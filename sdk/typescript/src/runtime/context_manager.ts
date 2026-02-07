import { UUID, Context } from '../types';

export class ContextManager {
    private contexts: Map<UUID, Context>;
    private values: Map<UUID, any>;

    constructor() {
        this.contexts = new Map();
        this.values = new Map();
    }

    public register(context: Context): void {
        this.contexts.set(context.id, context);
        if (context.initial_value !== undefined) {
            this.values.set(context.id, JSON.parse(JSON.stringify(context.initial_value)));
        }
    }

    public get(contextId: UUID): any {
        if (!this.contexts.has(contextId)) {
            throw new Error(`Context with ID ${contextId} not found`);
        }
        return this.values.get(contextId);
    }

    public set(contextId: UUID, value: any): void {
        if (!this.contexts.has(contextId)) {
            throw new Error(`Context with ID ${contextId} not found`);
        }
        // TODO: Validate against schema if present
        this.values.set(contextId, value);
    }

    public update(contextId: UUID, partialValue: any): void {
        if (!this.contexts.has(contextId)) {
            throw new Error(`Context with ID ${contextId} not found`);
        }
        const currentValue = this.values.get(contextId) || {};

        if (typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)) {
            this.values.set(contextId, { ...currentValue, ...partialValue });
        } else {
            this.values.set(contextId, partialValue);
        }
    }

    public delete(contextId: UUID): void {
        if (!this.contexts.has(contextId)) {
            throw new Error(`Context with ID ${contextId} not found`);
        }
        this.contexts.delete(contextId);
        this.values.delete(contextId);
    }

    public getContextDefinition(contextId: UUID): Context | undefined {
        return this.contexts.get(contextId);
    }
}
