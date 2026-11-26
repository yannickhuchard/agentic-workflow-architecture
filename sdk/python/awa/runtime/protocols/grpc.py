"""
The built-in executor of "grpc" tool bindings (specification 17.8): one unary
call, described by the .proto files the deployment provides or by the
server's reflection service, over TLS unless the deployment allows plaintext
for the host, with the tool's timeout as its deadline.

It needs the `grpc` extra: grpcio, grpcio-tools (to read .proto files) and
grpcio-reflection. The SDK loads without them; a gRPC call then fails with
VALIDATION_ERROR.
"""

import os
import re
import tempfile
import threading
from typing import Any

from awa.runtime.tools import ToolError

_lock = threading.Lock()


def _libraries() -> tuple[Any, Any, Any, Any]:
    try:
        import grpc
        from google.protobuf import descriptor_pb2, descriptor_pool, json_format
    except ImportError:
        raise ToolError('gRPC tools need the "grpc" extra: pip install "agentic-workflow-architecture[grpc]"',
                        "VALIDATION_ERROR") from None
    return grpc, descriptor_pb2, descriptor_pool, json_format


def grpc_address(endpoint: str) -> str:
    """The address a binding calls, without any scheme: "host:port" """
    return re.sub(r"^[a-z][a-z0-9+.-]*:/+", "", endpoint, flags=re.IGNORECASE).rstrip("/")


def _hostname(address: str) -> str:
    return address[:address.index("]") + 1] if address.startswith("[") else address.split(":")[0]


def grpc_plaintext(address: str, options: dict[str, Any] | None) -> bool:
    """Whether a call to this address may be made in plaintext"""
    allowed = (options or {}).get("plaintext_hosts") or []
    return address in allowed or _hostname(address) in allowed


def check_grpc_permission(endpoint: str, allowed_hosts: list[str] | None) -> None:
    """Refuse an endpoint the deployment's list of hosts does not include (17.4)"""
    address = grpc_address(endpoint)
    if allowed_hosts is not None and address not in allowed_hosts and _hostname(address) not in allowed_hosts:
        raise ToolError(f'This deployment does not allow calls to host "{address}"', "PERMISSION_DENIED")


class _Channel:
    def __init__(self, channel: Any) -> None:
        self.channel = channel
        self.pool: Any = None
        self.services: dict[str, Any] = {}

    def close(self) -> None:
        self.channel.close()


class _Protos:
    """The deployment's .proto files, compiled into a descriptor pool"""

    def __init__(self, pool: Any) -> None:
        self.pool = pool

    def close(self) -> None:
        pass


def _compile(protos: list[str], include_dirs: list[str]) -> Any:
    _, descriptor_pb2, descriptor_pool, _ = _libraries()
    try:
        from grpc_tools import protoc
    except ImportError:
        raise ToolError('Reading .proto files needs grpcio-tools: pip install "agentic-workflow-architecture[grpc]"',
                        "VALIDATION_ERROR") from None
    import importlib.resources
    well_known = str(importlib.resources.files("grpc_tools") / "_proto")
    with tempfile.TemporaryDirectory() as directory:
        out = os.path.join(directory, "set.pb")
        dirs = list(dict.fromkeys([*include_dirs, *(os.path.dirname(os.path.abspath(p)) for p in protos), well_known]))
        with _lock:  # protoc keeps global state
            code = protoc.main(["protoc", *(f"-I{d}" for d in dirs), f"--descriptor_set_out={out}", "--include_imports",
                                *(os.path.abspath(p) for p in protos)])
        if code != 0:
            raise ToolError(f"The .proto files of this deployment could not be read: {', '.join(protos)}", "VALIDATION_ERROR")
        files = descriptor_pb2.FileDescriptorSet()
        with open(out, "rb") as handle:
            files.ParseFromString(handle.read())
    pool = descriptor_pool.DescriptorPool()
    for file in files.file:
        pool.Add(file)
    return pool


