/**
 * AWA Tools (specification section 17)
 *
 * A tool is a function an actor may call while performing an activity. Each
 * tool declares a binding: the API, command or remote procedure that
 * actually runs. Every call goes through the ToolRunner, which checks the
 * arguments, applies the deployment's permissions, executes the binding and
 * journals what was called, when, with what, and the link to what ran.
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { ToolBinding, ToolDefinition } from '../types';
import { parse_iso_duration } from './duration_utils';
import { JournalEventInput } from './journal';
import { ToolSpec } from './models';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

export interface ToolResult {
    ok: boolean;
    /** What the tool returned, or a description of the error */
    result: unknown;
    /** The result as text, in the form given back to a model */
    content: string;
}

export interface ToolExecution {
    /** HTTP status, process exit code, or similar */
    status?: number | string;
    result: unknown;
}

export type ToolExecutor = (
    binding: ToolBinding, args: Record<string, unknown>,
    context: { call_id: string; secrets: Record<string, string>; signal: AbortSignal; allowed_hosts?: string[]; max_output_bytes?: number }
) => Promise<ToolExecution>;

export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export interface ToolOptions {
    /** Functions callable through bindings of kind "function", by name */
    handlers?: Record<string, ToolHandler>;
    /** Executors for binding kinds the engine does not implement itself (mcp, grpc), or replacements for those it does */
    executors?: Partial<Record<ToolBinding['kind'], ToolExecutor>>;
    /**
     * Whether "command" bindings may run. False by default: a workflow document
     * must not be able to run programs on the host unless the deployment says so.
     * A list allows only the named commands.
     */
    allow_commands?: boolean | string[];
    /** If set, "http" and "jsonrpc" bindings may only reach these hosts, redirects included */
    allowed_hosts?: string[];
    /** The most a call may return, in bytes. Default 4 MiB. A larger reply fails the call. */
    max_output_bytes?: number;
    /** Values for {{secret:NAME}} placeholders in binding headers. Never journalled. */
    secrets?: Record<string, string>;
    /** In simulation mode, what each tool returns, by tool name */
    simulated_results?: Record<string, unknown>;
}

class ToolError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
    }
}

const fill = (template: string, args: Record<string, unknown>, encode: (v: string) => string, used: Set<string>) =>
    template.replace(/\{([A-Za-z_][\w]*)\}/g, (whole, name) => {
        if (!(name in args)) return whole;
        used.add(name);
        return encode(String(args[name]));
    });

/** The request an "http" binding makes for given arguments */
export function http_request(binding: Extract<ToolBinding, { kind: 'http' }>, args: Record<string, unknown>) {
    const used = new Set<string>();
    const url = new URL(fill(binding.url, args, encodeURIComponent, used));
    const rest = Object.fromEntries(Object.entries(args).filter(([key]) => !used.has(key)));
    const method = (binding.method || 'GET').toUpperCase();
    let body: string | undefined;
    if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
        for (const [key, value] of Object.entries(rest)) {
            url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
    } else {
        body = JSON.stringify(rest);
    }
    return { method, url: url.toString(), body };
}

/** The argument list a "command" binding runs with for given arguments */
export function command_line(binding: Extract<ToolBinding, { kind: 'command' }>, args: Record<string, unknown>): string[] {
    const used = new Set<string>();
    // Each element is filled separately and passed as one argument: no shell, no splitting
    return (binding.args || []).map(arg => fill(arg, args, v => v, used));
}

/**
 * The link to what a call runs: a URL for an API, and a URI of the same kind
 * for everything else, so that every call can be traced to its target.
 */
export function tool_link(binding: ToolBinding, args: Record<string, unknown>): string {
    switch (binding.kind) {
        case 'http': {
            const request = http_request(binding, args);
            const url = new URL(request.url);
            // Query values are arguments, journalled separately under the payload mode
            return `${url.origin}${url.pathname}`;
        }
        case 'command': return `command:${binding.command}`;
        case 'jsonrpc': return `${binding.endpoint}#${binding.method}`;
        case 'grpc': return `grpc://${binding.endpoint.replace(/^[a-z][a-z0-9+.-]*:\/\/+/i, '')}/${binding.service}/${binding.method}`;
        case 'mcp': return `mcp://${binding.server}/${binding.tool}`;
        case 'function': return `function:${binding.name}`;
    }
}

