// Read furniture sizes from whatever people paste: a size ("72" x 40" x 30""), the
// specs section copied from a store page, text from the "Grab furniture size" bookmark,
// or a product link (name and type only; stores don't let other sites read their pages).
// Pure functions, no DOM.
import { CATALOG_BY_KIND } from './catalog.js';

const IN = 0.0254;
const UNIT = {
  mm: 0.001, millimeter: 0.001, millimeters: 0.001, mmt: 0.001,
  cm: 0.01, centimeter: 0.01, centimeters: 0.01, cmt: 0.01,
  m: 1, meter: 1, meters: 1, metre: 1, metres: 1, mtr: 1,
  in: IN, inch: IN, inches: IN, '"': IN, inh: IN,
  ft: 0.3048, feet: 0.3048, foot: 0.3048, "'": 0.3048, fot: 0.3048,
};

// keywords → catalog kind, checked in order (more specific first)
const KINDS = [
  [/fire\s*pit|fire\s*table|fire\s*bowl|firepit/, 'firepit'],
  [/\bgrill|bbq|barbecue|griddle|smoker|kamado/, 'grill'],
  [/hot\s*tub|\bspa\b|jacuzzi/, 'hottub'],
  [/swing\s*set|play\s*set|playset|jungle\s*gym|climbing\s*frame|play\s*structure/, 'playset'],
  [/trampoline/, 'trampoline'],
  [/sand\s*box|sandbox|sand\s*pit/, 'sandbox'],
  [/cornhole|bean\s*bag\s*toss/, 'cornhole'],
  [/hammock/, 'hammock'],
  [/chaise|lounger|sun\s*lounge|sunbed/, 'chaise'],
  [/adirondack/, 'adirondack'],
  [/sectional|sofa|loveseat|conversation|deep\s*seating|lounge\s*set|couch/, 'sofa'],
  [/bistro|balcony\s*set|cafe\s*set/, 'bistro'],
  [/dining|table\s*set|patio\s*table|picnic/, 'dining6'],
  [/bench/, 'bench'],
  [/raised\s*(garden\s*)?bed|garden\s*bed|planter\s*box|vegetable\s*bed/, 'gardenbed'],
  [/planter|\bpot\b|urn/, 'planter'],
  [/\bshed\b|storage\s*(building|house|unit)|outdoor\s*storage|deck\s*box/, 'shed'],
];

export function guessKind(text, w, d) {
  const t = text.toLowerCase();
  for (const [re, kind] of KINDS) {
    if (!re.test(t)) continue;
    if (kind === 'dining6' && w && d && w * d < 1.8) return 'bistro';
    return kind;
  }
  return null;
}

