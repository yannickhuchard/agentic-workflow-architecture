// The one place the AWA SDK and the view code shared with tools/visualization are loaded.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '../..');
export const VIEWS_DIR = path.join(REPOSITORY_ROOT, 'tools/visualization');
export const EXAMPLE_DIR = path.join(REPOSITORY_ROOT, 'examples/claims-journey');
export const RELEASE = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

let sdk;
/** The AWA TypeScript SDK (sdk/typescript, built to dist/) */
export async function load_sdk() {
    if (!sdk) {
        try { sdk = await import('agentic-workflow-architecture'); }
        catch (error) { throw new Error(`The AWA SDK is not built. Run "npm run build" in sdk/typescript. (${error.message})`); }
    }
    return sdk;
}

let builder;
/** tools/visualization/journey-story-builder.js: turns a portfolio record into the story the journey view plays */
export function story_builder() {
    if (!builder) builder = createRequire(import.meta.url)(path.join(VIEWS_DIR, 'journey-story-builder.js')).build_story;
    return builder;
}

let recommender;
/** tools/visualization/awa-recommendations.js: the twelve rules of the Recommendations tab, over a portfolio record */
export function recommendations_module() {
    if (!recommender) recommender = createRequire(import.meta.url)(path.join(VIEWS_DIR, 'awa-recommendations.js'));
    return recommender;
}

let dossier;
/** tools/visualization/awa-dossier.js and its HTML edition: the dossier of a journey record */
export function dossier_modules() {
    if (!dossier) { const req = createRequire(import.meta.url); dossier = { model: req(path.join(VIEWS_DIR, 'awa-dossier.js')), html: req(path.join(VIEWS_DIR, 'awa-dossier-html.js')) }; }
    return dossier;
}

let brand;
/** tools/visualization/awa-brand.js: reads a DESIGN.md or a brand.json, and checks its colours */
export function brand_module() {
    if (!brand) brand = createRequire(import.meta.url)(path.join(VIEWS_DIR, 'awa-brand.js'));
    return brand;
}
