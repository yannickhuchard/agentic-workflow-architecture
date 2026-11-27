// AWA brand: a company's colours, fonts, corner radius and logo on the views.
//
// A brand is a DESIGN.md file (the open format for describing a design system to
// agents: Markdown with YAML design tokens, https://github.com/google-labs-code/design.md)
// or a brand.json that mirrors its tokens:
//   { "name", "logo", "logo_dark"?, "colors": {...}, "typography": {...}, "rounded": {...}, "mode": "dark"|"light"|"auto" }
// The tokens become the CSS custom properties the views draw with. The colours that carry
// meaning (running, waiting, done, failed, undone) keep their hue; only their lightness is
// adjusted to the brand's background, so that they read at WCAG 4.5:1 as text and 3:1 as marks.
//
// Values are data: a colour is read only as hex, rgb() or hsl(), a dimension only in px, rem
// or em, a font only by a plain family name, a logo only as an image address or a data: URL
// shown in an <img>. Nothing from a brand is ever inserted as markup.
//
// One file, no dependencies. In a browser it defines window.AWA_brand; in Node, require() it.
(function (root) {
'use strict';

// ---------------------------------------------------------------------------
// A small YAML reader: the subset DESIGN.md uses. Maps by indentation, block
// sequences, flow maps and sequences, quoted and plain scalars, block scalars
// (| and >), comments. No anchors, aliases, tags or documents: those are refused.
// ---------------------------------------------------------------------------
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_TEXT = 200000, MAX_DEPTH = 24;

class YamlError extends Error {}

/** A plain scalar: a number, true, false, null, or the text itself */
function scalar(text) {
    const t = text.trim();
    if (t === '' || t === '~' || t === 'null') return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
    if (/^[&*!%@`]/.test(t)) throw new YamlError(`"${t.slice(0, 40)}" uses YAML this reader does not take (anchors, aliases, tags)`);
    return t;
}

/** A quoted string starting at text[i]; returns [value, index after the closing quote] */
function quoted(text, i) {
    const q = text[i]; let out = '', k = i + 1;
    while (k < text.length) {
        const c = text[k];
        if (q === "'" && c === "'") { if (text[k + 1] === "'") { out += "'"; k += 2; continue; } return [out, k + 1]; }
        if (q === '"' && c === '"') return [out, k + 1];
        if (q === '"' && c === '\\') {
            const e = text[k + 1], map = { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', r: '\r', '0': '\0' };
            if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(k + 2, k + 6))) { out += String.fromCharCode(parseInt(text.slice(k + 2, k + 6), 16)); k += 6; continue; }
            if (e in map) { out += map[e]; k += 2; continue; }
            throw new YamlError(`unknown escape \\${e}`);
        }
        out += c; k++;
    }
    throw new YamlError('a quoted string is not closed');
}

/** Remove a comment: a # at the start or after a space, outside quotes */
function strip_comment(line) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === q && !(q === '"' && line[i - 1] === '\\')) q = null; continue; }
        if (c === '"' || c === "'") { if (i === 0 || /[\s:,[{]/.test(line[i - 1])) q = c; continue; }
        if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
}

/** A flow value: { a: b, c: [d] }, [a, b], a quoted string, or a plain scalar */
function flow(text, depth) {
    if (depth > MAX_DEPTH) throw new YamlError('nested too deeply');
    let i = 0;
    const space = () => { while (i < text.length && /\s/.test(text[i])) i++; };
    const value = stop => {
        space();
        if (text[i] === '{') return map();
        if (text[i] === '[') return seq();
        if (text[i] === '"' || text[i] === "'") { const [v, k] = quoted(text, i); i = k; return v; }
        let start = i; while (i < text.length && !stop.includes(text[i])) i++;
        return scalar(text.slice(start, i));
    };
    const key = () => {
        space();
        if (text[i] === '"' || text[i] === "'") { const [v, k] = quoted(text, i); i = k; return v; }
        let start = i; while (i < text.length && text[i] !== ':' && text[i] !== ',' && text[i] !== '}') i++;
        return text.slice(start, i).trim();
    };
    function map() {
        i++; const out = Object.create(null);
        for (;;) {
            space(); if (text[i] === '}') { i++; return out; }
            const k = key(); space();
            if (text[i] !== ':') throw new YamlError(`expected ":" after "${k}" in a flow map`);
            i++;
            if (FORBIDDEN.has(k)) throw new YamlError(`the key "${k}" is not allowed`);
            out[k] = value([',', '}']); space();
            if (text[i] === ',') { i++; continue; }
            if (text[i] === '}') { i++; return out; }
            throw new YamlError('a flow map is not closed');
        }
    }
    function seq() {
        i++; const out = [];
        for (;;) {
            space(); if (text[i] === ']') { i++; return out; }
            out.push(value([',', ']'])); space();
            if (text[i] === ',') { i++; continue; }
            if (text[i] === ']') { i++; return out; }
            throw new YamlError('a flow sequence is not closed');
        }
    }
    const v = value([]); space();
    if (i < text.length) throw new YamlError(`unexpected text "${text.slice(i, i + 30)}"`);
    return v;
}

/** Parse a YAML document of the DESIGN.md subset into plain objects (with no prototype) */
function parse_yaml(source) {
    const text = String(source);
    if (text.length > MAX_TEXT) throw new YamlError('the YAML is too long');
    const raw = text.replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    for (let n = 0; n < raw.length; n++) {
        if (/\t/.test(raw[n].match(/^\s*/)[0])) throw new YamlError(`line ${n + 1} is indented with a tab`);
        lines.push({ n: n + 1, raw: raw[n] });
    }
    let p = 0;
    const indent = l => l.raw.match(/^ */)[0].length;
    const blank = l => strip_comment(l.raw).trim() === '';
    const skip = () => { while (p < lines.length && blank(lines[p])) p++; };

    /** A block scalar (| or >) whose lines are indented more than `parent` */
    function block_scalar(style, parent) {
        const body = []; let base = -1;
        while (p < lines.length) {
            const l = lines[p];
            if (l.raw.trim() === '') { body.push(''); p++; continue; }
            const ind = indent(l);
            if (ind <= parent) break;
            if (base < 0) base = ind;
            body.push(l.raw.slice(Math.min(base, ind))); p++;
        }
        while (body.length && body[body.length - 1] === '') body.pop();
        return style.startsWith('|') ? body.join('\n') : body.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ');
    }

    /** The value after "key:" or "- " on a line: inline, or the block below */
    function value_of(rest, parent, depth) {
        const t = rest.trim();
        if (t === '') { skip(); if (p < lines.length && indent(lines[p]) > parent) return node(indent(lines[p]), depth + 1); if (p < lines.length && indent(lines[p]) === parent && /^-( |$)/.test(lines[p].raw.trim())) return node(parent, depth + 1); return null; }
        if (/^[|>][-+]?$/.test(t)) return block_scalar(t, parent);
        return flow(t, depth);
    }

    function node(at, depth) {
        if (depth > MAX_DEPTH) throw new YamlError('nested too deeply');
        skip();
        const first = strip_comment(lines[p].raw).trim();
        if (/^-( |$)/.test(first)) {
            const out = [];
            while (p < lines.length) {
                skip(); if (p >= lines.length) break;
                const l = lines[p], ind = indent(l), t = strip_comment(l.raw).trim();
                if (ind < at || !/^-( |$)/.test(t)) { if (ind > at) throw new YamlError(`line ${l.n} is not where it belongs`); break; }
                if (ind > at) throw new YamlError(`line ${l.n} is indented too far`);
                p++;
                const rest = t.slice(1).trim();
                const kv = /^("[^"]*"|'[^']*'|[^:{[\]"']+?)\s*:(\s|$)/.exec(rest);
                if (kv && !/^[{[]/.test(rest)) {
                    // "- key: value" opens a map whose keys line up after the dash
                    const inner = ind + (l.raw.slice(ind).length - l.raw.slice(ind).replace(/^-\s+/, '').length);
                    lines.splice(p, 0, { n: l.n, raw: ' '.repeat(inner) + rest });
                    out.push(node(inner, depth + 1));
                } else out.push(value_of(rest, ind, depth));
            }
            return out;
        }
        const out = Object.create(null);
        while (p < lines.length) {
            skip(); if (p >= lines.length) break;
            const l = lines[p], ind = indent(l), t = strip_comment(l.raw).trim();
            if (ind < at) break;
            if (ind > at) throw new YamlError(`line ${l.n} is indented too far`);
            if (/^-( |$)/.test(t)) break;
            if (t === '---' || t === '...') throw new YamlError(`line ${l.n}: one document only`);
            let key, rest;
            if (t[0] === '"' || t[0] === "'") { const [k, e] = quoted(t, 0); key = k; rest = t.slice(e).trim(); if (rest[0] !== ':') throw new YamlError(`line ${l.n}: expected ":"`); rest = rest.slice(1); }
            else { const m = /^([^:]+?)\s*:(\s+|$)(.*)$/.exec(t); if (!m) throw new YamlError(`line ${l.n}: expected "key: value"`); key = m[1]; rest = m[3]; }
            if (FORBIDDEN.has(key)) throw new YamlError(`line ${l.n}: the key "${key}" is not allowed`);
            if (key in out) throw new YamlError(`line ${l.n}: "${key}" is given twice`);
            p++;
            out[key] = value_of(rest, ind, depth);
        }
        return out;
    }
    skip();
    if (p >= lines.length) return Object.create(null);
    const result = node(indent(lines[p]), 0);
    skip();
    if (p < lines.length) throw new YamlError(`line ${lines[p].n} is not where it belongs`);
    return result;
}

// ---------------------------------------------------------------------------
// DESIGN.md: YAML front matter and ```yaml blocks, merged into one token tree
// ---------------------------------------------------------------------------
/** Read a DESIGN.md: returns { tokens, prose, errors } (errors: problems that left something out) */
function parse_design_md(text) {
    const errors = [];
    const source = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (source.length > MAX_TEXT) return { tokens: Object.create(null), prose: '', errors: ['The DESIGN.md is longer than 200 000 characters.'] };
    const blocks = [];
    let body = source;
    const front = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(source);
    if (front) { blocks.push(['front matter', front[1]]); body = source.slice(front[0].length); }
    const fence = /^```ya?ml[ \t]*\n([\s\S]*?)\n```[ \t]*$/gim;
    let m; while ((m = fence.exec(body))) blocks.push([`the yaml block at line ${body.slice(0, m.index).split('\n').length + (front ? front[0].split('\n').length - 1 : 0)}`, m[1]]);
    const tokens = Object.create(null);
    for (const [where, yaml] of blocks) {
        let tree;
        try { tree = parse_yaml(yaml); } catch (error) { errors.push(`In ${where}: ${error.message}.`); continue; }
        if (!tree || typeof tree !== 'object' || Array.isArray(tree)) { errors.push(`In ${where}: the tokens are not a map.`); continue; }
        for (const key of Object.keys(tree)) {
            if (key in tokens) { errors.push(`"${key}" is defined twice (again in ${where}); the second is left out.`); continue; }
            tokens[key] = tree[key];
        }
    }
    if (!blocks.length) errors.push('The DESIGN.md has no YAML front matter and no ```yaml block.');
    return { tokens, prose: body, errors };
}

/** The value a token reference "{colors.primary}" points to, followed up to eight times */
function resolve(tree, value, seen = 0) {
    if (typeof value !== 'string') return value;
    const m = /^\{([A-Za-z0-9_.-]+)\}$/.exec(value.trim());
    if (!m || seen > 8) return value;
    let at = tree;
    for (const part of m[1].split('.')) { if (!at || typeof at !== 'object' || FORBIDDEN.has(part) || !(part in at)) return undefined; at = at[part]; }
    return resolve(tree, at, seen + 1);
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** Read a colour given as hex, rgb()/rgba() or hsl()/hsla(): { r, g, b, a } with r, g, b in 0..255; null for anything else */
function parse_color(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    let m;
    if ((m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v))) {
        let h = m[1]; if (h.length <= 4) h = [...h].map(c => c + c).join('');
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    const num = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+))';
    const alpha = s => s === undefined ? 1 : s.endsWith('%') ? clamp(parseFloat(s) / 100, 0, 1) : clamp(parseFloat(s), 0, 1);
    if ((m = new RegExp(`^rgba?\\(\\s*${num}(%?)\\s*[, ]\\s*${num}(%?)\\s*[, ]\\s*${num}(%?)\\s*(?:[,/]\\s*(${num.slice(1, -1)}%?)\\s*)?\\)$`).exec(v))) {
        const c = (x, pct) => clamp(pct ? parseFloat(x) * 2.55 : parseFloat(x), 0, 255);
        return { r: c(m[1], m[2]), g: c(m[3], m[4]), b: c(m[5], m[6]), a: alpha(m[7]) };
    }
    if ((m = new RegExp(`^hsla?\\(\\s*${num}(?:deg)?\\s*[, ]\\s*${num}%\\s*[, ]\\s*${num}%\\s*(?:[,/]\\s*(${num.slice(1, -1)}%?)\\s*)?\\)$`).exec(v))) {
        const rgb = hsl_to_rgb(((parseFloat(m[1]) % 360) + 360) % 360, clamp(parseFloat(m[2]), 0, 100) / 100, clamp(parseFloat(m[3]), 0, 100) / 100);
        return { ...rgb, a: alpha(m[4]) };
    }
    return null;
}
function hsl_to_rgb(h, s, l) {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}
function rgb_to_hsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
}
const hex = c => '#' + [c.r, c.g, c.b].map(x => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('') + (c.a !== undefined && c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '');
const css_rgba = (c, a) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+a.toFixed(3)})`;
/** Over an opaque background, a colour with alpha is what is seen */
const over = (c, bg) => (c.a === undefined || c.a >= 1 ? c : { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 });
const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 });
/** WCAG relative luminance and contrast ratio */
function luminance(c) {
    const ch = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}
function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/**
 * The colour with the same hue and saturation, its lightness moved as little as needed to reach `ratio`
 * against every background given. Returns the colour unchanged when it already does.
 */
function reach(color, backgrounds, ratio) {
    const ok = c => backgrounds.every(bg => contrast(c, bg) >= ratio);
    if (ok(color)) return color;
    const { h, s, l } = rgb_to_hsl(color), dark = backgrounds.reduce((n, bg) => n + luminance(bg), 0) / backgrounds.length < 0.18;
    // Move towards white on a dark background, towards black on a light one, in small steps
    for (let k = 1; k <= 100; k++) {
        const t = dark ? l + (1 - l) * k / 100 : l * (1 - k / 100);
        const c = { ...hsl_to_rgb(h, s, t), a: 1 };
        if (ok(c)) return c;
    }
    return dark ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
}

// ---------------------------------------------------------------------------
// AWA's own tokens: the default brand (tools/visualization/brands/awa.DESIGN.md holds the same)
// ---------------------------------------------------------------------------
const AWA = {
    name: 'AWA',
    colors: {
        primary: '#818CF8', 'on-primary': '#FFFFFF',
        dark: { surface: '#0B0F19', 'on-surface': '#F8FAFC', 'on-surface-variant': '#CBD5E1', 'surface-container-low': '#111827', 'surface-container': '#1E293B', 'surface-container-high': '#2A3A52', outline: '#475569' },
        light: { primary: '#4F46E5', surface: '#F5F6F8', 'on-surface': '#0F172A', 'on-surface-variant': '#334155', 'surface-container-low': '#FFFFFF', 'surface-container': '#FFFFFF', 'surface-container-high': '#E8EBF0', outline: '#94A3B8' },
    },
    typography: { heading: 'Space Grotesk', body: 'Inter' },
    rounded: { md: '8px', lg: '12px' },
};
/** The colours that carry meaning, by the hue they keep: AWA's dark values */
const STATES = { run: '#A855F7', wait: '#FBBF24', ok: '#10B981', bad: '#FF4D4F', undone: '#9CA3AF', sky: '#38BDF8', left: '#EB6834' };
/** Families a page has without loading anything, and generic families */
const LOCAL_FONTS = new Set(['inter', 'system-ui', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'arial', 'helvetica', 'georgia', 'times new roman', 'verdana', 'segoe ui', 'roboto', 'menlo', 'consolas']);
/** A font stack that starts with the brand's family, without naming it twice */
const stack = (family, fallback) => (family ? [`"${family}"`, ...fallback.split(',').map(f => f.trim()).filter(f => f.replace(/["']/g, '').toLowerCase() !== family.toLowerCase())].join(', ') : fallback);
const FALLBACK = { body: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif", heading: "'Space Grotesk', Inter, system-ui, sans-serif" };

// ---------------------------------------------------------------------------
// A brand, whatever it came from, in one form
// ---------------------------------------------------------------------------
const text_of = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const family_of = v => {
    const name = typeof v === 'string' ? v : v && typeof v === 'object' ? v.fontFamily : undefined;
    if (typeof name !== 'string') return '';
    const first = name.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return /^[A-Za-z0-9][A-Za-z0-9 -]{0,60}$/.test(first) ? first : '';
};
const dimension = v => {
    const t = typeof v === 'number' ? `${v}px` : typeof v === 'string' ? v.trim() : '';
    const m = /^(\d+(?:\.\d+)?)(px|rem|em)$/.exec(t);
    if (!m) return '';
    const px = parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16);
    return px <= 48 ? t : '48px';
};

/** Flatten nested groups to dot paths: { light: { surface } } gives "light.surface" */
function flatten(tree, prefix, out) {
    for (const key of Object.keys(tree || {})) {
        if (FORBIDDEN.has(key)) continue;
        const v = tree[key], path = prefix ? `${prefix}.${key}` : key;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out); else out[path] = v;
    }
    return out;
}

/**
 * A brand from a DESIGN.md text or a brand.json object, checked: { name, logo, logo_dark, mode, colors (by mode), fonts, rounded, warnings }.
 * `base` resolves relative logo addresses; `data_only` accepts only data: URLs for the logo (where the page reaches no network).
 */
function read_brand(source, { base, data_only } = {}) {
    const warnings = [];
    let tokens, from;
    if (typeof source === 'string') {
        const trimmed = source.trim();
        if (trimmed.startsWith('{')) {
            try { tokens = JSON.parse(trimmed); from = 'brand.json'; } catch (error) { return { warnings: [`The brand is neither a DESIGN.md nor JSON: ${error.message}`], invalid: true }; }
        } else { const read = parse_design_md(source); tokens = read.tokens; warnings.push(...read.errors); from = 'DESIGN.md'; }
    } else if (source && typeof source === 'object' && !Array.isArray(source)) { tokens = source; from = 'brand.json'; }
    else return { warnings: ['The brand must be a DESIGN.md text or a brand.json object.'], invalid: true };

    const tree = tokens || {};
    const colors = { top: {}, light: {}, dark: {} };
    const flat = flatten(tree.colors && typeof tree.colors === 'object' ? tree.colors : {}, '', {});
    for (const [path, raw] of Object.entries(flat)) {
        const value = resolve(tree, raw);
        const c = parse_color(value);
        if (!c) {
            warnings.push(raw === null || raw === undefined ? `colors.${path} is empty: in YAML a # starts a comment, so write a hex colour in quotes ("#0E7C66"); it is left out.`
                : `colors.${path}: ${JSON.stringify(String(value ?? raw)).slice(0, 60)} is not a colour these views read (hex, rgb() or hsl()); it is left out.`);
            continue;
        }
        const [group, ...rest] = path.split('.');
        if ((group === 'light' || group === 'dark') && rest.length === 1) colors[group][rest[0]] = c;
        else if (!path.includes('.')) colors.top[path] = c;
    }
    if (!colors.top.primary && !colors.light.primary && !colors.dark.primary && tree.colors) warnings.push('colors.primary is missing: the views keep AWA\'s accent.');

    // Typography: the heading font from headline, display, title or h1 tokens, the body font from body tokens
    const fonts = {};
    const typo = tree.typography && typeof tree.typography === 'object' ? tree.typography : {};
    if (from === 'brand.json' && (typeof typo.heading === 'string' || typeof typo.body === 'string' || typo.heading?.fontFamily || typo.body?.fontFamily)) {
        fonts.heading = family_of(resolve(tree, typo.heading)); fonts.body = family_of(resolve(tree, typo.body));
    }
    const levels = Object.entries(flatten(typo, '', {})).filter(([p]) => p.endsWith('.fontFamily')).map(([p, v]) => [p.slice(0, -'.fontFamily'.length).split('.').pop(), family_of(resolve(tree, v))]);
    if (!fonts.heading) fonts.heading = (levels.find(([n, f]) => f && /^(headline|display|title|h[1-3]\b|heading)/.test(n)) || [])[1] || '';
    if (!fonts.body) fonts.body = (levels.find(([n, f]) => f && /^body/.test(n)) || [])[1] || '';
    for (const [k, v] of Object.entries(typo)) if (k !== 'heading' && k !== 'body' && typeof v === 'string' && from === 'brand.json') warnings.push(`typography.${k} is not read.`);

    const rounded = {};
    const rtree = tree.rounded && typeof tree.rounded === 'object' ? tree.rounded : {};
    for (const level of ['sm', 'md', 'lg']) {
        if (rtree[level] === undefined) continue;
        const d = dimension(resolve(tree, rtree[level]));
        if (d) rounded[level] = d; else warnings.push(`rounded.${level}: ${JSON.stringify(String(rtree[level])).slice(0, 40)} is not a dimension in px, rem or em; it is left out.`);
    }

    const logo = address(tree.logo, { base, data_only }, warnings, 'logo'), logo_dark = address(tree.logo_dark ?? tree['logo-dark'], { base, data_only }, warnings, 'logo_dark');
    const mode = ['dark', 'light', 'auto'].includes(tree.mode) ? tree.mode : '';
    if (tree.mode !== undefined && !mode) warnings.push(`mode: ${JSON.stringify(String(tree.mode)).slice(0, 30)} is not dark, light or auto; it is left out.`);
    return { name: text_of(tree.name, 60), description: text_of(tree.description, 300), from, logo, logo_dark, mode, colors, fonts, rounded, warnings };
}

