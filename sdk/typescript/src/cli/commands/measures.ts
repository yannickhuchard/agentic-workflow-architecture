import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { open_runtime_directory } from '../../runtime/runtime';
import { measures_page } from '../../runtime/views';
import { compute_measures, measures_to_openmetrics, MEASURES, Measure, MeasureInput, MeasureReport } from '../../runtime/kpi';

const UNIT = new Map(MEASURES.map(m => [m.id, m]));

function duration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 90_000) return `${Math.round(ms / 1000)} s`;
    if (ms < 90 * 60_000) return `${Math.round(ms / 60_000)} min`;
    if (ms < 48 * 3_600_000) return `${(ms / 3_600_000).toFixed(1)} h`;
    return `${(ms / 86_400_000).toFixed(1)} days`;
}

/** A measure as a person reads it, with what it was computed over when that is few */
export function format_measure(id: string, measure: Measure, currency: string | null): string {
    if (measure.value === null) return 'no value';
    const unit = UNIT.get(id)?.unit;
    const few = unit === 'ratio' && measure.n < 10 ? ` (of ${measure.n})` : '';
    if (unit === 'ratio') return `${Math.round(measure.value * 100)}%${few}`;
    if (unit === 'ms') return duration(measure.value);
    if (unit === 'currency') return `${currency || ''} ${measure.value.toFixed(measure.value < 1 ? 4 : 2)}`.trim();
    if (unit === 'score') return (measure.value > 0 ? '+' : '') + measure.value.toFixed(2);
    return Number.isInteger(measure.value) ? String(measure.value) : measure.value.toFixed(2);
}

function print(report: MeasureReport): void {
    const row = (id: string, m: Measure) => `  ${(UNIT.get(id)?.name || id).padEnd(38)} ${format_measure(id, m, report.currency)}`;
    console.log(`Measures as of ${report.as_of}${report.period.from ? `, from ${report.period.from} to ${report.period.to}` : ''}`);
    for (const j of report.journeys) {
        console.log(`\nJourney: ${j.name}`);
        for (const [id, m] of Object.entries(j.measures)) console.log(row(id, m));
        for (const s of j.stages) {
            const m = s.measures;
            console.log(`    ${s.name.padEnd(26)} entered ${m['stage.entered'].value}, moved on ${format_measure('stage.conversion', m['stage.conversion'], null)}, median ${format_measure('stage.duration_median_ms', m['stage.duration_median_ms'], null)}, stalled now ${m['stage.stalled_now'].value}${s.owner ? `, owner ${s.owner}` : ''}`);
        }
    }
    for (const w of report.workflows) {
        console.log(`\nWorkflow: ${w.name}`);
        for (const [id, m] of Object.entries(w.measures)) console.log(row(id, m));
    }
    if (report.attention.length) {
        console.log('\nNeeds someone now');
        for (const a of report.attention) console.log(`  ${a.subject_name || a.subject_key}: ${a.journey_name}, stalled in "${a.stage_name}" for ${duration(a.waiting_ms)}${a.owner ? `, owner ${a.owner}` : ', no owner named'}: ${a.reason}`);
    }
}

export const measuresCommand = new Command('measures')
    .description('The measures of journeys and workflows (specification section 21), computed from what was recorded')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--file <file>', 'Read a portfolio exported with "awa journey export" instead of a runtime directory')
    .option('--from <instant>', 'Keep what started at or after this instant')
    .option('--to <instant>', 'Keep what started before this instant')
    .option('--journey <id>', 'Only this journey')
    .option('--workflow <id>', 'Only this workflow')
    .option('--json', 'Print the report as JSON')
    .option('--openmetrics', 'Print the measures in the OpenMetrics text format')
    .option('--html <file>', 'Write the measures page as one file that shows this record, to open in a browser')
    .option('--list', 'List the measures and their definitions')
    .action(async options => {
        try {
            if (options.list) {
                for (const m of MEASURES) console.log(`${m.id.padEnd(34)} ${m.unit.padEnd(9)} ${m.definition}`);
                return;
            }
            let input: MeasureInput;
            if (options.file) input = JSON.parse(await fs.readFile(path.resolve(process.cwd(), options.file), 'utf-8'));
            else {
                const runtime = await open_runtime_directory(path.resolve(process.cwd(), options.dir), { engine: { execution_logger: { log_execution: async () => { } } } });
                input = await runtime.export_portfolio();
                await runtime.close();
            }
            if (options.html) {
                const file = path.resolve(process.cwd(), options.html);
                await fs.writeFile(file, measures_page(input, { source: options.file || options.dir }));
                console.log(`wrote ${options.html}: open it in a browser`);
                return;
            }
            const report = compute_measures(input, { from: options.from, to: options.to, journey_id: options.journey, workflow_id: options.workflow });
            if (options.openmetrics) process.stdout.write(measures_to_openmetrics(report));
            else if (options.json) console.log(JSON.stringify(report, null, 2));
            else print(report);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
