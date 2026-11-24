/**
 * awa import and awa export: interchange with BPMN 2.0, DMN 1.x and CNCF Serverless
 * Workflow 1.0 (specification section 27).
 */
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { import_bpmn } from '../../interchange/bpmn_import';
import { export_bpmn } from '../../interchange/bpmn_export';
import { import_dmn, write_dmn } from '../../interchange/dmn';
import { export_serverless_workflow, type NotMapped } from '../../interchange/serverless_workflow';
import { InterchangeError, is_object, type InterchangeWarning, type JsonObject } from '../../interchange/common';

/** What a command wrote, and what it left out */
export interface InterchangeOutcome { written: string[]; warnings: InterchangeWarning[]; not_mapped?: NotMapped[] }

const base_of = (file: string, extensions: string[]) => {
    const name = path.basename(file);
    const ext = extensions.find(e => name.toLowerCase().endsWith(e));
    return path.join(path.dirname(file), ext ? name.slice(0, -ext.length) : name);
};
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
const read_json = (file: string): JsonObject => {
    const value = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!is_object(value)) throw new InterchangeError(`${file} does not hold a JSON object`);
    return value;
};
const write = (file: string, text: string, written: string[]) => { fs.writeFileSync(file, text); written.push(file); };
const workflow_name = (document: JsonObject) => String((is_object(document.workflow) && !document.activities ? document.workflow : document).name ?? 'workflow');

/** awa import bpmn: the first process to the output file, other processes and subprocesses beside it */
export async function import_bpmn_file(file: string, options: { dmn?: string[]; output?: string } = {}): Promise<InterchangeOutcome> {
    const base = base_of(file, ['.bpmn20.xml', '.bpmn', '.xml']);
    let dmn_files = options.dmn || [];
    if (!dmn_files.length && fs.existsSync(`${base}.dmn`)) dmn_files = [`${base}.dmn`];
    const result = await import_bpmn(fs.readFileSync(file, 'utf-8'), { dmn: dmn_files.map(f => fs.readFileSync(f, 'utf-8')) });
    const output = options.output || `${base}.awa.json`;
    const out_base = base_of(output, ['.awa.json', '.json']);
    const written: string[] = [];
    const names = new Set<string>();
    result.documents.forEach((document, i) => {
        if (i === 0) { write(output, `${JSON.stringify(document, null, 2)}\n`, written); return; }
        let name = slug(workflow_name(document));
        for (let n = 2; names.has(name); n++) name = `${slug(workflow_name(document))}-${n}`;
        names.add(name);
        write(`${out_base}.${name}.awa.json`, `${JSON.stringify(document, null, 2)}\n`, written);
    });
    const warnings = dmn_files.length && !options.dmn?.length ? [{ message: `Decision tables read from ${dmn_files[0]}` }, ...result.warnings] : result.warnings;
    return { written, warnings };
}

/** awa import dmn: the decision tables as a list of AWA decision nodes */
export async function import_dmn_file(file: string, options: { output?: string } = {}): Promise<InterchangeOutcome> {
    const result = await import_dmn(fs.readFileSync(file, 'utf-8'));
    const output = options.output || `${base_of(file, ['.dmn', '.xml'])}.decisions.json`;
    const written: string[] = [];
    write(output, `${JSON.stringify(result.decisions, null, 2)}\n`, written);
    return { written, warnings: result.warnings };
}

/** awa export bpmn: one BPMN document for the workflows, and a DMN document for their decision tables */
export async function export_bpmn_files(files: string[], options: { output?: string; diagram?: boolean } = {}): Promise<InterchangeOutcome> {
    const result = await export_bpmn(files.map(read_json), { diagram: options.diagram });
    const output = options.output || `${base_of(files[0], ['.awa.json', '.json'])}.bpmn`;
    const written: string[] = [];
    write(output, result.bpmn, written);
    if (result.dmn) write(`${base_of(output, ['.bpmn', '.xml'])}.dmn`, result.dmn, written);
    return { written, warnings: result.warnings };
}

