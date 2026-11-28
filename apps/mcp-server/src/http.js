// The Streamable HTTP entry point.
//
// By default it serves this machine only: it listens on the loopback interface,
// answers only requests whose Host header names the loopback, and refuses any
// browser Origin that was not allowed explicitly (this stops a web page from
// reaching the server through DNS rebinding or a cross-site request).
//
// Serving the public internet is a separate, explicit mode: see config_from_env.
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { LIMITS } from './limits.js';
import { RELEASE } from './sdk.js';

const LOOPBACK_BIND = new Set(['127.0.0.1', 'localhost', '::1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const host_name = value => String(value || '').toLowerCase().replace(/:\d+$/, '');

/**
 * Read the configuration and refuse the unsafe combinations.
 *
 *   AWA_MCP_HOST             interface to listen on. Default 127.0.0.1.
 *   AWA_MCP_PORT / PORT      port. Default 8787.
 *   AWA_MCP_ALLOWED_ORIGINS  comma-separated browser origins allowed to call. Default: none.
 *   AWA_MCP_PUBLIC_URL       https://<host>/mcp. Required to listen on anything but the loopback;
 *                            requests are then accepted only for that host.
 *   AWA_MCP_ALLOWED_HOSTS    further Host names accepted in public mode (a platform's own domain, for example).
 *   AWA_MCP_OPENAI_CHALLENGE token served at /.well-known/openai-apps-challenge for domain verification.
 *   AWA_MCP_MAX_CONCURRENT   requests handled at once. Default 8.
 */
export function config_from_env(env = process.env) {
    const bind = env.AWA_MCP_HOST || '127.0.0.1';
    const port = Number(env.PORT || env.AWA_MCP_PORT || 8787);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
    const origins = (env.AWA_MCP_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const origin of origins) { const url = new URL(origin); if (url.origin !== origin) throw new Error(`AWA_MCP_ALLOWED_ORIGINS: "${origin}" is not an origin (scheme, host and port only).`); }
    const max_concurrent = Number(env.AWA_MCP_MAX_CONCURRENT || 8);
    if (!Number.isInteger(max_concurrent) || max_concurrent < 1 || max_concurrent > 256) throw new Error('AWA_MCP_MAX_CONCURRENT must be between 1 and 256.');
    const challenge = env.AWA_MCP_OPENAI_CHALLENGE;
    if (challenge !== undefined && !/^[A-Za-z0-9._~-]{8,256}$/.test(challenge)) throw new Error('AWA_MCP_OPENAI_CHALLENGE is not a plain token.');

    if (!env.AWA_MCP_PUBLIC_URL) {
        if (!LOOPBACK_BIND.has(bind)) throw new Error(`Refusing to listen on ${bind}: without AWA_MCP_PUBLIC_URL the server serves the loopback interface only.`);
        if (env.AWA_MCP_ALLOWED_HOSTS) throw new Error('AWA_MCP_ALLOWED_HOSTS applies only with AWA_MCP_PUBLIC_URL.');
        return { mode: 'local', bind, port, origins, hosts: LOOPBACK_HOSTS, max_concurrent, challenge };
    }
    const url = new URL(env.AWA_MCP_PUBLIC_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') throw new Error('AWA_MCP_PUBLIC_URL must be an https URL ending in /mcp, without credentials or a query.');
    const hosts = new Set([url.hostname.toLowerCase(), ...(env.AWA_MCP_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)]);
    for (const name of hosts) if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) throw new Error(`"${name}" is not a host name.`);
    return { mode: 'public', bind, port, origins, hosts, max_concurrent, challenge, public_url: url.href };
}

const plain = (res, status, text, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }).end(text); };

export function createHttpServer(config = config_from_env()) {
    let active = 0;
    const handle = async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!config.hosts.has(host_name(req.headers.host))) return plain(res, 403, 'Invalid host');
        const origin = req.headers.origin;
        if (origin && !config.origins.includes(origin)) return plain(res, 403, 'Origin not allowed');
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-protocol-version, mcp-session-id');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        }
        let url;
        try { url = new URL(req.url, 'http://localhost'); } catch { return plain(res, 400, 'Invalid request'); }
        if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
        if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'ok', server: 'awa-mcp-server', version: RELEASE, mode: config.mode }));
            return;
        }
        if (req.method === 'GET' && url.pathname === '/.well-known/openai-apps-challenge') return config.challenge ? plain(res, 200, config.challenge) : plain(res, 404, 'Not found');
        if (url.pathname !== '/mcp') return plain(res, 404, 'Not found');
        // Stateless: each POST is one JSON-RPC exchange answered as JSON. There is no stream to open and no session to delete.
        if (req.method !== 'POST') return plain(res, 405, 'Method not allowed', { Allow: 'POST, OPTIONS' });
        if (Number(req.headers['content-length']) > LIMITS.http_body_bytes) return plain(res, 413, 'Request exceeds 1 MB', { Connection: 'close' });
        if (active >= config.max_concurrent) return plain(res, 503, 'Busy, retry shortly', { 'Retry-After': '2' });
        active++;
        res.on('close', () => { active--; });

        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > LIMITS.http_body_bytes) { plain(res, 413, 'Request exceeds 1 MB', { Connection: 'close' }); req.destroy(); return; }
            chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return plain(res, 400, 'Invalid JSON'); }

        const mcp = await createMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { transport.close().catch(() => { }); mcp.close().catch(() => { }); });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
    };
    const server = http.createServer((req, res) => {
        handle(req, res).catch(() => { if (!res.headersSent) plain(res, 500, 'MCP request failed'); else res.end(); });
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.maxHeadersCount = 60;
    return server;
}

export async function listen(config = config_from_env()) {
    const server = createHttpServer(config);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.bind, resolve); });
    return server;
}
