/**
 * The built-in executor of "grpc" tool bindings (specification 17.8): one
 * unary call, described by the .proto files the deployment provides or by
 * the server's reflection service, over TLS unless the deployment allows
 * plaintext for the host, with the tool's timeout as its deadline.
 *
 * It needs the optional packages @grpc/grpc-js and @grpc/proto-loader. The
 * SDK loads without them; a gRPC call then fails with VALIDATION_ERROR.
 */

import fs from 'fs';
import { ToolError, check_host } from './errors';
import { Closeable, ToolSessions } from './sessions';

export interface GrpcOptions {
    /** .proto files that describe the services the tools call */
    protos?: string[];
    /** Directories in which the imports of those files are looked up */
    include_dirs?: string[];
    /** Whether a service no file describes is learned from the server's reflection service. Default true. */
    reflection?: boolean;
    /** Hosts ("host" or "host:port") that may be called in plaintext. Every other call uses TLS. */
    plaintext_hosts?: string[];
    /** PEM file of the roots that TLS servers are checked against. Default: the system's. */
    root_certificates?: string;
}

const LOADER_OPTIONS = { keepCase: true, longs: String, enums: String, bytes: String, defaults: true, oneofs: false };

interface Libraries { grpc: any; loader: any }

async function libraries(): Promise<Libraries> {
    try {
        // Named through variables so that bundlers and the type checker leave the optional packages alone
        const grpc_name = '@grpc/grpc-js';
        const loader_name = '@grpc/proto-loader';
        const grpc: any = await import(grpc_name);
        const loader: any = await import(loader_name);
        return { grpc: grpc.default && !grpc.Client ? grpc.default : grpc, loader: loader.default && !loader.load ? loader.default : loader };
    } catch {
        throw new ToolError('gRPC tools need the optional packages "@grpc/grpc-js" and "@grpc/proto-loader". Install them with: npm install @grpc/grpc-js @grpc/proto-loader', 'VALIDATION_ERROR');
    }
}

/** The address a binding calls, without any scheme: "host:port" */
export function grpc_address(endpoint: string): string {
    return endpoint.replace(/^[a-z][a-z0-9+.-]*:\/\/+/i, '').replace(/\/+$/, '');
}

function hostname(address: string): string {
    return address.startsWith('[') ? address.slice(0, address.indexOf(']') + 1) : address.split(':')[0];
}

/** Whether a call to this address may be made in plaintext */
export function grpc_plaintext(address: string, options: GrpcOptions | undefined): boolean {
    const allowed = options?.plaintext_hosts || [];
    return allowed.includes(address) || allowed.includes(hostname(address));
}

/** Refuse an endpoint the deployment's list of hosts does not include (17.4) */
export function check_grpc_permission(endpoint: string, allowed_hosts: string[] | undefined): void {
    const address = grpc_address(endpoint);
    if (allowed_hosts && !allowed_hosts.includes(address) && !allowed_hosts.includes(hostname(address))) check_host(address, allowed_hosts);
}

class Channel implements Closeable {
    /** Methods of the services learned on this channel, by service name */
    public described = new Map<string, any>();
    constructor(public client: any) { }
    close(): void {
        this.client.close();
    }
}

class Protos implements Closeable {
    constructor(public definition: Record<string, any>) { }
    close(): void { }
}

// --- protobuf wire format, for the reflection service ------------------------

function varint(value: number): Buffer {
    const bytes: number[] = [];
    while (value > 0x7f) { bytes.push((value & 0x7f) | 0x80); value = Math.floor(value / 128); }
    bytes.push(value);
    return Buffer.from(bytes);
}

function string_field(field: number, text: string | Buffer): Buffer {
    const data = typeof text === 'string' ? Buffer.from(text, 'utf-8') : text;
    return Buffer.concat([varint((field << 3) | 2), varint(data.length), data]);
}

function* fields(buffer: Buffer): Generator<{ field: number; value: Buffer | number }> {
    let at = 0;
    const read_varint = () => {
        let result = 0, shift = 0, byte: number;
        do { byte = buffer[at++]; result += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80);
        return result;
    };
    while (at < buffer.length) {
        const key = read_varint();
        const field = Math.floor(key / 8), wire = key & 7;
        if (wire === 0) yield { field, value: read_varint() };
        else if (wire === 2) { const length = read_varint(); yield { field, value: buffer.subarray(at, at + length) }; at += length; }
        else if (wire === 1) at += 8;
        else if (wire === 5) at += 4;
        else throw new ToolError('The reflection service sent a message this client cannot read', 'TOOL_ERROR');
    }
}

/** The name and imports of a serialised FileDescriptorProto */
function file_header(descriptor: Buffer): { name: string; dependencies: string[] } {
    let name = '';
    const dependencies: string[] = [];
    for (const { field, value } of fields(descriptor)) {
        if (field === 1 && Buffer.isBuffer(value)) name = value.toString('utf-8');
        if (field === 3 && Buffer.isBuffer(value)) dependencies.push(value.toString('utf-8'));
    }
    return { name, dependencies };
}

/**
 * Ask the server's reflection service for the file that defines `symbol` and
 * every file it imports, and give them back as a FileDescriptorSet.
 */
