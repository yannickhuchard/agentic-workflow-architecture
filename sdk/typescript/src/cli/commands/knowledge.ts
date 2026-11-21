import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { parse_document } from '../../validator';
import { parse_journal } from '../../runtime/journal';
import { KnowledgeBase } from '../../runtime/knowledge';

const resolve = (file: string) => path.resolve(process.cwd(), file);
const run = (action: (...args: any[]) => Promise<void>) => async (...args: any[]) => {
    try {
        await action(...args);
    } catch (error: unknown) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
};

export const knowledgeCommand = new Command('knowledge')
    .description('Build, review and exchange knowledge distilled from run journals');

knowledgeCommand.command('ingest')
    .description('Distil the journal of a run into the knowledge base. Safe to repeat: a run is counted once')
    .argument('<workflow>', 'Path to the .awa.json file')
    .argument('<journal...>', 'One or more run journals (.jsonl)')
    .option('--kb <file>', 'Knowledge base file', 'knowledge.json')
    .action(run(async (workflowFile: string, journals: string[], options: { kb: string }) => {
        const workflow = parse_document(JSON.parse(await fs.readFile(resolve(workflowFile), 'utf-8')));
        const kb = await KnowledgeBase.load(resolve(options.kb));
        for (const file of journals) {
            const events = parse_journal(await fs.readFile(resolve(file), 'utf-8')).filter(e => e.workflow_id === workflow.id);
            for (const run_id of [...new Set(events.map(e => e.run_id))]) {
                const result = kb.ingest(workflow, events.filter(e => e.run_id === run_id));
                console.log(result.skipped
                    ? `run ${run_id}: already ingested`
                    : `run ${run_id}: ${result.created.length} created, ${result.updated.length} updated`);
            }
        }
        await kb.save(resolve(options.kb));
    }));

knowledgeCommand.command('list')
    .description('List knowledge entries')
    .option('--kb <file>', 'Knowledge base file', 'knowledge.json')
    .option('--status <status>', 'Only entries with this status: draft, reviewed or deprecated')
    .action(run(async (options: { kb: string; status?: 'draft' | 'reviewed' | 'deprecated' }) => {
        const kb = await KnowledgeBase.load(resolve(options.kb));
        for (const entry of kb.list({ status: options.status })) {
            console.log(`${entry.status.padEnd(10)} ${String(entry.observations).padStart(3)} run(s)  ${entry.id}\n${' '.repeat(23)}${entry.title}`);
        }
    }));

knowledgeCommand.command('review')
    .description('Mark entries as reviewed by a person. Only reviewed entries are given to actors by default')
    .argument('<id...>', 'Entry ids, or "all" for every draft')
    .requiredOption('--by <reviewer>', 'Who reviewed them')
    .option('--kb <file>', 'Knowledge base file', 'knowledge.json')
    .action(run(async (ids: string[], options: { kb: string; by: string }) => {
        const kb = await KnowledgeBase.load(resolve(options.kb));
        const targets = ids.includes('all') ? kb.list({ status: 'draft' }).map(e => e.id) : ids;
        for (const id of targets) kb.review(id, options.by);
        await kb.save(resolve(options.kb));
        console.log(`${targets.length} entr${targets.length === 1 ? 'y' : 'ies'} reviewed by ${options.by}`);
    }));

knowledgeCommand.command('deprecate')
    .description('Mark an entry as no longer current')
    .argument('<id>', 'Entry id')
    .option('--superseded-by <id>', 'The entry that replaces it')
    .option('--kb <file>', 'Knowledge base file', 'knowledge.json')
    .action(run(async (id: string, options: { kb: string; supersededBy?: string }) => {
        const kb = await KnowledgeBase.load(resolve(options.kb));
        kb.deprecate(id, options.supersededBy);
        await kb.save(resolve(options.kb));
        console.log(`${id} deprecated`);
    }));

knowledgeCommand.command('export')
    .description('Export the knowledge base as an Open Knowledge Format (OKF) bundle')
    .argument('<directory>', 'Directory to write the bundle to')
    .option('--kb <file>', 'Knowledge base file', 'knowledge.json')
    .option('--title <title>', 'Bundle title')
    .option('--license <license>', 'SPDX licence expression for the bundle')
    .action(run(async (directory: string, options: { kb: string; title?: string; license?: string }) => {
        const kb = await KnowledgeBase.load(resolve(options.kb));
        const count = await kb.export_okf(resolve(directory), { title: options.title, license: options.license });
        console.log(`${count} files written to ${directory}`);
    }));

knowledgeCommand.command('import')
    .description('Create a knowledge base from an Open Knowledge Format (OKF) bundle')
    .argument('<directory>', 'Bundle directory')
    .option('--kb <file>', 'Knowledge base file to write', 'knowledge.json')
    .action(run(async (directory: string, options: { kb: string }) => {
        const kb = await KnowledgeBase.import_okf(resolve(directory));
        await kb.save(resolve(options.kb));
        console.log(`${kb.list().length} entries imported into ${options.kb}`);
    }));
