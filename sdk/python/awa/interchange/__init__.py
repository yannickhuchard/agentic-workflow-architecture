"""
Interchange with the formats organisations already use (specification section 27): BPMN 2.0
and DMN 1.x, read and written without loss, and CNCF Serverless Workflow 1.0, written for
what maps. Python port of sdk/typescript/src/interchange, held to the same conformance cases.

Only the standard library is used. The Python SDK writes BPMN, DMN and Serverless Workflow
without the reference readers; its test suite checks its output with them when Node is
installed.
"""

from awa.interchange.bpmn_export import ExportBpmnResult, export_bpmn
from awa.interchange.bpmn_import import ImportBpmnResult, import_bpmn
from awa.interchange.common import (
    AWA_DECISION_ROUTE_LANGUAGE, AWA_EXPRESSION_LANGUAGE, AWA_INTERCHANGE_NAMESPACE, FEEL_LANGUAGE,
    INTERCHANGE_ID_NAMESPACE, InterchangeError, InterchangeWarning,
)
from awa.interchange.dmn import import_dmn, read_dmn, write_dmn as export_dmn
from awa.interchange.expressions import (
    awa_condition_to_feel, awa_unary_to_feel, feel_condition_to_awa, feel_to_value, feel_unary_to_awa, value_to_feel,
)
from awa.interchange.serverless_workflow import ServerlessWorkflowExport, export_serverless_workflow

__all__ = [
    "AWA_DECISION_ROUTE_LANGUAGE", "AWA_EXPRESSION_LANGUAGE", "AWA_INTERCHANGE_NAMESPACE", "FEEL_LANGUAGE",
    "INTERCHANGE_ID_NAMESPACE", "ExportBpmnResult", "ImportBpmnResult", "InterchangeError", "InterchangeWarning",
    "ServerlessWorkflowExport", "awa_condition_to_feel", "awa_unary_to_feel", "export_bpmn", "export_dmn",
    "export_serverless_workflow", "feel_condition_to_awa", "feel_to_value", "feel_unary_to_awa", "import_bpmn",
    "import_dmn", "read_dmn", "value_to_feel",
]
