"""
Interchange with BPMN 2.0, DMN and CNCF Serverless Workflow (specification section 27): what
the conformance cases do not reach. When Node and the TypeScript SDK's packages are present,
this SDK's exports are also read with the reference libraries (bpmn-moddle, dmn-moddle) and
checked with the Serverless Workflow SDK.
"""

import json
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from awa.interchange import (
    InterchangeError, export_bpmn, export_dmn, export_serverless_workflow, import_bpmn, import_dmn,
)
from awa.interchange.common import AWA_INTERCHANGE_NAMESPACE, apply_residual, clone, residual
from awa.interchange.dmn import decision_projection
from awa.cli import interchange as cli

ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = sorted(ROOT.glob("examples/*/*.awa.json"))
NODE_MODULES = ROOT / "sdk" / "typescript" / "node_modules"
BPMN_HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
             'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:awa="https://awa.io/schema/interchange/1.1" id="D" targetNamespace="https://example.com">')


def read(path):
    return json.loads(Path(path).read_text())


def unwrap(d):
    return d["workflow"] if isinstance(d.get("workflow"), dict) and "activities" not in d else d


def process(body, extra=""):
    return f'{BPMN_HEAD}{extra}<bpmn:process id="P" name="P">{body}</bpmn:process></bpmn:definitions>'


def test_finds_the_examples():
    assert len(EXAMPLES) >= 12


@pytest.mark.parametrize("path", EXAMPLES, ids=[str(p.relative_to(ROOT)) for p in EXAMPLES])
def test_every_example_crosses_to_bpmn_and_back_unchanged(path):
    document = read(path)
    result = export_bpmn([document])
    back = import_bpmn(result.bpmn, [result.dmn] if result.dmn else [])
    assert len(back.documents) == 1
    assert back.documents[0] == document
    if any(n.get("decision_table") for n in unwrap(document).get("decision_nodes", [])):
        assert result.dmn


def test_several_workflows_go_into_one_bpmn_document_and_come_back_in_order():
    documents = [read(p) for p in EXAMPLES[:3]]
    result = export_bpmn(documents)
    assert import_bpmn(result.bpmn, [result.dmn] if result.dmn else []).documents == documents


def test_the_diagram_has_a_shape_for_every_node_and_can_be_left_out():
    document = read(ROOT / "examples/claims-settlement/claims-settlement.awa.json")
    bpmn = export_bpmn([document]).bpmn
    root = ET.fromstring(bpmn)
    shapes = {s.get("bpmnElement") for s in root.iter("{http://www.omg.org/spec/BPMN/20100524/DI}BPMNShape")}
    process_el = root.find("{http://www.omg.org/spec/BPMN/20100524/MODEL}process")
    for el in process_el:
        if el.tag.endswith(("Task", "Event", "Gateway")):
            assert el.get("id") in shapes
    assert "BPMNDiagram" not in export_bpmn([document], diagram=False).bpmn


def test_bpmn_constructs_a_modeller_recognises():
    bpmn = export_bpmn([read(ROOT / "examples/claims-settlement/claims-settlement.awa.json")]).bpmn
    assert 'name="Damage assessor" awa:actorType="ai_agent"' in bpmn
    assert '<bpmn:parallelGateway id="Join_' in bpmn
    assert "<bpmn:compensateEventDefinition" in bpmn and 'isForCompensation="true"' in bpmn
    assert 'awa:decisionRef="_' in bpmn and "<awa:outcomeContract>" in bpmn
    purchase = export_bpmn([read(ROOT / "examples/claims-journey/policy-purchase.awa.json")]).bpmn
    assert '<bpmn:eventBasedGateway id="Wait_' in purchase


@pytest.mark.parametrize("path", [p for p in EXAMPLES if any(n.get("decision_table") for n in unwrap(read(p)).get("decision_nodes", []))],
                         ids=lambda p: str(p.relative_to(ROOT)))
def test_decision_tables_of_the_examples_cross_to_dmn_and_back(path):
    nodes = [n for n in unwrap(read(path))["decision_nodes"] if n.get("decision_table")]
    decisions, _ = import_dmn(export_dmn(nodes))
    assert decisions == [decision_projection(n) for n in nodes]


