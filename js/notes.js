// Plain-language explanations of a suggested layout, and a text summary to paste into Claude.
import { measure, footprint, isMovable, houseGap } from './optimizer.js';
import { CATALOG_BY_KIND, rulesOf } from './catalog.js';
import { fmtLen, fmtDims, fmtArea } from './units.js';

const pct = (f) => `${Math.round(f * 100)}%`;

export function whereText(site, fp, units) {
  const h = site.house;
  const cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
  const gap = houseGap(site, fp);
  switch (h.side) {
    case 'top':
    case 'bottom':
      return `${fmtLen(Math.max(0, gap), units)} out from the house, ${fmtLen(cx - h.x0, units)} from the left side`;
    case 'left':
    case 'right':
      return `${fmtLen(Math.max(0, gap), units)} out from the house, ${fmtLen(cz - h.z0, units)} from the top of the plan`;
    default:
      return `${fmtLen(cx - h.x0, units)} from the left, ${fmtLen(cz - h.z0, units)} from the top`;
  }
}

/** One note per movable piece: what to do, where, and why. */
export function layoutNotes(result, items, units) {
  const { site, placements, after } = result;
  const placed = after.placed;
  const notes = [];
  items.forEach((it, k) => {
    if (!isMovable(it)) return;
    const p = placements[k];
    const moved = Math.hypot(p.x - it.x, p.z - it.z) > 0.05 || (p.rot % 180) !== ((it.rot || 0) % 180);
    const m = measure(site, it, p, placed);
    const rules = rulesOf(it);
    const facts = [];
    const warn = [];
    if (rules.house && m.houseGap !== null) {
      const [lo] = rules.house;
      const ok = m.houseGap >= lo - 0.05;
      const t = `${fmtLen(Math.max(0, m.houseGap), units)} from the house`;
      if (lo >= 2.5) (ok ? facts : warn).push(ok ? `${t}, outside the 10 ft safety distance` : `only ${t}; aim for 10 ft or more`);
      else facts.push(t);
    }
    if (rules.awayTall) {
      const ok = m.tallGap >= rules.awayTall - 0.05;
      const t = `${fmtLen(Math.max(0, m.tallGap), units)} from the nearest tree or structure`;
      (ok ? facts : warn).push(ok ? t : `only ${t}`);
    }
    if (rules.sky) (m.shade < 0.05 ? facts : warn).push(m.shade < 0.05 ? 'open sky above, no branches overhead' : `${pct(m.shade)} under tree canopy`);
    if (rules.light === 'sun') facts.push(m.shade < 0.1 ? 'full sun' : `${pct(1 - m.shade)} sun`);
    if (rules.light === 'shade') facts.push(m.shade > 0.05 ? `${pct(m.shade)} shaded by canopy` : 'no canopy shade here; add an umbrella');
    if (rules.edge === 'prefer' && m.edgeGap < 0.8) facts.push('tucked against the edge');
    if (rules.level) (m.slope <= 0.04 ? facts : warn).push(m.slope <= 0.04 ? `level ground (${pct(m.slope)} slope)` : `${pct(m.slope)} slope; may need leveling`);
    if (m.near?.item) facts.push(`${fmtLen(m.near.gap, units)} from the ${m.near.item.name.toLowerCase()}`);
    if (m.away) for (const a of m.away) if (a.item && a.gap < a.min) warn.push(`close to the ${a.item.name.toLowerCase()}`);
    if (it.clearance > 0) facts.push(`${fmtLen(it.clearance, units)} clear around it`);
    const per = after.per?.get(k) || [];
    if (per.some((x) => x.why === 'blocked')) warn.push('does not fully fit here; the yard may be too small for everything');
    if (per.some((x) => x.why === 'overlap')) warn.push('overlaps another piece; remove something or lock fewer pieces');
    if (after.unreachable.includes(k)) warn.push('no clear path to it from the door');
    notes.push({
      k, id: it.id, name: it.name, moved, isNew: it.origin !== 'scanned',
      where: whereText(site, footprint(it, p.x, p.z, p.rot), units),
      turned: (p.rot % 180) !== ((it.rot || 0) % 180),
      dist: Math.hypot(p.x - it.x, p.z - it.z),
      why: CATALOG_BY_KIND[it.kind]?.why || null,
      facts, warn,
    });
  });
  // moved things first, scanned items before new ones
  notes.sort((a, b) => (b.moved - a.moved) || (a.isNew - b.isNew));
  return notes;
}

export function openText(o, units) {
  return o && o.area > 0 ? `${fmtDims(o.w, o.d, units)} (${fmtArea(o.area, units)})` : 'none';
}

/** Markdown summary of the yard and plan, for pasting into a Claude chat. */
export function claudeSummary(state) {
  const { model: m, items, units } = state;
  const s = m.stats;
  const lines = [];
  lines.push(`# My yard${m.source === 'scan' ? ` (from Polycam scan "${m.name}")` : m.source === 'sample' ? ' (sample yard)' : ''}`);
  lines.push('');
  lines.push(`- Overall size: ${fmtDims(s.width, s.depth, units)} (width × depth on the plan)`);
  lines.push(`- Usable ground: ${fmtArea(s.usableArea, units)}; blocked by fixed features: ${fmtArea(s.blockedArea, units)}`);
  lines.push(`- House side: ${m.houseSide === 'none' ? 'not set' : `${m.houseSide} edge of the plan`}`);
  lines.push(`- Tree canopy shade: ${pct(s.shadeFrac)} of the usable ground; average slope ${pct(s.meanSlope)}${s.steepFrac > 0.05 ? `, ${pct(s.steepFrac)} steeper than 8%` : ''}`);
  lines.push('- Coordinates below are the center of each item, measured from the top-left corner of the plan (x to the right, y down).');
  lines.push('');
  const fixed = items.filter((it) => it.fixed);
  if (fixed.length) {
    lines.push('## Fixed features');
    for (const it of fixed)
      lines.push(`- ${it.name}: ${fmtDims(it.w, it.d, units)} footprint, ${fmtLen(it.h, units)} tall, at (${fmtLen(it.x, units)}, ${fmtLen(it.z, units)})`);
    lines.push('');
  }
  const rest = items.filter((it) => !it.fixed);
  if (rest.length) {
    lines.push('## Furniture and movable items');
    for (const it of rest) {
      const fp = footprint(it);
      lines.push(`- ${it.name}${it.origin === 'scanned' ? ' (already in the yard)' : ' (planned)'}${it.locked ? ' [locked in place]' : ''}: ${fmtDims(fp.w, fp.d, units)}, needs ${fmtLen(it.clearance || 0, units)} clearance, at (${fmtLen(it.x, units)}, ${fmtLen(it.z, units)})`);
    }
    lines.push('');
  }
  if (state.openNow) lines.push(`Largest open rectangle of lawn right now: ${openText(state.openNow, units)}.`, '');
  lines.push('Please suggest where to place each item to make the most of the space, keeping safe distances (fire pits and grills 10 ft from the house and trees), clear walkways from the door, and a large open lawn.');
  return lines.join('\n');
}
