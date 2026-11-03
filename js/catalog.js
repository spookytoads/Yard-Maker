// Furniture library. Sizes are typical footprints in meters (w = along x, d = along z
// at rotation 0). `clearance` is the space kept free around the piece so it can be used
// (pulling out chairs, walking around a grill, the fall zone around a play set).
//
// rules (all optional, distances in meters):
//   house:   [min, max] preferred gap between the piece and the house side
//   awayTall: minimum gap from trees, sheds and other tall fixed things
//   sky:     true = nothing overhead (fire, grills: no canopy above)
//   light:   'sun' | 'shade'
//   edge:    'prefer' (hug the yard boundary) | 'avoid'
//   level:   true = wants flat ground
//   near:    { kinds: [...], gap } stay within `gap` of one of these pieces
//   away:    [{ kinds: [...], gap }] stay at least `gap` from these pieces

export const CATEGORIES = {
  dining:  { label: 'Dining',  color: '#3f7cac' },
  lounge:  { label: 'Lounge',  color: '#7a5fb0' },
  fire:    { label: 'Fire & cooking', color: '#d2551e' },
  play:    { label: 'Play',    color: '#c8961a' },
  garden:  { label: 'Garden',  color: '#4f8a3a' },
  storage: { label: 'Storage', color: '#7d6b5a' },
  water:   { label: 'Water',   color: '#2a9a9a' },
  other:   { label: 'Other',   color: '#6b7280' },
};

export const CATALOG = [
  { kind: 'dining6', name: 'Dining set (6)', cat: 'dining', w: 2.1, d: 1.5, h: 0.75, clearance: 0.9,
    rules: { house: [0.6, 4.5], level: true },
    why: 'close to the house for carrying food, on level ground, with 3 ft to pull out chairs' },
  { kind: 'bistro', name: 'Bistro set', cat: 'dining', w: 1.2, d: 1.2, h: 0.75, clearance: 0.6, shape: 'circle',
    rules: { house: [0.3, 6], level: true },
    why: 'a small table that fits near the door or in a corner' },
  { kind: 'sofa', name: 'Conversation set', cat: 'lounge', w: 2.4, d: 2.4, h: 0.8, clearance: 0.6,
    rules: { house: [0.6, 8], level: true, light: 'shade' },
    why: 'a sofa grouping that works best in partial shade and near the house' },
  { kind: 'chaise', name: 'Chaise lounge', cat: 'lounge', w: 0.75, d: 2.0, h: 0.4, clearance: 0.5,
    rules: { light: 'sun', near: { kinds: ['chaise', 'hottub'], gap: 2.5 } },
    why: 'sunbathing, so it goes where the canopy does not shade it' },
  { kind: 'adirondack', name: 'Adirondack chair', cat: 'lounge', w: 0.75, d: 0.9, h: 0.9, clearance: 0.4,
    rules: { near: { kinds: ['firepit'], gap: 1.6 } },
    why: 'grouped around the fire pit at a comfortable distance' },
  { kind: 'hammock', name: 'Hammock (with stand)', cat: 'lounge', w: 4.0, d: 1.2, h: 1.2, clearance: 0.6,
    rules: { light: 'shade' },
    why: 'in the shade of the canopy' },
  { kind: 'bench', name: 'Garden bench', cat: 'lounge', w: 1.5, d: 0.6, h: 0.85, clearance: 0.5,
    rules: { edge: 'prefer' },
    why: 'along the edge, facing into the yard' },
  { kind: 'firepit', name: 'Fire pit', cat: 'fire', w: 1.1, d: 1.1, h: 0.4, clearance: 0.9, shape: 'circle',
    rules: { house: [3.0, 99], awayTall: 3.0, sky: true, edge: 'avoid', level: true },
    why: 'at least 10 ft from the house, trees and sheds, with nothing overhead' },
  { kind: 'grill', name: 'Grill', cat: 'fire', w: 1.5, d: 0.7, h: 1.1, clearance: 0.9,
    rules: { house: [3.0, 6.5], awayTall: 1.5, sky: true, level: true },
    why: '10 ft from the house (the usual safety guidance) but still a short walk from the kitchen' },
  { kind: 'hottub', name: 'Hot tub', cat: 'water', w: 2.1, d: 2.1, h: 0.9, clearance: 0.9,
    rules: { house: [1.0, 6], level: true, light: 'sun' },
    why: 'near the door for winter use, on level ground, away from dropping leaves' },
  { kind: 'playset', name: 'Swing / play set', cat: 'play', w: 4.3, d: 3.0, h: 2.4, clearance: 1.8,
    rules: { house: [3, 14], awayTall: 1.0, level: true, away: [{ kinds: ['firepit', 'grill'], gap: 5 }] },
    why: 'visible from the house, with the 6 ft fall zone the CPSC recommends kept clear' },
  { kind: 'trampoline', name: 'Trampoline (12 ft)', cat: 'play', w: 3.7, d: 3.7, h: 0.9, clearance: 2.0, shape: 'circle',
    rules: { awayTall: 2.0, level: true, edge: 'avoid', away: [{ kinds: ['firepit', 'grill'], gap: 5 }] },
    why: 'on level ground, clear of trees, fences and the fire pit' },
  { kind: 'sandbox', name: 'Sandbox', cat: 'play', w: 1.8, d: 1.8, h: 0.3, clearance: 0.6,
    rules: { house: [1.5, 10], light: 'shade' },
    why: 'in shade and in view of the house' },
  { kind: 'cornhole', name: 'Cornhole lane', cat: 'play', w: 1.2, d: 8.2, h: 0.3, clearance: 0.6,
    rules: { level: true },
    why: 'a 27 ft regulation lane on flat ground' },
  { kind: 'gardenbed', name: 'Raised garden bed', cat: 'garden', w: 2.4, d: 1.2, h: 0.4, clearance: 0.6,
    rules: { light: 'sun', edge: 'prefer' },
    why: 'full sun along the edge, out of the main lawn' },
  { kind: 'planter', name: 'Large planter', cat: 'garden', w: 0.6, d: 0.6, h: 0.6, clearance: 0.2, shape: 'circle',
    rules: { edge: 'prefer' },
    why: 'along the edge to soften corners' },
  { kind: 'shed', name: 'Storage shed (8×6)', cat: 'storage', w: 2.4, d: 1.8, h: 2.3, clearance: 0.9,
    rules: { house: [5, 99], edge: 'prefer', level: true },
    why: 'tucked against the back edge, far from the house, on level ground' },
];

export const CATALOG_BY_KIND = Object.fromEntries(CATALOG.map((c) => [c.kind, c]));

export function categoryOf(item) {
  if (item.cat) return item.cat;
  const c = CATALOG_BY_KIND[item.kind];
  return c ? c.cat : 'other';
}

export function rulesOf(item) {
  const c = CATALOG_BY_KIND[item.kind];
  return (c && c.rules) || {};
}
