/**
 * The built-in executor of "mcp" tool bindings (specification 17.7).
 *
 * A deployment declares its Model Context Protocol servers by name: a program
 * the engine starts and speaks to over standard input and output, or an
 * address it reaches over Streamable HTTP. A binding names the server and the
 * tool. Connections are opened with the initialize handshake of MCP revision
 * 2025-11-25, kept for the run, and closed when it ends or waits.
 *
 * The client is written here, with no dependency: MCP is JSON-RPC 2.0 over
 * one of two transports.
 */

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { ToolError, check_host, web_url, with_secrets } from './errors';
import { Closeable, ToolSessions } from './sessions';

/** The MCP revision the engine asks for */
export const MCP_PROTOCOL_VERSION = '2025-11-25';
/** Revisions a server may answer with */
export const MCP_ACCEPTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

/** A server the deployment declares: a program, or an address */
export type McpServerConfig =
    | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
    | { url: string; headers?: Record<string, string> };

interface Message {
    jsonrpc?: '2.0';
    id?: number | string | null;
    method?: string;
    params?: unknown;
    result?: any;
    error?: { code: number; message: string; data?: unknown };
}

interface Transport {
    send(message: Message, signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
    /** Set once the handshake has fixed the revision and the session */
    negotiated?(version: string): void;
}

type Settle = { resolve: (m: Message) => void; reject: (e: Error) => void };

/** One connection to one MCP server, opened by the initialize handshake */
export class McpConnection implements Closeable {
    private next_id = 1;
    private pending = new Map<number | string, Settle>();
    private transport!: Transport;
    private closed = false;
    public server_info: { name?: string; version?: string } = {};
    public protocol_version = '';

    private constructor(public readonly name: string) { }

    static async open(name: string, config: McpServerConfig, context: { secrets: Record<string, string>; allowed_hosts?: string[]; max_output_bytes: number; signal?: AbortSignal }): Promise<McpConnection> {
        const connection = new McpConnection(name);
        const deliver = (message: Message) => connection.receive(message);
        const fail = (error: Error) => connection.fail(error);
        connection.transport = 'command' in config
            ? new StdioTransport(name, config, context.max_output_bytes, deliver, fail)
            : new HttpTransport(name, config, context, deliver);
        try {
            const result = await connection.request('initialize', {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'awa', version: '2' },
            }, context.signal);
            const version = String(result?.protocolVersion || '');
            if (!MCP_ACCEPTED_VERSIONS.includes(version)) {
                throw new ToolError(`MCP server "${name}" answered with protocol revision "${version}", which this engine does not speak`, 'TOOL_ERROR');
            }
            connection.protocol_version = version;
            connection.server_info = result?.serverInfo || {};
            connection.transport.negotiated?.(version);
            await connection.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            return connection;
        } catch (error) {
            await connection.close();
            throw error;
        }
    }

    /** Send a request and wait for its answer. A JSON-RPC error rejects with its code as status. */
    async request(method: string, params: unknown, signal?: AbortSignal): Promise<any> {
        if (this.closed) throw new ToolError(`The connection to MCP server "${this.name}" is closed`, 'TOOL_ERROR');
        const id = this.next_id++;
        const answer = new Promise<Message>((resolve, reject) => this.pending.set(id, { resolve, reject }));
        answer.catch(() => { }); // settled by whichever comes first; the caller sees the error below
        const onAbort = () => {
            // The server is told the request is cancelled; the runner reports the timeout
            this.pending.get(id)?.reject(new ToolError(`MCP request ${method} was cancelled`, 'TIMEOUT'));
            this.pending.delete(id);
            this.transport.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } }).catch(() => { });
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            await this.transport.send({ jsonrpc: '2.0', id, method, params }, signal);
            const reply = await answer;
            if (reply.error) {
                throw new ToolError(`MCP error ${reply.error.code} from "${this.name}": ${reply.error.message}`, 'TOOL_ERROR', { status: reply.error.code });
            }
            return reply.result;
        } finally {
            this.pending.delete(id);
            signal?.removeEventListener('abort', onAbort);
        }
    }

    /** Call a tool. The outcome is mapped as specification 17.7 says. */
    async call_tool(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
        const result = await this.request('tools/call', { name: tool, arguments: args }, signal);
        const content: any[] = Array.isArray(result?.content) ? result.content : [];
        if (result?.isError) {
            const text = content.filter(c => c?.type === 'text').map(c => c.text).join('\n') || `Tool "${tool}" reported an error`;
            throw new ToolError(text, 'TOOL_ERROR', { result: content });
        }
        if (result && result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent;
        if (content.length === 1 && content[0]?.type === 'text') {
            const text = String(content[0].text ?? '');
            try { return JSON.parse(text); } catch { return text; }
        }
        return content;
    }

    private receive(message: Message): void {
        if (message.method !== undefined) {
            // A request from the server: answer ping, refuse the rest. Notifications are ignored.
            if (message.id !== undefined && message.id !== null) {
                const reply: Message = message.method === 'ping'
                    ? { jsonrpc: '2.0', id: message.id, result: {} }
                    : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `This client does not offer ${message.method}` } };
                this.transport.send(reply).catch(() => { });
            }
            return;
        }
        if (message.id === undefined || message.id === null) return;
        const settle = this.pending.get(message.id);
        if (settle) settle.resolve(message);
    }

    private fail(error: Error): void {
        for (const settle of this.pending.values()) settle.reject(error);
        this.pending.clear();
        this.closed = true;
    }

    async close(): Promise<void> {
        if (this.closed && !this.transport) return;
        this.closed = true;
        this.fail(new ToolError(`The connection to MCP server "${this.name}" was closed`, 'TOOL_ERROR'));
        await this.transport?.close().catch(() => { });
    }
}