/** A logo's address: a data: image, or an http(s) address (resolved against the brand's own address). Anything else is refused */
function address(value, { base, data_only }, warnings, token) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') { warnings.push(`${token} is not an address; it is left out.`); return ''; }
    const v = value.trim();
    if (/^data:image\/(png|jpeg|gif|webp|svg\+xml)(;[a-z0-9=.+-]+)*,/i.test(v)) return v.length <= 400000 ? v : (warnings.push(`${token} is larger than 400 kB; it is left out.`), '');
    if (data_only) { warnings.push(`${token} must be a data: URL here, where the view reaches no network; it is left out.`); return ''; }
    let url;
    try { url = new URL(v, base || (typeof location !== 'undefined' ? location.href : undefined)); } catch { url = null; }
    if (!url || !/^https?:$/.test(url.protocol)) { warnings.push(`${token}: only an https or http address, or a data: image, is shown; it is left out.`); return ''; }
    return url.href;
}

// ---------------------------------------------------------------------------
// The palette a view draws with
// ---------------------------------------------------------------------------
/** Which mode a brand is shown in: its own, else that of its surface, else the reader's preference */
function mode_of(brand, prefers_dark) {
    if (brand.mode === 'dark' || brand.mode === 'light') return brand.mode;
    const surface = brand.colors.top.surface;
    if (brand.mode !== 'auto' && surface) return luminance(surface) < 0.18 ? 'dark' : 'light';
    const has = m => Object.keys(brand.colors[m]).length > 0;
    if (brand.mode !== 'auto' && has('light') !== has('dark')) return has('dark') ? 'dark' : 'light';
    return prefers_dark ? 'dark' : 'light';
}

