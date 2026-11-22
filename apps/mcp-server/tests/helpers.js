import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { REPOSITORY_ROOT } from '../src/sdk.js';

export const read = file => JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));

/** An MCP client connected in memory to a new server */
export async function connect(t) {
    const server = await createMcpServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'awa-test', version: '1.0.0' });
    await server.connect(a); await client.connect(b);
    t?.after(async () => { await client.close(); await server.close(); });
    return client;
}
export const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
export const text_of = result => result.content.map(c => c.text || '').join('\n');

const id = () => randomUUID();
/** A small valid workflow: one role, the activities given, joined in a line */
export function workflow(activities, extra = {}) {
    const role = { id: id(), name: 'Operator', actor_type: 'application' };
    const acts = activities.map(a => ({ id: id(), role_id: role.id, actor_type: 'application', ...a }));
    const edges = acts.slice(1).map((a, i) => ({ id: id(), source_id: acts[i].id, target_id: a.id }));
    return { id: id(), name: 'Test workflow', version: '1.0.0', awa_version: '1.1', roles: [role], activities: acts, edges, ...extra };
}
export { id };
