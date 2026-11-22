/**
 * Contexts (specification section 22): what the activities of a run share.
 *
 * An activity sees and changes a context only through a binding. The manager
 * holds the values; the engine decides who may read and write.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { UUID, Context } from '../types';
import { parse_iso_duration } from './duration_utils';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

export class ContextError extends Error {
    constructor(message: string, public readonly code: 'CONTEXT_INVALID' | 'CONTEXT_NOT_FOUND') {
        super(message);
        this.name = 'ContextError';
    }
}

export class ContextManager {
    private contexts = new Map<UUID, Context>();
    private values = new Map<UUID, unknown>();
    private written_at = new Map<UUID, number>();

    public register(context: Context): void {
        this.contexts.set(context.id, context);
        if (context.initial_value !== undefined) this.values.set(context.id, copy(context.initial_value));
    }

    private definition(contextId: UUID): Context {
        const context = this.contexts.get(contextId);
        if (!context) throw new ContextError(`Context with ID ${contextId} not found`, 'CONTEXT_NOT_FOUND');
        return context;
    }

    /**
     * The value of a context now. A transient context with a time to live has
     * no value once that long has passed since it was last written.
     */
    public get(contextId: UUID, now?: number): unknown {
        const context = this.definition(contextId);
        if (now !== undefined && context.lifecycle === 'transient' && context.ttl && this.written_at.has(contextId)) {
            if (now - this.written_at.get(contextId)! > parse_iso_duration(context.ttl)) return undefined;
        }
        return this.values.get(contextId);
    }

    /** Replace the value, whatever the sync pattern. Checked against the context's schema. */
    public set(contextId: UUID, value: unknown, now?: number): void {
        const context = this.definition(contextId);
        this.check(context, value);
        this.values.set(contextId, copy(value));
        if (now !== undefined) this.written_at.set(contextId, now);
    }

    /**
     * Write as the context's sync pattern says (22.3):
     * shared_state replaces the value; blackboard merges the properties written
     * into it; message_passing and event_sourcing append what is written to a list.
     * Returns the value the context has afterwards.
     */
    public write(contextId: UUID, value: unknown, now?: number): unknown {
        const context = this.definition(contextId);
        const current = this.get(contextId, now);
        let next: unknown;
        if (context.sync_pattern === 'blackboard') {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContextError(`Context "${context.name}" is a blackboard: what is written to it must be an object`, 'CONTEXT_INVALID');
            next = { ...(typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {}), ...value };
            this.check(context, next);
        } else if (context.sync_pattern === 'message_passing' || context.sync_pattern === 'event_sourcing') {
            this.check(context, value);                                 // the schema describes one entry
            next = [...(Array.isArray(current) ? current : []), value];
        } else {
            next = value;
            this.check(context, next);
        }
        this.values.set(contextId, copy(next));
        if (now !== undefined) this.written_at.set(contextId, now);
        return next;
    }

    private check(context: Context, value: unknown): void {
        if (!context.schema || Object.keys(context.schema).length === 0) return;
        let validate;
        try { validate = ajv.compile(context.schema); } catch (error) {
            throw new ContextError(`Context "${context.name}" has a schema that is not a JSON Schema: ${error instanceof Error ? error.message : String(error)}`, 'CONTEXT_INVALID');
        }
        if (!validate(value)) {
            const why = (validate.errors || []).slice(0, 3).map(e => `${e.instancePath || '/'} ${e.message}`).join('; ');
            throw new ContextError(`What was written to context "${context.name}" does not match its schema: ${why}`, 'CONTEXT_INVALID');
        }
    }

    /** Kept for callers of the earlier interface: merge into an object value */
    public update(contextId: UUID, partialValue: unknown): void {
        const currentValue = this.get(contextId) || {};
        if (typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)) {
            const partial = (typeof partialValue === 'object' && partialValue !== null) ? partialValue : {};
            this.set(contextId, { ...currentValue, ...partial as Record<string, unknown> });
        } else {
            this.set(contextId, partialValue);
        }
    }

    public delete(contextId: UUID): void {
        this.definition(contextId);
        this.contexts.delete(contextId);
        this.values.delete(contextId);
        this.written_at.delete(contextId);
    }

    public getContextDefinition(contextId: UUID): Context | undefined {
        return this.contexts.get(contextId);
    }

    public list(): Context[] {
        return [...this.contexts.values()];
    }

    /** All context values, keyed by context id */
    public snapshot(): Record<UUID, unknown> {
        return Object.fromEntries(this.values.entries());
    }

    /** When each context was last written, for a checkpoint */
    public snapshot_times(): Record<UUID, number> {
        return Object.fromEntries(this.written_at.entries());
    }

    /** Put every value back as it was: what was not in the snapshot has no value again */
    public replace(values: Record<UUID, unknown>, times: Record<UUID, number> = {}): void {
        this.values = new Map(Object.entries(values));
        this.written_at = new Map(Object.entries(times));
    }

    /** Replace context values from a snapshot. Unknown context ids are ignored. */
    public restore(values: Record<UUID, unknown>, times: Record<UUID, number> = {}): void {
        for (const [id, value] of Object.entries(values || {})) {
            if (this.contexts.has(id)) this.values.set(id, value);
        }
        for (const [id, at] of Object.entries(times || {})) {
            if (this.contexts.has(id)) this.written_at.set(id, at);
        }
    }
}
