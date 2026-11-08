// Shared geometry, maths and constants for the slider and grid views.
// Values ported from the reference site (module 21307).

export const COMPACT_BP = 760;
export const CELL_RATIO = 587.67 / 876.58; // tile w / h
export const INACTIVE_OPACITY = 0.5;
export const PARALLAX_PCT = 6; // image travel inside a tile, % of tile size
export const PARALLAX_SCALE = 1 / 0.88;
export const VIEW_MOVE_S = 1.6; // slider ⇄ grid morph
export const VIEW_ZOOM = 0.75; // grid cell = slider tile × this
export const BAND_STAGGER_S = 0.08;
export const IMAGE_SIZES = "(max-width: 760px) 70vw, 30vw";

export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));
export const wrap = (min: number, max: number, v: number) => min + mod(v - min, max - min);
export const oddAtLeast = (min: number, n: number) => Math.max(min, n % 2 === 0 ? n + 1 : n);
/** Frame-rate independent smoothing toward a target. */
export const easeFactor = (dtSeconds: number, rate = 7) => 1 - Math.exp(-dtSeconds * rate);

/** Slider tile size in px. The grid uses this × VIEW_ZOOM. */
export function cellSize(W: number, H: number) {
  if (W <= COMPACT_BP) return { w: H * (758 / 1116), h: H };
  const h = Math.min(((587.67 / 1728) * W * 1.15) / CELL_RATIO, 0.72 * H);
  return { w: h * CELL_RATIO, h };
}

/** Sextic in-out: slow start, fast middle, long settle. The reference's VIEW_MOVE_EASE. */
export function viewMoveEase(t: number) {
  return t < 0.5 ? 32 * Math.pow(t, 6) : 1 - Math.pow(-2 * t + 2, 6) / 2;
}

/** Offset of a row `band` rows away from the active one, `t` seconds into the morph. */
export function bandOffset(t: number, band: number, dist: number) {
  if (band === 0) return 0;
  const p = (t - BAND_STAGGER_S * (Math.abs(band) - 1)) / VIEW_MOVE_S;
  return Math.sign(band) * dist * (1 - viewMoveEase(clamp(0, 1, p)));
}

/** Morph length when the outermost band is `maxBand` rows away. */
export function bandedDuration(maxBand: number) {
  return VIEW_MOVE_S + BAND_STAGGER_S * Math.max(0, maxBand - 1);
}

/** Position nearest to `pos` whose wrapped index shows `index` (for an `n`-item loop). */
export function nearestPos(pos: number, index: number, n: number) {
  const cur = wrap(0, n, pos);
  return Math.round(pos + wrap(-n / 2, n / 2, index - cur));
}
