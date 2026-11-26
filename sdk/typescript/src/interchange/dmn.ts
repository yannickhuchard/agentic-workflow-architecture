/**
 * DMN 1.x decision tables to and from AWA decision tables (specification 27.9).
 */
import {
    AWA_INTERCHANGE_NAMESPACE, DMN13_NAMESPACE, DMN_NAMESPACES, InterchangeError, type InterchangeWarning,
    awa_id, xml_id, residual, apply_residual, residual_extensions, read_residual, residual_is_empty,
    json_equal, clone, is_object, type JsonObject, type Json, type Residual,
} from './common';
import { awa_unary_to_feel, feel_unary_to_awa, feel_to_value, value_to_feel } from './expressions';
import { dmn_moddle, read_xml, awa_extensions, add_extensions } from './moddle';

const HIT_POLICY_TO_DMN: Record<string, string> = {
    unique: 'UNIQUE', first: 'FIRST', priority: 'PRIORITY', any: 'ANY', collect: 'COLLECT', rule_order: 'RULE ORDER',
};
const HIT_POLICY_FROM_DMN: Record<string, string> = Object.fromEntries(Object.entries(HIT_POLICY_TO_DMN).map(([k, v]) => [v, k]));

const TYPE_TO_DMN: Record<string, string> = { string: 'string', number: 'number', boolean: 'boolean', date: 'date', datetime: 'date and time' };
const TYPE_FROM_DMN: Record<string, string> = {
    string: 'string', number: 'number', integer: 'number', long: 'number', double: 'number', decimal: 'number',
    boolean: 'boolean', date: 'date', 'date and time': 'datetime', datetime: 'datetime', dateTime: 'datetime',
};

/** A decision as DMN carries it: what of an AWA decision node a DMN decision holds */
export interface DmnDecision { id: string; name: string; description?: string; decision_table: JsonObject }

/** The part of a decision node a DMN decision carries */
export function decision_projection(node: JsonObject): JsonObject {
    const out: JsonObject = { id: node.id, name: node.name };
    if (node.description !== undefined) out.description = node.description;
    out.decision_table = node.decision_table;
    return out;
}

/** Rewrite DMN 1.1, 1.2, 1.4 and 1.5 namespaces to DMN 1.3, whose model the reader has */
function to_dmn13(xml: string): string {
    let out = xml;
    for (const ns of DMN_NAMESPACES) if (ns !== DMN13_NAMESPACE) out = out.split(`"${ns}"`).join(`"${DMN13_NAMESPACE}"`);
    return out;
}

export interface ReadDmnOptions {
    /** Leave out the awa: residual: what the elements alone say. Used by the exporter */
    native?: boolean;
}

export interface ReadDmnResult {
    definitions_id: string;
    /** Decisions with a decision table, by their DMN identifier, in document order */
    decisions: Map<string, JsonObject>;
    warnings: InterchangeWarning[];
}

/** Read the decision tables of a DMN document */
export async function read_dmn(xml: string, options: ReadDmnOptions = {}): Promise<ReadDmnResult> {
    if (!DMN_NAMESPACES.some(ns => xml.includes(ns))) {
        throw new InterchangeError('The DMN document is not DMN 1.1 to 1.5: its namespace is none of the DMN model namespaces');
    }
    const moddle = await dmn_moddle();
    const definitions = await read_xml(moddle, to_dmn13(xml), 'DMN');
    if (definitions.$type !== 'dmn:Definitions') throw new InterchangeError('The DMN document does not start with <definitions>');
    const warnings: InterchangeWarning[] = [];
    const decisions = new Map<string, JsonObject>();
    for (const element of definitions.drgElement || []) {
        if (element.$type !== 'dmn:Decision') continue;
        const logic = element.decisionLogic;
        if (!logic) { warnings.push({ element: element.id, message: `Decision "${element.id}" has no decision logic and is left out` }); continue; }
        if (logic.$type !== 'dmn:DecisionTable') {
            warnings.push({ element: element.id, message: `Decision "${element.id}" is decided by a ${logic.$type.replace('dmn:', '')}, not a decision table; AWA decides with tables (5.5), so it is left out` });
            continue;
        }
        decisions.set(element.id, read_decision(element, definitions.id || 'definitions', warnings, !!options.native));
    }
    return { definitions_id: definitions.id, decisions, warnings };
}