/**
 * The palette for a brand: every colour of the views, as CSS values, with the problems found and fixed.
 * Returns { mode, vars: { name: value }, fonts: { heading, body }, warnings }.
 */
function palette(brand, { prefers_dark = true } = {}) {
    const warnings = [];
    const mode = mode_of(brand, prefers_dark), dark = mode === 'dark';
    const defaults = AWA.colors[mode], given = { ...brand.colors.top, ...brand.colors[mode] };
    const tok = name => given[name] || null, def = name => parse_color(defaults[name]);
    const opaque = c => (c && c.a < 1 ? over(c, dark ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }) : c);
    const white = { r: 255, g: 255, b: 255, a: 1 }, black = { r: 0, g: 0, b: 0, a: 1 };

    // Surfaces: the brand's, else derived from its surface, else AWA's
    const bg = opaque(tok('surface') || tok('neutral') || tok('background') || def('surface'));
    const brand_surface = !!(tok('surface') || tok('neutral') || tok('background'));
    let text = opaque(tok('on-surface') || tok('on-background') || (brand_surface ? (contrast(white, bg) > contrast(black, bg) ? mix(white, bg, 0.03) : mix(black, bg, 0.12)) : def('on-surface')));
    if (contrast(text, bg) < 4.5) {
        warnings.push(`colors.on-surface reads at ${contrast(text, bg).toFixed(2)}:1 on colors.surface, under 4.5:1; its lightness is adjusted.`);
        text = reach(text, [bg], 4.5);
    }
    const lift = (amount) => (dark ? mix(bg, text, amount) : mix(bg, white, Math.min(1, amount * 10)));
    const panel = opaque(tok('surface-container-low') || (brand_surface ? lift(0.04) : def('surface-container-low')));
    const card = opaque(tok('surface-container') || (brand_surface ? (dark ? mix(bg, text, 0.1) : white) : def('surface-container')));
    const raised = opaque(tok('surface-container-high') || (dark ? mix(card, text, 0.07) : mix(card, text, 0.06)));
    const surfaces = [bg, panel, card];
    const soft = reach(opaque(tok('on-surface-variant') || mix(text, bg, 0.16)), surfaces, 4.5);
    const mute = reach(mix(text, bg, 0.36), surfaces, 4.5);
    const faint = reach(mix(text, bg, 0.55), [bg, panel], 3);
    const stroke = opaque(tok('outline') || mix(text, bg, dark ? 0.7 : 0.62));
    const edge = mix(text, bg, dark ? 0.8 : 0.72);

    // The accent: the brand's primary, as a mark (3:1) on the page and the panels, as text (4.5:1), and as a fill under on-primary
    let accent = opaque(tok('primary') || parse_color(AWA.colors.primary));
    if (!tok('primary') && !dark) accent = reach(accent, [bg, panel], 3);
    if (contrast(accent, bg) < 3 || contrast(accent, panel) < 3) {
        if (tok('primary')) warnings.push(`colors.primary (${hex(accent)}) reads at ${contrast(accent, bg).toFixed(2)}:1 on the page, under 3:1 for a mark; its lightness is adjusted.`);
        accent = reach(accent, [bg, panel], 3);
    }
    const accent_text = reach(accent, [bg, panel, card], 4.5);
    const on_given = tok('on-primary');
    const on_accent = on_given ? opaque(on_given) : contrast(white, accent) >= contrast(black, accent) ? white : black;
    // A button's fill: the primary, darkened or lightened until on-primary reads on it
    const fill = reach(accent, [on_accent], 4.5);

    // The colours that carry meaning keep their hue: a mark reads at 3:1, a word at 4.5:1
    const states = {};
    for (const [name, value] of Object.entries(STATES)) {
        const base = parse_color(value);
        states[name] = reach(base, [bg, panel, card], 3);
        states[`${name}-ink`] = reach(base, [bg, panel, card], 4.5);
    }

    const heading = brand.fonts.heading, body = brand.fonts.body;
    const vars = {
        '--bg': hex(bg), '--panel': hex(panel), '--card': hex(card), '--raised': hex(raised),
        '--text': hex(text), '--soft': hex(soft), '--mute': hex(mute), '--faint': hex(faint), '--stroke': hex(stroke), '--edge': hex(edge),
        '--line': css_rgba(text, dark ? 0.08 : 0.12), '--line-strong': css_rgba(text, dark ? 0.16 : 0.22), '--hover': css_rgba(text, dark ? 0.07 : 0.05), '--wash': css_rgba(text, dark ? 0.04 : 0.03),
        '--accent': hex(accent), '--accent-text': hex(accent_text), '--accent-fill': hex(fill), '--on-accent': hex(on_accent), '--focus': hex(accent),
        '--accent-soft': hex(mix(accent, card, dark ? 0.62 : 0.72)),
        '--shadow': dark ? 'rgba(0,0,0,.55)' : 'rgba(15,23,42,.16)',
        '--font-display': stack(heading, FALLBACK.heading),
        '--font-body': stack(body, FALLBACK.body),
        '--radius': brand.rounded.md || brand.rounded.sm || AWA.rounded.md,
        '--radius-lg': brand.rounded.lg || (brand.rounded.md ? `calc(${brand.rounded.md} * 1.5)` : AWA.rounded.lg),
    };
    for (const [name, c] of Object.entries(states)) vars[`--${name}`] = hex(c);
    return { mode, vars, fonts: { heading, body }, warnings };
}

