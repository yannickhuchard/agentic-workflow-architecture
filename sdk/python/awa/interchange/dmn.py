"""
DMN 1.x decision tables to and from AWA decision tables (specification 27.9).

Python port of sdk/typescript/src/interchange/dmn.ts.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

from awa.interchange.common import (
    AWA_INTERCHANGE_NAMESPACE, DMN13_NAMESPACE, DMN_NAMESPACES, InterchangeError, InterchangeWarning, Residual,
    apply_residual, awa_id, clone, json_equal, read_residual, residual, residual_extensions, xml_id,
)
from awa.interchange.expressions import awa_unary_to_feel, feel_to_value, feel_unary_to_awa, value_to_feel
from awa.interchange.xml_reader import Document, Element, awa_extensions, check_known, local, namespace, parse

HIT_POLICY_TO_DMN = {"unique": "UNIQUE", "first": "FIRST", "priority": "PRIORITY", "any": "ANY", "collect": "COLLECT", "rule_order": "RULE ORDER"}
HIT_POLICY_FROM_DMN = {v: k for k, v in HIT_POLICY_TO_DMN.items()}
TYPE_TO_DMN = {"string": "string", "number": "number", "boolean": "boolean", "date": "date", "datetime": "date and time"}
TYPE_FROM_DMN = {
    "string": "string", "number": "number", "integer": "number", "long": "number", "double": "number", "decimal": "number",
    "boolean": "boolean", "date": "date", "date and time": "datetime", "datetime": "datetime", "dateTime": "datetime",
}
KNOWN_DMN = {
    "definitions", "import", "itemDefinition", "typeRef", "allowedValues", "itemComponent", "functionItem", "parameters",
    "decision", "question", "allowedAnswers", "variable", "informationRequirement", "requiredDecision", "requiredInput",
    "knowledgeRequirement", "requiredKnowledge", "authorityRequirement", "requiredAuthority", "supportedObjective",
    "impactedPerformanceIndicator", "decisionMaker", "decisionOwner", "usingProcess", "usingTask", "decisionTable",
    "input", "inputExpression", "inputValues", "output", "outputValues", "defaultOutputEntry", "rule", "inputEntry",
    "outputEntry", "annotationEntry", "annotation", "literalExpression", "text", "importedValues", "description",
    "extensionElements", "inputData", "businessKnowledgeModel", "encapsulatedLogic", "knowledgeSource", "context",
    "contextEntry", "invocation", "binding", "list", "relation", "column", "row", "functionDefinition", "formalParameter",
    "decisionService", "outputDecision", "encapsulatedDecision", "inputDecision", "textAnnotation", "association",
    "group", "elementCollection", "drgElement", "performanceIndicator", "organizationUnit", "decisionMade",
    "decisionOwned", "sourceRef", "targetRef", "conditional", "if", "then", "else", "for", "every", "some", "in",
    "return", "satisfies", "filter", "match", "iterator", "typedChildExpression", "inputExpressionText",
}


def decision_projection(node: dict[str, Any]) -> dict[str, Any]:
    """The part of a decision node a DMN decision carries"""
    out: dict[str, Any] = {"id": node["id"], "name": node["name"]}
    if node.get("description") is not None:
        out["description"] = node["description"]
    out["decision_table"] = node["decision_table"]
    return out


@dataclass
class ReadDmnResult:
    definitions_id: str
    #: Decisions with a decision table, by their DMN identifier, in document order
    decisions: dict[str, dict[str, Any]]
    warnings: list[InterchangeWarning] = field(default_factory=list)


def _where(decision: Element, part: str) -> str:
    name = decision.get("name")
    return f'Decision "{decision.get("id")}"' + (f" ({name})" if name else "") + f", {part}"


def _split_list(text: str) -> list[str]:
    parts, depth, quote, start, i = [], 0, False, 0, 0
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                quote = False
            i += 1
            continue
        if c == '"':
            quote = True
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(text[start:i].strip())
            start = i + 1
        i += 1
    parts.append(text[start:].strip())
    return parts


def read_dmn(xml: str, native: bool = False) -> ReadDmnResult:
    """Read the decision tables of a DMN document"""
    root = parse(xml, "DMN")
    ns = namespace(root.tag)
    if ns not in DMN_NAMESPACES:
        raise InterchangeError("The DMN document is not DMN 1.1 to 1.5: its namespace is none of the DMN model namespaces")
    if local(root.tag) != "definitions":
        raise InterchangeError("The DMN document does not start with <definitions>")
    doc = Document(root, ns, "DMN")
    check_known(doc, KNOWN_DMN)
    warnings: list[InterchangeWarning] = []
    decisions: dict[str, dict[str, Any]] = {}
    for element in doc.children(root, "decision"):
        table = doc.child(element, "decisionTable")
        if table is None:
            other = next((c for c in doc.children(element) if local(c.tag) not in ("description", "extensionElements", "question", "allowedAnswers", "variable", "informationRequirement", "knowledgeRequirement", "authorityRequirement")), None)
            if other is None:
                warnings.append(InterchangeWarning(element=element.get("id"), message=f'Decision "{element.get("id")}" has no decision logic and is left out'))
            else:
                warnings.append(InterchangeWarning(element=element.get("id"), message=f'Decision "{element.get("id")}" is decided by a {local(other.tag)[0].upper() + local(other.tag)[1:]}, not a decision table; AWA decides with tables (5.5), so it is left out'))
            continue
        decisions[element.get("id")] = _read_decision(doc, element, table, root.get("id") or "definitions", warnings, native)
    return ReadDmnResult(definitions_id=root.get("id"), decisions=decisions, warnings=warnings)


def _allowed_values(doc: Document, clause: Element, name: str, where: str, warnings: list) -> list | None:
    unary = doc.child(clause, name)
    text = (doc.text(unary, "text") or "").strip() if unary is not None else ""
    if not text:
        return None
    values = []
    for part in _split_list(text):
        try:
            values.append(feel_to_value(part))
        except InterchangeError:
            warnings.append(InterchangeWarning(element=where, message=f'{where}: the allowed values "{text}" are not a list of values, so they are left out'))
            return None
    return values


def _column_type(type_ref: str | None, where: str, warnings: list) -> str:
    if not type_ref:
        return "string"
    mapped = TYPE_FROM_DMN.get(type_ref.strip())
    if mapped:
        return mapped
    warnings.append(InterchangeWarning(element=where, message=f'{where}: type "{type_ref}" has no AWA counterpart and is read as string'))
    return "string"


def _read_decision(doc: Document, decision: Element, table: Element, document_id: str, warnings: list, native: bool) -> dict[str, Any]:
    hit = (table.get("hitPolicy") or "UNIQUE").upper()
    if hit == "OUTPUT ORDER":
        raise InterchangeError(f"{_where(decision, 'hit policy OUTPUT ORDER')}: AWA has no hit policy that sorts outputs by their priority")
    if table.get("aggregation"):
        raise InterchangeError(f"{_where(decision, 'hit policy COLLECT ' + table.get('aggregation'))}: AWA collects the outputs of the matching rules but does not aggregate them")
    hit_policy = HIT_POLICY_FROM_DMN.get(hit)
    if not hit_policy:
        raise InterchangeError(f"{_where(decision, 'hit policy ' + json.dumps(table.get('hitPolicy')))}: not a DMN hit policy")

    input_els, output_els, rule_els = doc.children(table, "input"), doc.children(table, "output"), doc.children(table, "rule")
    inputs = []
    for i, clause in enumerate(input_els):
        where = _where(decision, f"input {i + 1}")
        expression_el = doc.child(clause, "inputExpression")
        expression = (doc.text(expression_el, "text") or "").strip() if expression_el is not None else ""
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_ ]*", expression):
            raise InterchangeError(f'{where}: the input expression "{expression}" is not the name of one property; an AWA decision input names one property of the token data (5.5.1)')
        column: dict[str, Any] = {"name": expression.strip()}
        if clause.get("label"):
            column["label"] = clause.get("label")
        column["type"] = _column_type(expression_el.get("typeRef") if expression_el is not None else None, where, warnings)
        allowed = _allowed_values(doc, clause, "inputValues", where, warnings)
        if allowed is not None:
            column["allowed_values"] = allowed
        inputs.append(column)
    outputs = []
    for i, clause in enumerate(output_els):
        where = _where(decision, f"output {i + 1}")
        name = clause.get("name") or ((decision.get("name") or decision.get("id")) if len(output_els) == 1 else None)
        if not name:
            raise InterchangeError(f"{where}: the output has no name, and an AWA output names the property it sets")
        column = {"name": name}
        if clause.get("label"):
            column["label"] = clause.get("label")
        column["type"] = _column_type(clause.get("typeRef"), where, warnings)
        allowed = _allowed_values(doc, clause, "outputValues", where, warnings)
        if allowed is not None:
            column["allowed_values"] = allowed
        outputs.append(column)
    if not inputs:
        raise InterchangeError(f"{_where(decision, 'its table')}: it has no input; an AWA table has at least one")
    if not outputs:
        raise InterchangeError(f"{_where(decision, 'its table')}: it has no output; an AWA table has at least one")

    rules = []
    for r, rule in enumerate(rule_els):
        out: dict[str, Any] = {}
        rule_id = rule.get("id")
        if rule_id and re.fullmatch(r"_[0-9a-fA-F-]{36}", rule_id):
            out["id"] = awa_id(rule_id, document_id)
        description = doc.text(rule, "description")
        if description:
            out["description"] = description
        entries = []
        for j, entry in enumerate(doc.children(rule, "inputEntry")):
            try:
                entries.append(feel_unary_to_awa(doc.text(entry, "text") or ""))
            except InterchangeError as error:
                raise InterchangeError(f"{_where(decision, f'rule {r + 1}, input {j + 1}')}: {error}") from None
        out["input_entries"] = entries
        values = []
        for j, entry in enumerate(doc.children(rule, "outputEntry")):
            try:
                values.append(feel_to_value(doc.text(entry, "text") or ""))
            except InterchangeError as error:
                raise InterchangeError(f"{_where(decision, f'rule {r + 1}, output {j + 1}')}: {error}") from None
        out["output_entries"] = values
        rules.append(out)
    if hit_policy == "priority":
        _assign_priorities(decision, rules, outputs)
    if not native:
        for r, rule in enumerate(rule_els):
            apply_residual(rules[r], read_residual(awa_extensions(doc, rule), _where(decision, f"rule {r + 1}")))
        for i, clause in enumerate(input_els):
            apply_residual(inputs[i], read_residual(awa_extensions(doc, clause), _where(decision, f"input {i + 1}")))
        for i, clause in enumerate(output_els):
            apply_residual(outputs[i], read_residual(awa_extensions(doc, clause), _where(decision, f"output {i + 1}")))

    decision_table: dict[str, Any] = {"hit_policy": hit_policy, "inputs": inputs, "outputs": outputs, "rules": rules}
    node: dict[str, Any] = {"id": awa_id(decision.get("id"), document_id), "name": decision.get("name") or decision.get("id")}
    description = doc.text(decision, "description")
    if description:
        node["description"] = description
    node["decision_table"] = decision_table
    if not native:
        apply_residual(decision_table, read_residual(awa_extensions(doc, table), _where(decision, "its table")))
        apply_residual(node, read_residual(awa_extensions(doc, decision), _where(decision, "the decision")))
        final = node["decision_table"]
        ordered = any(isinstance(o.get("allowed_values"), list) for o in final["outputs"]) or any(
            isinstance(rule.get("priority"), (int, float)) and not isinstance(rule.get("priority"), bool) for rule in final["rules"])
        if final["hit_policy"] == "priority" and not ordered:
            raise InterchangeError(f"{_where(decision, 'hit policy PRIORITY')}: the table gives no output values to order its rules by, and AWA gives each rule a priority")
    return node


def _assign_priorities(decision: Element, rules: list[dict], outputs: list[dict]) -> None:
    lists = [o.get("allowed_values") if isinstance(o.get("allowed_values"), list) else None for o in outputs]
    if not any(lst is not None for lst in lists):
        return
    keys = []
    for rule in rules:
        key = []
        for i, lst in enumerate(lists):
            if lst is None:
                key.append(0)
                continue
            index = next((k for k, v in enumerate(lst) if json_equal(v, rule["output_entries"][i] if i < len(rule["output_entries"]) else None)), -1)
            if index < 0:
                raise InterchangeError(f"{_where(decision, 'hit policy PRIORITY')}: an output of a rule is not among the output values that order the rules")
            key.append(index)
        keys.append(tuple(key))
    distinct = sorted(set(keys))
    for rule, key in zip(rules, keys):
        rule["priority"] = len(distinct) - distinct.index(key)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

ET.register_namespace("dmn", DMN13_NAMESPACE)
ET.register_namespace("awa", AWA_INTERCHANGE_NAMESPACE)


def _q(name: str) -> str:
    return f"{{{DMN13_NAMESPACE}}}{name}"


def _sub(parent: Element, name: str, attrib: dict[str, str] | None = None, text: str | None = None) -> Element:
    el = ET.SubElement(parent, _q(name), {k: v for k, v in (attrib or {}).items() if v is not None})
    if text is not None:
        el.text = text
    return el


def add_extensions(el: Element, values: list[tuple[str, str]], ns: str, before: tuple[str, ...] = ("documentation", "description")) -> None:
    """Add awa: extension elements, after the element's documentation and before anything else"""
    if not values:
        return
    container = next((c for c in el if c.tag == f"{{{ns}}}extensionElements"), None)
    if container is None:
        container = ET.Element(f"{{{ns}}}extensionElements")
        position = 0
        for i, c in enumerate(list(el)):
            if local(c.tag) in before:
                position = i + 1
        el.insert(position, container)
    for name, body in values:
        child = ET.SubElement(container, f"{{{AWA_INTERCHANGE_NAMESPACE}}}{name}")
        child.text = body


