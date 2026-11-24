/**
 * A deployment file: what the workflows run by this host may reach (specification 17.4, 17.7, 17.8, 28.2),
 * and the guardrails the deployment adds to every run (31.1).
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
 *     "guardrails": [{ "id": "…", "stages": ["output"], "check": { "kind": "personal_data" }, "action": "redact" }]
 *   }
 *
 * Relative paths of .proto files, include directories and root certificates are taken from the
 * file's own directory. Secrets are not read from this file.
 */

import fs from 'fs';
import path from 'path';
import { ToolOptions } from '../runtime/tools';
import { A2AOptions } from '../runtime/protocols/a2a';
import { Guardrail, GuardrailSchema } from '../types';
import { check_guardrail } from '../runtime/guardrails';

export interface Deployment {
    tools: ToolOptions;
    a2a: A2AOptions;
    /** Guardrails added to every run, before the document's (31.1) */
    guardrails: Guardrail[];
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
    const extra = Object.keys(raw || {}).filter(k => k !== 'tools' && k !== 'a2a' && k !== 'guardrails');
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
    // Held to the rules of a document's guardrails (31.11): an inconsistent one is refused when the file is read
    if (raw.guardrails !== undefined && !Array.isArray(raw.guardrails)) throw new Error(`"guardrails" in ${file} must be a list`);
    const guardrails: Guardrail[] = (raw.guardrails || []).map((g: unknown) => GuardrailSchema.parse(g));
    const issues = guardrails.flatMap(g => check_guardrail(g, `guardrails[${g.id}]`));
    if (issues.length) throw new Error(`Invalid guardrails in ${file}: ${issues.map(i => i.message).join('; ')}`);
    return { tools, a2a: { ...(raw.a2a || {}) }, guardrails };
}