// ---------------------------------------------------------------------------
// In a page
// ---------------------------------------------------------------------------
const STYLE = `.awa-brand{display:inline-flex;align-items:center;gap:10px;min-width:0;max-width:340px}
.awa-brand img{height:28px;width:auto;max-width:120px;object-fit:contain;flex:none;display:block}
.awa-brand-t{display:flex;flex-direction:column;min-width:0;line-height:1.15}
.awa-brand-n{font-family:var(--font-display,inherit);font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.awa-brand-p{font-size:10px;letter-spacing:.04em;color:var(--mute,inherit);white-space:nowrap}`;

/**
 * Put a brand on the page: its palette as CSS custom properties on <html> (each through `map`, a view's own names),
 * its fonts, and its logo and name in `header` with "powered by AWA". Returns the palette.
 * options: { map: { '--view-name': '--generic-name' }, header: Element, network: true, prefers_dark }
 */
function apply(brand, { map = {}, header, network = true, prefers_dark, doc = document } = {}) {
    const dark_query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const look = palette(brand, { prefers_dark: prefers_dark ?? (dark_query ? dark_query.matches : true) });
    for (const w of [...brand.warnings, ...look.warnings]) console.warn(`Brand${brand.name ? ` "${brand.name}"` : ''}: ${w}`);
    const html = doc.documentElement;
    for (const [name, value] of Object.entries(look.vars)) html.style.setProperty(name, value);
    for (const [own, generic] of Object.entries(map)) if (look.vars[generic] !== undefined) html.style.setProperty(own, look.vars[generic]);
    html.dataset.theme = look.mode; html.dataset.brand = brand.name || 'brand';
    html.style.colorScheme = look.mode;
    if (!doc.getElementById('awa-brand-style')) { const s = doc.createElement('style'); s.id = 'awa-brand-style'; s.textContent = STYLE; doc.head.appendChild(s); }
    for (const family of [look.fonts.heading, look.fonts.body]) {
        if (!family || LOCAL_FONTS.has(family.toLowerCase()) || !network) continue;
        if (doc.fonts && doc.fonts.check && (() => { try { return doc.fonts.check(`12px "${family}"`) && [...doc.fonts].some(f => f.family.replace(/"/g, '') === family); } catch { return false; } })()) continue;
        const id = 'awa-font-' + family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (doc.getElementById(id)) continue;
        const link = doc.createElement('link'); link.id = id; link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;
        doc.head.appendChild(link);
    }
    if (header) mount(header, brand, look.mode, doc);
    return look;
}

/** The brand's mark in a header: its logo (as an image, never inlined), its name, and "powered by AWA" */
function mount(header, brand, mode, doc = document) {
    header.textContent = '';
    header.classList.add('awa-brand');
    const logo = mode === 'dark' && brand.logo_dark ? brand.logo_dark : brand.logo;
    if (logo) {
        const img = doc.createElement('img'); img.alt = brand.name ? `${brand.name} logo` : 'Logo'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        img.onerror = () => { img.remove(); console.warn(`Brand: the logo ${logo.slice(0, 80)} could not be shown.`); };
        img.src = logo; header.appendChild(img);
    }
    const t = doc.createElement('span'); t.className = 'awa-brand-t';
    const n = doc.createElement('span'); n.className = 'awa-brand-n'; n.textContent = brand.name || 'AWA';
    const p = doc.createElement('span'); p.className = 'awa-brand-p'; p.textContent = 'powered by AWA';
    t.append(n, p); header.appendChild(t);
    header.title = brand.name ? `${brand.name}, powered by AWA` : 'AWA';
}

/** Fetch a brand: a DESIGN.md or a brand.json at an address. Resolves to a brand, or null with a warning */
async function load(url, options = {}) {
    let text;
    try {
        const response = await fetch(url, { headers: { accept: 'text/markdown, application/json, text/plain' } });
        if (!response.ok) throw new Error(`it answered ${response.status}`);
        text = await response.text();
    } catch (error) { console.warn(`Brand: cannot load ${url}: ${error.message}`); return null; }
    const brand = read_brand(text, { ...options, base: new URL(url, typeof location !== 'undefined' ? location.href : undefined).href });
    if (brand.invalid) { for (const w of brand.warnings) console.warn(`Brand: ${w}`); return null; }
    return brand;
}

/**
 * The brand a page is asked for: ?brand=<url>, else the options' "brand" (an address, relative to the options file, or a brand.json object).
 * Resolves to a brand or null.
 */
async function from_page({ options, options_url, search = typeof location !== 'undefined' ? location.search : '' } = {}) {
    const asked = new URLSearchParams(search).get('brand');
    if (asked) return load(asked);
    const b = options && options.brand;
    if (typeof b === 'string' && b) return load(new URL(b, options_url || location.href).href);
    if (b && typeof b === 'object') { const brand = read_brand(b, { base: options_url }); return brand.invalid ? null : brand; }
    return null;
}

const api = { parse_yaml, parse_design_md, parse_color, contrast, luminance, reach, hex, read_brand, palette, apply, mount, load, from_page, AWA, STATES, YamlError };
root.AWA_brand = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