/** awa export dmn: the decision tables of the workflows */
export async function export_dmn_files(files: string[], options: { output?: string } = {}): Promise<InterchangeOutcome> {
    const documents = files.map(read_json);
    const workflows = documents.map(d => (is_object(d.workflow) && !d.activities ? d.workflow : d) as JsonObject);
    const nodes = workflows.flatMap(w => ((w.decision_nodes as JsonObject[]) || []).filter(n => is_object(n.decision_table)));
    if (!nodes.length) throw new InterchangeError('None of the workflows has a decision table');
    const xml = await write_dmn(nodes, { definitions: { id: String(workflows[0].id), name: String(workflows[0].name) } });
    const output = options.output || `${base_of(files[0], ['.awa.json', '.json'])}.dmn`;
    const written: string[] = [];
    write(output, xml, written);
    return { written, warnings: [] };
}

/** awa export serverless-workflow: YAML by default, JSON when the output file or --format says so */
export async function export_serverless_workflow_file(file: string, options: { output?: string; format?: string } = {}): Promise<InterchangeOutcome> {
    const result = await export_serverless_workflow(read_json(file));
    const format = options.format || (options.output && /\.json$/i.test(options.output) ? 'json' : 'yaml');
    if (format !== 'json' && format !== 'yaml') throw new InterchangeError(`--format is json or yaml, not ${format}`);
    const output = options.output || `${base_of(file, ['.awa.json', '.json'])}.sw.${format}`;
    const text = format === 'json' ? `${JSON.stringify(result.document, null, 2)}\n` : YAML.stringify(result.document);
    const written: string[] = [];
    write(output, text, written);
    return { written, warnings: [], not_mapped: result.not_mapped };
}

function report(outcome: InterchangeOutcome) {
    for (const file of outcome.written) console.log(`✓ wrote ${file}`);
    for (const w of outcome.warnings) console.log(`  note: ${w.message}`);
    if (outcome.not_mapped?.length) {
        console.log(`  not mapped (${outcome.not_mapped.length}):`);
        for (const n of outcome.not_mapped) console.log(`    - ${[n.node, n.property].filter(Boolean).join(' / ') || 'workflow'}: ${n.reason}`);
    }
}

const run = (task: () => Promise<InterchangeOutcome>) => async () => {
    try {
        report(await task());
    } catch (error) {
        console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
};

export const importCommand = new Command('import').description('Read a BPMN 2.0 process or DMN decision tables into AWA (specification section 27)');
importCommand.command('bpmn')
    .description('Turn a BPMN 2.0 document into AWA workflows: the first process to the output, others beside it')
    .argument('<file>', 'BPMN 2.0 document')
    .option('--dmn <files...>', 'DMN documents holding the decision tables business rule tasks name (default: <file>.dmn when it exists)')
    .option('-o, --output <file>', 'Workflow document to write (default: <file>.awa.json)')
    .action((file: string, options: { dmn?: string[]; output?: string }) => run(() => import_bpmn_file(file, options))());
importCommand.command('dmn')
    .description('Turn the decision tables of a DMN 1.x document into AWA decision nodes')
    .argument('<file>', 'DMN document')
    .option('-o, --output <file>', 'File to write (default: <file>.decisions.json)')
    .action((file: string, options: { output?: string }) => run(() => import_dmn_file(file, options))());

export const exportCommand = new Command('export').description('Write AWA workflows as BPMN 2.0, DMN or CNCF Serverless Workflow (specification section 27)');
exportCommand.command('bpmn')
    .description('Write workflows as one BPMN 2.0 document, and their decision tables as DMN beside it. Reading them back gives the same workflows')
    .argument('<files...>', 'Workflow documents')
    .option('-o, --output <file>', 'BPMN document to write (default: <first file>.bpmn)')
    .option('--no-diagram', 'Leave out the diagram (BPMNDI)')
    .action((files: string[], options: { output?: string; diagram?: boolean }) => run(() => export_bpmn_files(files, options))());
exportCommand.command('dmn')
    .description('Write the decision tables of workflows as a DMN 1.3 document')
    .argument('<files...>', 'Workflow documents')
    .option('-o, --output <file>', 'DMN document to write (default: <first file>.dmn)')
    .action((files: string[], options: { output?: string }) => run(() => export_dmn_files(files, options))());
exportCommand.command('serverless-workflow')
    .description('Write a workflow as a CNCF Serverless Workflow 1.0 document, and list what does not map')
    .argument('<file>', 'Workflow document')
    .option('-o, --output <file>', 'Document to write (default: <file>.sw.yaml)')
    .option('--format <format>', 'yaml or json (default: from the output file, else yaml)')
    .action((file: string, options: { output?: string; format?: string }) => run(() => export_serverless_workflow_file(file, options))());
