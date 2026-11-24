/**
 * Reading what an evidence report or an evaluation dataset is computed from:
 * journal files, exported portfolios and runtime directories. Nothing here
 * opens a runtime directory as a host: its files are read, no lock is taken
 * and no run is continued, so evidence can be gathered while a host runs.
 */

import fs from 'fs/promises';
import path from 'path';
import { JournalEvent, parse_journal } from './journal';
import { EvidenceInput, EvidenceRun } from './evidence';
import { is_journey_document } from './runtime';

async function exists(file: string): Promise<boolean> {
    try { await fs.access(file); return true; } catch { return false; }
}

/** Every journal file under a directory, its own and those of a journals/ folder */
async function journal_files(directory: string): Promise<string[]> {
    const found: string[] = [];
    for (const dir of [directory, path.join(directory, 'journals')]) {
        if (!(await exists(dir))) continue;
        for (const name of (await fs.readdir(dir)).sort()) if (name.endsWith('.jsonl')) found.push(path.join(dir, name));
    }
    return found;
}

/** The journal events held by files and directories of journal files (.jsonl) */
export async function read_journals(paths: string[]): Promise<JournalEvent[]> {
    const events: JournalEvent[] = [];
    for (const p of paths) {
        const stat = await fs.stat(p);
        const files = stat.isDirectory() ? await journal_files(p) : [p];
        for (const file of files) events.push(...parse_journal(await fs.readFile(file, 'utf-8')));
    }
    return events;
}

function runs_of(events: JournalEvent[]): EvidenceRun[] {
    const runs = new Map<string, EvidenceRun>();
    for (const e of events) {
        if (!runs.has(e.run_id)) runs.set(e.run_id, { run_id: e.run_id, workflow_id: e.workflow_id, events: [] });
        runs.get(e.run_id)!.events.push(e);
    }
    return [...runs.values()];
}

/** A runtime directory (19.10) read as files: definitions, journey records and journals */
async function read_runtime_directory(directory: string): Promise<EvidenceInput> {
    const definitions: Record<string, any>[] = [];
    const defs = path.join(directory, 'definitions');
    if (await exists(defs)) for (const name of (await fs.readdir(defs)).filter(n => n.endsWith('.json')).sort()) definitions.push(JSON.parse(await fs.readFile(path.join(defs, name), 'utf-8')));
    const state = (await exists(path.join(directory, 'runtime.json'))) ? JSON.parse(await fs.readFile(path.join(directory, 'runtime.json'), 'utf-8')) : { instances: [] };
    const runs = new Map(runs_of(await read_journals([path.join(directory, 'journals')])).map(r => [r.run_id, r]));
    const used = new Set<string>();
    const journeys = definitions.filter(is_journey_document).map(definition => ({
        definition: { id: definition.id, name: definition.name },
        instances: (state.instances || []).filter((i: any) => i.journey_id === definition.id).map((instance: any) => ({
            instance,
            runs: (instance.runs || []).map((ref: any) => { used.add(ref.run_id); return { ...(runs.get(ref.run_id) || { run_id: ref.run_id, workflow_id: ref.workflow_id, events: [] }), stage_id: ref.stage_id }; }),
        })),
    }));
    return {
        workflows: definitions.filter(d => !is_journey_document(d)).map(d => ({ id: d.id, name: d.name, version: d.version, activities: (d.activities || []).map((a: any) => ({ id: a.id, name: a.name, actor_type: a.actor_type })) })),
        journeys,
        runs: [...runs.values()].filter(r => !used.has(r.run_id)),
    };
}

/**
 * What an evidence report is computed from, read from any mix of: runtime directories,
 * directories of journal files, journal files (.jsonl), and portfolios exported by a host (.json).
 */
export async function read_evidence_input(paths: string[]): Promise<EvidenceInput> {
    const merged: Required<Pick<EvidenceInput, 'workflows' | 'journeys' | 'runs'>> & { as_of?: string } = { workflows: [], journeys: [], runs: [] };
    const loose: JournalEvent[] = [];
    for (const p of paths) {
        const stat = await fs.stat(p);
        let part: EvidenceInput;
        if (stat.isDirectory()) {
            if (await exists(path.join(p, 'runtime.json')) || await exists(path.join(p, 'definitions'))) part = await read_runtime_directory(p);
            else { loose.push(...await read_journals([p])); continue; }
        } else if (p.endsWith('.jsonl')) { loose.push(...await read_journals([p])); continue; }
        else {
            const document = JSON.parse(await fs.readFile(p, 'utf-8'));
            // One journey with its runs, as a host exports it, or a portfolio of several, or loose runs
            if (document.definition && document.instance && Array.isArray(document.runs)) part = { workflows: document.workflows, journeys: [{ definition: document.definition, instances: [{ instance: document.instance, runs: document.runs }] }] };
            else if (Array.isArray(document.journeys) || Array.isArray(document.runs)) part = document;
            else throw new Error(`${p} is neither a portfolio nor a journey exported by a host, nor a journal (.jsonl)`);
        }
        merged.workflows.push(...(part.workflows || []));
        merged.journeys.push(...(part.journeys || []));
        merged.runs.push(...(part.runs || []));
        if (part.as_of && (!merged.as_of || part.as_of > merged.as_of)) merged.as_of = part.as_of;
    }
    merged.runs.push(...runs_of(loose));
    return merged;
}
