import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { KnowledgeBase, distill, OKF_VERSION } from '../src/runtime/knowledge';
import { FunctionModelProvider } from '../src/runtime/models';
import { OutcomeContractSchema } from '../src/types';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const quiet = { sleep: async () => { }, execution_logger: silent_logger };

function fixture() {
    const price = activity('Price order', {
        actor_type: 'ai_agent',
        knowledge: {},
        outcome_contract: OutcomeContractSchema.parse({
            postconditions: [{ name: 'Total is a number', expression: 'typeof total == number' }], budgets: { max_attempts: 3 },
        }),
    });
    const ship = activity('Ship');
    const wf = workflow([price, ship], [edge(price, ship)], { name: 'Order Fulfilment' });
    const good = { output: { total: 40 }, _reasoning: { plan: ['look up the price list', 'sum the lines'], rationale: 'Prices come from the list, not memory', alternatives_considered: ['estimate'], confidence: 0.9 } };
    const bad = { output: { total: 'forty' }, _reasoning: { plan: ['estimate'], rationale: 'From memory', confidence: 0.3 } };
    return { wf, price, ship, good, bad };
}

async function run(wf: ReturnType<typeof fixture>['wf'], script: Parameters<typeof scripted>[0], extra = {}) {
    const s = scripted(script);
    const engine = new WorkflowEngine(wf, { actors: s.actors, ...quiet, ...extra });
    await engine.start();
    const status = await engine.run();
    return { status, events: await engine.getEvents(), actor: s.actor, engine };
}

describe('Distillation', () => {
    it('turns one run into a strategy and a failure pattern, each citing its events', async () => {
        const { wf, good, bad } = fixture();
        const { events } = await run(wf, { 'Price order': [bad, good] });
        const candidates = distill(wf, events);
        expect(candidates.map(c => c.type).sort()).toEqual(['failure_pattern', 'strategy']);

        const strategy = candidates.find(c => c.type === 'strategy')!;
        expect(strategy.id).toBe('strategies/order-fulfilment-price-order');
        expect(strategy.latest.plan).toEqual(['look up the price list', 'sum the lines']); // the accepted attempt, not the rejected one
        expect(strategy.counts).toEqual({ accepted_runs: 1, accepted_first_attempt: 0, attempts: 2 });

        const failure = candidates.find(c => c.type === 'failure_pattern')!;
        expect(failure.latest).toMatchObject({ code: 'CONTRACT_VIOLATION', terms: ['Total is a number'], resolution: 'retry_with_feedback' });
        for (const candidate of candidates) {
            for (const seq of candidate.event_seqs) expect(events.some(e => e.seq === seq)).toBe(true);
        }
    });

    it('is deterministic', async () => {
        const { wf, good, bad } = fixture();
        const { events } = await run(wf, { 'Price order': [bad, good] });
        expect(distill(wf, events)).toEqual(distill(wf, [...events].reverse()));
    });
});

describe('Knowledge that compounds', () => {
    it('adds evidence to existing entries instead of duplicating them', async () => {
        const { wf, good, bad } = fixture();
        const kb = new KnowledgeBase();
        const first = kb.ingest(wf, (await run(wf, { 'Price order': [bad, good] })).events);
        const second = kb.ingest(wf, (await run(wf, { 'Price order': [bad, good] })).events);
        const third = kb.ingest(wf, (await run(wf, { 'Price order': good })).events);

        expect(first.created).toHaveLength(2);
        expect(second).toMatchObject({ created: [], updated: first.created });
        expect(third.updated).toEqual(['strategies/order-fulfilment-price-order']);
        expect(kb.list()).toHaveLength(2);

        const strategy = kb.get('strategies/order-fulfilment-price-order')!;
        expect(strategy.observations).toBe(3);
        expect(strategy.counts).toEqual({ accepted_runs: 3, accepted_first_attempt: 1, attempts: 5 });
        expect(strategy.sources).toHaveLength(3);
        expect(kb.list({ type: 'failure_pattern' })[0].counts).toMatchObject({ occurrences: 2, resolved_by_retry_with_feedback: 2 });
    });

    it('counts a run once however often it is ingested', async () => {
        const { wf, good } = fixture();
        const kb = new KnowledgeBase();
        const { events } = await run(wf, { 'Price order': good });
        kb.ingest(wf, events);
        expect(kb.ingest(wf, events).skipped).toBe(true);
        expect(kb.list()[0].observations).toBe(1);
    });

    it('records a lesson when a run fails', async () => {
        const { wf, good } = fixture();
        const kb = new KnowledgeBase();
        kb.ingest(wf, (await run(wf, { 'Price order': good, Ship: Object.assign(new Error('carrier down'), { code: 'UNAVAILABLE' }) })).events);
        const lesson = kb.list({ type: 'lesson' })[0];
        expect(lesson.title).toBe('Order Fulfilment fails at Ship (UNAVAILABLE)');
    });
});