def test_dmn_refusals():
    with pytest.raises(InterchangeError, match="not DMN 1.1 to 1.5"):
        import_dmn('<definitions xmlns="urn:other"/>')
    literal = '<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="n" namespace="x"><decision id="D" name="D"><literalExpression id="L"><text>1</text></literalExpression></decision></definitions>'
    with pytest.raises(InterchangeError, match="no decision table"):
        import_dmn(literal)
    priority = ('<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="n" namespace="x"><decision id="D" name="D">'
                '<decisionTable id="T" hitPolicy="PRIORITY"><input id="i"><inputExpression id="e" typeRef="number"><text>a</text></inputExpression></input>'
                '<output id="o" name="r" typeRef="string"/><rule id="r"><inputEntry id="x"><text>-</text></inputEntry><outputEntry id="y"><text>"a"</text></outputEntry></rule></decisionTable></decision></definitions>')
    with pytest.raises(InterchangeError, match="PRIORITY: the table gives no output values"):
        import_dmn(priority)


def test_reading_bpmn_refuses_what_is_not_well_formed():
    with pytest.raises(InterchangeError):
        import_bpmn("not xml at all")
    with pytest.raises(InterchangeError, match="no process"):
        import_bpmn(f"{BPMN_HEAD}</bpmn:definitions>")
    with pytest.raises(InterchangeError, match="unresolved reference"):
        import_bpmn(process('<bpmn:sequenceFlow id="F" sourceRef="A" targetRef="B"/>'))
    with pytest.raises(InterchangeError, match="unknown type"):
        import_bpmn(process('<bpmn:bogus id="X"/>'))
    with pytest.raises(InterchangeError, match='awa:actorType "wizard"'):
        import_bpmn(process('<bpmn:userTask id="T" awa:actorType="wizard"/>'))
    with pytest.raises(InterchangeError, match="awa:absent must hold a list of property paths"):
        import_bpmn(process('<bpmn:userTask id="T"><bpmn:extensionElements><awa:absent>[1]</awa:absent></bpmn:extensionElements></bpmn:userTask>'))


@pytest.mark.parametrize("body,pattern", [
    ('<bpmn:startEvent id="S"/><bpmn:intermediateThrowEvent id="L"><bpmn:linkEventDefinition id="x" name="a"/></bpmn:intermediateThrowEvent><bpmn:sequenceFlow id="F" sourceRef="S" targetRef="L"/>', 'intermediateThrowEvent "L".*link'),
    ('<bpmn:userTask id="T"><bpmn:standardLoopCharacteristics id="x"/></bpmn:userTask>', 'userTask "T".*a loop'),
    ('<bpmn:subProcess id="E" triggeredByEvent="true"/>', 'subProcess "E".*event subprocess'),
    ('<bpmn:adHocSubProcess id="A"/>', 'adHocSubProcess "A"'),
    ('<bpmn:startEvent id="S"/><bpmn:intermediateThrowEvent id="C"><bpmn:compensateEventDefinition id="x"/></bpmn:intermediateThrowEvent><bpmn:sequenceFlow id="F" sourceRef="S" targetRef="C"/>', 'intermediateThrowEvent "C".*compensat'),
    ('<bpmn:serviceTask id="T"/><bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:timerEventDefinition id="x"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent><bpmn:endEvent id="E"/><bpmn:sequenceFlow id="F" sourceRef="B" targetRef="E"/>', 'boundaryEvent "B".*receive task'),
    ('<bpmn:serviceTask id="T"/><bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:compensateEventDefinition id="x"/></bpmn:boundaryEvent>', 'boundaryEvent "B".*association'),
])
def test_reading_bpmn_refuses_what_would_change_meaning(body, pattern):
    with pytest.raises(InterchangeError, match=pattern):
        import_bpmn(process(body))


def test_an_inclusive_split_without_a_join_ends_a_skipped_branch():
    xml = process('<bpmn:startEvent id="S"/><bpmn:inclusiveGateway id="G" name="Notify"/><bpmn:serviceTask id="A" name="Email"/><bpmn:serviceTask id="B" name="Text"/><bpmn:endEvent id="E1"/><bpmn:endEvent id="E2"/>'
                  '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="G"/><bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="A"><bpmn:conditionExpression>email = true</bpmn:conditionExpression></bpmn:sequenceFlow>'
                  '<bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="B"><bpmn:conditionExpression>sms = true</bpmn:conditionExpression></bpmn:sequenceFlow><bpmn:sequenceFlow id="F4" sourceRef="A" targetRef="E1"/><bpmn:sequenceFlow id="F5" sourceRef="B" targetRef="E2"/>')
    workflow = import_bpmn(xml).documents[0]
    assert ["Notify: no branch", "end"] in [[e["name"], e["event_type"]] for e in workflow["events"]]
    skips = [e for e in workflow["edges"] if e.get("is_default")]
    assert len(skips) == 2 and len({e["target_id"] for e in skips}) == 1


