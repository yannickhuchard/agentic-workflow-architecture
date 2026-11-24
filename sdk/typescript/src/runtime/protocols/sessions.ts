/**
 * Connections a run keeps open to the servers its tools call: MCP servers and
 * gRPC channels (specification 17.7, 17.8). A connection is opened at the
 * first call of a run that needs it, reused by every later call of the run,
 * and closed when the run ends or stops to wait.
 */

export interface Closeable {
    close(): Promise<void> | void;
}

export class ToolSessions {
    private open = new Map<string, Promise<Closeable>>();

    /** The connection kept under `key`, opened by `create` if there is none yet */
    async get<T extends Closeable>(key: string, create: () => Promise<T>): Promise<T> {
        let pending = this.open.get(key);
        if (!pending) {
            pending = create();
            this.open.set(key, pending);
            // A connection that failed to open is not kept: the next call tries again
            pending.catch(() => { if (this.open.get(key) === pending) this.open.delete(key); });
        }
        return pending as Promise<T>;
    }

    /** Forget a connection that broke, so that the next call opens a new one */
    async discard(key: string): Promise<void> {
        const pending = this.open.get(key);
        this.open.delete(key);
        if (pending) await pending.then(c => c.close()).catch(() => { });
    }

    get size(): number {
        return this.open.size;
    }

    /** Close every connection. Closing stops a server the engine started. */
    async close(): Promise<void> {
        const all = [...this.open.values()];
        this.open.clear();
        await Promise.all(all.map(p => p.then(c => c.close()).catch(() => { })));
    }
}
