import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { compute_evidence, render_evidence_html, render_evidence_markdown } from '../../runtime/evidence';
import { read_evidence_input } from '../../runtime/evidence_sources';

export const evidenceCommand = new Command('evidence')
    .description('An evidence report computed from journals and journey records (specification section 32). Evidence a deployer can use; not a certification of compliance')
    .argument('<sources...>', 'Runtime directories, directories of journals, journal files (.jsonl) or portfolios exported by a host (.json)')
    .option('--from <instant>', 'Keep runs and journeys started at or after this instant')
    .option('--to <instant>', 'Keep runs and journeys started before this instant')
    .option('--workflow <id...>', 'Keep only runs of these workflows, by id or name')
    .option('--as-of <instant>', 'The instant the report is made as of, for a report that can be made again identically')
    .option('--format <format>', 'json, md or html', 'md')
    .option('-o, --output <file>', 'Write the report to this file instead of standard output')
    .action(async (sources: string[], options) => {
        try {
            if (!['json', 'md', 'html'].includes(options.format)) throw new Error('--format must be json, md or html');
            for (const instant of [options.from, options.to, options.asOf]) if (instant && Number.isNaN(new Date(instant).getTime())) throw new Error(`Not an instant: ${instant}`);
            const input = await read_evidence_input(sources.map(s => path.resolve(process.cwd(), s)));
            if (options.asOf) input.as_of = options.asOf;
            let workflow_ids: string[] | undefined;
            if (options.workflow) {
                // A workflow may be named by id or by name
                const names = new Map<string, string>();
                for (const w of input.workflows || []) names.set(w.name, w.id);
                for (const r of [...(input.runs || []), ...(input.journeys || []).flatMap(j => j.instances.flatMap(i => i.runs))]) {
                    const started = r.events.find(e => e.type === 'run.started');
                    if (started?.data?.workflow_name) names.set(String(started.data.workflow_name), r.workflow_id);
                }
                workflow_ids = (options.workflow as string[]).map(w => names.get(w) || w);
            }
            const report = compute_evidence(input, { from: options.from, to: options.to, workflow_ids });
            const text = options.format === 'json' ? JSON.stringify(report, null, 2) + '\n' : options.format === 'html' ? render_evidence_html(report) : render_evidence_markdown(report);
            if (options.output) {
                await fs.writeFile(path.resolve(process.cwd(), options.output), text, 'utf-8');
                console.error(`Evidence report written to ${options.output}: ${report.parts[0].summary.runs} run(s), ${report.parts.reduce((a, p) => a + p.statements.length, 0)} statement(s)`);
            } else process.stdout.write(text);
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
