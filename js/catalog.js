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
  plants:  { label: 'Plants',  color: '#2f7a46' },
  feature: { label: 'Structures', color: '#8a8177' },
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
  // plants
  { kind: 'tree', name: 'Tree', cat: 'plants', group: 'plants', w: 3.5, d: 3.5, h: 6, clearance: 0.3, shape: 'circle',
    rules: { house: [4.5, 99], light: 'sun', edge: 'prefer' },
    why: 'at least 15 ft from the house so roots and branches stay clear, toward the edge where its shade does not cover the lawn' },
  { kind: 'shrub', name: 'Shrub / bush', cat: 'plants', group: 'plants', w: 1.2, d: 1.2, h: 1.2, clearance: 0.3, shape: 'circle',
    rules: { edge: 'prefer' },
    why: 'along the edges and the house to soften the lines' },
  { kind: 'hedge', name: 'Hedge / privacy row', cat: 'plants', group: 'plants', w: 6, d: 1.0, h: 1.8, clearance: 0.3,
    rules: { edge: 'prefer' },
    why: 'along a property line for privacy' },
  { kind: 'flowerbed', name: 'Flower bed', cat: 'plants', group: 'plants', w: 3, d: 1.2, h: 0.3, clearance: 0.4,
    rules: { edge: 'prefer', light: 'sun' },
    why: 'in sun along the edge, framing the lawn' },
  { kind: 'boulder', name: 'Boulder / rock', cat: 'plants', group: 'plants', w: 1.0, d: 0.8, h: 0.6, clearance: 0.2,
    rules: { edge: 'prefer' },
    why: 'as an accent near the edge' },
];

/**
 * Types for things already in the yard that are not furniture or plants. They carry no
 * placement rules and are fixed by default. Shown with the catalog in every Type menu.
 */
export const FEATURES = [
  { kind: 'house', name: 'House', fixed: true },
  { kind: 'fence', name: 'Fence', fixed: true },
  { kind: 'wall', name: 'Wall / retaining wall', fixed: true },
  { kind: 'structure', name: 'Shed / outbuilding', fixed: true },
  { kind: 'deck', name: 'Deck / patio', fixed: true },
  { kind: 'pool', name: 'Pool', fixed: true },
  { kind: 'utility', name: 'AC unit / utility box', fixed: true },
  { kind: 'scanned', name: 'Something else', fixed: false },
];
export const FEATURE_BY_KIND = Object.fromEntries(FEATURES.map((f) => [f.kind, { ...f, cat: 'feature' }]));

/** Grouped options for a Type menu: [{ label, items: [{ kind, name }] }]. */
export function typeGroups() {
  return [
    { label: 'Furniture', items: CATALOG.filter((c) => c.group !== 'plants' && c.cat !== 'garden') },
    { label: 'Garden and plants', items: CATALOG.filter((c) => c.group === 'plants' || c.cat === 'garden') },
    { label: 'Structures and other', items: FEATURES },
  ];
}

/** Display name for a kind from either list. */
export const kindName = (kind) => (CATALOG_BY_KIND[kind] || FEATURE_BY_KIND[kind] || {}).name || '';

/** Kinds that are rooted or built in: a scanned one of these starts out Fixed. */
export const FIXED_KINDS = new Set(['tree', 'shrub', 'hedge', 'flowerbed', 'boulder', ...FEATURES.filter((f) => f.fixed).map((f) => f.kind)]);

export const CATALOG_BY_KIND = Object.fromEntries(CATALOG.map((c) => [c.kind, c]));

export function categoryOf(item) {
  if (item.cat) return item.cat;
  const c = CATALOG_BY_KIND[item.kind] || FEATURE_BY_KIND[item.kind];
  return c && item.kind !== 'scanned' ? c.cat : 'other';
}

export function rulesOf(item) {
  const c = CATALOG_BY_KIND[item.kind];
  return (c && c.rules) || {};
}
