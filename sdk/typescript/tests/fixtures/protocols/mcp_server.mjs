// An MCP server for the tests, built with the reference SDK. Usage:
//   node mcp_server.mjs stdio [marker-file]   speaks over standard input and output
//   node mcp_server.mjs http                  serves Streamable HTTP on a free port and prints it
import fs from 'fs';
import http from 'http';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const [mode, marker] = process.argv.slice(2);
if (marker) fs.writeFileSync(marker, String(process.pid));
let calls = 0;

function server() {
    const s = new McpServer({ name: 'awa-test', version: '1.0.0' });
    s.registerTool('count', { description: 'Counts the calls this server process has had', inputSchema: {} },
        async () => ({ content: [{ type: 'text', text: JSON.stringify({ count: ++calls, pid: process.pid }) }] }));
    s.registerTool('lookup', { description: 'Looks a policy up', inputSchema: { policy: z.string() }, outputSchema: { policy: z.string(), covered: z.boolean() } },
        async ({ policy }) => ({ structuredContent: { policy, covered: policy !== 'P-0' }, content: [{ type: 'text', text: `Policy ${policy}` }] }));
    s.registerTool('words', { description: 'Plain text', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'not json' }] }));
    s.registerTool('two_blocks', { description: 'Two blocks', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }));
    s.registerTool('broken', { description: 'Reports an error', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'policy store unavailable' }] }));
    s.registerTool('slow', { description: 'Takes a second', inputSchema: {} }, async () => { await new Promise(r => setTimeout(r, 1000)); return { content: [{ type: 'text', text: 'late' }] }; });
    return s;
}

if (mode === 'stdio') {
    await server().connect(new StdioServerTransport());
} else {
    const sessions = new Map();
    const httpServer = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = body ? JSON.parse(body) : undefined;
        const id = req.headers['mcp-session-id'];
        let transport = id ? sessions.get(id) : undefined;
        if (!transport) {
            transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: sid => sessions.set(sid, transport) });
            await server().connect(transport);
        }
        await transport.handleRequest(req, res, parsed);
    });
    httpServer.listen(0, '127.0.0.1', () => console.log(`PORT ${httpServer.address().port}`));
}
