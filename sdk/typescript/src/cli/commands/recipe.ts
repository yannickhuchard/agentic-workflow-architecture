import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { parse_document } from '../../validator';
import { parse_journal } from '../../runtime/journal';
import { compile_recipe } from '../../runtime/recipe';

export const recipeCommand = new Command('recipe')
    .description('Compile a workflow and the journal of one run into a build-from-scratch recipe (Markdown)')
    .argument('<workflow>', 'Path to the .awa.json file')
    .argument('[journal]', 'Path to the run journal (.jsonl). Without it the recipe covers the definition only')
    .option('-o, --output <file>', 'Write the recipe to this file instead of standard output')
    .option('--no-definition', 'Leave out the appendix with the full workflow definition')
    .option('--no-payloads', 'Leave out inputs and accepted outputs')
    .action(async (workflowFile, journalFile, options) => {
        try {
            const workflow = parse_document(JSON.parse(await fs.readFile(path.resolve(process.cwd(), workflowFile), 'utf-8')));
            let events = journalFile
                ? parse_journal(await fs.readFile(path.resolve(process.cwd(), journalFile), 'utf-8'))
                : [];

            // A journal file may hold several runs of the workflow; use the latest
            const runs = [...new Set(events.filter(e => e.workflow_id === workflow.id).map(e => e.run_id))];
            if (journalFile && runs.length === 0) {
                throw new Error(`The journal holds no run of workflow ${workflow.id}`);
            }
            events = events.filter(e => e.run_id === runs[runs.length - 1]);

            const recipe = compile_recipe(workflow, events, {
                include_definition: options.definition,
                include_payloads: options.payloads,
            });

            if (options.output) {
                await fs.writeFile(path.resolve(process.cwd(), options.output), recipe, 'utf-8');
                console.error(`Recipe written to ${options.output}`);
            } else {
                process.stdout.write(recipe + '\n');
            }
        } catch (error: unknown) {
            console.error('Error compiling recipe:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
