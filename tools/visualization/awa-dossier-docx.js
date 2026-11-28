// The dossier as a Word document (DOCX, Office Open XML), written directly with no dependency: real Heading 1 to 3
// styles, the brand's fonts and colours where Word allows, charts as images with alt text beside their data tables,
// table header rows that repeat, the document's language and title set, a reading order that follows the text, the
// customers' voices in a style of their own, page headers and page numbers. Node only (it uses zlib).
//
//   const { render } = require('./awa-dossier-docx.js');
//   const bytes = render(model, { theme, images: { cover: { png, width, height, alt } } });   // a Buffer
//
// The same model and images give the same bytes: the archive's dates and the document's dates are fixed to the record's
// as_of, and nothing random is written.
(function (root) {
'use strict';

const zlib = typeof require === 'function' ? require('zlib') : null;
const x = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const hex = c => String(c || '#000000').replace('#', '').toUpperCase();
const DAY = 86400000, H = 3600000;
const fmtH = ms => ms === null || ms === undefined ? '' : ms === 0 ? '0' : ms < H ? `${Math.round(ms / 60000)} min` : ms < 48 * H ? `${String(Math.round(ms / H * 10) / 10).replace(/\.0$/, '')} h` : `${(ms / DAY).toFixed(1)} d`;
const days = p => (p ? String(p).replace(/^P(\d+)D$/, '$1 days').replace(/^P/, '') : 'no limit');
const METHOD = { replay: 'Replay', measured: 'Measured', estimate: 'Estimate', pilot: 'Pilot', 'replay-live': 'Replay, not run' };

// ---------------------------------------------------------------- a zip archive with fixed dates
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
    const locals = [], centrals = []; let offset = 0;
    const dosTime = 0, dosDate = (0 << 9) | (1 << 5) | 1;              // 1980-01-01 00:00: the same bytes every time
    for (const [name, data] of files) {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), comp = zlib.deflateRawSync(raw, { level: 9 }), nm = Buffer.from(name, 'utf8'), crc = crc32(raw);
        const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
        locals.push(lh, nm, comp);
        const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
        centrals.push(ch, nm);
        offset += 30 + nm.length + comp.length;
    }
    const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------- WordprocessingML
const run = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
const para = (inner, style, ppr = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${ppr}</w:pPr>${inner}</w:p>`;
const p = (text, style) => para(run(text), style);
const h = (level, text) => p(text, `Heading${level}`);
const bold = text => run(text, '<w:b/>');
const refRun = r => run(` ${r.run}·${r.seq}`, '<w:rStyle w:val="Reference"/>');
function table(head, rows, widths) {
    const total = 9360, ws = widths || head.map(() => Math.floor(total / head.length));
    const cell = (t, i, th) => `<w:tc><w:tcPr><w:tcW w:w="${ws[i]}" w:type="dxa"/></w:tcPr>${para(th ? bold(t) : run(t), th ? 'TableHeading' : 'TableText')}</w:tc>`;
    return `<w:tbl><w:tblPr><w:tblStyle w:val="DossierTable"/><w:tblW w:w="${total}" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${ws.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
        + `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${head.map((t, i) => cell(t, i, true)).join('')}</w:tr>`
        + rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((t, i) => cell(t, i, false)).join('')}</w:tr>`).join('') + '</w:tbl>' + p('', 'Spacer');
}
let pic = 0;
function image(rid, img) {
    pic++;
    const cx = Math.round(Math.min(6.5, img.width / 110) * 914400), cy = Math.round(cx * img.height / img.width);
    return para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pic}" name="Figure ${pic}" descr="${x(img.alt)}" title="${x(img.title || '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${pic}" name="figure-${pic}.png" descr="${x(img.alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, 'Figure');
}

function styles(T) {
    const font = f => `<w:rFonts w:ascii="${x(f)}" w:hAnsi="${x(f)}" w:cs="${x(f)}" w:eastAsia="${x(f)}"/>`;
    const st = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${font(T.body)}<w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="${hex(T.ink2)}"/><w:lang w:val="en-GB" w:eastAsia="en-GB" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${st('Title', 'Title', '<w:spacing w:after="200"/>', `${font(T.display)}<w:b/><w:sz w:val="64"/><w:color w:val="${hex(T.ink)}"/>`)}
${st('Subtitle', 'Subtitle', '<w:spacing w:after="240"/>', `<w:sz w:val="26"/><w:color w:val="${hex(T.ink2)}"/>`)}
${st('Heading1', 'heading 1', '<w:keepNext/><w:pageBreakBefore/><w:spacing w:before="0" w:after="200"/><w:outlineLvl w:val="0"/>', `${font(T.display)}<w:b/><w:sz w:val="44"/><w:color w:val="${hex(T.ink)}"/>`, '<w:next w:val="Normal"/>')}
${st('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/>', `${font(T.display)}<w:b/><w:sz w:val="30"/><w:color w:val="${hex(T.ink)}"/>`, '<w:next w:val="Normal"/>')}
${st('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/>', `<w:b/><w:sz w:val="23"/><w:color w:val="${hex(T.accent)}"/>`, '<w:next w:val="Normal"/>')}
${st('Kicker', 'Kicker', '<w:keepNext/><w:spacing w:after="60"/>', `<w:b/><w:caps/><w:spacing w:val="20"/><w:sz w:val="18"/><w:color w:val="${hex(T.accent)}"/>`)}
${st('Voice', 'Customer voice', '<w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="' + hex(T.accent) + '"/></w:pBdr>', `<w:rFonts w:ascii="Newsreader" w:hAnsi="Newsreader" w:cs="Georgia"/><w:sz w:val="25"/><w:color w:val="${hex(T.ink)}"/>`)}
${st('Quote', 'Quote', '<w:spacing w:before="200" w:after="240"/><w:ind w:left="360"/>', `<w:rFonts w:ascii="Newsreader" w:hAnsi="Newsreader" w:cs="Georgia"/><w:i/><w:sz w:val="40"/><w:color w:val="${hex(T.accent)}"/>`)}
${st('Caption', 'caption', '<w:spacing w:after="200"/>', `<w:sz w:val="18"/><w:color w:val="${hex(T.ink3)}"/>`)}
${st('Figure', 'Figure', '<w:keepNext/><w:spacing w:before="120" w:after="60"/>', '')}
${st('TableHeading', 'Table heading', '<w:spacing w:after="0"/>', `<w:b/><w:sz w:val="17"/><w:color w:val="${hex(T.ink)}"/>`)}
${st('TableText', 'Table text', '<w:spacing w:after="0"/>', '<w:sz w:val="18"/>')}
${st('Spacer', 'Spacer', '<w:spacing w:after="120"/>', '<w:sz w:val="8"/>')}
${st('Header', 'header', '', `<w:caps/><w:sz w:val="16"/><w:color w:val="${hex(T.ink3)}"/>`)}
${st('Footer', 'footer', '', `<w:sz w:val="16"/><w:color w:val="${hex(T.ink3)}"/>`)}
<w:style w:type="character" w:styleId="Reference"><w:name w:val="Journal reference"/><w:rPr><w:rFonts w:ascii="JetBrains Mono" w:hAnsi="JetBrains Mono" w:cs="Consolas"/><w:sz w:val="16"/><w:color w:val="${hex(T.accent)}"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="DossierTable"><w:name w:val="Dossier table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8" w:color="${hex(T.ink)}"/><w:bottom w:val="single" w:sz="4" w:color="${hex(T.rule)}"/><w:insideH w:val="single" w:sz="4" w:color="${hex(T.rule)}"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${hex(T.tint)}"/></w:tcPr></w:tblStylePr></w:style>
</w:styles>`;
}

/** Render the DOCX of a dossier: a Buffer */
function render(m, opts = {}) {
    if (!zlib) throw new Error('awa-dossier-docx.js runs in Node');
    pic = 0;
    const T = opts.theme || require('./awa-dossier.js').AWA_THEME, images = opts.images || {}, client = m.edition === 'client', S = m.meta.subject;
    const rels = [], media = [];
    const img = key => { const im = images[key]; if (!im || !im.png) return ''; const rid = `rIdImg${media.length + 1}`; media.push([`word/media/figure${media.length + 1}.png`, im.png]); rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/figure${media.length}.png"/>`); return image(rid, im); };
    const b = [];
    // the cover
    b.push(p(client ? `Your ${m.meta.journey.toLowerCase()} · client edition` : 'A dossier on one journey and the work behind it · professional edition', 'Kicker'));
    b.push(p(client ? m.meta.client.name : m.meta.journey, 'Title'));
    b.push(p(client ? 'Every step you took with us, in your words and in the record: what you chose, what was checked, and what we recommend for next time.' : m.meta.lead, 'Subtitle'));
    b.push(img('cover'));
    b.push(table(['Scope', 'Period', 'Record as of', 'Edition'], [[client ? `${m.meta.client.name}, one journey` : `1 journey, ${m.meta.workflows.length} workflows, ${m.meta.customers} ${S[1]}, ${m.meta.runs} runs`, m.meta.period.text, `${m.meta.as_of_text}; ${m.meta.run_events.toLocaleString('en-US')} run events, ${m.meta.journey_events} journey events`, client ? 'Client: your journey only' : 'Professional: with cost, agents and every customer']]));
    b.push(p(`${m.meta.source ? `Computed from ${m.meta.source}. ` : ''}${m.meta.fictional} A reference such as J·37 is journey record 37 of the customer in question; 00f7·46 is event 46 of run 000000f7.`, 'Caption'));
    b.push(h(2, 'Contents'));
    b.push(table(['Chapter', 'What it holds'], m.contents.map(c => [`${c.n} ${c.title}`, c.sub]), [3200, 6160]));

    if (!client) {
        b.push(h(1, '01 Summary')); b.push(p(m.summary.headline, 'Subtitle'));
        b.push(h(2, 'The figures, with their counts'));
        b.push(table(['Figure', 'Count or base', 'What it says'], m.summary.figures.map(f => [f.show, f.unit, f.text]), [1800, 1600, 5960]));
        b.push(h(2, 'Three findings'));
        m.summary.findings.forEach((f, i) => { b.push(h(3, `${i + 1}. ${f.title}`)); b.push(p(f.text)); });
        b.push(h(2, 'What to change first'));
        b.push(table(['No.', 'Recommendation', 'Owner', 'Effect known by'], m.summary.first.map(r => [String(r.rank), r.title, r.owner || '', METHOD[r.method] || r.method]), [700, 4660, 2400, 1600]));
    }
    const glance = () => {
        b.push(h(1, client ? '02 Your stages' : '02 The journey at a glance'));
        const st = m.glance.stages;
        b.push(p(`Each row is ${client ? 'your journey' : `one of the ${S[1]}`}, with the time spent in each stage it reached.`));
        b.push(table(['Who', ...st.map(s => s.name)], m.glance.rows.map(r => [`${r.name} (${r.status === 'completed' ? 'reached the end' : r.status === 'abandoned' ? 'left' : 'stuck'}, ${r.days.toFixed(1)} d)`, ...r.cells.map(c => (c ? fmtH(c.ms) || '0' : ''))])));
        if (!client) { b.push(h(2, 'The stages, their owners and their times')); b.push(table(['Stage', 'Owner', 'Given', 'Median', 'Entered', 'Done', 'Stuck', 'Left'], st.map(s => [s.name, s.owner || '', days(s.max), s.median_ms === null || s.median_ms === undefined ? '' : fmtH(s.median_ms), String(s.entered), String(s.completed), String(s.stalled), String(s.abandoned)]))); }
    };
    if (!client) glance();
    b.push(h(1, client ? '01 Your journey' : '03 In their own words'));
    m.personas.forEach(pp => {
        b.push(h(2, `${pp.name}, ${pp.role}`));
        b.push(table(['Fact', 'Value'], pp.facts, [2800, 6560]));
        b.push(h(3, client ? 'In your own words' : 'In their own words'));
        for (const par of pp.story.paragraphs) b.push(para(par.map(s => run(s.text + ' ') + s.refs.map(refRun).join('') + run(' ')).join(''), 'Voice'));
        if (pp.story.quote) b.push(p(`“${pp.story.quote.text}”`, 'Quote'));
        b.push(p(`${pp.name}, as the record tells it: ${pp.story.sentences} sentences, ${pp.story.references} references, written by the dossier’s narrator from the record.`, 'Caption'));
        b.push(h(3, 'What the record says'));
        b.push(table(['Reference', 'When (UTC)', 'What happened'], pp.story.record.map(r => [r.ref, new Date(r.t).toISOString().slice(0, 16).replace('T', ' '), r.text]), [1500, 2000, 5860]));
    });
    if (client) glance();
    if (!client) {
        b.push(h(1, '04 The work behind the journey'));
        b.push(p(`${m.work.workflows.map(w => `${w.name}: ${w.activities.length} activities, ${w.runs} runs`).join('. ')}.`));
        b.push(h(2, 'Who does what')); b.push(img('who'));
        b.push(table(['Actor', 'Defined', 'Completed in the runs'], m.work.defined.map(r => [r.actor, String(r.count), String((m.work.completed.find(c => c.key === r.key) || {}).count || 0)])));
        b.push(h(2, 'The controls')); b.push(table(['Control', 'Defined', 'In the record'], m.work.controls, [2400, 2400, 4560]));
        const A = m.analysis;
        b.push(h(1, '05 Analysis'));
        b.push(h(2, `A · ${S[1][0].toUpperCase() + S[1].slice(1)} entering each stage`)); b.push(img('funnel'));
        b.push(table(['Stage', 'Entered', 'Completed', 'Lost or stuck'], A.funnel.map(s => [s.name, String(s.entered), String(s.completed), String(s.lost)])));
        b.push(h(2, 'B · Time used, of the time each stage is given')); b.push(img('time'));
        b.push(table(['Stage', 'Given', 'Median', 'Share', 'Longest'], A.time.map(s => [s.name, days(s.max), fmtH(s.median_ms) || '0', `${Math.round((s.share || 0) * 100)}%`, `${fmtH(s.longest_ms)}${s.longest_who ? ', ' + s.longest_who : ''}`])));
        b.push(h(2, 'C · Mood at the end of each stage')); b.push(img('mood'));
        b.push(table(['Stage', 'Mean', 'Customers', 'Lowest'], A.mood.map(s => [s.name, s.mean === null ? 'no value' : String(s.mean), String(s.n), s.min === null ? '' : String(s.min)])));
        b.push(p(A.mood_said ? `${A.mood_said} of ${A.mood_changes} changes of mood were said by the customers.` : `Every change of mood was inferred by the journey’s rules (0 of ${A.mood_changes} said).`, 'Caption'));
        if (A.people.length) { b.push(h(2, 'D · Where people step in')); b.push(img('people')); b.push(table(['Customer', 'Step', 'Who', 'Waited', 'Refused first'], A.people.map(x2 => [x2.name, x2.step, x2.who, `${((x2.waited_ms || 0) / H).toFixed(1)} h`, x2.refused ? `${x2.refused.who}, ${String(x2.refused.reason).replace(/_/g, ' ')}` : '']))); }
        if (A.cost) { b.push(h(2, 'E · Where the model tokens go')); b.push(img('tokens')); b.push(table(['Activity', 'Tokens', 'Share'], A.cost.tokens.map(t => [t.activity, t.tokens.toLocaleString('en-US'), `${(t.tokens / A.cost.tokens_total * 100).toFixed(1)}%`]))); b.push(p(`Models and tools cost ${A.cost.total.toFixed(2)} ${m.meta.currency || ''} in all, ${A.cost.per_journey.toFixed(3)} per journey. People’s time is not costed.`, 'Caption')); }
        if (A.trust && A.trust.length) { b.push(h(2, 'F · Trust events')); b.push(table(['By', 'What', 'Rule', 'For', 'Record'], A.trust.map(t => [t.by, t.what, t.rule, t.for, t.refs.join(' ')]))); }
    }
    b.push(h(1, client ? '03 For next time' : '06 Recommendations'));
    b.push(img('recs'));
    b.push(table(['No.', 'Recommendation', 'Kind', 'Owner', 'Impact', 'Effort', 'Effect'], m.recommendations.list.map(r => [String(r.rank), r.title, r.kind, r.owner || '', r.impact.toFixed(2), String(r.effort), METHOD[r.method] || r.method]), [600, 3400, 1100, 1800, 800, 760, 900]));
    for (const r of m.recommendations.list) {
        b.push(h(2, `${r.rank}. ${r.title}`));
        b.push(p(`${r.kind} · ${r.stage} · ${r.owner || 'no owner named'} · rules ${r.rules.join(', ')} · impact ${r.impact}, effort ${r.effort}`, 'Caption'));
        b.push(p(r.finding)); if (r.action) b.push(para(bold('Action. ') + run(r.action))); b.push(para(bold(`Expected effect · ${METHOD[r.method] || r.method}. `) + run(r.effect)));
    }
    if (!m.recommendations.list.length) b.push(p('No recommendation: every rule was checked and none fired.'));
    b.push(h(1, client ? '04 Your record and these words' : '07 Appendix'));
    if (m.compliance) {
        b.push(h(2, 'Evidence, not a certification')); b.push(p(client ? 'The organisation keeps an evidence report of the whole system; a client edition shows only your own journey.' : m.compliance.notice));
        if (!client) b.push(table(['Provision', 'What it asks for', 'Report part', 'In this record'], m.compliance.rows.map(r => [r.provision, r.asks, r.parts.join(', '), r.holds]), [1300, 3400, 1700, 2960]));
    }
    b.push(h(2, 'Glossary')); b.push(table(['Term', 'Meaning', 'Source'], m.glossary.map(t => [t.term, t.definition, /^https?:/.test(t.see || '') ? t.see.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : t.see || '']), [2000, 5760, 1600]));
    if (m.recommendations.rules.length) { b.push(h(2, client ? 'The rules behind these recommendations' : 'The rules behind the recommendations')); b.push(table(['Rule', 'Fires when', 'Threshold'], m.recommendations.rules.map(r => [r.id, r.name, r.threshold]), [900, 5260, 3200])); }
    b.push(h(2, 'Method')); for (const t of m.method) b.push(p(t));
    b.push(h(2, 'Sources')); b.push(p(`${m.sources.join('; ')}. As of ${m.meta.as_of_text} UTC.`));

    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${b.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1270" w:bottom="1300" w:left="1270" w:header="560" w:footer="560" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${NS}>${para(run(`${m.meta.journey} · dossier · ${client ? 'client' : 'professional'} edition`), 'Header')}</w:hdr>`;
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS}>${para(run(`Period ${m.meta.period.text} · page `) + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' + run(' of ') + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>', 'Footer')}</w:ftr>`;
    const when = new Date(m.meta.as_of).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const files = [
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
        ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
        ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(m.meta.title)}</dc:title><dc:subject>${x(`${m.meta.journey}, ${m.edition} edition`)}</dc:subject><dc:creator>${x(T.name)}</dc:creator><dc:description>${x(m.meta.lead)}</dc:description><dc:language>en-GB</dc:language><cp:keywords>AWA, dossier, journey, recommendations</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`],
        ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AWA dossier</Application><DocSecurity>0</DocSecurity></Properties>`],
        ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${rels.join('')}</Relationships>`],
        ['word/document.xml', body],
        ['word/styles.xml', styles(T)],
        ['word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/><w:themeFontLang w:val="en-GB"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`],
        ['word/header1.xml', header],
        ['word/footer1.xml', footer],
        ...media,
    ];
    return zip(files);
}

const api = { render, zip, crc32 };
root.AWA_DOSSIER_DOCX = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
