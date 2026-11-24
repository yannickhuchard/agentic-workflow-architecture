/**
 * Interchange with the formats organisations already use (specification section 27):
 * BPMN 2.0 and DMN 1.x, read and written without loss, and CNCF Serverless Workflow 1.0,
 * written for what maps.
 */
export {
    InterchangeError, type InterchangeWarning, AWA_INTERCHANGE_NAMESPACE, AWA_EXPRESSION_LANGUAGE,
    AWA_DECISION_ROUTE_LANGUAGE, FEEL_LANGUAGE, INTERCHANGE_ID_NAMESPACE, awa_id as interchange_awa_id,
} from './common';
export { import_bpmn, type ImportBpmnOptions, type ImportBpmnResult } from './bpmn_import';
export { export_bpmn, type ExportBpmnOptions, type ExportBpmnResult } from './bpmn_export';
export { import_dmn, write_dmn as export_dmn, read_dmn } from './dmn';
export { export_serverless_workflow, type ServerlessWorkflowExport, type NotMapped } from './serverless_workflow';
export {
    feel_unary_to_awa, awa_unary_to_feel, feel_condition_to_awa, awa_condition_to_feel, feel_to_value, value_to_feel,
} from './expressions';