def _reflect(channel: Any, service: str) -> Any:
    """A descriptor pool fed by the server's reflection service"""
    try:
        from grpc_reflection.v1alpha.proto_reflection_descriptor_database import ProtoReflectionDescriptorDatabase
    except ImportError:
        raise ToolError('Server reflection needs grpcio-reflection: pip install "agentic-workflow-architecture[grpc]"',
                        "VALIDATION_ERROR") from None
    _, _, descriptor_pool, _ = _libraries()
    return descriptor_pool.DescriptorPool(ProtoReflectionDescriptorDatabase(channel))


def _status_name(code: Any) -> str:
    name = getattr(code, "name", None)
    return str(name) if name else str(code)


def call_grpc(binding: Any, args: dict[str, Any], context: Any) -> Any:
    """Run a "grpc" binding"""
    from awa.runtime.tools import ToolExecution
    grpc, _, _, json_format = _libraries()
    from google.protobuf import message_factory
    options = (context.options.grpc if context.options is not None else None) or {}
    address = grpc_address(binding.endpoint or "")
    plaintext = grpc_plaintext(address, options)

    def open_channel() -> _Channel:
        if plaintext:
            return _Channel(grpc.insecure_channel(address))
        roots = None
        if options.get("root_certificates"):
            with open(options["root_certificates"], "rb") as handle:
                roots = handle.read()
        return _Channel(grpc.secure_channel(address, grpc.ssl_channel_credentials(root_certificates=roots)))

    channel = context.sessions.get(f"grpc:{'plain' if plaintext else 'tls'}:{address}", open_channel)

    # The service, from the deployment's .proto files, else from the server
    service = channel.services.get(binding.service)
    if service is None and options.get("protos"):
        protos = context.sessions.get("grpc-protos", lambda: _Protos(_compile(options["protos"], options.get("include_dirs") or [])))
        try:
            service = protos.pool.FindServiceByName(binding.service)
        except KeyError:
            service = None
    if service is None and options.get("reflection", True) is not False:
        if channel.pool is None:
            channel.pool = _reflect(channel.channel, binding.service)
        try:
            service = channel.pool.FindServiceByName(binding.service)
        except KeyError:
            raise ToolError(f'The server\'s reflection service does not describe "{binding.service}"', "VALIDATION_ERROR") from None
        except grpc.RpcError as error:
            status = _status_name(error.code())
            raise ToolError(f"Reflection failed: {error.details() or status}", "TIMEOUT" if status == "DEADLINE_EXCEEDED" else "TOOL_ERROR", status) from None
    if service is None:
        reflection = ", and reflection is off" if options.get("reflection", True) is False else ""
        raise ToolError(f'No .proto file of this deployment describes the service "{binding.service}"{reflection}', "VALIDATION_ERROR")
    channel.services[binding.service] = service

    method = service.methods_by_name.get(binding.method)
    if method is None:
        raise ToolError(f'The service "{binding.service}" has no method "{binding.method}"', "VALIDATION_ERROR")
    if method.client_streaming or method.server_streaming:
        raise ToolError(f'"{binding.service}/{binding.method}" is a streaming method; gRPC tools make unary calls only', "VALIDATION_ERROR")

    request_class = message_factory.GetMessageClass(method.input_type)
    response_class = message_factory.GetMessageClass(method.output_type)
    try:
        request = json_format.ParseDict(args, request_class())
    except json_format.ParseError as error:
        raise ToolError(f"The arguments are not a {method.input_type.full_name}: {error}", "VALIDATION_ERROR") from None
    call = channel.channel.unary_unary(f"/{binding.service}/{binding.method}",
                                       request_serializer=lambda m: m.SerializeToString(),
                                       response_deserializer=response_class.FromString)
    try:
        response = call(request, timeout=context.remaining_seconds)
    except grpc.RpcError as error:
        status = _status_name(error.code())
        raise ToolError(error.details() or status, "TIMEOUT" if status == "DEADLINE_EXCEEDED" else "TOOL_ERROR", status) from None
    try:
        result = json_format.MessageToDict(response, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)
    except TypeError:  # protobuf before 5.26
        result = json_format.MessageToDict(response, preserving_proto_field_name=True, including_default_value_fields=True)
    return ToolExecution(result, "OK")
