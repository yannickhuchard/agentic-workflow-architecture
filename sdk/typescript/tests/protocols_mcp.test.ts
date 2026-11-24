/**
 * The built-in MCP executor (specification 17.7), against a server built with the
 * reference SDK that the tests start: over standard input and output, and over
 * Streamable HTTP on localhost.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ToolRunner, ToolOptions } from '../src/runtime/tools';
import { ToolSessions } from '../src/runtime/protocols/sessions';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { JournalEventInput } from '../src/runtime/journal';
import { Actor } from '../src/runtime/actors/actor';
import { ToolDefinitionSchema, ToolDefinition } from '../src/types';
import { parse_document } from '../src/validator';
import { silent_logger } from './helpers';

const FIXTURE = path.join(__dirname, 'fixtures/protocols/mcp_server.mjs');
const NODE = process.execPath;
const tool = (name: string, server = 'docs', timeout?: string): ToolDefinition =>
    ToolDefinitionSchema.parse({ name, binding: { kind: 'mcp', server, tool: name }, ...(timeout ? { timeout } : {}) });

function runner(tools: ToolDefinition[], options: ToolOptions, simulate = false) {
    const events: JournalEventInput[] = [];
    const run = new ToolRunner(tools, options, e => events.push(e), v => v, { max_calls: 20, simulate });
    return { run, events };
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise(r => setTimeout(r, 25)); return check(); };

describe('MCP over standard input and output', () => {
    const stdio: ToolOptions = { allow_commands: [NODE], mcp_servers: { docs: { command: NODE, args: [FIXTURE, 'stdio'] } } };

    it('calls a tool and maps structured content, text, JSON text and several blocks', async () => {
        const sessions = new ToolSessions();
        const { run, events } = runner([tool('lookup'), tool('words'), tool('count'), tool('two_blocks')], { ...stdio, sessions });
        expect((await run.call('lookup', { policy: 'P-1' })).result).toEqual({ policy: 'P-1', covered: true });
        expect((await run.call('words', {})).result).toBe('not json');
        expect((await run.call('count', {})).result).toMatchObject({ count: 1 });
        expect((await run.call('two_blocks', {})).result).toEqual([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
        expect(events.filter(e => e.type === 'tool.completed')).toHaveLength(4);
        expect(events.find(e => e.type === 'tool.invoked')!.data).toMatchObject({ link: 'mcp://docs/lookup', binding: { kind: 'mcp', server: 'docs', tool: 'lookup' } });
        // One connection served every call
        expect(sessions.size).toBe(1);
        await sessions.close();
    });

    it('reports isError and a timeout as failed calls', async () => {
        const { run, events } = runner([tool('broken'), tool('slow', 'docs', 'PT0.2S')], stdio);
        expect((await run.call('broken', {})).result).toMatchObject({ code: 'TOOL_ERROR', error: 'policy store unavailable' });
        expect((await run.call('slow', {})).result).toMatchObject({ code: 'TIMEOUT' });
        expect(events.filter(e => e.type === 'tool.failed').map(e => e.data!.invoked)).toEqual([true, true]);
    });

    it('does not start a server the deployment does not allow as a command', async () => {
        const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-mcp-')), 'started');
        const servers = { docs: { command: NODE, args: [FIXTURE, 'stdio', marker] } };
        for (const allow_commands of [undefined, false, ['python3']] as const) {
            const { run, events } = runner([tool('count')], { allow_commands: allow_commands as ToolOptions['allow_commands'], mcp_servers: servers });
            expect((await run.call('count', {})).result).toMatchObject({ code: 'PERMISSION_DENIED' });
            expect(events.map(e => e.type)).toEqual(['tool.failed']);
        }
        const { run } = runner([tool('count', 'elsewhere')], { allow_commands: true, mcp_servers: servers });
        expect((await run.call('count', {})).result).toMatchObject({ code: 'PERMISSION_DENIED', error: expect.stringMatching(/declares no MCP server "elsewhere"/) });
        await new Promise(r => setTimeout(r, 200));
        expect(fs.existsSync(marker)).toBe(false);
    });

    it('starts nothing in simulation', async () => {
        const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-mcp-')), 'started');
        const { run, events } = runner([tool('count')], { allow_commands: true, mcp_servers: { docs: { command: NODE, args: [FIXTURE, 'stdio', marker] } }, simulated_results: { count: { count: 99 } } }, true);
        expect((await run.call('count', {})).result).toEqual({ count: 99 });
        expect(events[0].data).toMatchObject({ simulated: true });
        await new Promise(r => setTimeout(r, 200));
        expect(fs.existsSync(marker)).toBe(false);
    });

    it('reuses one connection for the whole run and stops the server when the run ends', async () => {
        // Two activities call the same server: the count goes on, so the second used the first one's connection
        const results: unknown[] = [];
        const actor: Actor = {
            async execute(activity, _inputs, context) {
                const first = await context!.tools!.call('count', {});
                const second = await context!.tools!.call('count', {});
                results.push(first.result, second.result);
                return { [`${activity.name}_done`]: true };
            },
        };
        const tools = [{ name: 'count', binding: { kind: 'mcp', server: 'docs', tool: 'count' } }];
        const workflow = parse_document({
            id: '11111111-1111-4111-8111-111111111111', name: 'mcp-run', version: '1.0.0', awa_version: '1.1',
            activities: [
                { id: '11111111-1111-4111-8111-000000000001', name: 'A', role_id: '11111111-1111-4111-8111-0000000000ff', actor_type: 'application', tools },
                { id: '11111111-1111-4111-8111-000000000002', name: 'B', role_id: '11111111-1111-4111-8111-0000000000ff', actor_type: 'application', tools },
            ],
            edges: [{ id: '11111111-1111-4111-8111-000000000003', source_id: '11111111-1111-4111-8111-000000000001', target_id: '11111111-1111-4111-8111-000000000002' }],
        });
        const engine = new WorkflowEngine(workflow, { actors: { application: actor }, execution_logger: silent_logger, tools: stdio });
        await engine.start({});
        expect(await engine.run()).toBe('completed');
        expect(results.map(r => (r as { count: number }).count)).toEqual([1, 2, 3, 4]);
        const pid = (results[0] as { pid: number }).pid;
        expect(new Set(results.map(r => (r as { pid: number }).pid)).size).toBe(1);
        expect(await until(() => !alive(pid))).toBe(true);
    });
});

describe('MCP over Streamable HTTP', () => {
    let server: ChildProcess;
    let port = 0;

    beforeAll(async () => {
        server = spawn(NODE, [FIXTURE, 'http'], { stdio: ['ignore', 'pipe', 'inherit'] });
        port = await new Promise<number>((resolve, reject) => {
            server.stdout!.on('data', (chunk: Buffer) => { const m = /PORT (\d+)/.exec(chunk.toString()); if (m) resolve(Number(m[1])); });
            server.on('exit', () => reject(new Error('the MCP server exited')));
        });
    });
    afterAll(() => { server?.kill(); });

    const options = (): ToolOptions => ({ allowed_hosts: [`127.0.0.1:${port}`], mcp_servers: { search: { url: `http://127.0.0.1:${port}/mcp` } } });

    it('calls tools over one session and maps the outcomes', async () => {
        const sessions = new ToolSessions();
        const { run } = runner([tool('lookup', 'search'), tool('count', 'search'), tool('broken', 'search'), tool('slow', 'search', 'PT0.2S')], { ...options(), sessions });
        expect((await run.call('lookup', { policy: 'P-0' })).result).toEqual({ policy: 'P-0', covered: false });
        const first = (await run.call('count', {})).result as { count: number };
        const second = (await run.call('count', {})).result as { count: number };
        expect(second.count).toBe(first.count + 1);
        expect((await run.call('broken', {})).result).toMatchObject({ code: 'TOOL_ERROR', error: 'policy store unavailable' });
        expect((await run.call('slow', {})).result).toMatchObject({ code: 'TIMEOUT' });
        expect(sessions.size).toBe(1);
        await sessions.close();
    });

    it('refuses a server at a host the deployment does not allow, and a server that is not declared', async () => {
        const { run, events } = runner([tool('lookup', 'search')], { ...options(), allowed_hosts: ['api.example.com'] });
        expect((await run.call('lookup', { policy: 'P-1' })).result).toMatchObject({ code: 'PERMISSION_DENIED' });
        expect(events.map(e => e.type)).toEqual(['tool.failed']);
        const other = runner([tool('lookup', 'other')], options());
        expect((await other.run.call('lookup', { policy: 'P-1' })).result).toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('fails a call to a server that is not there', async () => {
        const { run } = runner([tool('lookup', 'gone')], { mcp_servers: { gone: { url: 'http://127.0.0.1:1/mcp' } } });
        expect((await run.call('lookup', { policy: 'P-1' })).result).toMatchObject({ code: 'TOOL_ERROR' });
    });
});