def _build(nodes: list[dict], definitions: dict[str, str]) -> tuple[Element, dict[str, Element]]:
    elements: dict[str, Element] = {}
    root = ET.Element(_q("definitions"), {"id": f"Definitions_{definitions['id']}", "name": definitions["name"],
                                          "namespace": f"https://awa.io/workflows/{definitions['id']}"})
    for node in nodes:
        table = node["decision_table"]
        node_id = str(node["id"])
        decision = _sub(root, "decision", {"id": xml_id(node_id), "name": node["name"]})
        if isinstance(node.get("description"), str):
            _sub(decision, "description", text=node["description"])
        inputs, outputs = table.get("inputs") or [], table.get("outputs") or []
        dmn_table = _sub(decision, "decisionTable", {"id": f"DecisionTable_{node_id}", "hitPolicy": HIT_POLICY_TO_DMN.get(str(table.get("hit_policy")), "UNIQUE")})
        for i, column in enumerate(inputs):
            clause = _sub(dmn_table, "input", {"id": f"Input_{node_id}_{i + 1}", "label": column.get("label")})
            expression = _sub(clause, "inputExpression", {"id": f"InputExpression_{node_id}_{i + 1}", "typeRef": TYPE_TO_DMN.get(str(column.get("type")), "string")})
            _sub(expression, "text", text=str(column.get("name")))
            if isinstance(column.get("allowed_values"), list) and column["allowed_values"]:
                values = _sub(clause, "inputValues", {"id": f"InputValues_{node_id}_{i + 1}"})
                _sub(values, "text", text=", ".join(value_to_feel(v) for v in column["allowed_values"]))
            elements[f"{node_id}/input/{i}"] = clause
        for i, column in enumerate(outputs):
            clause = _sub(dmn_table, "output", {"id": f"Output_{node_id}_{i + 1}", "label": column.get("label"), "name": column.get("name"),
                                                "typeRef": TYPE_TO_DMN.get(str(column.get("type")), "string")})
            if isinstance(column.get("allowed_values"), list) and column["allowed_values"]:
                values = _sub(clause, "outputValues", {"id": f"OutputValues_{node_id}_{i + 1}"})
                _sub(values, "text", text=", ".join(value_to_feel(v) for v in column["allowed_values"]))
            elements[f"{node_id}/output/{i}"] = clause
        for r, rule in enumerate(table.get("rules") or []):
            rule_id = xml_id(rule["id"]) if isinstance(rule.get("id"), str) else f"Rule_{node_id}_{r + 1}"
            dmn_rule = _sub(dmn_table, "rule", {"id": rule_id})
            if isinstance(rule.get("description"), str):
                _sub(dmn_rule, "description", text=rule["description"])
            for j, entry in enumerate(rule.get("input_entries") or []):
                column_type = inputs[j].get("type") if j < len(inputs) else None
                _sub(_sub(dmn_rule, "inputEntry", {"id": f"{rule_id}_in_{j + 1}"}), "text", text=awa_unary_to_feel(entry, column_type))
            for j, value in enumerate(rule.get("output_entries") or []):
                _sub(_sub(dmn_rule, "outputEntry", {"id": f"{rule_id}_out_{j + 1}"}), "text", text=value_to_feel(value))
            elements[f"{node_id}/rule/{r}"] = dmn_rule
        elements[f"{node_id}/decision"] = decision
        elements[f"{node_id}/table"] = dmn_table
    return root, elements