function text_of(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') return (value as { text: string }).text;
    return undefined;
}

function where_of(decision: any, part: string): string {
    return `Decision "${decision.id}"${decision.name ? ` (${decision.name})` : ''}, ${part}`;
}

function allowed_values(unary: any, where: string, warnings: InterchangeWarning[]): Json[] | undefined {
    const text = unary?.text?.trim();
    if (!text) return undefined;
    const values: Json[] = [];
    for (const part of split_list(text)) {
        try { values.push(feel_to_value(part) as Json); } catch {
            warnings.push({ element: where, message: `${where}: the allowed values "${text}" are not a list of values, so they are left out` });
            return undefined;
        }
    }
    return values;
}

function split_list(text: string): string[] {
    const parts: string[] = [];
    let depth = 0, quote = false, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === '\\') i++; else if (c === '"') quote = false; continue; }
        if (c === '"') quote = true;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(text.slice(start).trim());
    return parts;
}

function column_type(type_ref: string | undefined, where: string, warnings: InterchangeWarning[]): string {
    if (!type_ref) return 'string';
    const mapped = TYPE_FROM_DMN[type_ref.trim()];
    if (mapped) return mapped;
    warnings.push({ element: where, message: `${where}: type "${type_ref}" has no AWA counterpart and is read as string` });
    return 'string';
}

