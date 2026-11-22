#!/usr/bin/env node
// Entry point.
//   node src/start.js            Streamable HTTP on http://127.0.0.1:8787/mcp
//   node src/start.js --stdio    stdio, for clients that start the server themselves
// Standard output belongs to the stdio transport: everything else is written to standard error.
console.log = console.info = console.debug = (...args) => { if (process.env.AWA_MCP_DEBUG) console.error(...args); };

const { config_from_env, listen } = await import('./http.js');
const { createMcpServer } = await import('./server.js');

async function main(argv = process.argv.slice(2), env = process.env) {
    if (argv.includes('--stdio')) {
        const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
        const server = await createMcpServer();
        await server.connect(new StdioServerTransport());
        return;
    }
    const config = config_from_env(env);
    const server = await listen(config);
    console.error(`AWA MCP server ${config.mode === 'local' ? 'listening on the loopback only' : `serving ${config.public_url}`}: http://${config.bind.includes(':') ? `[${config.bind}]` : config.bind}:${server.address().port}/mcp`);
    const close = () => server.close(() => process.exit(0));
    process.once('SIGINT', close); process.once('SIGTERM', close);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
