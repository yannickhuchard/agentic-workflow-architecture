/**
 * The workload of the shared store tests: a claim journey whose run waits for
 * the customer's documents, notes the customer adds while it waits, and the
 * actors that do the work. Used by the tests in this process and by the
 * worker processes they start.
 */
import { Activity } from '../../src/types';
import { Actor } from '../../src/runtime/actors/actor';
import { BusinessEvent } from '../../src/runtime/business_event';

export const CLAIM_WORKFLOW_ID = '0b6b6f8e-6a43-4c7e-9a4b-2f1d3c5e7a91';
export const CLAIM_JOURNEY_ID = '5f2c9d1e-3b4a-4f6e-8c7d-1a2b3c4d5e6f';
const id = (n: number) => `9c1e4f2a-7b3d-4e5f-8a6b-${String(n).padStart(12, '0')}`;

export const claim_workflow = {
    id: CLAIM_WORKFLOW_ID, name: 'Claim', version: '1.0.0', awa_version: '1.1',
    activities: [
        { id: id(1), name: 'Register', role_id: id(9), actor_type: 'application' },
        { id: id(2), name: 'Settle', role_id: id(9), actor_type: 'application' },
    ],
    events: [{ id: id(3), name: 'Documents', event_type: 'message', event_definition: { name: 'documents.uploaded', correlation_key: 'customer_id', timeout: 'P1D' } }],
    edges: [{ id: id(4), source_id: id(1), target_id: id(3) }, { id: id(5), source_id: id(3), target_id: id(2) }],
};

export const claim_journey = {
    id: CLAIM_JOURNEY_ID, name: 'Claim', version: '1.0.0', subject: { name: 'customer', key: 'customer_id' },
    stages: [{ id: 'open', name: 'Open', workflows: [CLAIM_WORKFLOW_ID], complete_when: 'paid == true', max_duration: 'PT1S', transitions: [] }],
    triggers: [{ event: 'claim.submitted', starts_journey: true, start_workflow: CLAIM_WORKFLOW_ID }],
    touchpoints: [{ id: 'note', name: 'Adds a note', direction: 'inbound', channel: 'web', on: { event: 'note.added' } }],
};

/** Returns at once, except for the activities named, which take the time given (in milliseconds) */
export class LoadActor implements Actor {
    constructor(private slow: Record<string, number> = {}, private on_slow?: (activity: string) => void) { }
    async execute(activity: Activity, inputs?: Record<string, unknown>): Promise<Record<string, unknown>> {
        const ms = this.slow[activity.name];
        if (ms) { this.on_slow?.(activity.name); await new Promise(resolve => setTimeout(resolve, ms)); }
        return activity.name === 'Settle' ? { paid: true } : { claim_id: `CLM-${inputs?.customer_id}` };
    }
}

export const event = (type: string, customer: string, event_id: string, data: Record<string, unknown> = {}): BusinessEvent =>
    ({ specversion: '1.0', id: event_id, source: '/load', type, data: { customer_id: customer, ...data } });

/** The events of one phase of the burst, for every subject */
export function phase(name: 'submit' | 'notes' | 'documents', subjects: number, notes: number): BusinessEvent[] {
    const out: BusinessEvent[] = [];
    for (let s = 0; s < subjects; s++) {
        const customer = `c-${s}`;
        if (name === 'submit') out.push(event('claim.submitted', customer, `submit-${s}`));
        if (name === 'notes') for (let n = 0; n < notes; n++) out.push(event('note.added', customer, `note-${s}-${n}`, { note: n }));
        if (name === 'documents') out.push(event('documents.uploaded', customer, `documents-${s}`));
    }
    return out;
}

/**
 * Deal events out to hosts: each event to one host, and every `duplicate_every`th
 * event to a second host as well, as a producer that delivers twice would.
 */
export function deal<T>(events: T[], hosts: number, duplicate_every: number): T[][] {
    const queues: T[][] = Array.from({ length: hosts }, () => []);
    events.forEach((e, n) => {
        queues[n % hosts].push(e);
        if (duplicate_every && n % duplicate_every === 0) queues[(n + 1) % hosts].push(e);
    });
    // Each host takes its events in its own order, so that hosts meet on the same subjects
    return queues.map((q, h) => (h % 2 ? [...q].reverse() : q));
}
