/**
 * A deployment file: what the workflows run by this host may reach (specification 17.4, 17.7, 17.8, 28.2),
 * and who may do what in them (specification 30).
 *
 *   {
 *     "tools": {
 *       "allow_commands": ["python3"],                   // or true for all
 *       "allowed_hosts": ["api.example.com"],
 *       "mcp_servers": { "docs": { "command": "python3", "args": ["docs_server.py"] },
 *                        "search": { "url": "https://mcp.example.com/mcp" } },
 *       "grpc": { "protos": ["pricing.proto"], "plaintext_hosts": ["localhost"] }
 *     },
 *     "a2a": { "allowed_hosts": ["agents.example.com"], "poll_interval_ms": 1000, "max_wait_ms": 600000 },
 *     "authorization": {
 *       "principals": [{ "id": "agent:assessor", "kind": "ai_agent", "attributes": { "roles": ["underwriter"] },
 *                        "acts_for": { "roles": ["Underwriter"] }, "credentials": { "authorization": "Bearer {{secret:ASSESSOR_TOKEN}}" } }],
 *       "policy": { "rules": [...], "separation_of_duties": [...], "four_eyes": [...] },
 *       "classifications": { "Claim settlement": "confidential" },
 *       "record_allows": false
 *     }
 *   }
 *
 * Relative paths of .proto files, include directories and root certificates are taken from the
 * file's own directory. Secrets are not read from this file.
 */

import fs from 'fs';
import path from 'path';
import { ToolOptions } from '../runtime/tools';
import { A2AOptions } from '../runtime/protocols/a2a';
import { AuthorizationOptions, load_authorization } from '../runtime/authorization';

export interface Deployment {
    tools: ToolOptions;
    a2a: A2AOptions;
    /** Principals and the policy, when the file has an `authorization` section (spec 30) */
    authorization?: AuthorizationOptions;
}

const TOOL_KEYS = ['allow_commands', 'allowed_hosts', 'max_output_bytes', 'mcp_servers', 'grpc'];
const A2A_KEYS = ['allowed_hosts', 'poll_interval_ms', 'max_wait_ms', 'max_output_bytes'];

export function load_deployment(file: string): Deployment {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const dir = path.dirname(path.resolve(file));
    const unknown = (section: string, value: Record<string, unknown> | undefined, keys: string[]) => {
        const extra = Object.keys(value || {}).filter(k => !keys.includes(k));
        if (extra.length) throw new Error(`Unknown ${section} option(s) in ${file}: ${extra.join(', ')}`);
    };
    const extra = Object.keys(raw || {}).filter(k => k !== 'tools' && k !== 'a2a' && k !== 'authorization');
    if (extra.length) throw new Error(`Unknown section(s) in ${file}: ${extra.join(', ')}`);
    unknown('tools', raw.tools, TOOL_KEYS);
    unknown('a2a', raw.a2a, A2A_KEYS);
    const tools: ToolOptions = { ...(raw.tools || {}) };
    if (tools.grpc) {
        const local = (p: string) => path.resolve(dir, p);
        tools.grpc = {
            ...tools.grpc,
            ...(tools.grpc.protos ? { protos: tools.grpc.protos.map(local) } : {}),
            ...(tools.grpc.include_dirs ? { include_dirs: tools.grpc.include_dirs.map(local) } : {}),
            ...(tools.grpc.root_certificates ? { root_certificates: local(tools.grpc.root_certificates) } : {}),
        };
    }
    const authorization = raw.authorization !== undefined ? load_authorization(raw.authorization) : undefined;
    return { tools, a2a: { ...(raw.a2a || {}) }, ...(authorization ? { authorization } : {}) };
}