const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;

/** A tool reaches the web over http or https and nothing else: no file:, no data:, no other scheme a URL can carry */
function web_url(text: string): URL {
    let url: URL;
    try { url = new URL(text); } catch { throw new ToolError(`"${text}" is not a URL`, 'VALIDATION_ERROR'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ToolError(`Tools call http and https addresses only, not ${url.protocol}`, 'VALIDATION_ERROR');
    return url;
}

/**
 * fetch for tools: redirects are followed here, one at a time, so that each hop is held to the
 * allowed hosts and headers that may carry secrets never follow a redirect to another origin;
 * and the reply is read up to a bound.
 */
async function bounded_fetch(address: string, init: { method: string; headers: Record<string, string>; body?: string },
    context: { signal: AbortSignal; allowed_hosts?: string[]; max_output_bytes?: number }): Promise<{ status: number; ok: boolean; text: string; host: string }> {
    let url = web_url(address);
    let { method, headers, body } = init;
    for (let hop = 0; ; hop++) {
        if (context.allowed_hosts && !context.allowed_hosts.includes(url.host)) throw new ToolError(`This deployment does not allow calls to host "${url.host}"`, 'PERMISSION_DENIED');
        const response = await fetch(url, { method, headers, body, signal: context.signal, redirect: 'manual' });
        const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
        if (location) {
            if (hop >= 5) throw new ToolError(`Too many redirects from ${new URL(address).host}`, 'TOOL_ERROR');
            const next = web_url(new URL(location, url).toString());
            if (next.origin !== url.origin) headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name === 'accept' || name === 'content-type'));
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
            url = next;
            continue;
        }
        const limit = context.max_output_bytes ?? DEFAULT_MAX_OUTPUT;
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (response.body) {
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > limit) { await reader.cancel().catch(() => { }); throw new ToolError(`The reply from ${url.host} is larger than ${limit} bytes`, 'TOOL_ERROR'); }
                chunks.push(value);
            }
        }
        return { status: response.status, ok: response.ok, text: Buffer.concat(chunks).toString('utf-8'), host: url.host };
    }
}

const built_in: Partial<Record<ToolBinding['kind'], ToolExecutor>> = {
    http: async (binding, args, context) => {
        if (binding.kind !== 'http') throw new Error('unreachable');
        const request = http_request(binding, args);
        const headers: Record<string, string> = { accept: 'application/json', ...(request.body ? { 'content-type': 'application/json' } : {}) };
        for (const [name, value] of Object.entries(binding.headers || {})) {
            headers[name.toLowerCase()] = value.replace(/\{\{secret:([\w-]+)\}\}/g, (_, key) => {
                if (!(key in context.secrets)) throw new ToolError(`Secret "${key}" is not configured`, 'VALIDATION_ERROR');
                return context.secrets[key];
            });
        }
        const response = await bounded_fetch(request.url, { method: request.method, headers, body: request.body }, context);
        let result: unknown = response.text;
        try { result = JSON.parse(response.text); } catch { /* not JSON: keep the text */ }
        if (!response.ok) {
            throw Object.assign(new ToolError(`HTTP ${response.status} from ${response.host}`, 'TOOL_ERROR'), { status: response.status, result });
        }
        return { status: response.status, result };
    },

    jsonrpc: async (binding, args, context) => {
        if (binding.kind !== 'jsonrpc') throw new Error('unreachable');
        const response = await bounded_fetch(binding.endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: context.call_id, method: binding.method, params: args }),
        }, context);
        if (!response.ok) throw Object.assign(new ToolError(`HTTP ${response.status} from ${response.host}`, 'TOOL_ERROR'), { status: response.status });
        let body: { result?: unknown; error?: { code?: number; message?: string } };
        try { body = JSON.parse(response.text); } catch { throw new ToolError(`${response.host} did not answer in JSON`, 'TOOL_ERROR'); }
        if (body.error) throw Object.assign(new ToolError(`RPC error ${body.error.code}: ${body.error.message}`, 'TOOL_ERROR'), { status: body.error.code });
        return { status: response.status, result: body.result };
    },

    command: (binding, args, context) => new Promise((resolve, reject) => {
        if (binding.kind !== 'command') return reject(new Error('unreachable'));
        const argv = command_line(binding, args);
        const child = execFile(binding.command, argv, { signal: context.signal, maxBuffer: context.max_output_bytes ?? DEFAULT_MAX_OUTPUT }, (error, stdout, stderr) => {
            if (error) {
                const exit = (error as { code?: number | string }).code;
                return reject(Object.assign(new ToolError(`Command "${binding.command}" failed: ${stderr.trim() || error.message}`, 'TOOL_ERROR'), { status: exit }));
            }
            let result: unknown = stdout.trim();
            try { result = JSON.parse(stdout); } catch { /* not JSON: keep the text */ }
            resolve({ status: 0, result });
        });
        // A program may exit without reading its input. That is its business, not an error of the call:
        // without this handler the broken pipe would be an uncaught exception in the host.
        child.stdin?.on('error', () => { });
        // Arguments not placed on the command line are given as JSON on standard input
        child.stdin?.end(binding.args?.some(a => /\{\w+\}/.test(a)) ? '' : JSON.stringify(args));
    }),
};