def _serialise(root: Element) -> str:
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


def write_dmn(nodes: list[dict[str, Any]], definitions: dict[str, str] | None = None) -> str:
    """Write the decision tables of decision nodes as a DMN 1.3 document that reads back the same"""
    with_tables = [n for n in nodes if isinstance(n.get("decision_table"), dict)]
    definitions = definitions or {"id": str(with_tables[0]["id"]) if with_tables else "decisions",
                                  "name": str(with_tables[0]["name"]) if with_tables else "Decisions"}
    root, elements = _build(with_tables, definitions)
    native = read_dmn(_serialise(clone_tree(root)), native=True)
    native_by_id = {str(d["id"]): d for d in native.decisions.values()}
    for node in with_tables:
        node_id = str(node["id"])
        original = clone(decision_projection(node))
        back = native_by_id.get(node_id)
        if back is None:
            raise InterchangeError(f'Decision "{node["name"]}" was not read back from the DMN written for it')
        table, native_table = original["decision_table"], back["decision_table"]
        level = {k: v for k, v in table.items() if k not in ("inputs", "outputs", "rules")}
        native_level = {k: v for k, v in native_table.items() if k not in ("inputs", "outputs", "rules")}
        for key, kind in (("inputs", "input"), ("outputs", "output"), ("rules", "rule")):
            mine, theirs = table.get(key), native_table.get(key)
            if isinstance(mine, list) and isinstance(theirs, list) and len(mine) == len(theirs):
                for i, item in enumerate(mine):
                    add_extensions(elements[f"{node_id}/{kind}/{i}"], residual_extensions(residual(item, theirs[i])), DMN13_NAMESPACE)
            else:
                if key in table:
                    level[key] = table[key]
                if key in native_table:
                    native_level[key] = native_table[key]
        add_extensions(elements[f"{node_id}/table"], residual_extensions(residual(level, native_level)), DMN13_NAMESPACE)
        decision_level = {k: v for k, v in original.items() if k != "decision_table"}
        native_decision_level = {k: v for k, v in back.items() if k != "decision_table"}
        r: Residual = residual(decision_level, native_decision_level)
        if not r.is_empty():
            add_extensions(elements[f"{node_id}/decision"], residual_extensions(r), DMN13_NAMESPACE)
    xml = _serialise(root)
    back = read_dmn(xml)
    for node in with_tables:
        read = next((d for d in back.decisions.values() if d["id"] == node["id"]), None)
        if read is None or not json_equal(read, decision_projection(node)):
            raise InterchangeError(f'Decision "{node["name"]}" does not read back from DMN as it was written; this is a defect of the exporter')
    return xml


def clone_tree(root: Element) -> Element:
    return ET.fromstring(ET.tostring(root))


def import_dmn(xml: str) -> tuple[list[dict[str, Any]], list[InterchangeWarning]]:
    """The decision nodes of a DMN document, each with its table and no routing: the result of `awa import dmn`"""
    result = read_dmn(xml)
    if not result.decisions:
        raise InterchangeError("The DMN document has no decision table")
    return list(result.decisions.values()), result.warnings
