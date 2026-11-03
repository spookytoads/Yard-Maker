// Length / area formatting. Everything inside the app is stored in meters.
export const M_PER_FT = 0.3048;
export const SQFT_PER_M2 = 10.7639;

export function fmtLen(m, units) {
  if (!isFinite(m)) return '—';
  if (units === 'metric') {
    const a = Math.abs(m);
    return (a < 10 ? m.toFixed(2) : m.toFixed(1)) + ' m';
  }
  const sign = m < 0 ? '-' : '';
  let inches = Math.round(Math.abs(m) / 0.0254);
  const ft = Math.floor(inches / 12);
  inches -= ft * 12;
  if (ft === 0) return `${sign}${inches}″`;
  return inches ? `${sign}${ft}′ ${inches}″` : `${sign}${ft}′`;
}

export function fmtDims(w, d, units) {
  return `${fmtLen(w, units)} × ${fmtLen(d, units)}`;
}

export function fmtArea(m2, units) {
  if (units === 'metric') return `${m2 < 100 ? m2.toFixed(1) : Math.round(m2).toLocaleString()} m²`;
  return `${Math.round(m2 * SQFT_PER_M2).toLocaleString()} sq ft`;
}

/** Number shown in an input field (feet or meters). */
export function toInput(m, units) {
  const v = units === 'metric' ? m : m / M_PER_FT;
  return Math.round(v * 100) / 100;
}

export function fromInput(v, units) {
  const n = parseFloat(v);
  if (!isFinite(n)) return NaN;
  return units === 'metric' ? n : n * M_PER_FT;
}

export const unitLabel = (units) => (units === 'metric' ? 'm' : 'ft');
