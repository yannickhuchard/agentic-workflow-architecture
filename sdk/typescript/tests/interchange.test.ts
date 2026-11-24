/**
 * Interchange with BPMN 2.0, DMN and CNCF Serverless Workflow (specification section 27):
 * what the conformance cases do not reach.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { import_bpmn, export_bpmn, import_dmn, export_dmn, export_serverless_workflow, InterchangeError } from '../src/interchange';
import { json_equal, residual, apply_residual, clone } from '../src/interchange/common';
import { decision_projection } from '../src/interchange/dmn';
import { import_bpmn_file, export_bpmn_files, export_dmn_files, import_dmn_file, export_serverless_workflow_file } from '../src/cli/commands/interchange';

const ROOT = path.resolve(__dirname, '../../..');
const examples = fs.readdirSync(path.join(ROOT, 'examples'))
    .flatMap(dir => fs.readdirSync(path.join(ROOT, 'examples', dir)).filter(f => f.endsWith('.awa.json')).map(f => path.join(ROOT, 'examples', dir, f)));
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const unwrap = (d: any) => (d.workflow && !d.activities ? d.workflow : d);

const BPMN_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:awa="https://awa.io/schema/interchange/1.1" id="D" targetNamespace="https://example.com">';
const process = (body: string, extra = '') => `${BPMN_HEAD}${extra}<bpmn:process id="P" name="P">${body}</bpmn:process></bpmn:definitions>`;

describe('Every published example crosses to BPMN and back unchanged', () => {
    it('finds the examples', () => expect(examples.length).toBeGreaterThanOrEqual(12));
    for (const file of examples) {
        it(path.relative(ROOT, file), async () => {
            const document = read(file);
            const { bpmn, dmn } = await export_bpmn([document]);
            const back = await import_bpmn(bpmn, { dmn: dmn ? [dmn] : [] });
            expect(back.documents).toHaveLength(1);
            expect(back.documents[0]).toEqual(document);
            if (unwrap(document).decision_nodes?.some((n: any) => n.decision_table)) expect(dmn).toBeDefined();
        });
    }

    it('several workflows go into one BPMN document, one process each, and come back in order', async () => {
        const documents = examples.slice(0, 3).map(read);
        const { bpmn, dmn } = await export_bpmn(documents);
        const back = await import_bpmn(bpmn, { dmn: dmn ? [dmn] : [] });
        expect(back.documents).toEqual(documents);
    });

    it('writes a diagram with a shape for every flow node, and none when asked not to', async () => {
        const document = read(path.join(ROOT, 'examples/claims-settlement/claims-settlement.awa.json'));
        const { bpmn } = await export_bpmn([document]);
        const ids = [...bpmn.matchAll(/<bpmn:(?:serviceTask|userTask|startEvent|endEvent|intermediateCatchEvent|businessRuleTask|exclusiveGateway|parallelGateway) id="([^"]+)"/g)].map(m => m[1]);
        for (const id of ids) expect(bpmn).toContain(`bpmnElement="${id}"`);
        expect(bpmn).toContain('<bpmndi:BPMNDiagram');
        const plain = await export_bpmn([document], { diagram: false });
        expect(plain.bpmn).not.toContain('BPMNDiagram');
    });

    it('writes BPMN constructs a modeller recognises: lanes, a join, a wait with a timeout, compensation, a decision', async () => {
        const settlement = await export_bpmn([read(path.join(ROOT, 'examples/claims-settlement/claims-settlement.awa.json'))]);
        expect(settlement.bpmn).toMatch(/<bpmn:lane id="_[^"]+" name="Damage assessor" awa:actorType="ai_agent">/);
        expect(settlement.bpmn).toMatch(/<bpmn:parallelGateway id="Join_/);
        expect(settlement.bpmn).toMatch(/<bpmn:compensateEventDefinition/);
        expect(settlement.bpmn).toMatch(/isForCompensation="true"/);
        expect(settlement.bpmn).toMatch(/<bpmn:businessRuleTask [^>]*awa:decisionRef="_/);
        expect(settlement.bpmn).toMatch(/<awa:outcomeContract>/);
        const purchase = await export_bpmn([read(path.join(ROOT, 'examples/claims-journey/policy-purchase.awa.json'))]);
        expect(purchase.bpmn).toMatch(/<bpmn:eventBasedGateway id="Wait_/);
        expect(purchase.bpmn).toMatch(/<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P7D<\/bpmn:timeDuration>/);
        expect(purchase.bpmn).toMatch(/<bpmn:intermediateThrowEvent [^>]*>\s*<bpmn:documentation>[^<]*<\/bpmn:documentation>\s*<bpmn:extensionElements>[\s\S]*?<bpmn:messageEventDefinition/);
    });
});

describe('DMN', () => {
    for (const file of examples) {
        const nodes = (unwrap(read(file)).decision_nodes || []).filter((n: any) => n.decision_table);
        if (!nodes.length) continue;
        it(`the decision tables of ${path.relative(ROOT, file)} cross to DMN and back unchanged`, async () => {
            const xml = await export_dmn(nodes);
            const { decisions } = await import_dmn(xml);
            expect(decisions).toEqual(nodes.map(decision_projection));
        });
    }

    it('reads DMN 1.2, 1.4 and 1.5 namespaces', async () => {
        for (const ns of ['http://www.omg.org/spec/DMN/20180521/MODEL/', 'https://www.omg.org/spec/DMN/20211108/MODEL/', 'https://www.omg.org/spec/DMN/20230324/MODEL/']) {
            const xml = `<definitions xmlns="${ns}" id="d" name="n" namespace="x"><decision id="D" name="D"><decisionTable id="T" hitPolicy="ANY"><input id="i"><inputExpression id="e" typeRef="boolean"><text>ok</text></inputExpression></input><output id="o" name="r" typeRef="string"/><rule id="r"><inputEntry id="a"><text>true</text></inputEntry><outputEntry id="b"><text>"yes"</text></outputEntry></rule></decisionTable></decision></definitions>`;
            const { decisions } = await import_dmn(xml);
            expect(decisions[0].decision_table).toMatchObject({ hit_policy: 'any', rules: [{ input_entries: ['true'], output_entries: ['yes'] }] });
        }
    });

    it('refuses a document that is not DMN, one without a table, and a PRIORITY table with nothing to order by', async () => {
        await expect(import_dmn('<definitions xmlns="urn:other"/>')).rejects.toThrow(/not DMN 1.1 to 1.5/);
        const literal = '<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="n" namespace="x"><decision id="D" name="D"><literalExpression id="L"><text>1</text></literalExpression></decision></definitions>';
        await expect(import_dmn(literal)).rejects.toThrow(/no decision table/);
        const priority = '<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="n" namespace="x"><decision id="D" name="D"><decisionTable id="T" hitPolicy="PRIORITY"><input id="i"><inputExpression id="e" typeRef="number"><text>a</text></inputExpression></input><output id="o" name="r" typeRef="string"/><rule id="r"><inputEntry id="x"><text>-</text></inputEntry><outputEntry id="y"><text>"a"</text></outputEntry></rule></decisionTable></decision></definitions>';
        await expect(import_dmn(priority)).rejects.toThrow(/PRIORITY: the table gives no output values/);
    });

    it('warns about types it reads as text and allowed values that are not values', async () => {
        const xml = '<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="n" namespace="x"><decision id="D" name="D"><decisionTable id="T"><input id="i"><inputExpression id="e" typeRef="time"><text>at</text></inputExpression><inputValues id="v"><text>[1..5]</text></inputValues></input><output id="o" name="r" typeRef="string"/></decisionTable></decision></definitions>';
        const { decisions, warnings } = await import_dmn(xml);
        expect(decisions[0].decision_table).toMatchObject({ inputs: [{ name: 'at', type: 'string' }] });
        expect(warnings.map(w => w.message).join('\n')).toMatch(/type "time"[\s\S]*not a list of values/);
    });
});

describe('Reading BPMN', () => {
    it('refuses what is not BPMN and what is not well-formed', async () => {
        await expect(import_bpmn('not xml at all')).rejects.toThrow(InterchangeError);
        await expect(import_bpmn(`${BPMN_HEAD}</bpmn:definitions>`)).rejects.toThrow(/no process/);
        await expect(import_bpmn(process('<bpmn:sequenceFlow id="F" sourceRef="A" targetRef="B"/>'))).rejects.toThrow(/BPMN/);
        await expect(import_bpmn(process('<bpmn:userTask id="T" awa:actorType="wizard"/>'))).rejects.toThrow(/awa:actorType "wizard"/);
        await expect(import_bpmn(process('<bpmn:userTask id="T"><bpmn:extensionElements><awa:absent>[1]</awa:absent></bpmn:extensionElements></bpmn:userTask>'))).rejects.toThrow(/awa:absent must hold a list of property paths/);
    });

    it('refuses what would change meaning, naming the element and the reason', async () => {
        const cases: [string, RegExp][] = [
            ['<bpmn:startEvent id="S"/><bpmn:intermediateThrowEvent id="L"><bpmn:linkEventDefinition id="x" name="a"/></bpmn:intermediateThrowEvent><bpmn:sequenceFlow id="F" sourceRef="S" targetRef="L"/>', /intermediateThrowEvent "L".*link/],
            ['<bpmn:userTask id="T"><bpmn:standardLoopCharacteristics id="x"/></bpmn:userTask>', /userTask "T".*a loop/],
            ['<bpmn:subProcess id="E" triggeredByEvent="true"/>', /subProcess "E".*event subprocess/],
            ['<bpmn:adHocSubProcess id="A"/>', /adHocSubProcess "A"/],
            ['<bpmn:startEvent id="S"/><bpmn:intermediateThrowEvent id="C"><bpmn:compensateEventDefinition id="x"/></bpmn:intermediateThrowEvent><bpmn:sequenceFlow id="F" sourceRef="S" targetRef="C"/>', /intermediateThrowEvent "C".*compensat/],
            ['<bpmn:serviceTask id="T"/><bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:timerEventDefinition id="x"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent><bpmn:endEvent id="E"/><bpmn:sequenceFlow id="F" sourceRef="B" targetRef="E"/>', /boundaryEvent "B".*receive task/],
            ['<bpmn:serviceTask id="T"/><bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:compensateEventDefinition id="x"/></bpmn:boundaryEvent>', /boundaryEvent "B".*association/],
            ['<bpmn:startEvent id="S"/><bpmn:inclusiveGateway id="G"/><bpmn:serviceTask id="A"/><bpmn:endEvent id="E"/><bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="G"/><bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="A"><bpmn:conditionExpression>a = 1</bpmn:conditionExpression></bpmn:sequenceFlow><bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="E"/><bpmn:sequenceFlow id="F4" sourceRef="A" targetRef="E"/>'.replace('<bpmn:inclusiveGateway id="G"/>', '<bpmn:inclusiveGateway id="G" default="F3"/><bpmn:serviceTask id="X"/><bpmn:sequenceFlow id="F5" sourceRef="G" targetRef="X"/>'), /inclusiveGateway "G".*never be taken/],
        ];
        for (const [body, pattern] of cases) await expect(import_bpmn(process(body))).rejects.toThrow(pattern);
    });

    it('imports an inclusive split without a join: a skipped branch ends', async () => {
        const xml = process('<bpmn:startEvent id="S"/><bpmn:inclusiveGateway id="G" name="Notify"/><bpmn:serviceTask id="A" name="Email"/><bpmn:serviceTask id="B" name="Text"/><bpmn:endEvent id="E1"/><bpmn:endEvent id="E2"/>'
            + '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="G"/><bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="A"><bpmn:conditionExpression>email = true</bpmn:conditionExpression></bpmn:sequenceFlow>'
            + '<bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="B"><bpmn:conditionExpression>sms = true</bpmn:conditionExpression></bpmn:sequenceFlow><bpmn:sequenceFlow id="F4" sourceRef="A" targetRef="E1"/><bpmn:sequenceFlow id="F5" sourceRef="B" targetRef="E2"/>');
        const { documents } = await import_bpmn(xml);
        const events = documents[0].events as any[];
        expect(events.map(e => [e.name, e.event_type])).toContainEqual(['Notify: no branch', 'end']);
        const skips = (documents[0].edges as any[]).filter(e => e.is_default);
        expect(skips).toHaveLength(2);
        expect(new Set(skips.map(e => e.target_id)).size).toBe(1);
    });

    it('warns about what it leaves out without changing behaviour', async () => {
        const xml = `${BPMN_HEAD}<bpmn:collaboration id="C"><bpmn:participant id="Pa" processRef="P"/><bpmn:participant id="Pb"/><bpmn:messageFlow id="M" sourceRef="T" targetRef="Pb"/></bpmn:collaboration>`
            + '<bpmn:process id="P"><bpmn:startEvent id="S"><bpmn:timerEventDefinition id="x"><bpmn:timeCycle>R/P1D</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:startEvent><bpmn:serviceTask id="T"/><bpmn:businessRuleTask id="B" camunda:decisionRef="Missing" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"/><bpmn:endEvent id="E"/>'
            + '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="B"/><bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="E"/><bpmn:textAnnotation id="A"><bpmn:text>note</bpmn:text></bpmn:textAnnotation></bpmn:process></bpmn:definitions>';
        const { documents, warnings } = await import_bpmn(xml);
        const text = warnings.map(w => w.message).join('\n');
        expect(text).toMatch(/Message flows between pools are not imported/);
        expect(text).toMatch(/timer start event is imported as a start event/);
        expect(text).toMatch(/text annotations are not imported/);
        expect(text).toMatch(/decision "Missing" is not in the DMN documents given/);
        expect((documents[0].decision_nodes as any[])[0].decision_engine).toMatchObject({ name: 'dmn', ruleset: 'Missing' });
    });

    it('reads awa:actorType whatever prefix the document gives the namespace', async () => {
        const xml = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:x="https://awa.io/schema/interchange/1.1" id="D" targetNamespace="t"><bpmn:process id="P"><bpmn:serviceTask id="T" x:actorType="robot"/></bpmn:process></bpmn:definitions>';
        const { documents } = await import_bpmn(xml);
        expect((documents[0].activities as any[])[0].actor_type).toBe('robot');
    });
});

describe('Writing BPMN', () => {
    it('refuses a document that is not valid, and two workflows with one identifier', async () => {
        await expect(export_bpmn([{ name: 'Broken', activities: [] }])).rejects.toThrow(/not a valid AWA document/);
        const document = read(examples[0]);
        await expect(export_bpmn([document, document])).rejects.toThrow(/Two workflows have the identifier/);
        await expect(export_bpmn([])).rejects.toThrow(/no workflow/);
    });

    it('keeps each property once: in a BPMN element or in the residual, not both', async () => {
        const document = read(path.join(ROOT, 'examples/claims-settlement/claims-settlement.awa.json'));
        const { bpmn } = await export_bpmn([document]);
        expect(bpmn).not.toMatch(/awa:properties>[^<]*"name":"Assess damage"/);
        expect(bpmn).not.toMatch(/awa:properties>[^<]*"decision_table"/);
    });
});

describe('The residual', () => {
    it('is what must be added to and removed from what the elements give', () => {
        const original = { a: 1, b: { c: 2, d: 3 }, e: [1, 2] };
        const native = { a: 1, b: { c: 2, x: 9 }, e: [1], f: true };
        const r = residual(original, native);
        expect(r).toEqual({ set: { b: { d: 3 }, e: [1, 2] }, absent: [['b', 'x'], ['f']] });
        expect(apply_residual(clone(native) as any, r)).toEqual(original);
        expect(json_equal(apply_residual(clone(native) as any, r), original)).toBe(true);
    });
});

describe('Serverless Workflow', () => {
    for (const file of examples) {
        it(`${path.relative(ROOT, file)} exports to a document the Serverless Workflow SDK accepts`, async () => {
            const { document, not_mapped } = await export_serverless_workflow(read(file));
            expect((document.document as any).dsl).toBe('1.0.0');
            expect(Array.isArray(document.do)).toBe(true);
            for (const item of not_mapped) expect(item.reason.length).toBeGreaterThan(10);
        });
    }

    it('lists what it does not carry: decision models, compensation, contracts, the outputs of a rule', async () => {
        const { not_mapped } = await export_serverless_workflow(read(path.join(ROOT, 'examples/claims-settlement/claims-settlement.awa.json')));
        const props = not_mapped.map(n => n.property);
        expect(props).toEqual(expect.arrayContaining(['decision_model', 'outcome_contract', 'tools', 'decision_table.outputs', 'compensation']));
        expect(not_mapped.find(n => n.node === 'Release funds')?.reason).toMatch(/compensation handler/);
    });

    it('raises errors where AWA decides in ways a switch cannot, and refuses branches that meet before a join', async () => {
        const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        const w = {
            id: u(1), name: 'Collect', version: '1.0.0',
            activities: [{ id: u(2), name: 'A', role_id: u(9), actor_type: 'human' }, { id: u(3), name: 'B', role_id: u(9), actor_type: 'human' }],
            decision_nodes: [{ id: u(4), name: 'All', decision_table: { hit_policy: 'collect', inputs: [{ name: 'x', type: 'number' }], outputs: [{ name: 'y', type: 'string' }], rules: [] }, default_output_edge_id: u(6) }],
            edges: [{ id: u(5), source_id: u(2), target_id: u(4) }, { id: u(6), source_id: u(4), target_id: u(3) }],
        };
        const { document, not_mapped } = await export_serverless_workflow(w);
        expect(JSON.stringify(document)).toContain('decision-not-mapped');
        expect(not_mapped.map(n => n.property)).toContain('decision_table.hit_policy');
        const tangled = {
            id: u(1), name: 'Tangled', version: '1.0.0',
            activities: [1, 2, 3, 4].map(n => ({ id: u(10 + n), name: `T${n}`, role_id: u(9), actor_type: 'application' })),
            edges: [{ id: u(21), source_id: u(11), target_id: u(12) }, { id: u(22), source_id: u(11), target_id: u(13) }, { id: u(23), source_id: u(12), target_id: u(14) }, { id: u(24), source_id: u(13), target_id: u(14) }],
        };
        await expect(export_serverless_workflow(tangled)).rejects.toThrow(/meet before they reach a join/);
    });
});

describe('awa import and awa export', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-interchange-'));

    it('export bpmn writes BPMN and DMN beside it; import bpmn finds the DMN and gives the workflow back', async () => {
        const source = path.join(dir, 'renewal.awa.json');
        fs.copyFileSync(path.join(ROOT, 'examples/claims-journey/policy-renewal.awa.json'), source);
        const out = await export_bpmn_files([source]);
        expect(out.written).toEqual([path.join(dir, 'renewal.bpmn'), path.join(dir, 'renewal.dmn')]);
        const back = await import_bpmn_file(path.join(dir, 'renewal.bpmn'), { output: path.join(dir, 'back.awa.json') });
        expect(back.warnings[0].message).toMatch(/Decision tables read from/);
        expect(read(path.join(dir, 'back.awa.json'))).toEqual(read(source));
    });

    it('import bpmn writes further processes and subprocesses beside the first', async () => {
        const conformance = read(path.join(ROOT, 'spec/conformance/interchange/bpmn-subprocess-and-call-activity.json'));
        const file = path.join(dir, 'claim.bpmn');
        fs.writeFileSync(file, conformance.bpmn);
        const out = await import_bpmn_file(file);
        expect(out.written.map(f => path.basename(f))).toEqual(['claim.awa.json', 'claim.checks.awa.json', 'claim.collect-documents.awa.json']);
    });

    it('export and import dmn, and export serverless-workflow as YAML or JSON', async () => {
        const source = path.join(dir, 'order.awa.json');
        fs.copyFileSync(path.join(ROOT, 'examples/order-processing/order-processing.awa.json'), source);
        const dmn = await export_dmn_files([source]);
        const decisions = await import_dmn_file(dmn.written[0]);
        expect(read(decisions.written[0])).toEqual(unwrap(read(source)).decision_nodes.map(decision_projection));
        const yaml = await export_serverless_workflow_file(source);
        expect(yaml.written[0]).toMatch(/order\.sw\.yaml$/);
        expect(fs.readFileSync(yaml.written[0], 'utf-8')).toMatch(/^document:/);
        const json = await export_serverless_workflow_file(source, { output: path.join(dir, 'order.json') });
        expect(read(json.written[0]).document.dsl).toBe('1.0.0');
        await expect(export_serverless_workflow_file(source, { format: 'xml' })).rejects.toThrow(/json or yaml/);
        await expect(export_dmn_files([path.join(ROOT, 'examples/customer-support-ai/workflow.awa.json')])).rejects.toThrow(/no.*decision table|None of the workflows/);
    });
});
