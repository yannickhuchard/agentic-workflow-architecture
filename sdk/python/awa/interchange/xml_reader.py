"""
Reading BPMN and DMN XML with the standard library: elements by identifier, references
resolved, and the strictness of the reference readers (an element BPMN does not define,
or a reference to nothing, refuses the document).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Iterator

from awa.interchange.common import AWA_INTERCHANGE_NAMESPACE, InterchangeError

Element = ET.Element


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def namespace(tag: str) -> str:
    return tag[1:].split("}", 1)[0] if isinstance(tag, str) and tag.startswith("{") else ""


def parse(xml: str, what: str) -> Element:
    try:
        return ET.fromstring(xml.encode("utf-8") if isinstance(xml, str) else xml)
    except ET.ParseError as error:
        raise InterchangeError(f"The {what} document cannot be read: {error}") from None


class Document:
    """An XML document whose elements of one namespace are found by identifier"""

    def __init__(self, root: Element, ns: str, what: str):
        self.root, self.ns, self.what = root, ns, what
        self.by_id: dict[str, Element] = {}
        self.parent: dict[Element, Element] = {}
        for parent in root.iter():
            for child in parent:
                self.parent[child] = parent
            el_id = parent.get("id")
            if el_id is not None and namespace(parent.tag) == ns:
                self.by_id[el_id] = parent

    def q(self, name: str) -> str:
        return f"{{{self.ns}}}{name}"

    def children(self, el: Element, name: str | None = None) -> list[Element]:
        return [c for c in el if namespace(c.tag) == self.ns and (name is None or local(c.tag) == name)]

    def child(self, el: Element, name: str) -> Element | None:
        found = self.children(el, name)
        return found[0] if found else None

    def text(self, el: Element | None, name: str) -> str | None:
        c = self.child(el, name) if el is not None else None
        return c.text if c is not None and c.text is not None else (("" if c is not None else None))

    def resolve(self, value: str | None, where: Element, attribute: str) -> Element | None:
        """The element a reference names. A reference to nothing refuses the document"""
        if value is None:
            return None
        value = value.strip()
        target = self.by_id.get(value)
        if target is None and ":" in value:
            target = self.by_id.get(value.split(":", 1)[1])
        if target is None:
            raise InterchangeError(f"The {self.what} document is not well-formed {self.what}: unresolved reference <{value}> in {attribute} of {local(where.tag)} \"{where.get('id')}\"")
        return target

    def ref(self, el: Element, attribute: str) -> Element | None:
        return self.resolve(el.get(attribute), el, attribute)

    def ref_children(self, el: Element, name: str) -> list[Element]:
        """References written as child elements, such as flowNodeRef or sourceRef"""
        out = []
        for c in self.children(el, name):
            target = self.resolve(c.text, el, name)
            if target is not None:
                out.append(target)
        return out

    def documentation(self, el: Element | None) -> str | None:
        if el is None:
            return None
        texts = [d.text for d in self.children(el, "documentation") if d.text]
        return "\n\n".join(texts) if texts else None

    def iter_ns(self) -> Iterator[Element]:
        for el in self.root.iter():
            if namespace(el.tag) == self.ns:
                yield el


def awa_extensions(doc: Document, el: Element | None) -> list[tuple[str, str]]:
    """The awa: extension elements of an element, as (local name, text)"""
    if el is None:
        return []
    out = []
    for container in doc.children(el, "extensionElements"):
        for c in container:
            if namespace(c.tag) == AWA_INTERCHANGE_NAMESPACE:
                out.append((local(c.tag), c.text or ""))
    return out


def awa_attribute(el: Element, name: str) -> str | None:
    return el.get(f"{{{AWA_INTERCHANGE_NAMESPACE}}}{name}")


def foreign_attribute(el: Element, name: str, own_ns: str) -> str | None:
    """An attribute of that local name in a namespace other than the element's own"""
    for key, value in el.attrib.items():
        if key.startswith("{") and local(key) == name and namespace(key) not in (own_ns, ""):
            return value
    return None


def check_known(doc: Document, known: set[str]) -> None:
    """Refuse an element of the document's namespace that its model does not define"""
    for el in doc.iter_ns():
        if local(el.tag) not in known:
            raise InterchangeError(f"The {doc.what} document is not well-formed {doc.what}: unparsable content <{local(el.tag)}> detected; unknown type")
