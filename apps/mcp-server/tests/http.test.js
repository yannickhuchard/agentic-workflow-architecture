// The HTTP entry point: who may reach it, how much they may send, and what it answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config_from_env, listen } from '../src/http.js';
import { LIMITS } from '../src/limits.js';
import { PACKAGE_ROOT } from '../src/sdk.js';
import { read } from './helpers.js';

async function start(t, env = {}) {
    const server = await listen(config_from_env({ AWA_MCP_PORT: '0', ...env }));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return server;
}
/** A raw request, so that the Host and Origin headers are exactly what the test says */
function request(server, { method = 'GET', path: url = '/mcp', headers = {}, body, chunks } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: url, headers, setHost: !('host' in headers) && !('Host' in headers) }, res => {
            const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
        });
        req.on('error', error => (error.code === 'ECONNRESET' || error.code === 'EPIPE' ? resolve({ status: 0, reset: true }) : reject(error)));
        if (chunks) { for (const chunk of chunks) req.write(chunk); req.end(); } else req.end(body);
    });
}
const rpc = (method, params, idn = 1) => JSON.stringify({ jsonrpc: '2.0', id: idn, method, params });
const json = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const initialize = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });

test('by default the server listens on the loopback only and refuses to be configured otherwise', async t => {
    const server = await start(t);
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal(config_from_env({}).bind, '127.0.0.1'); assert.equal(config_from_env({}).port, 8787);
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'example.com']) assert.throws(() => config_from_env({ AWA_MCP_HOST: host }), /loopback interface only/, host);
    assert.throws(() => config_from_env({ AWA_MCP_ALLOWED_HOSTS: 'example.com' }), /only with AWA_MCP_PUBLIC_URL/);
    assert.throws(() => config_from_env({ AWA_MCP_PORT: '99999' }), /Invalid port/);
    assert.throws(() => config_from_env({ AWA_MCP_ALLOWED_ORIGINS: 'https://chatgpt.com/path' }), /not an origin/);
    assert.throws(() => config_from_env({ AWA_MCP_ALLOWED_ORIGINS: '*' }));
});

test('Host: only loopback names are answered (DNS rebinding)', async t => {
    const server = await start(t), port = server.address().port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'LOCALHOST'])
        assert.equal((await request(server, { path: '/healthz', headers: { host } })).status, 200, host);
    for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1.evil.example', 'localhost.evil.example', '10.0.0.5', '', `127.0.0.1:${port}@evil.example`]) {
        const answer = await request(server, { path: '/healthz', headers: { host } });
        assert.ok(answer.status === 403 || answer.status === 400, `Host "${host}" was answered with ${answer.status}`);
        const post = await request(server, { method: 'POST', headers: { ...json, host }, body: initialize });
        assert.ok(post.status === 403 || post.status === 400, `POST with Host "${host}" was answered with ${post.status}`);
    }
});

test('Origin: a browser origin is refused unless it was allowed by name', async t => {
    const closed = await start(t);
    for (const origin of ['https://evil.example', 'http://localhost:3000', 'null', `http://127.0.0.1:${closed.address().port}`]) {
        const answer = await request(closed, { method: 'POST', headers: { ...json, origin }, body: initialize });
        assert.equal(answer.status, 403, origin); assert.equal(answer.headers['access-control-allow-origin'], undefined);
        assert.equal((await request(closed, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } })).status, 403, `preflight from ${origin}`);
    }
    assert.equal((await request(closed, { method: 'POST', headers: json, body: initialize })).status, 200, 'a client that sends no Origin (not a browser) is served');

    const open = await start(t, { AWA_MCP_ALLOWED_ORIGINS: 'https://app.example, http://localhost:6274' });
    const allowed = await request(open, { method: 'POST', headers: { ...json, origin: 'https://app.example' }, body: initialize });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example'); assert.equal(allowed.headers.vary, 'Origin');
    assert.equal((await request(open, { method: 'OPTIONS', headers: { origin: 'http://localhost:6274' } })).status, 204);
    assert.equal((await request(open, { method: 'POST', headers: { ...json, origin: 'https://app.example.evil.example' }, body: initialize })).status, 403);
});

test('body limit: more than 1 MB is refused, declared or streamed', async t => {
    const server = await start(t);
    const declared = await request(server, { method: 'POST', headers: { ...json, 'content-length': String(LIMITS.http_body_bytes + 1) }, body: '' });
    assert.ok(declared.status === 413 || declared.reset, `declared: ${declared.status}`);
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    const streamed = await request(server, { method: 'POST', headers: { ...json, 'transfer-encoding': 'chunked' }, chunks: Array.from({ length: 20 }, () => chunk) });
    assert.ok(streamed.status === 413 || streamed.reset, `streamed: ${streamed.status}`);
    const under = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(LIMITS.http_body_bytes - 2000) } });
    assert.equal((await request(server, { method: 'POST', headers: json, body: under })).status, 200, 'a body just under the limit is read');
    assert.equal((await request(server, { path: '/healthz' })).status, 200, 'the server still answers afterwards');
});

