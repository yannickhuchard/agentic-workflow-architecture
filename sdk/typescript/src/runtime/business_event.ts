/**
 * Business events (specification section 18)
 *
 * The envelope AWA uses for events that cross its boundary, in either
 * direction: a CloudEvents 1.0 event in JSON form. `type` names the event,
 * `id` together with `source` identifies one occurrence, `data` carries the
 * facts.
 */

import { randomUUID } from 'crypto';

export interface BusinessEvent {
    specversion: '1.0';
    /** Identifies this occurrence. A consumer that sees the same id twice ignores the second. */
    id: string;
    /** Who produced it, as a URI reference, e.g. "/crm" or "urn:awa:run:<id>" */
    source: string;
    /** The event name, e.g. "claim.submitted" */
    type: string;
    time?: string;
    subject?: string;
    datacontenttype?: string;
    data?: Record<string, unknown>;
}

export function business_event(type: string, data: Record<string, unknown> = {}, extra: Partial<BusinessEvent> = {}): BusinessEvent {
    return {
        specversion: '1.0',
        id: randomUUID(),
        source: '/awa',
        type,
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data,
        ...extra,
    };
}

/** Receives the events a workflow publishes. A Kafka producer, a webhook caller, a queue. */
export type EventSink = (event: BusinessEvent) => void | Promise<void>;