/** A server the engine starts: newline-delimited JSON-RPC over its standard input and output */
class StdioTransport implements Transport {
    private child: ChildProcessWithoutNullStreams;
    private buffer = '';
    private stderr = '';
    private exited = false;

    constructor(private name: string, config: { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }, limit: number,
        deliver: (m: Message) => void, fail: (e: Error) => void) {
        // No shell: each element of args is one argument
        this.child = spawn(config.command, config.args || [], {
            env: { ...process.env, ...(config.env || {}) }, cwd: config.cwd, stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.child.stdout.setEncoding('utf-8');
        this.child.stdout.on('data', (chunk: string) => {
            this.buffer += chunk;
            if (this.buffer.length > limit && !this.buffer.includes('\n')) {
                fail(new ToolError(`MCP server "${name}" sent a message larger than ${limit} bytes`, 'TOOL_ERROR'));
                this.child.kill();
                return;
            }
            let newline: number;
            while ((newline = this.buffer.indexOf('\n')) >= 0) {
                const line = this.buffer.slice(0, newline).trim();
                this.buffer = this.buffer.slice(newline + 1);
                if (!line) continue;
                if (Buffer.byteLength(line) > limit) { fail(new ToolError(`MCP server "${name}" sent a message larger than ${limit} bytes`, 'TOOL_ERROR')); continue; }
                let message: Message;
                try { message = JSON.parse(line); } catch { continue; } // a line that is not JSON-RPC is not a message
                deliver(message);
            }
        });
        this.child.stderr.setEncoding('utf-8');
        this.child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-2000); });
        this.child.stdin.on('error', () => { });
        this.child.on('error', error => {
            this.exited = true;
            fail(new ToolError(`MCP server "${name}" could not be started: ${error.message}`, 'TOOL_ERROR'));
        });
        this.child.on('exit', code => {
            this.exited = true;
            fail(new ToolError(`MCP server "${name}" exited${code !== null ? ` with code ${code}` : ''}${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').pop()}` : ''}`, 'TOOL_ERROR'));
        });
    }

    async send(message: Message): Promise<void> {
        if (this.exited) throw new ToolError(`MCP server "${this.name}" is not running`, 'TOOL_ERROR');
        await new Promise<void>((resolve, reject) => this.child.stdin.write(`${JSON.stringify(message)}\n`, error => (error ? reject(new ToolError(`Could not write to MCP server "${this.name}": ${error.message}`, 'TOOL_ERROR')) : resolve())));
    }

    async close(): Promise<void> {
        if (this.exited) return;
        this.child.stdin.end();
        const gone = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
        const timer = setTimeout(() => this.child.kill('SIGTERM'), 1000);
        const hard = setTimeout(() => this.child.kill('SIGKILL'), 3000);
        await gone;
        clearTimeout(timer);
        clearTimeout(hard);
    }
}

/** A server at an address: Streamable HTTP. Each message is POSTed; the answer comes as JSON or as an event stream. */
class HttpTransport implements Transport {
    private session?: string;
    private version?: string;
    private url: URL;
    private headers: Record<string, string> = {};

    constructor(private name: string, config: { url: string; headers?: Record<string, string> },
        private context: { secrets: Record<string, string>; allowed_hosts?: string[]; max_output_bytes: number },
        private deliver: (m: Message) => void) {
        this.url = web_url(config.url);
        check_host(this.url.host, context.allowed_hosts);
        for (const [name, value] of Object.entries(config.headers || {})) this.headers[name.toLowerCase()] = with_secrets(value, context.secrets);
    }

    negotiated(version: string): void {
        this.version = version;
    }

    private request_headers(): Record<string, string> {
        return {
            ...this.headers,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(this.session ? { 'mcp-session-id': this.session } : {}),
            ...(this.version ? { 'mcp-protocol-version': this.version } : {}),
        };
    }

    async send(message: Message, signal?: AbortSignal): Promise<void> {
        const response = await fetch(this.url, { method: 'POST', headers: this.request_headers(), body: JSON.stringify(message), redirect: 'manual', signal })
            .catch((error: Error) => { throw new ToolError(`MCP server "${this.name}" at ${this.url.host} could not be reached: ${error.message}`, 'TOOL_ERROR'); });
        // A redirect is not followed: the server is the address the deployment declared
        if (response.status >= 300 && response.status < 400) throw new ToolError(`MCP server "${this.name}" answered with a redirect, which is not followed`, 'TOOL_ERROR');
        const session = response.headers.get('mcp-session-id');
        if (session) this.session = session;
        if (response.status === 202 || response.status === 204) return;
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            // An error about a request is delivered as its answer, so the caller sees it
            let body: Message | undefined;
            try { body = JSON.parse(text); } catch { /* not JSON-RPC */ }
            if (body && body.error && message.id !== undefined) { this.deliver({ ...body, id: body.id ?? message.id }); return; }
            throw new ToolError(`HTTP ${response.status} from MCP server "${this.name}"`, 'TOOL_ERROR', { status: response.status });
        }
        const type = response.headers.get('content-type') || '';
        if (!response.body) return;
        const limit = this.context.max_output_bytes;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let size = 0;
        const read = async (each: (chunk: string) => boolean | void) => {
            for (; ;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > limit) { await reader.cancel().catch(() => { }); throw new ToolError(`MCP server "${this.name}" sent a reply larger than ${limit} bytes`, 'TOOL_ERROR'); }
                if (each(decoder.decode(value, { stream: true })) === true) { await reader.cancel().catch(() => { }); break; }
            }
        };
        if (type.includes('text/event-stream')) {
            // Each event's data is one JSON-RPC message. The stream is read until the answer to this request has come.
            let event = '';
            let answered = false;
            const lines = (chunk: string) => {
                text += chunk;
                let newline: number;
                while ((newline = text.indexOf('\n')) >= 0) {
                    const line = text.slice(0, newline).replace(/\r$/, '');
                    text = text.slice(newline + 1);
                    if (line === '') {
                        if (event) {
                            try {
                                const parsed = JSON.parse(event) as Message;
                                this.deliver(parsed);
                                if (message.id !== undefined && parsed.id === message.id && parsed.method === undefined) answered = true;
                            } catch { /* not a message */ }
                        }
                        event = '';
                    } else if (line.startsWith('data:')) {
                        event += (event ? '\n' : '') + line.slice(5).replace(/^ /, '');
                    }
                }
                return answered;
            };
            await read(lines);
            return;
        }
        await read(chunk => { text += chunk; });
        if (!text.trim()) return;
        let body: Message | Message[];
        try { body = JSON.parse(text); } catch { throw new ToolError(`MCP server "${this.name}" did not answer in JSON`, 'TOOL_ERROR'); }
        for (const item of Array.isArray(body) ? body : [body]) this.deliver(item);
    }

    async close(): Promise<void> {
        if (!this.session) return;
        // Ending the session is a courtesy; a server that does not support it answers 405
        await fetch(this.url, { method: 'DELETE', headers: this.request_headers(), redirect: 'manual', signal: AbortSignal.timeout(2000) }).catch(() => { });
    }
}

/** Run an "mcp" binding: the server's connection is taken from the run's sessions, or opened */
export async function call_mcp_tool(
    binding: { server: string; tool: string }, args: Record<string, unknown>,
    context: { servers?: Record<string, McpServerConfig>; sessions: ToolSessions; secrets: Record<string, string>; allowed_hosts?: string[]; max_output_bytes: number; signal: AbortSignal },
): Promise<unknown> {
    const config = context.servers?.[binding.server];
    if (!config) throw new ToolError(`This deployment declares no MCP server "${binding.server}"`, 'PERMISSION_DENIED');
    const key = `mcp:${binding.server}`;
    const connection = await context.sessions.get(key, () => McpConnection.open(binding.server, config, context));
    try {
        return await connection.call_tool(binding.tool, args, context.signal);
    } catch (error) {
        // A connection that broke is not reused
        if ((error as ToolError).code === 'TOOL_ERROR' && (error as { status?: unknown }).status === undefined && !(error as { result?: unknown }).result) {
            await context.sessions.discard(key);
        }
        throw error;
    }
}