export type ToolRecorder = (event: JournalEventInput) => void;

/**
 * Runs the tools of one activity attempt and journals each call.
 * A failed call does not raise: the failure is returned, so an agent can
 * read it and try something else. It is journalled either way.
 */
export class ToolRunner {
    private calls = 0;
    private validators = new Map<string, ReturnType<typeof ajv.compile>>();

    constructor(
        private tools: ToolDefinition[],
        private options: ToolOptions,
        private record: ToolRecorder,
        private payload: (value: unknown) => unknown,
        private limits: { max_calls: number; simulate: boolean },
    ) { }

    /** The tools in the form given to a model */
    get specs(): ToolSpec[] {
        return this.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || { type: 'object', properties: {} },
        }));
    }

    get call_count(): number {
        return this.calls;
    }

    async call(name: string, args: Record<string, unknown>, call_id: string = randomUUID()): Promise<ToolResult> {
        const started = Date.now();
        const tool = this.tools.find(t => t.name === name);
        const link = tool ? safe_link(tool.binding, JSON.stringify(this.payload({ probe: 1 })) === '{"probe":1}' ? args : {}) : undefined;
        const failure = (error: unknown, invoked: boolean): ToolResult => {
            const message = error instanceof Error ? error.message : String(error);
            const code = (error as { code?: string })?.code || 'TOOL_ERROR';
            const status = (error as { status?: unknown })?.status;
            this.record({
                type: 'tool.failed',
                data: {
                    call_id, tool: name, ...(link ? { link } : {}), invoked,
                    error: { message, code }, ...(status !== undefined ? { status } : {}), duration_ms: Date.now() - started,
                },
            });
            const result = { error: message, code };
            return { ok: false, result, content: JSON.stringify(result) };
        };

        this.calls++;
        if (!tool) {
            return failure(new ToolError(`Unknown tool "${name}". Available: ${this.tools.map(t => t.name).join(', ') || 'none'}`, 'UNKNOWN_TOOL'), false);
        }
        if (this.calls > this.limits.max_calls) {
            return failure(new ToolError(`Tool call budget of ${this.limits.max_calls} exceeded`, 'TOOL_BUDGET_EXCEEDED'), false);
        }

        // Arguments are checked before anything runs
        if (tool.parameters) {
            if (!this.validators.has(name)) this.validators.set(name, ajv.compile(tool.parameters));
            const validate = this.validators.get(name)!;
            if (!validate(args)) {
                const detail = (validate.errors || []).map(e => `${e.instancePath || 'arguments'} ${e.message}`).join('; ');
                return failure(new ToolError(`Invalid arguments for "${name}": ${detail}`, 'VALIDATION_ERROR'), false);
            }
        }

        try {
            this.check_permission(tool.binding, args);
        } catch (error) {
            return failure(error, false);
        }

        // Argument values follow the payload mode (17.5): unless payloads are journalled in full, the binding is recorded as declared, not as filled
        const full = JSON.stringify(this.payload({ probe: 1 })) === '{"probe":1}';
        const binding = describe_binding(tool.binding, full ? args : {});
        this.record({
            type: 'tool.invoked',
            data: {
                call_id, tool: name, link, binding,
                ...(tool.documentation ? { documentation: tool.documentation } : {}),
                arguments: this.payload(args),
                ...(this.limits.simulate ? { simulated: true } : {}),
            },
        });

        try {
            const execution = this.limits.simulate
                ? { status: 'simulated', result: this.options.simulated_results?.[name] ?? { _simulated: true } }
                : await this.execute(tool, args, call_id);
            this.record({
                type: 'tool.completed',
                data: {
                    call_id, tool: name, link, status: execution.status,
                    duration_ms: Date.now() - started, result: this.payload(execution.result),
                },
            });
            const content = typeof execution.result === 'string' ? execution.result : JSON.stringify(execution.result ?? null);
            return { ok: true, result: execution.result, content: content.length > 60000 ? `${content.slice(0, 60000)}… (truncated)` : content };
        } catch (error) {
            return failure(error, true);
        }
    }

    private check_permission(binding: ToolBinding, args: Record<string, unknown>): void {
        if (binding.kind === 'command') {
            const allowed = this.options.allow_commands;
            if (!allowed || (Array.isArray(allowed) && !allowed.includes(binding.command))) {
                throw new ToolError(`This deployment does not allow the command "${binding.command}"`, 'PERMISSION_DENIED');
            }
        }
        if (binding.kind === 'http' || binding.kind === 'jsonrpc') {
            // Refused before anything is called: an address that is not a web address, or a host the deployment does not allow
            const host = web_url(binding.kind === 'http' ? http_request(binding, args).url : binding.endpoint).host;
            if (this.options.allowed_hosts && !this.options.allowed_hosts.includes(host)) {
                throw new ToolError(`This deployment does not allow calls to host "${host}"`, 'PERMISSION_DENIED');
            }
        }
    }

    private async execute(tool: ToolDefinition, args: Record<string, unknown>, call_id: string): Promise<ToolExecution> {
        const binding = tool.binding;
        let executor = this.options.executors?.[binding.kind] || built_in[binding.kind];
        if (binding.kind === 'function' && !this.options.executors?.function) {
            const handler = this.options.handlers?.[binding.name];
            if (!handler) throw new ToolError(`No handler is registered for function "${binding.name}"`, 'VALIDATION_ERROR');
            executor = async (_binding, handler_args) => ({ result: await handler(handler_args) });
        }
        if (!executor) {
            throw new ToolError(`No executor is registered for "${binding.kind}" tools. Register one with tools.executors.${binding.kind}`, 'VALIDATION_ERROR');
        }

        // Every kind of binding runs under the tool's timeout, registered handlers included
        const timeout = tool.timeout ? parse_iso_duration(tool.timeout) : 30000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            return await Promise.race([
                executor(binding, args, { call_id, secrets: this.options.secrets || {}, signal: controller.signal, allowed_hosts: this.options.allowed_hosts, max_output_bytes: this.options.max_output_bytes }),
                new Promise<never>((_, reject) => controller.signal.addEventListener('abort',
                    () => reject(new ToolError(`Tool "${tool.name}" timed out after ${timeout} ms`, 'TIMEOUT')))),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
}

function safe_link(binding: ToolBinding, args: Record<string, unknown>): string | undefined {
    try { return tool_link(binding, args); } catch { return undefined; }
}

/** The binding as journalled: what will run, without headers or secrets */
function describe_binding(binding: ToolBinding, args: Record<string, unknown>): Record<string, unknown> {
    switch (binding.kind) {
        case 'http': {
            const request = http_request(binding, args);
            const url = new URL(request.url);
            return { kind: 'http', method: request.method, url: `${url.origin}${url.pathname}`, url_template: binding.url };
        }
        case 'command': return { kind: 'command', command: binding.command, args: command_line(binding, args) };
        case 'jsonrpc': return { kind: 'jsonrpc', endpoint: binding.endpoint, method: binding.method };
        case 'grpc': return { kind: 'grpc', endpoint: binding.endpoint, service: binding.service, method: binding.method };
        case 'mcp': return { kind: 'mcp', server: binding.server, tool: binding.tool };
        case 'function': return { kind: 'function', name: binding.name };
    }
}
