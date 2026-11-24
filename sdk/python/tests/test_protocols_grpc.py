"""
The built-in gRPC executor (specification 17.8), against a server the tests start
on localhost, described by a .proto file or by the server's reflection service.
"""

import time
from concurrent import futures
from pathlib import Path

import pytest

from awa.runtime.protocols.sessions import ToolSessions
from awa.runtime.tools import ToolRunner
from awa.types import ToolBinding, ToolDefinition

grpc = pytest.importorskip("grpc", reason="gRPC tools need the 'grpc' extra")
pytest.importorskip("grpc_tools", reason="reading .proto files needs grpcio-tools")
pytest.importorskip("grpc_reflection", reason="server reflection needs grpcio-reflection")

PROTO = str(Path(__file__).parent / "fixtures" / "pricing.proto")
calls = {"n": 0}


@pytest.fixture(scope="module")
def address():
    from google.protobuf import descriptor_pool, message_factory
    from grpc_reflection.v1alpha import reflection
    from awa.runtime.protocols.grpc import _compile

    pool = _compile([PROTO], [])
    service = pool.FindServiceByName("pricing.Quotes")
    Request = message_factory.GetMessageClass(pool.FindMessageTypeByName("pricing.QuoteRequest"))
    Quote = message_factory.GetMessageClass(pool.FindMessageTypeByName("pricing.Quote"))

    def get(request, context):
        calls["n"] += 1
        if request.sku == "missing":
            context.abort(grpc.StatusCode.NOT_FOUND, f"No price for {request.sku}")
        if request.sku == "slow":
            time.sleep(1)
        quote = Quote(sku=request.sku, total_cents=1999 * request.quantity, currency=1, notes=["list price"])
        if request.quantity > 1:
            quote.detail.source = "catalogue"
        return quote

    handler = grpc.method_handlers_generic_handler("pricing.Quotes", {
        "Get": grpc.unary_unary_rpc_method_handler(get, request_deserializer=Request.FromString,
                                                   response_serializer=lambda m: m.SerializeToString()),
        "Watch": grpc.unary_stream_rpc_method_handler(lambda request, context: iter(()), request_deserializer=Request.FromString,
                                                      response_serializer=lambda m: m.SerializeToString()),
    })
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    server.add_generic_rpc_handlers((handler,))
    reflection.enable_server_reflection(["pricing.Quotes", reflection.SERVICE_NAME], server, pool)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    assert service.methods_by_name["Get"]
    yield f"127.0.0.1:{port}"
    server.stop(0)


def tool(address, method="Get", timeout=None, name=None):
    return ToolDefinition(name=name or f"quote_{method.lower()}", timeout=timeout,
                          binding=ToolBinding(kind="grpc", endpoint=address, service="pricing.Quotes", method=method))


def runner(tools, options, simulate=False):
    events = []
    return ToolRunner(tools, options, lambda type, data: events.append((type, data)), max_calls=20, simulate=simulate), events


PLAIN = {"protos": [PROTO], "plaintext_hosts": ["127.0.0.1"]}


def test_a_unary_call_described_by_a_proto_file(address):
    tools, events = runner([tool(address)], {"grpc": PLAIN})
    result = tools.call("quote_get", {"sku": "S-1", "quantity": 1})
    assert result.ok
    # 64-bit integers as strings, enumerations by name, scalar and repeated fields present, an unset message absent
    assert result.result == {"sku": "S-1", "total_cents": "1999", "currency": "USD", "notes": ["list price"], "discounted": False}
    completed = next(data for type, data in events if type == "tool.completed")
    assert completed["status"] == "OK" and completed["link"] == f"grpc://{address}/pricing.Quotes/Get"


def test_the_service_is_learned_by_reflection(address):
    tools, _ = runner([tool(address)], {"grpc": {"plaintext_hosts": [address]}})
    result = tools.call("quote_get", {"sku": "S-2", "quantity": 2}).result
    assert result["total_cents"] == "3998" and result["detail"] == {"source": "catalogue"}


def test_without_a_file_or_reflection_the_service_is_unknown(address):
    tools, _ = runner([tool(address)], {"grpc": {"reflection": False, "plaintext_hosts": ["127.0.0.1"]}})
    assert tools.call("quote_get", {"sku": "S-2"}).result["code"] == "VALIDATION_ERROR"


def test_status_codes_and_the_deadline(address):
    tools, events = runner([tool(address), tool(address, timeout="PT0.2S", name="slow")], {"grpc": PLAIN})
    missing = tools.call("quote_get", {"sku": "missing"}).result
    assert missing == {"error": "No price for missing", "code": "TOOL_ERROR"}
    failed = next(data for type, data in events if type == "tool.failed")
    assert failed["status"] == "NOT_FOUND" and failed["invoked"] is True
    assert tools.call("slow", {"sku": "slow"}).result["code"] == "TIMEOUT"


def test_streaming_methods_are_refused(address):
    tools, _ = runner([tool(address, "Watch")], {"grpc": PLAIN})
    result = tools.call("quote_watch", {"sku": "S-1"}).result
    assert result["code"] == "VALIDATION_ERROR" and "streaming" in result["error"]


def test_tls_unless_the_deployment_allows_plaintext(address):
    before = calls["n"]
    tools, events = runner([tool(address, timeout="PT2S")], {"grpc": {"protos": [PROTO]}})
    assert tools.call("quote_get", {"sku": "S-1", "quantity": 1}).result["code"] in ("TOOL_ERROR", "TIMEOUT")
    assert calls["n"] == before


def test_an_endpoint_not_on_the_list_of_hosts_is_refused(address):
    before = calls["n"]
    tools, events = runner([tool(address)], {"allowed_hosts": ["api.example.com"], "grpc": PLAIN})
    assert tools.call("quote_get", {"sku": "S-1"}).result["code"] == "PERMISSION_DENIED"
    assert [type for type, _ in events] == ["tool.failed"] and calls["n"] == before
    allowed, _ = runner([tool(address)], {"allowed_hosts": [address], "grpc": PLAIN})
    assert allowed.call("quote_get", {"sku": "S-1", "quantity": 1}).ok


def test_simulation_calls_nothing(address):
    before = calls["n"]
    tools, _ = runner([tool(address)], {"grpc": PLAIN, "simulated_results": {"quote_get": {"sku": "sim"}}}, simulate=True)
    assert tools.call("quote_get", {"sku": "S-1"}).result == {"sku": "sim"}
    assert calls["n"] == before


def test_one_channel_for_the_calls_of_a_run(address):
    sessions = ToolSessions()
    tools, _ = runner([tool(address)], {"sessions": sessions, "grpc": {"plaintext_hosts": ["127.0.0.1"]}})
    tools.call("quote_get", {"sku": "S-1", "quantity": 1})
    tools.call("quote_get", {"sku": "S-2", "quantity": 1})
    assert len(sessions) == 1
    sessions.close()