/** Tidy the many ways stores write primes, multiplication signs and spaces. */
export function normalize(s) {
  return String(s)
    .replace(/[   ]/g, ' ')
    .replace(/[″”“]|''/g, '"')
    .replace(/[′’‘`]/g, "'")
    .replace(/[×✕✖]/g, 'x')
    .replace(/(\d)\s*-\s*(\d+\/\d+)/g, '$1 $2')       // 29-1/2 → 29 1/2
    .replace(/(\d),(\d{3})\b/g, '$1$2');                // 1,200 mm
}

const NUM = String.raw`(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\.\d+)`;
const UNIT_RE = String.raw`(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|met(?:er|re)s?|m(?![a-z])|in(?:ch(?:es)?)?\.?|"|ft\.?|feet|foot|'|inh|cmt|mmt|fot|mtr)?`;
// 6' 4" | 6 ft 4 in | 6'
const FTIN = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot)\s*(?:(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)\s*(?:"|in(?:ch(?:es)?)?\.?)?)?`, 'gi');
const PLAIN = new RegExp(NUM + String.raw`\s*` + UNIT_RE, 'gi');

const toNum = (s) => {
  s = s.trim();
  const m = s.match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/);
  if (!m) return parseFloat(s);
  return (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? parseInt(m[2], 10) / parseInt(m[3], 10) : 0);
};

const LABELS = [
  ['w', /^(w|wide|width)\b/i, /\b(w|wide|width)\s*[:=]?\s*$/i],
  ['d', /^(d|deep|depth)\b/i, /\b(d|deep|depth)\s*[:=]?\s*$/i],
  ['l', /^(l|long|length)\b/i, /\b(l|long|length)\s*[:=]?\s*$/i],
  ['h', /^(h|high|height|tall)\b/i, /\b(h|high|height|tall)\s*[:=]?\s*$/i],
  ['dia', /^(dia\.?|diam\.?|diameter|round)\b/i, /\b(dia\.?|diam\.?|diameter|ø)\s*[:=]?\s*$/i],
];

/** Find measurements in one line: [{ v (meters or null if unitless), raw, unit, label }]. */
function tokens(line) {
  const out = [];
  const taken = [];
  for (const m of line.matchAll(FTIN)) {
    const v = parseFloat(m[1]) * 0.3048 + (m[2] ? toNum(m[2]) * IN : 0);
    out.push({ start: m.index, end: m.index + m[0].length, v, unit: 'ft' });
    taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of line.matchAll(PLAIN)) {
    const s = m.index, e = s + m[0].length;
    if (taken.some(([a, b]) => s < b && e > a)) continue;
    // skip "6-piece", "4 seats", years, model numbers glued to letters
    const after = line.slice(e, e + 8);
    if (/^\s*-?\s*(pc|pcs|piece|seat|seater|person|people|lb|lbs|kg|year|yr|gal|btu|%)/i.test(after)) continue;
    if (/[a-z]$/i.test(line.slice(Math.max(0, s - 1), s))) continue;
    const unit = (m[2] || '').toLowerCase().replace(/\.$/, '');
    const key = unit.startsWith('in') && unit !== 'inh' ? 'in' : unit.replace(/s$/, '').replace('metre', 'meter').replace('centimetre', 'centimeter').replace('millimetre', 'millimeter');
    const f = UNIT[key] ?? UNIT[unit] ?? null;
    const n = toNum(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push({ start: s, end: e, raw: n, unit: f ? key : null, f, v: f ? n * f : null });
  }
  out.sort((a, b) => a.start - b.start);
  for (const t of out) {
    const after = line.slice(t.end, t.end + 10).replace(/^[\s.)]+/, '');
    const before = line.slice(Math.max(0, t.start - 16), t.start);
    for (const [name, post, pre] of LABELS) {
      if (post.test(after) || pre.test(before)) { t.label = name; break; }
    }
  }
  return out;
}

const BAD = /(package|packag|carton|\bbox\b|shipping|ship\s*dim|seat\s*(height|depth|width)|arm\s*(height|rest)|back\s*height|leg\s*height|cushion|thickness|weight|clearance|opening|umbrella\s*hole|cord|hose)/i;
const GOOD = /(overall|assembled|product\s*dim|dimensions|measurements|size|footprint|exterior)/i;

/** Measurements from one line → { w, d, h, round, n, score } in meters, or null. */
function readLine(line, defUnit) {
  let ts = tokens(line);
  if (!ts.length) return null;
  // a trailing unit applies to unitless numbers: "72 x 40 x 30 in"
  const lastUnit = [...ts].reverse().find((t) => t.f);
  for (const t of ts) if (t.v === null) { t.f = lastUnit ? lastUnit.f : defUnit; t.v = t.raw * t.f; }
  ts = ts.filter((t) => t.v > 0.05 && t.v < 30);
  if (!ts.length) return null;
  // an order key like (L x W x H) labels unlabeled numbers
  const order = line.match(/\(?\b([lwdh])\s*x\s*([lwdh])(?:\s*x\s*([lwdh]))?\b\)?/i);
  if (order) {
    const keys = order.slice(1).filter(Boolean).map((k) => k.toLowerCase());
    const unl = ts.filter((t) => !t.label);
    if (unl.length >= keys.length - 0) unl.slice(0, keys.length).forEach((t, i) => { t.label = keys[i]; });
  }
  const by = {};
  for (const t of ts) if (t.label && by[t.label] === undefined) by[t.label] = t.v;
  const rest = ts.filter((t) => !t.label).map((t) => t.v);
  let w, d, h, round = false;
  if (by.dia !== undefined) { w = d = by.dia; round = true; h = by.h ?? rest[0]; }
  else {
    w = by.w; d = by.d ?? by.l; h = by.h;
    if (by.l !== undefined && by.w !== undefined && by.d === undefined) { w = by.l; d = by.w; }
    for (const v of rest) {
      if (w === undefined) w = v;
      else if (d === undefined) d = v;
      else if (h === undefined) h = v;
    }
  }
  const n = [w, d, h].filter((x) => x !== undefined).length;
  let score = n * 2 + (round ? 3 : 0);
  if (GOOD.test(line)) score += 3;
  if (BAD.test(line)) score -= 8;
  if (/\bx\b/i.test(line)) score += 1;
  return { w, d, h, round, n, score, labeled: Object.keys(by) };
}

function slugName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const slug = parts.filter((p) => /[a-z]{3,}/i.test(p) && !/^(p|dp|product|products|ip|item|shop|en|us|c)$/i.test(p))
      .sort((a, b) => (b.match(/-/g) || []).length - (a.match(/-/g) || []).length)[0];
    if (!slug) return { name: u.hostname.replace(/^www\./, ''), host: u.hostname };
    const words = slug.replace(/\.(html?|aspx?|php)$/i, '').split(/[-_+]+/)
      .filter((w) => w && !/^[a-z]{0,3}\d{5,}[a-z]*$/i.test(w));
    const name = words.join(' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 70);
    return { name, host: u.hostname };
  } catch { return { name: '', host: '' }; }
}

/**
 * Parse pasted text. Returns
 * { ok, name, w, d, h, round, kind, url, from: 'size'|'specs'|'bookmark'|'link', notes: [] }
 * with lengths in meters. `ok` is false when no footprint could be found.
 */
export function parseProduct(input, { units = 'imperial' } = {}) {
  let text = normalize(input || '').trim();
  const notes = [];
  let name = '', url = '', from = 'size';
  // text from the bookmark: "YARDMAKER {json}"
  const bm = text.match(/YARDMAKER\s+(\{[\s\S]*\})/);
  if (bm) {
    try {
      const o = JSON.parse(bm[1]);
      name = (o.name || '').trim();
      url = o.url || '';
      text = normalize([...(o.lines || [])].join('\n'));
      from = 'bookmark';
    } catch { /* fall through and read it as text */ }
  }
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    url ||= urlMatch[0];
    text = text.replace(urlMatch[0], ' ');
  }
  const metricHint = /\b(cm|mm|centimet|millimet)/i.test(text);
  // "Product Width (in.) 84" → "Product Width 84 in"; a label alone on a line takes the next line
  const raw = text.split(/\n|;|\|/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/\((in|inches|cm|mm|ft|m)\.?\)\s*:?\s*([\d.]+(?:\s+\d+\/\d+)?)(?![\d.\/])(?!\s*(?:in|cm|mm|ft|m|"|'))/i, '$2 $1')
      .replace(/\s*\((in|inches|cm|mm|ft|m)\.?\)/i, ''));
  const lines = [];
  const LABEL_ONLY = /^(overall |assembled |product |item )?(width|depth|height|length|diameter|dimensions?|measurements|size)\s*:?$/i;
  for (let i = 0; i < raw.length; i++) {
    if (LABEL_ONLY.test(raw[i]) && raw[i + 1] && /\d/.test(raw[i + 1])) { lines.push(raw[i].replace(/:$/, '') + ': ' + raw[i + 1]); i++; }
    else lines.push(raw[i]);
  }
  const defUnit = metricHint ? UNIT.cm : units === 'metric' ? UNIT.cm : IN;

  // best single line
  let best = null;
  for (const l of lines) {
    const r = readLine(l, defUnit);
    if (r && r.n >= 1 && (!best || r.score > best.score)) best = { ...r, line: l };
  }
  // spec tables: one labeled value per line ("Width: 72 in" / "Depth: 40 in")
  const merged = {};
  for (const l of lines) {
    if (BAD.test(l)) continue;
    const r = readLine(l, defUnit);
    if (!r || r.n !== 1 || !r.labeled.length) continue;
    const key = r.labeled[0];
    const v = r.round ? r.w : key === 'h' ? r.h : r.w ?? r.d;
    if (merged[key] === undefined && v !== undefined) merged[key] = v;
  }
  const mergedN = Object.keys(merged).length;
  if (mergedN >= 2 && (!best || best.n < 2 || mergedN > best.n)) {
    best = {
      w: merged.dia ?? (merged.l !== undefined && merged.w !== undefined && merged.d === undefined ? merged.l : merged.w),
      d: merged.dia ?? merged.d ?? (merged.l !== undefined && merged.w !== undefined ? merged.w : merged.l),
      h: merged.h, round: merged.dia !== undefined, n: mergedN, score: 10,
    };
    from = from === 'bookmark' ? from : 'specs';
  } else if (best && lines.length > 1 && from !== 'bookmark') from = 'specs';
  // fill a missing height (or depth) from a spec-table line
  if (best && mergedN) {
    if (best.h === undefined && merged.h !== undefined) { best.h = merged.h; best.n++; }
    if (best.d === undefined && !best.round && (merged.d ?? merged.l) !== undefined) { best.d = merged.d ?? merged.l; best.n++; }
  }

  // product name: bookmark → first wordy line → link
  if (!name) {
    const wordy = lines.find((l) => /[a-z]{3,}/i.test(l) && l.length < 90 && !GOOD.test(l) && !/^(width|depth|height|length|diameter|weight)/i.test(l) && tokens(l).length === 0);
    if (wordy) name = wordy.replace(/\s{2,}/g, ' ');
  }
  if (!name && url) name = slugName(url).name;
  if (url && from === 'size' && !best) from = 'link';

  let w = best?.w, d = best?.d, h = best?.h, round = !!best?.round;
  if (best && best.n === 1 && !round) { d = w; notes.push('Only one length found, so it is treated as square. Check the depth.'); }
  // a round piece written as "60 in diameter x 24 in H"
  const ok = !!(w && d);
  if (ok) {
    if (w < d && !round && best.labeled?.length === 0) [w, d] = [d, w]; // wider side across
    if (h && h > Math.max(w, d) * 3 && h > 2.5) notes.push('The height looks large; check it.');
  }
  const kind = guessKind([name, url, input].join(' '), w, d);
  return {
    ok, name: name || (kind ? CATALOG_BY_KIND[kind].name : ''), w, d, h, round, kind, url, from, notes,
  };
}

/** Prompt for asking Claude when the text alone is not enough. */
export function claudePrompt(text) {
  const kinds = Object.keys(CATALOG_BY_KIND).join(', ');
  return [
    'You help someone plan furniture in their backyard. From the product information below, give the',
    'assembled, overall footprint and height of the item (for a set, the whole set as usually arranged).',
    'If you are only given a link or a product name, use what you know about that exact product; if you',
    'do not know it, give typical sizes for that kind of product and set "estimated" to true.',
    'Reply with only JSON in this shape:',
    '{"name": "Short product name", "width_in": 72, "depth_in": 40, "height_in": 30, "round": false,',
    ` "type": "one of: ${kinds}, other", "estimated": false, "note": "one short sentence on where the size came from"}`,
    '',
    'Product information:',
    String(text).slice(0, 6000),
  ].join('\n');
}

/** Turn Claude's JSON into the same shape parseProduct returns. */
export function fromClaude(j) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) * IN : undefined);
  const w = n(j?.width_in), d = n(j?.depth_in) ?? (j?.round ? n(j?.width_in) : undefined), h = n(j?.height_in);
  const kind = CATALOG_BY_KIND[j?.type] ? j.type : null;
  const notes = [];
  if (j?.note) notes.push(String(j.note).slice(0, 200));
  if (j?.estimated) notes.push('This is an estimate. Check it against the product page.');
  return { ok: !!(w && d), name: String(j?.name || '').slice(0, 80), w, d, h, round: !!j?.round, kind, from: 'claude', notes, estimated: !!j?.estimated };
}

/**
 * Bookmarklet source. Run on a store's product page, it collects the product's name and
 * every line that looks like a dimension (structured data first), then copies it.
 */
export const BOOKMARKLET = `(()=>{const o={v:1,name:'',url:location.href,lines:[]};const add=s=>{s=String(s).replace(/\\s+/g,' ').trim();if(s&&s.length<200&&o.lines.indexOf(s)<0)o.lines.push(s)};const walk=j=>{if(!j||typeof j!=='object')return;if(Array.isArray(j))return j.forEach(walk);if(j['@graph'])walk(j['@graph']);const t=[].concat(j['@type']||[]);if(t.indexOf('Product')>=0){o.name=o.name||j.name||'';['width','depth','height','length','size'].forEach(k=>{const v=j[k];if(v)add(k+': '+(typeof v==='object'?(v.value+' '+(v.unitText||v.unitCode||'')):v))});[].concat(j.additionalProperty||[]).forEach(p=>{if(p&&p.name&&/dimen|width|depth|height|length|diam|size/i.test(p.name))add(p.name+': '+p.value+' '+(p.unitText||p.unitCode||''))})}};document.querySelectorAll('script[type="application/ld+json"]').forEach(s=>{try{walk(JSON.parse(s.textContent))}catch(e){}});const h1=document.querySelector('h1');o.name=o.name||(h1&&h1.innerText)||document.title;const L=document.body.innerText.split('\\n').map(s=>s.trim()).filter(Boolean);const lab=/^(overall |assembled |product )?(width|depth|height|length|diameter|dimensions?|measurements|size)( \\(.*\\))?:?$/i;const dim=/(dimension|width|depth|height|length|diameter|overall|assembled|\\d\\s*("|in|cm|mm|ft|')\\.?\\s*[wdhl]?\\s*x)/i;for(let i=0;i<L.length&&o.lines.length<60;i++){const t=L[i];if(lab.test(t)&&L[i+1]&&/\\d/.test(L[i+1]))add(t.replace(/:$/,'')+': '+L[i+1]);else if(t.length<160&&/\\d/.test(t)&&dim.test(t))add(t)}const s='YARDMAKER '+JSON.stringify(o);const done=()=>alert('Furniture size copied. Paste it into Yard Maker.');if(navigator.clipboard)navigator.clipboard.writeText(s).then(done,()=>prompt('Copy this, then paste it into Yard Maker:',s));else prompt('Copy this, then paste it into Yard Maker:',s)})()`;
