import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { validate_workflow, validate_workflow_integrity, parse_document, ValidationError } from '../../validator';
import { is_journey_document } from '../../runtime/runtime';
import { JourneyDefinitionSchema, validate_journey } from '../../runtime/journey';

/** A document as written: a workflow, a journey, or a workflow wrapped in { "workflow": ... } */
const unwrap = (document: any) => (document && document.workflow && !document.activities ? document.workflow : document);

/**
 * Check workflow and journey documents against the schema and the rules the engine
 * applies before it runs one (specification sections 4 and 19). A journey is checked
 * against the workflows given beside it: its references must name one of them.
 * Exit status 1 when any document is not valid.
 */
export interface DocumentCheck { file: string; kind: 'workflow' | 'journey' | 'unknown'; name?: string; valid: boolean; errors: ValidationError[] }

/**
 * Check workflow and journey documents against the schema and the rules the engine
 * applies before it runs one (specification sections 4 and 19). A journey is checked
 * against the workflows given beside it: its references must name one of them.
 */
export async function check_documents(files: string[]): Promise<{ results: DocumentCheck[]; journey_references_checked: boolean }> {
    const results: DocumentCheck[] = [];
    const documents: { file: string; document: any }[] = [];
    for (const file of files) {
        try {
            documents.push({ file, document: unwrap(JSON.parse(await fs.readFile(path.resolve(process.cwd(), file), 'utf-8'))) });
        } catch (error) {
            results.push({ file, kind: 'unknown', valid: false, errors: [{ path: '', message: `Cannot read it as JSON: ${error instanceof Error ? error.message : String(error)}`, code: 'invalid_json' }] });
        }
    }
    const workflow_ids = new Set<string>();
    for (const { file, document } of documents.filter(d => !is_journey_document(d.document))) {
        const schema = validate_workflow(document);
        if (!schema.valid) { results.push({ file, kind: 'workflow', name: document?.name, valid: false, errors: schema.errors }); continue; }
        const workflow = parse_document(document);
        workflow_ids.add(workflow.id);
        const integrity = validate_workflow_integrity(workflow);
        results.push({ file, kind: 'workflow', name: workflow.name, valid: integrity.valid, errors: integrity.errors });
    }
    for (const { file, document } of documents.filter(d => is_journey_document(d.document))) {
        const parsed = JourneyDefinitionSchema.safeParse(document);
        if (!parsed.success) {
            results.push({ file, kind: 'journey', name: document?.name, valid: false, errors: parsed.error.issues.map(e => ({ path: e.path.join('.'), message: e.message, code: e.code })) });
            continue;
        }
        // With its workflows given, every reference is checked; without, only what the journey says of itself
        const errors = validate_journey(parsed.data, workflow_ids, workflow_ids.size > 0);
        results.push({ file, kind: 'journey', name: parsed.data.name, valid: errors.length === 0, errors });
    }
    return { results, journey_references_checked: workflow_ids.size > 0 };
}

/** Exit status 1 when any document is not valid */
export const validateCommand = new Command('validate')
    .description('Check workflow and journey documents against the schema and the rules applied before a run')
    .argument('<files...>', 'Workflow (.awa.json) and journey documents. Give a journey\'s workflows beside it to check its references')
    .option('--json', 'Print the result as JSON')
    .action(async (files: string[], options: { json?: boolean }) => {
        const { results, journey_references_checked } = await check_documents(files);
        if (options.json) console.log(JSON.stringify(results, null, 2));
        else {
            for (const r of results) {
                console.log(`${r.valid ? '✓' : '✗'} ${r.file}: ${r.kind}${r.name ? ` "${r.name}"` : ''} ${r.valid ? 'is valid' : `has ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}`}`);
                for (const e of r.errors) console.log(`    ${e.path ? `${e.path}: ` : ''}${e.message}`);
            }
            if (results.some(r => r.kind === 'journey') && !journey_references_checked) console.log('  (journey references to workflows were not checked: give the workflows beside the journey to check them)');
        }
        process.exitCode = results.every(r => r.valid) ? 0 : 1;
    });