async function reflect(grpc: any, client: any, symbol: string, deadline: number): Promise<Buffer> {
    let last: unknown;
    for (const version of ['v1', 'v1alpha']) {
        try {
            return await reflect_with(grpc, client, `/grpc.reflection.${version}.ServerReflection/ServerReflectionInfo`, symbol, deadline);
        } catch (error) {
            last = error;
            if ((error as { code?: number }).code !== grpc.status.UNIMPLEMENTED) throw error;
        }
    }
    throw last;
}

function reflect_with(grpc: any, client: any, path: string, symbol: string, deadline: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const stream = client.makeBidiStreamRequest(path, (b: Buffer) => b, (b: Buffer) => b, new grpc.Metadata(), { deadline });
        const files = new Map<string, Buffer>();
        const asked = new Set<string>();
        let outstanding = 0;
        const ask = (field: number, value: string) => { outstanding++; stream.write(string_field(field, value)); };
        stream.on('data', (message: Buffer) => {
            outstanding--;
            for (const { field, value } of fields(message)) {
                if (field === 7 && Buffer.isBuffer(value)) {
                    let text = 'not found';
                    for (const inner of fields(value)) if (inner.field === 2 && Buffer.isBuffer(inner.value)) text = inner.value.toString('utf-8');
                    stream.cancel();
                    return reject(new ToolError(`The server's reflection service does not describe "${symbol}": ${text}`, 'VALIDATION_ERROR'));
                }
                if (field === 4 && Buffer.isBuffer(value)) {
                    for (const inner of fields(value)) {
                        if (inner.field !== 1 || !Buffer.isBuffer(inner.value)) continue;
                        const descriptor = Buffer.from(inner.value);
                        files.set(file_header(descriptor).name, descriptor);
                    }
                }
            }
            // Imports the server did not send are asked for by name
            for (const descriptor of [...files.values()]) {
                for (const dependency of file_header(descriptor).dependencies) {
                    if (!files.has(dependency) && !asked.has(dependency)) { asked.add(dependency); ask(3, dependency); }
                }
            }
            if (outstanding === 0) {
                stream.end();
                resolve(Buffer.concat([...files.values()].map(descriptor => string_field(1, descriptor))));
            }
        });
        stream.on('error', reject);
        ask(4, symbol);
    });
}

/** Run a "grpc" binding */
export async function call_grpc(
    binding: { endpoint: string; service: string; method: string }, args: Record<string, unknown>,
    context: { options?: GrpcOptions; sessions: ToolSessions; timeout_ms: number; signal: AbortSignal },
): Promise<{ status: string; result: unknown }> {
    const { grpc, loader } = await libraries();
    const options = context.options || {};
    const address = grpc_address(binding.endpoint);
    const plaintext = grpc_plaintext(address, options);
    const deadline = Date.now() + context.timeout_ms;

    const channel = await context.sessions.get(`grpc:${plaintext ? 'plain' : 'tls'}:${address}`, async () => {
        const credentials = plaintext
            ? grpc.credentials.createInsecure()
            : grpc.credentials.createSsl(options.root_certificates ? fs.readFileSync(options.root_certificates) : undefined);
        return new Channel(new grpc.Client(address, credentials));
    });

    // The service, from the deployment's .proto files, else from the server
    let service = channel.described.get(binding.service);
    if (!service && options.protos?.length) {
        const protos = await context.sessions.get('grpc-protos', async () => new Protos(
            await loader.load(options.protos, { ...LOADER_OPTIONS, includeDirs: options.include_dirs || [] })));
        service = protos.definition[binding.service];
    }
    if (!service && options.reflection !== false) {
        const set = await reflect(grpc, channel.client, binding.service, deadline);
        service = loader.loadFileDescriptorSetFromBuffer(set, LOADER_OPTIONS)[binding.service];
    }
    if (!service) throw new ToolError(`No .proto file of this deployment describes the service "${binding.service}"${options.reflection === false ? ', and reflection is off' : ''}`, 'VALIDATION_ERROR');
    channel.described.set(binding.service, service);

    const method = service[binding.method];
    if (!method) throw new ToolError(`The service "${binding.service}" has no method "${binding.method}"`, 'VALIDATION_ERROR');
    if (method.requestStream || method.responseStream) throw new ToolError(`"${binding.service}/${binding.method}" is a streaming method; gRPC tools make unary calls only`, 'VALIDATION_ERROR');

    const names: Record<number, string> = Object.fromEntries(Object.entries(grpc.status).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v as number, k]));
    return new Promise((resolve, reject) => {
        const call = channel.client.makeUnaryRequest(method.path, method.requestSerialize, method.responseDeserialize, args, new grpc.Metadata(), { deadline },
            (error: any, response: unknown) => {
                if (error) {
                    const status = names[error.code] || String(error.code);
                    return reject(new ToolError(error.details || error.message, status === 'DEADLINE_EXCEEDED' ? 'TIMEOUT' : 'TOOL_ERROR', { status }));
                }
                resolve({ status: 'OK', result: without_nulls(response) });
            });
        context.signal.addEventListener('abort', () => call.cancel(), { once: true });
    });
}

/** A message field that is not set is absent, not null (17.8) */
function without_nulls(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(without_nulls);
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, without_nulls(v)]));
    }
    return value;
}