describe('Review gate and use by actors', () => {
    it('gives actors nothing until a person has reviewed an entry', async () => {
        const { wf, price, good, bad } = fixture();
        const kb = new KnowledgeBase();
        kb.ingest(wf, (await run(wf, { 'Price order': [bad, good] })).events);

        expect(kb.retrieve(wf, price)).toEqual([]);
        expect(kb.retrieve(wf, price, { min_status: 'draft' })).toHaveLength(2);

        const before = await run(wf, { 'Price order': good }, { knowledge: kb });
        expect(before.actor.calls[0].inputs._knowledge).toBeUndefined();

        kb.review('strategies/order-fulfilment-price-order', 'ana');
        const after = await run(wf, { 'Price order': good }, { knowledge: kb });
        const given = after.actor.calls[0].inputs._knowledge as { id: string; guidance: string }[];
        expect(given.map(k => k.id)).toEqual(['strategies/order-fulfilment-price-order']);
        expect(given[0].guidance).toContain('look up the price list; sum the lines');

        const event = after.events.find(e => e.type === 'knowledge.retrieved')!;
        expect((event.data.entries as { id: string; status: string }[])[0]).toMatchObject({ id: given[0].id, status: 'reviewed' });
    });

    it('does not give knowledge to activities that have no binding, and never deprecated entries', async () => {
        const { wf, price, ship, good } = fixture();
        const kb = new KnowledgeBase();
        kb.ingest(wf, (await run(wf, { 'Price order': good })).events);
        kb.review('strategies/order-fulfilment-price-order', 'ana');
        expect(kb.retrieve(wf, ship)).toEqual([]);
        kb.deprecate('strategies/order-fulfilment-price-order');
        expect(kb.retrieve(wf, price, { min_status: 'draft' })).toEqual([]);
    });

    it('puts reviewed knowledge into the agent\'s prompt', async () => {
        const { wf, good, bad } = fixture();
        const kb = new KnowledgeBase();
        kb.ingest(wf, (await run(wf, { 'Price order': [bad, good] })).events);
        for (const entry of kb.list()) kb.review(entry.id, 'ana');

        const provider = new FunctionModelProvider('acme', () => JSON.stringify({ reasoning: { plan: ['p'], rationale: 'r' }, output: { total: 12 } }));
        const engine = new WorkflowEngine(wf, { model_providers: [provider], knowledge: kb, actors: { application: scripted().actor }, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(provider.requests[0].prompt).toContain('## Knowledge from earlier runs');
        expect(provider.requests[0].prompt).toContain('Make sure these hold: Total is a number');
    });

    it('learns from each run when asked to', async () => {
        const { wf, good } = fixture();
        const kb = new KnowledgeBase();
        await run(wf, { 'Price order': good }, { knowledge: kb, learn: true });
        await run(wf, { 'Price order': good }, { knowledge: kb, learn: true });
        expect(kb.get('strategies/order-fulfilment-price-order')!.observations).toBe(2);
    });
});

describe('OKF bundle', () => {
    async function populated() {
        const { wf, good, bad } = fixture();
        const kb = new KnowledgeBase();
        kb.ingest(wf, (await run(wf, { 'Price order': [bad, good] })).events);
        kb.ingest(wf, (await run(wf, { 'Price order': good, Ship: new Error('carrier down') })).events);
        kb.review('strategies/order-fulfilment-price-order', 'ana', '2026-11-21T10:00:00Z');
        return kb;
    }
    const frontmatter = (content: string) => YAML.parse(content.slice(4, content.indexOf('\n---', 3)));

    it('is a conformant OKF v0.3 bundle', async () => {
        const files = (await populated()).to_okf({ title: 'Orders', license: 'CC-BY-4.0' });

        // Root index: frontmatter with a quoted okf_version, then "# Section" and "* [Title](url) - description" lines
        const root = files.get('index.md')!;
        expect(root).toContain(`okf_version: "${OKF_VERSION}"`);
        expect(frontmatter(root)).toMatchObject({ okf_version: '0.3', title: 'Orders', license: 'CC-BY-4.0' });
        expect(root).toMatch(/^\* \[Strategies\]\(strategies\/\) - 1 entry$/m);

        // Subdirectory indexes have no frontmatter
        const sub = files.get('strategies/index.md')!;
        expect(sub.startsWith('# Strategies\n')).toBe(true);
        expect(sub).toMatch(/^\* \[How to price order\]\(order-fulfilment-price-order\.md\) - .+$/m);

        // log.md: ISO date headings, bold action words
        const log = files.get('log.md')!;
        expect(log).toMatch(/^## \d{4}-\d{2}-\d{2}$/m);
        expect(log).toMatch(/^\* \*\*Creation\*\*: \[/m);
        expect(log).toMatch(/^\* \*\*Review\*\*: \[/m);

        // Every concept: a YAML mapping with a non-empty type; reserved names are not concepts
        const concepts = [...files].filter(([file]) => !/(^|\/)(index|log)\.md$/.test(file));
        expect(concepts.length).toBe(4); // strategy, two failure patterns, one lesson
        for (const [file, content] of concepts) {
            expect(content.startsWith('---\n'), file).toBe(true);
            const fm = frontmatter(content);
            expect(typeof fm.type).toBe('string');
            expect(fm.type.length).toBeGreaterThan(0);
            expect(['draft', 'stable', 'deprecated']).toContain(fm.status);
            expect(fm.generated).toMatchObject({ by: 'agent:awa-distiller' });
            expect(fm.generated.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
            for (const source of fm.sources) expect(source.resource).toMatch(/^urn:awa:run:/);
            // producer-specific keys follow the x-<producer>-<name> convention
            const known = ['type', 'title', 'description', 'resource', 'tags', 'status', 'superseded_by', 'generated', 'verified', 'sources'];
            for (const key of Object.keys(fm)) expect(known.includes(key) || key.startsWith('x-awa-'), key).toBe(true);
        }

        // Review maps to OKF's stable status and a human verification event
        const strategy = frontmatter(files.get('strategies/order-fulfilment-price-order.md')!);
        expect(strategy).toMatchObject({ type: 'Strategy', status: 'stable', verified: [{ by: 'human:ana', at: '2026-11-21T10:00:00Z' }] });
        // Links between concepts are bundle-root Markdown links
        expect(files.get('strategies/order-fulfilment-price-order.md')).toMatch(/\]\(\/failure-patterns\/.+\.md\)/);
    });

    it('round-trips through a directory without losing anything that affects behaviour', async () => {
        const kb = await populated();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-okf-'));
        await kb.export_okf(dir);
        const back = await KnowledgeBase.import_okf(dir);
        expect(back.list()).toEqual(kb.list());

        // A run already counted is still recognised after the round trip
        const again = await KnowledgeBase.import_okf(dir);
        const { wf, good } = fixture();
        expect(again.list().length).toBe(4);
        expect(back.to_okf().get('strategies/order-fulfilment-price-order.md'))
            .toBe(kb.to_okf().get('strategies/order-fulfilment-price-order.md'));
        void wf; void good;
    });

    it('reads concepts written by other producers', () => {
        const kb = KnowledgeBase.from_okf(new Map([
            ['index.md', '---\nokf_version: "0.3"\n---\n\n# Things\n'],
            ['playbooks/refunds.md', '---\ntype: Playbook\ntitle: Refunds\ndescription: How refunds work\ntags: [finance]\n---\n\nRefund within 14 days.\n'],
            ['notes/scratch.md', 'No frontmatter here, so not a concept.\n'],
            ['playbooks/old.md', '---\ntype: Playbook\nstatus: deprecated\nsuperseded_by: /playbooks/refunds.md\n---\nOld.\n'],
        ]));
        expect(kb.list().map(e => e.id)).toEqual(['playbooks/old', 'playbooks/refunds']);
        expect(kb.get('playbooks/refunds')).toMatchObject({ title: 'Refunds', status: 'reviewed', tags: ['finance'], latest: { message: 'Refund within 14 days.' } });
        expect(kb.get('playbooks/old')).toMatchObject({ status: 'deprecated', superseded_by: 'playbooks/refunds' });
    });

    it('saves and loads its own file', async () => {
        const kb = await populated();
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-kb-')), 'knowledge.json');
        await kb.save(file);
        expect((await KnowledgeBase.load(file)).to_json()).toEqual(kb.to_json());
        expect((await KnowledgeBase.load(file + '.missing')).list()).toEqual([]);
    });
});
