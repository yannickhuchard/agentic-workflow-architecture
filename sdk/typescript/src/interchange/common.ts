/**
 * Interchange with BPMN 2.0, DMN and CNCF Serverless Workflow (specification section 27):
 * identifiers, namespaces, errors, and the residual that keeps an export lossless.
 */
import { createHash } from 'crypto';

/** The namespace of AWA's extension to BPMN and DMN (spec/xsd/awa-interchange.xsd) */
export const AWA_INTERCHANGE_NAMESPACE = 'https://awa.io/schema/interchange/1.1';
/** Language of a BPMN condition written in AWA's condition expression language (section 6) */
export const AWA_EXPRESSION_LANGUAGE = 'https://awa.io/schema/expression/1.1';
/** Language of the conditions an export writes after a decision: which rules route there. Derived, never read */
export const AWA_DECISION_ROUTE_LANGUAGE = 'https://awa.io/schema/decision-route/1.1';
/** FEEL, as DMN 1.3 names it */
export const FEEL_LANGUAGE = 'https://www.omg.org/spec/DMN/20191111/FEEL/';
export const BPMN_MODEL_NAMESPACE = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const DMN13_NAMESPACE = 'https://www.omg.org/spec/DMN/20191111/MODEL/';
/** The namespaces of the DMN versions an importer reads: 1.1 to 1.5 */
export const DMN_NAMESPACES = [
    'http://www.omg.org/spec/DMN/20151101/dmn.xsd',
    'http://www.omg.org/spec/DMN/20180521/MODEL/',
    DMN13_NAMESPACE,
    'https://www.omg.org/spec/DMN/20211108/MODEL/',
    'https://www.omg.org/spec/DMN/20230324/MODEL/',
];

/** A BPMN, DMN or Serverless Workflow document that cannot be read or written without changing its meaning */
export class InterchangeError extends Error {
    public readonly code = 'INTERCHANGE_ERROR';
    constructor(message: string) {
        super(message);
        this.name = 'InterchangeError';
    }
}

/** Something an import or export left out that does not change how a run behaves */
export interface InterchangeWarning { element?: string; message: string }

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** RFC 4122 name-based UUID, version 5 */
export function uuid5(namespace: string, name: string): string {
    const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
    const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf-8')])).digest();
    const bytes = hash.subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** uuid5(NAMESPACE_URL, AWA_INTERCHANGE_NAMESPACE): the namespace of identifiers derived from BPMN and DMN identifiers */
export const INTERCHANGE_ID_NAMESPACE = '84c7aa15-559c-5fc6-abf7-39cad8e0d785';

/** The BPMN or DMN identifier of an AWA object: an XML ID cannot start with a digit */
export const xml_id = (uuid: string) => `_${uuid}`;

/**
 * The AWA identifier of an element. "_<uuid>" gives back the UUID; any other
 * identifier gives a UUID derived from it and from the document's own identifier.
 */
export function awa_id(element_id: string, document_id: string, suffix = ''): string {
    if (!suffix && element_id.startsWith('_') && UUID_PATTERN.test(element_id.slice(1))) return element_id.slice(1);
    return uuid5(INTERCHANGE_ID_NAMESPACE, `${document_id}/${element_id}${suffix}`);
}

export const is_uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

// ---------------------------------------------------------------------------
// JSON values
// ---------------------------------------------------------------------------

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const is_object = (value: unknown): value is JsonObject =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** Deep equality of JSON values; the order of an object's properties does not matter */
export function json_equal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, i) => json_equal(item, b[i]));
    }
    if (is_object(a) && is_object(b)) {
        const keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) return false;
        return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && json_equal(a[key], b[key]));
    }
    return false;
}

export const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

// ---------------------------------------------------------------------------
// The residual (27.7): what the native mapping does not give back
// ---------------------------------------------------------------------------

/** Properties to merge over what the native mapping gives, and paths it gives that the object does not have */
export interface Residual { set: JsonObject; absent: string[][] }

