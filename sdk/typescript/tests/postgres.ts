/**
 * A throwaway PostgreSQL for the tests of the shared runtime store (spec 29).
 *
 * With AWA_TEST_POSTGRES_URL set (as in CI, where a postgres service runs), the
 * tests use that server and create a database of their own in it. Otherwise
 * they start a cluster of their own in a temporary directory with initdb and
 * pg_ctl, on a free port, and stop it at the end. Where PostgreSQL is not
 * installed, postgres_unavailable says why and the tests are skipped.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

export interface TestPostgres {
    /** A new, empty database, as a URL */
    database(): Promise<string>;
    stop(): Promise<void>;
}

function binaries(): string | undefined {
    const candidates = [process.env.AWA_TEST_POSTGRES_BIN, ...(fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort().reverse().map(v => `/usr/lib/postgresql/${v}/bin`) : [])];
    for (const dir of candidates) if (dir && fs.existsSync(path.join(dir, 'initdb'))) return dir;
    const found = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf-8' });
    return found.status === 0 && found.stdout.trim() ? path.dirname(found.stdout.trim()) : undefined;
}

const running_as_root = () => typeof process.getuid === 'function' && process.getuid() === 0;
const has_postgres_user = () => spawnSync('id', ['postgres']).status === 0;

/** Why the tests cannot have a PostgreSQL, or undefined when they can */
export function postgres_unavailable(): string | undefined {
    if (process.env.AWA_TEST_POSTGRES_URL) return undefined;
    if (!binaries()) return 'PostgreSQL is not installed (no initdb found; set AWA_TEST_POSTGRES_URL or AWA_TEST_POSTGRES_BIN)';
    if (running_as_root() && !has_postgres_user()) return 'running as root without a "postgres" user to run initdb as';
    return undefined;
}

async function free_port(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => { const port = (server.address() as net.AddressInfo).port; server.close(() => resolve(port)); });
    });
}

let counter = 0;
async function create_database(admin_url: string): Promise<string> {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: admin_url });
    await client.connect();
    const name = `awa_test_${process.pid}_${Date.now()}_${counter++}`;
    try { await client.query(`CREATE DATABASE ${name}`); } finally { await client.end(); }
    const url = new URL(admin_url);
    url.pathname = `/${name}`;
    return url.toString();
}

export async function start_postgres(): Promise<TestPostgres> {
    const external = process.env.AWA_TEST_POSTGRES_URL;
    if (external) return { database: () => create_database(external), stop: async () => { } };

    const bin = binaries()!;
    const as_postgres = running_as_root();
    const run = (program: string, args: string[]) => as_postgres
        ? execFileSync('runuser', ['-u', 'postgres', '--', path.join(bin, program), ...args], { stdio: 'pipe' })
        : execFileSync(path.join(bin, program), args, { stdio: 'pipe' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-pg-'));
    if (as_postgres) { fs.chmodSync(dir, 0o755); execFileSync('chown', ['postgres', dir]); }
    const data = path.join(dir, 'data'), port = await free_port();
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'awa', '--no-sync']);
    run('pg_ctl', ['-D', data, '-l', path.join(dir, 'log'), '-w', '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=300`, 'start']);
    const admin = `postgres://awa@127.0.0.1:${port}/postgres`;
    return {
        database: () => create_database(admin),
        stop: async () => {
            try { run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); } catch { /* already stopped */ }
            fs.rmSync(dir, { recursive: true, force: true });
        },
    };
}