function read_decision(decision: any, document_id: string, warnings: InterchangeWarning[], native: boolean): JsonObject {
    const table = decision.decisionLogic;
    const hit = (table.hitPolicy || 'UNIQUE').toUpperCase();
    if (hit === 'OUTPUT ORDER') {
        throw new InterchangeError(`${where_of(decision, 'hit policy OUTPUT ORDER')}: AWA has no hit policy that sorts outputs by their priority`);
    }
    if (table.aggregation) {
        throw new InterchangeError(`${where_of(decision, `hit policy COLLECT ${table.aggregation}`)}: AWA collects the outputs of the matching rules but does not aggregate them`);
    }
    const hit_policy = HIT_POLICY_FROM_DMN[hit];
    if (!hit_policy) throw new InterchangeError(`${where_of(decision, `hit policy "${table.hitPolicy}"`)}: not a DMN hit policy`);

    const inputs: JsonObject[] = (table.input || []).map((input: any, i: number) => {
        const where = where_of(decision, `input ${i + 1}`);
        const expression = (input.inputExpression?.text ?? '').trim();
        if (!/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(expression)) {
            throw new InterchangeError(`${where}: the input expression "${expression}" is not the name of one property; an AWA decision input names one property of the token data (5.5.1)`);
        }
        const column: JsonObject = { name: expression.trim() };
        if (input.label) column.label = input.label;
        column.type = column_type(input.inputExpression?.typeRef, where, warnings);
        const allowed = allowed_values(input.inputValues, where, warnings);
        if (allowed) column.allowed_values = allowed;
        return column;
    });
    const outputs: JsonObject[] = (table.output || []).map((output: any, i: number) => {
        const where = where_of(decision, `output ${i + 1}`);
        const name = output.name || ((table.output || []).length === 1 ? decision.name || decision.id : undefined);
        if (!name) throw new InterchangeError(`${where}: the output has no name, and an AWA output names the property it sets`);
        const column: JsonObject = { name };
        if (output.label) column.label = output.label;
        column.type = column_type(output.typeRef, where, warnings);
        const allowed = allowed_values(output.outputValues, where, warnings);
        if (allowed) column.allowed_values = allowed;
        return column;
    });
    if (!inputs.length) throw new InterchangeError(`${where_of(decision, 'its table')}: it has no input; an AWA table has at least one`);
    if (!outputs.length) throw new InterchangeError(`${where_of(decision, 'its table')}: it has no output; an AWA table has at least one`);

    const rules: JsonObject[] = (table.rule || []).map((rule: any, r: number) => {
        const out: JsonObject = {};
        if (typeof rule.id === 'string' && /^_[0-9a-fA-F-]{36}$/.test(rule.id)) out.id = awa_id(rule.id, document_id);
        const description = text_of(rule.description);
        if (description) out.description = description;
        out.input_entries = (rule.inputEntry || []).map((entry: any, j: number) => {
            try { return feel_unary_to_awa(entry.text ?? ''); } catch (error) {
                throw new InterchangeError(`${where_of(decision, `rule ${r + 1}, input ${j + 1}`)}: ${(error as Error).message}`);
            }
        });
        out.output_entries = (rule.outputEntry || []).map((entry: any, j: number) => {
            try { return feel_to_value(entry.text ?? '') as Json; } catch (error) {
                throw new InterchangeError(`${where_of(decision, `rule ${r + 1}, output ${j + 1}`)}: ${(error as Error).message}`);
            }
        });
        return out;
    });
    if (hit_policy === 'priority') assign_priorities(decision, table, rules, outputs);
    if (!native) {
        (table.rule || []).forEach((rule: any, r: number) => apply_residual(rules[r], read_residual(awa_extensions(rule), where_of(decision, `rule ${r + 1}`))));
        (table.input || []).forEach((input: any, i: number) => apply_residual(inputs[i], read_residual(awa_extensions(input), where_of(decision, `input ${i + 1}`))));
        (table.output || []).forEach((output: any, i: number) => apply_residual(outputs[i], read_residual(awa_extensions(output), where_of(decision, `output ${i + 1}`))));
    }

    const decision_table: JsonObject = { hit_policy, inputs, outputs, rules };
    const node: JsonObject = { id: awa_id(decision.id, document_id), name: decision.name || decision.id };
    const description = text_of(decision.description);
    if (description) node.description = description;
    node.decision_table = decision_table;
    if (!native) {
        apply_residual(decision_table, read_residual(awa_extensions(table), where_of(decision, 'its table')));
        apply_residual(node, read_residual(awa_extensions(decision), where_of(decision, 'the decision')));
        const final = node.decision_table as JsonObject;
        const ordered = (final.outputs as JsonObject[]).some(o => Array.isArray(o.allowed_values)) || (final.rules as JsonObject[]).some(rule => typeof rule.priority === 'number');
        if (final.hit_policy === 'priority' && !ordered) {
            throw new InterchangeError(`${where_of(decision, 'hit policy PRIORITY')}: the table gives no output values to order its rules by, and AWA gives each rule a priority`);
        }
    }
    return node;
}

/**
 * DMN PRIORITY orders rules by the position of their outputs in each output's list of
 * values; AWA by a number on each rule. The rule whose outputs come first gets the highest.
 */
function assign_priorities(decision: any, table: any, rules: JsonObject[], outputs: JsonObject[]): void {
    const lists = outputs.map(o => (Array.isArray(o.allowed_values) ? o.allowed_values : undefined));
    if (!lists.some(Boolean)) return;
    const keys = rules.map(rule => lists.map((list, i) => {
        if (!list) return 0;
        const index = list.findIndex(v => json_equal(v, (rule.output_entries as Json[])[i]));
        if (index < 0) throw new InterchangeError(`${where_of(decision, 'hit policy PRIORITY')}: an output of a rule is not among the output values that order the rules`);
        return index;
    }));
    const distinct = [...new Set(keys.map(k => JSON.stringify(k)))].map(k => JSON.parse(k) as number[]).sort(compare_keys);
    rules.forEach((rule, i) => {
        rule.priority = distinct.length - distinct.findIndex(k => compare_keys(k, keys[i]) === 0);
    });
    void table;
}

