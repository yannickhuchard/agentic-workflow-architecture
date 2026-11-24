/**
 * Loading of the optional libraries that read and write BPMN, DMN and Serverless Workflow.
 * They are ESM-only and optional: the SDK loads without them, and a command that needs
 * one says which package to install.
 */
import { InterchangeError, AWA_INTERCHANGE_NAMESPACE, type ExtensionValue } from './common';

async function load(name: string): Promise<any> {
    try {
        return await import(/* @vite-ignore */ name);
    } catch (error) {
        throw new InterchangeError(`This needs the package ${name}, which is not installed: npm install ${name} (${error instanceof Error ? error.message : String(error)})`);
    }
}

export async function bpmn_moddle(): Promise<any> {
    const module = await load('bpmn-moddle');
    const BpmnModdle = module.BpmnModdle || module.default;
    return new BpmnModdle();
}

export async function dmn_moddle(): Promise<any> {
    const module = await load('dmn-moddle');
    const DmnModdle = module.DmnModdle || module.default;
    return new DmnModdle();
}

export async function serverless_workflow_sdk(): Promise<any> {
    const module = await load('@serverlessworkflow/sdk');
    return module.default && module.default.validate ? module.default : module;
}

/** Parse XML with a moddle instance; any warning refuses the document */
export async function read_xml(moddle: any, xml: string, what: string): Promise<any> {
    let result: any;
    try {
        result = await moddle.fromXML(xml);
    } catch (error) {
        throw new InterchangeError(`The ${what} document cannot be read: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
    if (result.warnings && result.warnings.length) {
        const messages = result.warnings.map((w: { message: string }) => w.message.split('\n')[0]);
        throw new InterchangeError(`The ${what} document is not well-formed ${what}: ${messages.join('; ')}`);
    }
    return result.rootElement;
}

/** The awa: extension elements of an element, as local name and text */
export function awa_extensions(element: any): ExtensionValue[] {
    const values: any[] = element?.extensionElements?.values || [];
    const out: ExtensionValue[] = [];
    for (const v of values) {
        const ns = v.$descriptor?.ns;
        if (!ns || ns.uri !== AWA_INTERCHANGE_NAMESPACE) continue;
        out.push({ name: ns.localName, body: typeof v.$body === 'string' ? v.$body : '' });
    }
    return out;
}

/** The namespace URI a prefix is declared with, looking up the element's ancestors */
function lookup_namespace(element: any, prefix: string): string | undefined {
    let node = element;
    while (node) {
        const uri = node.$attrs?.[`xmlns:${prefix}`];
        if (uri) return uri;
        node = node.$parent;
    }
    return undefined;
}

/** The value of an attribute in the awa: namespace, whatever prefix the document gives it */
export function awa_attribute(element: any, local: string): string | undefined {
    for (const [key, value] of Object.entries(element?.$attrs || {})) {
        const [prefix, name] = key.includes(':') ? key.split(':') : ['', key];
        if (name === local && prefix !== 'xmlns' && lookup_namespace(element, prefix) === AWA_INTERCHANGE_NAMESPACE) return String(value);
    }
    return undefined;
}

/** The value of an attribute of that local name in any namespace other than the element's own */
export function foreign_attribute(element: any, local: string): string | undefined {
    for (const [key, value] of Object.entries(element?.$attrs || {})) {
        if (key.includes(':') && !key.startsWith('xmlns') && key.split(':')[1] === local) return String(value);
    }
    return undefined;
}

/** Add awa: extension elements to an element */
export function add_extensions(moddle: any, element: any, type_prefix: 'bpmn' | 'dmn', values: ExtensionValue[]): void {
    if (!values.length) return;
    if (!element.extensionElements) element.extensionElements = moddle.create(`${type_prefix}:ExtensionElements`, { values: [] });
    for (const { name, body } of values) {
        element.extensionElements.values.push(moddle.createAny(`awa:${name}`, AWA_INTERCHANGE_NAMESPACE, { $body: body }));
    }
}