def test_reading_bpmn_warns_about_what_it_leaves_out():
    xml = (f'{BPMN_HEAD}<bpmn:collaboration id="C"><bpmn:participant id="Pa" processRef="P"/><bpmn:participant id="Pb"/><bpmn:messageFlow id="M" sourceRef="T" targetRef="Pb"/></bpmn:collaboration>'
           '<bpmn:process id="P"><bpmn:startEvent id="S"><bpmn:timerEventDefinition id="x"><bpmn:timeCycle>R/P1D</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:startEvent><bpmn:serviceTask id="T"/>'
           '<bpmn:businessRuleTask id="B" camunda:decisionRef="Missing" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"/><bpmn:endEvent id="E"/>'
           '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="B"/><bpmn:sequenceFlow id="F3" sourceRef="B" targetRef="E"/>'
           '<bpmn:textAnnotation id="A"><bpmn:text>note</bpmn:text></bpmn:textAnnotation></bpmn:process></bpmn:definitions>')
    result = import_bpmn(xml)
    text = "\n".join(w.message for w in result.warnings)
    for phrase in ("Message flows between pools are not imported", "timer start event is imported as a start event",
                   "text annotations are not imported", 'decision "Missing" is not in the DMN documents given'):
        assert phrase in text
    assert result.documents[0]["decision_nodes"][0]["decision_engine"]["ruleset"] == "Missing"


def test_awa_attributes_are_read_whatever_the_prefix():
    xml = ('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:x="https://awa.io/schema/interchange/1.1" id="D" targetNamespace="t">'
           '<bpmn:process id="P"><bpmn:serviceTask id="T" x:actorType="robot"/></bpmn:process></bpmn:definitions>')
    assert import_bpmn(xml).documents[0]["activities"][0]["actor_type"] == "robot"


def test_writing_bpmn_refuses_invalid_documents():
    with pytest.raises(InterchangeError, match="not a valid AWA document"):
        export_bpmn([{"name": "Broken", "activities": []}])
    document = read(EXAMPLES[0])
    with pytest.raises(InterchangeError, match="Two workflows have the identifier"):
        export_bpmn([document, document])
    with pytest.raises(InterchangeError, match="no workflow"):
        export_bpmn([])


def test_the_residual():
    original = {"a": 1, "b": {"c": 2, "d": 3}, "e": [1, 2]}
    native = {"a": 1, "b": {"c": 2, "x": 9}, "e": [1], "f": True}
    r = residual(original, native)
    assert r.set == {"b": {"d": 3}, "e": [1, 2]} and r.absent == [["b", "x"], ["f"]]
    assert apply_residual(clone(native), r) == original


def test_the_extension_schema_accepts_what_an_export_writes():
    lxml = pytest.importorskip("lxml.etree")
    schema = lxml.XMLSchema(lxml.parse(str(ROOT / "spec" / "xsd" / "awa-interchange.xsd")))
    bpmn = export_bpmn([read(ROOT / "examples/claims-settlement/claims-settlement.awa.json")]).bpmn
    found = 0
    for el in ET.fromstring(bpmn).iter():
        if el.tag.startswith(f"{{{AWA_INTERCHANGE_NAMESPACE}}}"):
            schema.assertValid(lxml.fromstring(ET.tostring(el)))
            json.loads(el.text)
            found += 1
    assert found > 5


@pytest.mark.parametrize("path", EXAMPLES, ids=[str(p.relative_to(ROOT)) for p in EXAMPLES])
def test_serverless_workflow_export_of_every_example(path):
    result = export_serverless_workflow(read(path))
    assert result.document["document"]["dsl"] == "1.0.0"
    assert all(len(item["reason"]) > 10 for item in result.not_mapped)


def test_serverless_workflow_lists_what_it_does_not_carry_and_refuses_tangled_branches():
    result = export_serverless_workflow(read(ROOT / "examples/claims-settlement/claims-settlement.awa.json"))
    props = {n.get("property") for n in result.not_mapped}
    assert {"decision_model", "outcome_contract", "tools", "decision_table.outputs", "compensation"} <= props
    u = lambda n: f"00000000-0000-4000-8000-{n:012d}"  # noqa: E731
    tangled = {"id": u(1), "name": "Tangled", "version": "1.0.0",
               "activities": [{"id": u(10 + n), "name": f"T{n}", "role_id": u(9), "actor_type": "application"} for n in (1, 2, 3, 4)],
               "edges": [{"id": u(21), "source_id": u(11), "target_id": u(12)}, {"id": u(22), "source_id": u(11), "target_id": u(13)},
                         {"id": u(23), "source_id": u(12), "target_id": u(14)}, {"id": u(24), "source_id": u(13), "target_id": u(14)}]}
    with pytest.raises(InterchangeError, match="meet before they reach a join"):
        export_serverless_workflow(tangled)