function compare_keys(a: number[], b: number[]): number {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface WriteDmnOptions {
    /** Identifier and name of the DMN definitions; by default those of the first decision */
    definitions?: { id: string; name: string };
}

interface Built { moddle: any; definitions: any; elements: Map<string, any> }

function build(moddle: any, nodes: JsonObject[], definitions: { id: string; name: string }): Built {
    const elements = new Map<string, any>();
    const defs = moddle.create('dmn:Definitions', {
        id: `Definitions_${definitions.id}`, name: definitions.name, namespace: `https://awa.io/workflows/${definitions.id}`, drgElement: [],
    });
    defs.$attrs['xmlns:awa'] = AWA_INTERCHANGE_NAMESPACE;
    for (const node of nodes) {
        const table = node.decision_table as JsonObject;
        const id = String(node.id);
        const decision = moddle.create('dmn:Decision', { id: xml_id(id), name: node.name });
        if (typeof node.description === 'string') decision.description = node.description;
        const inputs = (table.inputs as JsonObject[]) || [];
        const outputs = (table.outputs as JsonObject[]) || [];
        const dmn_table = moddle.create('dmn:DecisionTable', {
            id: `DecisionTable_${id}`, hitPolicy: HIT_POLICY_TO_DMN[String(table.hit_policy)] || 'UNIQUE', input: [], output: [], rule: [],
        });
        inputs.forEach((column, i) => {
            const input = moddle.create('dmn:InputClause', { id: `Input_${id}_${i + 1}` });
            if (column.label !== undefined) input.label = column.label;
            input.inputExpression = moddle.create('dmn:LiteralExpression', { id: `InputExpression_${id}_${i + 1}`, typeRef: TYPE_TO_DMN[String(column.type)] || 'string', text: column.name });
            if (Array.isArray(column.allowed_values) && column.allowed_values.length) {
                input.inputValues = moddle.create('dmn:UnaryTests', { id: `InputValues_${id}_${i + 1}`, text: column.allowed_values.map(value_to_feel).join(', ') });
            }
            dmn_table.input.push(input);
            elements.set(`${id}/input/${i}`, input);
        });
        outputs.forEach((column, i) => {
            const output = moddle.create('dmn:OutputClause', { id: `Output_${id}_${i + 1}`, name: column.name, typeRef: TYPE_TO_DMN[String(column.type)] || 'string' });
            if (column.label !== undefined) output.label = column.label;
            if (Array.isArray(column.allowed_values) && column.allowed_values.length) {
                output.outputValues = moddle.create('dmn:UnaryTests', { id: `OutputValues_${id}_${i + 1}`, text: column.allowed_values.map(value_to_feel).join(', ') });
            }
            dmn_table.output.push(output);
            elements.set(`${id}/output/${i}`, output);
        });
        ((table.rules as JsonObject[]) || []).forEach((rule, r) => {
            const rule_id = typeof rule.id === 'string' ? xml_id(rule.id) : `Rule_${id}_${r + 1}`;
            const dmn_rule = moddle.create('dmn:DecisionRule', { id: rule_id, inputEntry: [], outputEntry: [] });
            if (typeof rule.description === 'string') dmn_rule.description = rule.description;
            ((rule.input_entries as string[]) || []).forEach((entry, j) => {
                dmn_rule.inputEntry.push(moddle.create('dmn:UnaryTests', { id: `${rule_id}_in_${j + 1}`, text: awa_unary_to_feel(entry, inputs[j]?.type as string | undefined) }));
            });
            ((rule.output_entries as Json[]) || []).forEach((value, j) => {
                dmn_rule.outputEntry.push(moddle.create('dmn:LiteralExpression', { id: `${rule_id}_out_${j + 1}`, text: value_to_feel(value) }));
            });
            dmn_table.rule.push(dmn_rule);
            elements.set(`${id}/rule/${r}`, dmn_rule);
        });
        decision.decisionLogic = dmn_table;
        defs.drgElement.push(decision);
        elements.set(`${id}/decision`, decision);
        elements.set(`${id}/table`, dmn_table);
    }
    return { moddle, definitions: defs, elements };
}

/** Residuals of a list matched element by element when the lengths agree; otherwise the whole list belongs to the parent */
function list_residuals(original: JsonObject[] | undefined, native: JsonObject[] | undefined): Residual[] | undefined {
    if (!Array.isArray(original) || !Array.isArray(native) || original.length !== native.length) return undefined;
    return original.map((item, i) => residual(item, native[i]));
}

/**
 * Write the decision tables of decision nodes as a DMN 1.3 document. Every table is kept:
 * what DMN cannot say is written in the awa: namespace, so reading the document back gives
 * the same tables.
 */
export async function write_dmn(nodes: JsonObject[], options: WriteDmnOptions = {}): Promise<string> {
    const with_tables = nodes.filter(n => is_object(n.decision_table));
    const definitions = options.definitions || { id: String(with_tables[0]?.id ?? 'decisions'), name: String(with_tables[0]?.name ?? 'Decisions') };
    const moddle = await dmn_moddle();
    const built = build(moddle, with_tables, definitions);
    const first = (await moddle.toXML(built.definitions, { format: true })).xml as string;
    const native = await read_dmn(first, { native: true });
    const native_by_id = new Map([...native.decisions.values()].map(d => [String(d.id), d]));

    for (const node of with_tables) {
        const id = String(node.id);
        const original = clone(decision_projection(node));
        const back = native_by_id.get(id);
        if (!back) throw new InterchangeError(`Decision "${node.name}" was not read back from the DMN written for it`);
        const table = original.decision_table as JsonObject;
        const native_table = back.decision_table as JsonObject;
        const table_level: JsonObject = {};
        const native_table_level: JsonObject = {};
        for (const key of Object.keys(table)) if (!['inputs', 'outputs', 'rules'].includes(key)) table_level[key] = table[key];
        for (const key of Object.keys(native_table)) if (!['inputs', 'outputs', 'rules'].includes(key)) native_table_level[key] = native_table[key];
        for (const [key, kind] of [['inputs', 'input'], ['outputs', 'output'], ['rules', 'rule']] as const) {
            const per_item = list_residuals(table[key] as JsonObject[], native_table[key] as JsonObject[]);
            if (per_item) {
                per_item.forEach((r, i) => add_extensions(moddle, built.elements.get(`${id}/${kind}/${i}`), 'dmn', residual_extensions(r)));
            } else {
                table_level[key] = table[key];
                native_table_level[key] = native_table[key];
            }
        }
        add_extensions(moddle, built.elements.get(`${id}/table`), 'dmn', residual_extensions(residual(table_level, native_table_level)));
        const decision_level = { ...original };
        delete decision_level.decision_table;
        const native_decision_level = { ...back };
        delete native_decision_level.decision_table;
        const r = residual(decision_level, native_decision_level);
        if (!residual_is_empty(r)) add_extensions(moddle, built.elements.get(`${id}/decision`), 'dmn', residual_extensions(r));
    }
    const xml = (await moddle.toXML(built.definitions, { format: true })).xml as string;

    // The export is lossless or it is a defect
    const back = await read_dmn(xml);
    for (const node of with_tables) {
        const read = [...back.decisions.values()].find(d => d.id === node.id);
        if (!read || !json_equal(read, decision_projection(node))) {
            throw new InterchangeError(`Decision "${node.name}" does not read back from DMN as it was written; this is a defect of the exporter`);
        }
    }
    return xml;
}

/** The decision nodes of a DMN document, each with its table and no routing: the result of `awa import dmn` */
export async function import_dmn(xml: string): Promise<{ decisions: JsonObject[]; warnings: InterchangeWarning[] }> {
    const result = await read_dmn(xml);
    if (!result.decisions.size) throw new InterchangeError('The DMN document has no decision table');
    return { decisions: [...result.decisions.values()], warnings: result.warnings };
}