/** What must be added to, and removed from, `native` to obtain `original` */
export function residual(original: JsonObject, native: JsonObject): Residual {
    const set: JsonObject = {};
    const absent: string[][] = [];
    for (const [key, value] of Object.entries(original)) {
        if (value === undefined) continue;
        if (!(key in native) || native[key] === undefined) { set[key] = value; continue; }
        if (json_equal(value, native[key])) continue;
        if (is_object(value) && is_object(native[key])) {
            const inner = residual(value, native[key] as JsonObject);
            if (Object.keys(inner.set).length) set[key] = inner.set;
            for (const path of inner.absent) absent.push([key, ...path]);
        } else {
            set[key] = value;
        }
    }
    for (const key of Object.keys(native)) {
        if (native[key] !== undefined && (!(key in original) || original[key] === undefined)) absent.push([key]);
    }
    return { set, absent };
}

export const residual_is_empty = (r: Residual) => Object.keys(r.set).length === 0 && r.absent.length === 0;

/** Merge `set` over `target` (objects key by key, any other value replaces) and remove the `absent` paths */
export function apply_residual(target: JsonObject, r: Residual): JsonObject {
    merge_into(target, r.set);
    for (const path of r.absent) {
        let node: unknown = target;
        for (const key of path.slice(0, -1)) node = is_object(node) ? node[key] : undefined;
        if (is_object(node)) delete node[path[path.length - 1]];
    }
    return target;
}

function merge_into(target: JsonObject, set: JsonObject): void {
    for (const [key, value] of Object.entries(set)) {
        if (is_object(value) && is_object(target[key])) merge_into(target[key] as JsonObject, value);
        else target[key] = clone(value);
    }
}

/**
 * Properties of the residual written as their own extension element rather than inside
 * awa:properties. Their content is the same: the JSON of the property's value.
 */
export const NAMED_EXTENSIONS: Record<string, string> = {
    outcome_contract: 'outcomeContract',
    verification: 'verification',
    retry: 'retry',
    tools: 'tools',
    context_bindings: 'contextBindings',
    contexts: 'contexts',
    ai_model_config: 'modelConfig',
    decision_model: 'decisionModel',
    decision_engine: 'decisionEngine',
    sla: 'sla',
    knowledge: 'knowledge',
};

/** One extension element of the awa: namespace, by local name, with its JSON content */
export interface ExtensionValue { name: string; body: string }

/** The extension elements that carry a residual */
export function residual_extensions(r: Residual): ExtensionValue[] {
    const out: ExtensionValue[] = [];
    const rest: JsonObject = {};
    for (const [key, value] of Object.entries(r.set)) {
        if (NAMED_EXTENSIONS[key]) out.push({ name: NAMED_EXTENSIONS[key], body: JSON.stringify(value) });
        else rest[key] = value;
    }
    if (Object.keys(rest).length) out.unshift({ name: 'properties', body: JSON.stringify(rest) });
    if (r.absent.length) out.push({ name: 'absent', body: JSON.stringify(r.absent) });
    return out;
}

/** Read back a residual from extension elements (local name and text). Unknown awa: elements are refused */
export function read_residual(extensions: ExtensionValue[], where: string): Residual {
    const r: Residual = { set: {}, absent: [] };
    const by_name = Object.fromEntries(Object.entries(NAMED_EXTENSIONS).map(([k, v]) => [v, k]));
    for (const { name, body } of extensions) {
        if (name === 'envelope') continue;
        let value: unknown;
        try { value = JSON.parse(body); } catch {
            throw new InterchangeError(`${where}: the content of awa:${name} is not JSON`);
        }
        if (name === 'properties') {
            if (!is_object(value)) throw new InterchangeError(`${where}: awa:properties must hold a JSON object`);
            Object.assign(r.set, value);
        } else if (name === 'absent') {
            if (!Array.isArray(value) || !value.every(p => Array.isArray(p) && p.length > 0 && p.every(k => typeof k === 'string'))) {
                throw new InterchangeError(`${where}: awa:absent must hold a list of property paths`);
            }
            r.absent.push(...(value as string[][]));
        } else if (by_name[name]) {
            r.set[by_name[name]] = value as Json;
        } else {
            throw new InterchangeError(`${where}: awa:${name} is not an element of the AWA interchange namespace`);
        }
    }
    return r;
}

/** A name usable where only letters, digits, "-" and "_" are allowed */
export function token_name(text: string, max = 64): string {
    const cleaned = text.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, max);
    return cleaned || '_';
}
