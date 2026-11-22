/**
 * The views that come with the SDK: the measures page and the journey view.
 * They are plain pages with no dependencies; the SDK serves them and can write
 * the measures page as one file with a record inside it.
 */
import fs from 'fs';
import path from 'path';
import type { MeasureInput } from './kpi';

/** Where the views are: beside the built SDK, or in the repository when running from source */
export function view_directory(): string {
    const candidates = [path.join(__dirname, 'views'), path.join(__dirname, '../views'), path.join(__dirname, '../../../../tools/visualization')];
    const found = candidates.find(dir => fs.existsSync(path.join(dir, 'dashboard.html')));
    if (!found) throw new Error('The views are not installed with this copy of the SDK. Build it with "npm run build".');
    return found;
}

/** Text placed inside a script element must not be able to end it */
const inline = (script: string) => script.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/**
 * The measures page as one self-contained file showing the given record: nothing to install,
 * nothing fetched. The record is what `export_portfolio()` returns.
 */
export function measures_page(record: MeasureInput, options: { source?: string } = {}): string {
    const dir = view_directory();
    const page = fs.readFileSync(path.join(dir, 'dashboard.html'), 'utf-8');
    const measures = fs.readFileSync(path.join(dir, 'awa-kpis.js'), 'utf-8');
    const data = JSON.stringify(record).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const source = JSON.stringify(options.source || 'a record written into this page').replace(/</g, '\\u003c');
    const a = '<script src="awa-kpis.js"></script>', b = '<script src="dashboard-sample.js"></script>';
    if (!page.includes(a) || !page.includes(b)) throw new Error('dashboard.html is not the page this SDK was built with');
    return page
        .replace(a, () => `<script>${inline(measures)}</script>`)
        .replace(b, () => `<script>window.AWA_PORTFOLIO = ${data}; window.AWA_SOURCE = ${source};</script>`);
}
