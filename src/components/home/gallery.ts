// Shared geometry, maths and constants for the slider and grid views.
// Values ported from the reference site (module 21307).

export const COMPACT_BP = 760;
export const CELL_RATIO = 587.67 / 876.58; // tile w / h
export const INACTIVE_OPACITY = 0.5;
// ---- Image parallax inside tiles ----
// The reference uses ±6% (UV scale 0.88). Ours is stronger and also reacts to speed:
// images lag behind the motion and zoom in slightly, then settle when the tiles stop.
// Worst case shift (position + lag) stays inside the overflow the scale provides.
export const PARALLAX_SCALE = 1.28; // ±14% of tile size available on each side
export const PARALLAX_PCT = 9; // position-based travel at the screen edge
export const MOTION_LAG_PCT = 4.5; // extra travel at full speed, opposite to the motion
export const MOTION_LAG_PER_CELL_S = 1.6; // % of lag per (cell / second) of speed
export const MOTION_ZOOM = 0.05; // extra zoom at full speed
export const MOTION_FULL_SPEED = 4; // cells / second that counts as "full speed"
export const MOTION_SMOOTHING = 9; // how quickly the lag follows speed changes (1/s)

/** Smoothed speed tracker, in cells per second, for one axis. */
export function followSpeed(current: number, instant: number, dt: number) {
  const next = current + (instant - current) * easeFactor(dt, MOTION_SMOOTHING);
  return Math.abs(next) < 1e-3 ? 0 : next;
}

/**
 * Transform for the image layer inside a tile.
 * nx/ny: tile position from the screen centre (-1..1); vx/vy: smoothed speed in cells/s
 * in the direction the content scrolls (positive = tiles moving left / up).
 */
export function mediaParams(nx: number, ny: number, vx: number, vy: number) {
  const lagX = clamp(-MOTION_LAG_PCT, MOTION_LAG_PCT, vx * MOTION_LAG_PER_CELL_S);
  const lagY = clamp(-MOTION_LAG_PCT, MOTION_LAG_PCT, vy * MOTION_LAG_PER_CELL_S);
  const speed = Math.min(1, Math.hypot(vx, vy) / MOTION_FULL_SPEED);
  return {
    x: (-nx * PARALLAX_PCT + lagX) / 100, // fraction of the tile
    y: (-ny * PARALLAX_PCT + lagY) / 100,
    scale: PARALLAX_SCALE * (1 + MOTION_ZOOM * speed),
  };
}

export function mediaTransform(m: ReturnType<typeof mediaParams>) {
  return `translate3d(${m.x * 100}%, ${m.y * 100}%, 0) scale(${m.scale})`;
}

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

/**
 * Resolves once the images inside the currently visible tiles are decoded and a frame
 * with them has been painted (or after `timeoutMs`, so a slow image never blocks a view
 * switch). Used to hand over between views without a blank frame.
 */
export function whenTilesPainted(tiles: (HTMLElement | null)[], timeoutMs = 800): Promise<void> {
  const imgs = tiles
    .filter((t): t is HTMLElement => !!t && t.style.visibility === "visible")
    .flatMap((t) => Array.from(t.querySelectorAll("img")));
  const decoded = Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
  const timeout = new Promise<void>((r) => window.setTimeout(r, timeoutMs));
  return Promise.race([decoded, timeout]).then(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** Position nearest to `pos` whose wrapped index shows `index` (for an `n`-item loop). */
export function nearestPos(pos: number, index: number, n: number) {
  const cur = wrap(0, n, pos);
  return Math.round(pos + wrap(-n / 2, n / 2, index - cur));
}

/** Lens on/off morph: 1.6s × distance, sextic ease (the reference's LENS_MORPH_S). */
export const LENS_MORPH_S = VIEW_MOVE_S;