def test_the_commands(tmp_path):
    source = tmp_path / "renewal.awa.json"
    shutil.copy(ROOT / "examples/claims-journey/policy-renewal.awa.json", source)
    out = cli.export_bpmn_files([str(source)])
    assert [Path(f).name for f in out["written"]] == ["renewal.bpmn", "renewal.dmn"]
    back = cli.import_bpmn_file(str(tmp_path / "renewal.bpmn"), output=str(tmp_path / "back.awa.json"))
    assert back["warnings"][0].message.startswith("Decision tables read from")
    assert read(tmp_path / "back.awa.json") == read(source)

    claim = tmp_path / "claim.bpmn"
    claim.write_text(read(ROOT / "spec/conformance/interchange/bpmn-subprocess-and-call-activity.json")["bpmn"])
    written = cli.import_bpmn_file(str(claim))["written"]
    assert [Path(f).name for f in written] == ["claim.awa.json", "claim.checks.awa.json", "claim.collect-documents.awa.json"]

    order = tmp_path / "order.awa.json"
    shutil.copy(ROOT / "examples/order-processing/order-processing.awa.json", order)
    dmn = cli.export_dmn_files([str(order)])
    decisions = cli.import_dmn_file(dmn["written"][0])
    assert read(decisions["written"][0]) == [decision_projection(n) for n in unwrap(read(order))["decision_nodes"]]
    sw = cli.export_serverless_workflow_file(str(order), output=str(tmp_path / "order.json"))
    assert read(sw["written"][0])["document"]["dsl"] == "1.0.0"
    with pytest.raises(InterchangeError, match="json or yaml"):
        cli.export_serverless_workflow_file(str(order), fmt="xml")
    with pytest.raises(InterchangeError, match="None of the workflows"):
        cli.export_dmn_files([str(ROOT / "examples/customer-support-ai/workflow.awa.json")])


# ---------------------------------------------------------------------------
# The reference libraries read what this SDK writes
# ---------------------------------------------------------------------------

CHECK_SCRIPT = """
import fs from 'fs';
const nm = process.argv[2];
const { BpmnModdle } = await import(nm + '/bpmn-moddle/dist/index.js');
const { DmnModdle } = await import(nm + '/dmn-moddle/dist/index.js');
const sw = await import(nm + '/@serverlessworkflow/sdk/esm/index.esm.min.js');
const validate = (sw.default && sw.default.validate) || sw.validate;
const out = [];
for (const file of process.argv.slice(3)) {
  const text = fs.readFileSync(file, 'utf-8');
  try {
    if (file.endsWith('.json')) { validate('Workflow', JSON.parse(text)); out.push({ file, warnings: [] }); continue; }
    const m = file.endsWith('.dmn') ? new DmnModdle() : new BpmnModdle();
    const r = await m.fromXML(text);
    out.push({ file, warnings: r.warnings.map(w => w.message.split('\\n')[0]) });
  } catch (e) { out.push({ file, error: e.message.slice(0, 400) }); }
}
console.log(JSON.stringify(out));
"""


def _node_available():
    return shutil.which("node") and (NODE_MODULES / "bpmn-moddle").exists() and (NODE_MODULES / "dmn-moddle").exists() \
        and (NODE_MODULES / "@serverlessworkflow" / "sdk").exists()


@pytest.mark.skipif(not _node_available(), reason="Node or the TypeScript SDK's packages (npm ci in sdk/typescript) are not installed")
def test_exports_are_read_by_the_reference_libraries_without_warnings(tmp_path):
    files = []
    for path in EXAMPLES:
        stem = f"{path.parent.name}-{path.name.removesuffix('.awa.json')}"
        result = export_bpmn([read(path)])
        (tmp_path / f"{stem}.bpmn").write_text(result.bpmn)
        files.append(tmp_path / f"{stem}.bpmn")
        if result.dmn:
            (tmp_path / f"{stem}.dmn").write_text(result.dmn)
            files.append(tmp_path / f"{stem}.dmn")
        (tmp_path / f"{stem}.sw.json").write_text(json.dumps(export_serverless_workflow(read(path)).document))
        files.append(tmp_path / f"{stem}.sw.json")
    script = tmp_path / "check.mjs"
    script.write_text(CHECK_SCRIPT)
    completed = subprocess.run(["node", str(script), str(NODE_MODULES), *map(str, files)], capture_output=True, text=True, timeout=120)
    assert completed.returncode == 0, completed.stderr
    results = json.loads(completed.stdout)
    assert len(results) == len(files)
    problems = [r for r in results if r.get("error") or r.get("warnings")]
    assert problems == []