test('routes, methods and headers', async t => {
    const server = await start(t, { AWA_MCP_OPENAI_CHALLENGE: 'token-1234567890' });
    const health = await request(server, { path: '/healthz' });
    assert.equal(health.status, 200); assert.deepEqual(Object.keys(JSON.parse(health.text)).sort(), ['mode', 'server', 'status', 'version']);
    for (const answer of [health, await request(server, { path: '/nowhere' }), await request(server, { method: 'POST', headers: json, body: initialize })]) {
        assert.equal(answer.headers['cache-control'], 'no-store'); assert.equal(answer.headers['x-content-type-options'], 'nosniff');
    }
    assert.equal((await request(server, { path: '/nowhere' })).status, 404);
    assert.equal((await request(server, { path: '/' })).status, 404);
    assert.equal((await request(server, { path: '/mcp/../healthz/../../etc/passwd' })).status, 404);
    for (const method of ['GET', 'DELETE', 'PUT']) { const a = await request(server, { method }); assert.equal(a.status, 405, method); assert.match(a.headers.allow, /POST/); }
    assert.equal((await request(server, { method: 'POST', headers: json, body: '{not json' })).status, 400);
    const challenge = await request(server, { path: '/.well-known/openai-apps-challenge' });
    assert.equal(challenge.status, 200); assert.equal(challenge.text, 'token-1234567890'); assert.match(challenge.headers['content-type'], /text\/plain/);
    assert.equal((await request(await start(t), { path: '/.well-known/openai-apps-challenge' })).status, 404, 'no challenge is served unless one is configured');
    assert.throws(() => config_from_env({ AWA_MCP_OPENAI_CHALLENGE: '<script>' }), /plain token/);
});

test('too many requests at once are turned away, not queued', async t => {
    const server = await start(t, { AWA_MCP_MAX_CONCURRENT: '1' });
    // The first request holds its slot while its body is still arriving
    const slow = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/mcp', headers: { ...json, 'transfer-encoding': 'chunked' } });
    slow.on('error', () => { }); slow.write('{"jsonrpc":');
    await new Promise(resolve => setTimeout(resolve, 150));
    const second = await request(server, { method: 'POST', headers: json, body: initialize });
    assert.equal(second.status, 503); assert.equal(second.headers['retry-after'], '2');
    slow.destroy();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await request(server, { method: 'POST', headers: json, body: initialize })).status, 200, 'the slot is released when the first request ends');
});

test('public mode is explicit: an https address is required and only that host is answered', async t => {
    assert.throws(() => config_from_env({ AWA_MCP_PUBLIC_URL: 'http://awa.example/mcp' }), /https/);
    assert.throws(() => config_from_env({ AWA_MCP_PUBLIC_URL: 'https://awa.example/' }), /ending in \/mcp/);
    assert.throws(() => config_from_env({ AWA_MCP_PUBLIC_URL: 'https://user:pw@awa.example/mcp' }), /without credentials/);
    const config = config_from_env({ AWA_MCP_PUBLIC_URL: 'https://awa.example/mcp', AWA_MCP_HOST: '0.0.0.0', AWA_MCP_ALLOWED_HOSTS: 'awa-abc.a.run.app' });
    assert.equal(config.mode, 'public'); assert.deepEqual([...config.hosts].sort(), ['awa-abc.a.run.app', 'awa.example']);
    // Listen on the loopback for the test; the Host rules are those of public mode
    const server = await start(t, { AWA_MCP_PUBLIC_URL: 'https://awa.example/mcp', AWA_MCP_ALLOWED_HOSTS: 'awa-abc.a.run.app' });
    assert.equal((await request(server, { path: '/healthz', headers: { host: 'awa.example' } })).status, 200);
    assert.equal((await request(server, { path: '/healthz', headers: { host: 'awa-abc.a.run.app' } })).status, 200);
    assert.equal((await request(server, { method: 'POST', headers: { ...json, host: 'awa.example' }, body: initialize })).status, 200);
    for (const host of ['localhost', `127.0.0.1:${server.address().port}`, 'evil.example', 'awa.example.evil.example'])
        assert.equal((await request(server, { path: '/healthz', headers: { host } })).status, 403, host);
    assert.equal((await request(server, { method: 'POST', headers: { ...json, host: 'awa.example', origin: 'https://evil.example' }, body: initialize })).status, 403);
});

test('an MCP client works over Streamable HTTP, statelessly', async t => {
    const server = await start(t);
    const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
    const client = new Client({ name: 'awa-http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    t.after(() => client.close());
    assert.equal((await client.listTools()).tools.length, 6);
    const result = await client.callTool({ name: 'simulate_workflow', arguments: { workflow: read('examples/order-processing/order-processing.awa.json'), simulated_outputs: read('examples/order-processing/simulation.json') } });
    assert.equal(result.structuredContent.status, 'completed');
    assert.ok((await client.readResource({ uri: 'ui://awa/run-replay-v1.html' })).contents[0].text.length > 50_000);
    // No session: a second client needs nothing from the first, and a call without initialize is answered
    const bare = await request(server, { method: 'POST', headers: json, body: rpc('tools/list', {}) });
    assert.equal(bare.status, 200); assert.equal(JSON.parse(bare.text).result.tools.length, 6);
    assert.equal(bare.headers['mcp-session-id'], undefined);
});

test('stdio: the server answers on standard output and writes nothing else there', async t => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(PACKAGE_ROOT, 'src/start.js'), '--stdio'], stderr: 'pipe' });
    const client = new Client({ name: 'awa-stdio-test', version: '1.0.0' });
    await client.connect(transport);
    t.after(() => client.close());
    assert.equal((await client.listTools()).tools.length, 6);
    // The SDK prints progress while it runs; none of it may reach the protocol stream
    const result = await client.callTool({ name: 'simulate_workflow', arguments: { workflow: read('examples/claims-settlement/claims-settlement.awa.json'), simulated_outputs: read('examples/claims-settlement/simulation.json') } });
    assert.equal(result.structuredContent.status, 'completed');
    assert.equal((await client.callTool({ name: 'load_claims_example', arguments: {} })).structuredContent.journeys.length, 3);
});

test('the command line refuses an unsafe configuration and exits', async () => {
    const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'src/start.js')], { env: { ...process.env, AWA_MCP_HOST: '0.0.0.0', AWA_MCP_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', c => { err += c; });
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 1); assert.match(err, /Refusing to listen on 0\.0\.0\.0/);
});
