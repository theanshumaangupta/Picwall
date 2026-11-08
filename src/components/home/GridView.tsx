"use client";

import { animate, type AnimationPlaybackControls } from "motion/react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { projects } from "@/config/projects";
import { ease } from "@/lib/ease";
import { playTick } from "@/lib/sound";
import {
  IMAGE_SIZES,
  INACTIVE_OPACITY,
  LENS_MORPH_S,
  VIEW_MOVE_S,
  VIEW_ZOOM,
  bandOffset,
  bandedDuration,
  cellSize,
  clamp,
  easeFactor,
  followSpeed,
  mediaParams,
  mediaTransform,
  mod,
  oddAtLeast,
  viewMoveEase,
  whenTilesPainted,
  wrap,
} from "./gallery";
import {
  LensRenderer,
  lensCellScale,
  lensOptics,
  projectRect,
  rectInView,
  unprojectPoint,
  type LensTile,
} from "./lens";

const FILTER_S = 1.6;
const TICKS_PER_CELL = 7; // sound ticks per cell crossed
const RULER_SPACING = 16; // target px between edge-ruler ticks

type Pool = { nx: number; ny: number };

function poolFor(W: number, H: number): Pool {
  const c = cellSize(W, H);
  const cw = c.w * VIEW_ZOOM;
  const ch = c.h * VIEW_ZOOM;
  return {
    nx: oddAtLeast(5, Math.ceil(W / cw) + 2),
    ny: oddAtLeast(3, Math.ceil(H / ch) + 2),
  };
}

const offsets = (n: number) => Array.from({ length: n }, (_, i) => i - (n - 1) / 2);

/** Each row is the row above shifted one project to the left, as in the reference. */
const projectAt = (items: number[], col: number, row: number) => items[mod(col + row, items.length)] ?? 0;

function cellProjects(pool: Pool, items: number[], px: number, py: number) {
  const xs = offsets(pool.nx);
  const ys = offsets(pool.ny);
  const out: number[] = [];
  for (const sy of ys) {
    const ey = wrap(-pool.ny / 2, pool.ny / 2, sy - py);
    for (const sx of xs) {
      const ex = wrap(-pool.nx / 2, pool.nx / 2, sx - px);
      out.push(projectAt(items, Math.round(px + ex), Math.round(py + ey)));
    }
  }
  return out;
}

type Controller = {
  render: () => void;
  setActive: (on: boolean, centerProject: number) => void;
  setShown: (shown: boolean) => void;
  setItems: (items: number[]) => void;
  setFisheye: (on: boolean) => void;
};

type Props = {
  items: number[];
  active: boolean;
  /** Project the morph starts centred on (the slider's current project). */
  centerProject: number;
  fisheye: boolean;
  onActiveChange: (project: number) => void;
  /** Fired when the leaving morph has finished, so the slider can take over. */
  onExited: () => void;
  /** Keep drawing after the leaving morph, until the slider has painted (see SliderView). */
  shown: boolean;
  /** Fired once after becoming active, when the visible cells' images are painted. */
  onShown: () => void;
};

export function GridView({ items, active, centerProject, fisheye, onActiveChange, onExited, shown, onShown }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mediaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const colourRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rulerRefs = useRef<{ top: HTMLElement | null; bottom: HTMLElement | null; left: HTMLElement | null; right: HTMLElement | null }>({
    top: null,
    bottom: null,
    left: null,
    right: null,
  });
  const ctrl = useRef<Controller | null>(null);
  const shownActive = useRef(false);
  const wasShown = useRef(false);
  const fisheyeShown = useRef(false);
  const itemsRef = useRef(items);
  const cbRef = useRef({ onActiveChange, onExited, onShown });
  const pendingShown = useRef(false);
  useLayoutEffect(() => {
    cbRef.current = { onActiveChange, onExited, onShown };
  });

  const [pool, setPool] = useState<Pool>({ nx: 9, ny: 5 });
  const [cellProj, setCellProj] = useState(() => cellProjects({ nx: 9, ny: 5 }, items, 0, 0));
  const poolRef = useRef(pool);
  const cellProjRef = useRef(cellProj);

  // Layout effect so the controller exists before the `active` effect below runs on first mount.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const sim = {
      px: 0,
      py: 0,
      tx: 0,
      ty: 0,
      items: itemsRef.current,
      morphT: 0, // seconds into the slider → grid morph (0 = slider layout)
      morphTotal: VIEW_MOVE_S,
      active: false,
      shown: false,
      filterT: 1,
      lens: 0,
      dragging: false,
      lastActive: -1,
      lastTickKey: "",
      vx: 0, // smoothed scroll speed in cells/s per axis (drives the image lag)
      vy: 0,
      raf: 0,
      last: 0,
    };

    let W = window.innerWidth;
    let H = window.innerHeight;
    let base = cellSize(W, H); // slider tile
    let cw = base.w * VIEW_ZOOM;
    let ch = base.h * VIEW_ZOOM;
    let morph: AnimationPlaybackControls | null = null;
    let lensMorph: AnimationPlaybackControls | null = null;

    const measure = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      base = cellSize(W, H);
      cw = base.w * VIEW_ZOOM;
      ch = base.h * VIEW_ZOOM;
      root.style.setProperty("--gcell-w", `${cw}px`);
      root.style.setProperty("--gcell-h", `${ch}px`);
      // Edge rulers repeat once per cell, with a tall tick on each cell centre.
      const rulerX = Math.max(1, Math.round(cw / RULER_SPACING));
      const rulerY = Math.max(1, Math.round(ch / RULER_SPACING));
      root.style.setProperty("--ruler-x-step", `${cw / rulerX}px`);
      root.style.setProperty("--ruler-y-step", `${ch / rulerY}px`);
      // Strips start one cell before their edge (gticker size 20px), so the major ticks land on cell centres.
      root.style.setProperty("--ruler-x-origin", `${mod(W / 2 - 20 + cw, cw)}px`);
      root.style.setProperty("--ruler-y-origin", `${mod(H / 2 + ch, ch)}px`);
      const next = poolFor(W, H);
      if (next.nx !== poolRef.current.nx || next.ny !== poolRef.current.ny) {
        poolRef.current = next;
        setPool(next);
      }
      lensRenderer?.setSize(W, H);
    };

    // ---- Fisheye renderer, created the first time the lens is used ----
    let lensRenderer: LensRenderer | null = null;
    let lensFailed = false;
    let lensDrawn = false;
    const ensureLens = () => {
      if (!lensRenderer && !lensFailed && canvasRef.current) {
        lensRenderer = LensRenderer.create(canvasRef.current);
        lensFailed = !lensRenderer;
        lensRenderer?.setSize(W, H);
      }
      return lensRenderer;
    };
    const currentOptics = () => (sim.lens > 0 && lensRenderer ? lensOptics(W, H) : null);

    const render = () => {
      const { nx, ny } = poolRef.current;
      const xs = offsets(nx);
      const ys = offsets(ny);
      const M = sim.items.length || 1;
      const lens = sim.lens;
      const visibleRoot = sim.active || sim.morphT > 0 || sim.shown;
      root.style.visibility = visibleRoot ? "visible" : "hidden";

      // Zoom from slider tile size (1 / VIEW_ZOOM) down to grid size as the morph runs.
      const zoomP = viewMoveEase(clamp(0, 1, sim.morphT / VIEW_MOVE_S));
      const s = 1 / VIEW_ZOOM + (1 - 1 / VIEW_ZOOM) * zoomP;
      // Fisheye: cells grow with the lens (the reference's lensCellScale), then bend in WebGL.
      const ls = lensCellScale(lens);
      const lensR = lens > 0 && visibleRoot ? ensureLens() : null;
      const optics = lensR ? lensOptics(W, H) : null;
      const lensTiles: LensTile[] = [];
      const scw = cw * s * ls;
      const sch = ch * s * ls;
      const activeRow = Math.round(sim.py);

      const nextProj = cellProjRef.current.slice(0, nx * ny);
      let changed = false;

      for (let j = 0; j < ny; j++) {
        const ey = wrap(-ny / 2, ny / 2, ys[j] - sim.py);
        const row = Math.round(sim.py + ey);
        const band = row - activeRow;
        const bandY = bandOffset(sim.morphT, band, H);
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const ex = wrap(-nx / 2, nx / 2, xs[i] - sim.px);
          const col = Math.round(sim.px + ex);
          const proj = sim.items[mod(col + row, M)] ?? 0;
          if (nextProj[k] !== proj) {
            nextProj[k] = proj;
            changed = true;
          }

          const cell = cellRefs.current[k];
          if (!cell) continue;
          // Flat centre, relative to the screen centre.
          const fx = ex * scw;
          const fy = ey * sch + bandY;
          const visible =
            visibleRoot &&
            (optics
              ? rectInView(fx, fy, scw, sch, W, H, lens, optics)
              : Math.abs(fx) < W / 2 + scw && Math.abs(fy) < H / 2 + sch);
          cell.style.visibility = visible ? "visible" : "hidden";
          if (!visible) continue;

          const n = clamp(0, 1, 1 - Math.hypot(ex, ey));
          const opacity = sim.filterT * (INACTIVE_OPACITY + (1 - INACTIVE_OPACITY) * n);
          const m = mediaParams(clamp(-1, 1, fx / (W / 2)), clamp(-1, 1, fy / (H / 2)), sim.vx, sim.vy);
          cell.style.zIndex = String(Math.round(n * 10));
          cell.classList.toggle("is-center", n > 0.5);

          if (optics) {
            // WebGL draws the cell through the lens; the invisible DOM cell covers the
            // projected box for the cursor caption and clicks.
            const r = projectRect(fx, fy, scw, sch, lens, optics);
            cell.style.transform = `translate3d(${W / 2 + r.x - cw / 2}px, ${H / 2 + r.y - ch / 2}px, 0) scale(${r.w / cw}, ${r.h / ch})`;
            cell.style.opacity = "0";
            const img = colourRefs.current[k]?.querySelector("img");
            if (img) {
              lensTiles.push({ img, cx: fx, cy: fy, w: scw, h: sch, opacity, colour: n, mediaX: m.x, mediaY: m.y, mediaScale: m.scale });
            }
            continue;
          }

          cell.style.transform = `translate3d(${W / 2 + fx - cw / 2}px, ${H / 2 + fy - ch / 2}px, 0) scale(${s * ls})`;
          cell.style.opacity = String(opacity);
          const colour = colourRefs.current[k];
          if (colour) colour.style.opacity = String(n);
          const media = mediaRefs.current[k];
          if (media) media.style.transform = mediaTransform(m);
        }
      }

      if (optics && lensR) {
        lensTiles.sort((a, b) => a.colour - b.colour); // centre cell on top
        lensR.draw(lensTiles, lens);
        lensDrawn = true;
      } else if (lensDrawn) {
        lensRenderer?.clear();
        lensDrawn = false;
      }

      if (changed) {
        cellProjRef.current = nextProj;
        setCellProj(nextProj);
      }

      // Edge rulers scroll with the grid.
      const r = rulerRefs.current;
      const fx = mod(sim.px, 1) * cw;
      const fy = mod(sim.py, 1) * ch;
      if (r.top) r.top.style.transform = `translate3d(${-fx}px, 0, 0)`;
      if (r.bottom) r.bottom.style.transform = `translate3d(${-fx}px, 0, 0)`;
      if (r.left) r.left.style.transform = `translate3d(0, ${-fy}px, 0)`;
      if (r.right) r.right.style.transform = `translate3d(0, ${-fy}px, 0)`;

      // Report the centred project (Home shows it in the header).
      const activeProj = projectAt(sim.items, Math.round(sim.px), activeRow);
      if (activeProj !== sim.lastActive && sim.active) {
        sim.lastActive = activeProj;
        cbRef.current.onActiveChange(activeProj);
      }
    };

    const step = (dt: number) => {
      const f = easeFactor(dt);
      const dx = (sim.tx - sim.px) * f;
      const dy = (sim.ty - sim.py) * f;
      sim.px += dx;
      sim.py += dy;
      sim.vx = followSpeed(sim.vx, dt > 0 ? dx / dt : 0, dt);
      sim.vy = followSpeed(sim.vy, dt > 0 ? dy / dt : 0, dt);
      if (!sim.dragging && Math.abs(sim.tx - sim.px) < 5e-4 && Math.abs(sim.ty - sim.py) < 5e-4) {
        sim.px = sim.tx;
        sim.py = sim.ty;
      }
      const key = `${Math.round(sim.px * TICKS_PER_CELL)},${Math.round(sim.py * TICKS_PER_CELL)}`;
      if (sim.active && sim.lastTickKey && key !== sim.lastTickKey) playTick();
      sim.lastTickKey = key;
    };

    const busy = () => sim.dragging || sim.px !== sim.tx || sim.py !== sim.ty || sim.vx !== 0 || sim.vy !== 0;

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - sim.last) / 1000);
      sim.last = now;
      step(dt);
      render();
      sim.raf = busy() ? requestAnimationFrame(frame) : 0;
    };

    const wake = () => {
      if (sim.raf) return;
      sim.last = performance.now();
      sim.raf = requestAnimationFrame(frame);
    };

    let settleTimer = 0;
    const settleAfter = (ms: number) => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        sim.tx = Math.round(sim.tx);
        sim.ty = Math.round(sim.ty);
        wake();
      }, ms);
    };

    // ---- 2D drag with flick ----
    let pointerId = -1;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let lastT = 0;
    let downT = 0;
    let vx = 0;
    let vy = 0;
    const interactive = () => sim.active && sim.morphT >= sim.morphTotal - 1e-3;

    const onDown = (e: PointerEvent) => {
      if (!interactive() || (e.pointerType === "mouse" && e.button !== 0)) return;
      sim.dragging = true;
      pointerId = e.pointerId;
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
      lastT = downT = performance.now();
      vx = vy = 0;
      root.classList.add("is-dragging");
      try {
        root.setPointerCapture(e.pointerId);
      } catch {}
      window.clearTimeout(settleTimer);
      wake();
    };

    const onMove = (e: PointerEvent) => {
      if (!sim.dragging || e.pointerId !== pointerId) return;
      const ls = lensCellScale(sim.lens);
      const dx = -(e.clientX - lastX) / (cw * ls);
      const dy = -(e.clientY - lastY) / (ch * ls);
      sim.tx += dx;
      sim.ty += dy;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      vx = 0.7 * vx + (dx / dt) * 0.3;
      vy = 0.7 * vy + (dy / dt) * 0.3;
      lastT = now;
      lastX = e.clientX;
      lastY = e.clientY;
      wake();
    };

    const onUp = (e: PointerEvent) => {
      if (!sim.dragging || e.pointerId !== pointerId) return;
      sim.dragging = false;
      pointerId = -1;
      root.classList.remove("is-dragging");

      // A click on a side cell centres it.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5 && performance.now() - downT < 400) {
        const optics = currentOptics();
        const [fx, fy] = optics
          ? unprojectPoint(e.clientX - W / 2, e.clientY - H / 2, sim.lens, optics)
          : [e.clientX - W / 2, e.clientY - H / 2];
        const ls = lensCellScale(sim.lens);
        sim.tx = Math.round(sim.px + fx / (cw * ls));
        sim.ty = Math.round(sim.py + fy / (ch * ls));
        wake();
        return;
      }
      const held = performance.now() - lastT > 90;
      sim.tx = Math.round(sim.tx + (held ? 0 : 140 * vx));
      sim.ty = Math.round(sim.ty + (held ? 0 : 140 * vy));
      wake();
    };

    const onWheel = (e: WheelEvent) => {
      if (!interactive()) return;
      e.preventDefault();
      sim.tx += 0.0016 * clamp(-140, 140, e.deltaX) * (base.w / cw);
      sim.ty += 0.0016 * clamp(-140, 140, e.deltaY) * (base.w / cw);
      wake();
      settleAfter(160);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!interactive() || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") sim.tx = Math.round(sim.tx) + 1;
      else if (e.key === "ArrowLeft") sim.tx = Math.round(sim.tx) - 1;
      else if (e.key === "ArrowDown") sim.ty = Math.round(sim.ty) + 1;
      else if (e.key === "ArrowUp") sim.ty = Math.round(sim.ty) - 1;
      else return;
      e.preventDefault();
      wake();
    };

    const onResize = () => {
      measure();
      render();
    };

    ctrl.current = {
      render,
      setShown(on) {
        sim.shown = on;
        render();
      },
      setActive(on, centerProject) {
        sim.active = on;
        root.classList.toggle("is-active", on);
        sim.dragging = false;
        root.classList.remove("is-dragging");
        morph?.stop();

        if (on) {
          // Start centred on the slider's project, laid out exactly like the slider row.
          const k = Math.max(0, sim.items.indexOf(centerProject));
          sim.px = sim.tx = k;
          sim.py = sim.ty = 0;
          sim.lastActive = -1;
          sim.lastTickKey = "";
          pendingShown.current = true;
          measure();
        } else {
          sim.tx = sim.px = Math.round(sim.tx);
          sim.ty = sim.py = Math.round(sim.ty);
        }

        sim.morphTotal = bandedDuration(Math.ceil(poolRef.current.ny / 2));
        const target = on ? sim.morphTotal : 0;
        const remaining = Math.abs(target - sim.morphT);
        morph = animate(sim.morphT, target, {
          duration: remaining,
          ease: "linear",
          onUpdate: (v) => {
            sim.morphT = v;
            render();
          },
          onComplete: () => {
            sim.morphT = target;
            render();
            if (!on) cbRef.current.onExited();
          },
        });
        if (on) playTick();
      },
      setItems(next) {
        const half = FILTER_S / 2;
        animate(sim.filterT, 0, {
          duration: half,
          ease: ease.power2InOut,
          onUpdate: (v) => {
            sim.filterT = v;
            render();
          },
          onComplete: () => {
            sim.items = next;
            sim.px = sim.tx = 0;
            sim.py = sim.ty = 0;
            sim.lastActive = -1;
            animate(0, 1, {
              duration: half,
              ease: ease.power2InOut,
              onUpdate: (v) => {
                sim.filterT = v;
                render();
              },
            });
          },
        });
      },
      setFisheye(on) {
        const target = on ? 1 : 0;
        lensMorph?.stop();
        const from = sim.lens;
        const duration = LENS_MORPH_S * Math.abs(target - from);
        if (!duration) return;
        lensMorph = animate(0, 1, {
          duration,
          ease: "linear",
          onUpdate: (p) => {
            sim.lens = from + (target - from) * viewMoveEase(p);
            root.style.setProperty("--lens-amount", String(sim.lens));
            render();
          },
          onComplete: () => {
            sim.lens = target;
            root.style.setProperty("--lens-amount", String(target));
            render();
          },
        });
      },
    };

    measure();
    render();

    root.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    root.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(sim.raf);
      window.clearTimeout(settleTimer);
      morph?.stop();
      lensMorph?.stop();
      lensRenderer?.dispose();
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      root.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      ctrl.current = null;
      // A remount starts from a fresh, inactive state, so the effects below must re-apply.
      shownActive.current = false;
      fisheyeShown.current = false;
      wasShown.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    ctrl.current?.render();
  }, [pool]);

  useLayoutEffect(() => {
    if (wasShown.current === shown) return;
    wasShown.current = shown;
    ctrl.current?.setShown(shown);
  }, [shown]);

  const centerRef = useRef(centerProject);
  useLayoutEffect(() => {
    centerRef.current = centerProject;
  });
  useLayoutEffect(() => {
    if (shownActive.current === active) return;
    shownActive.current = active;
    ctrl.current?.setActive(active, centerRef.current);
  }, [active]);

  // Handoff: once the entering cells have their images painted, the slider can hide.
  useEffect(() => {
    if (!pendingShown.current || !active) return;
    // The flag clears only when the wait completes, so a re-run (new images mounted,
    // or React re-running effects in development) starts a fresh wait instead of dropping it.
    let cancelled = false;
    whenTilesPainted(cellRefs.current).then(() => {
      if (cancelled) return;
      pendingShown.current = false;
      cbRef.current.onShown();
    });
    return () => {
      cancelled = true;
    };
  }, [active, cellProj]);

  useEffect(() => {
    if (itemsRef.current === items) return;
    itemsRef.current = items;
    ctrl.current?.setItems(items);
  }, [items]);

  useEffect(() => {
    if (fisheyeShown.current === fisheye) return;
    fisheyeShown.current = fisheye;
    ctrl.current?.setFisheye(fisheye);
  }, [fisheye]);

  const xs = offsets(pool.nx);
  const ys = offsets(pool.ny);

  return (
    <div className="grid-view" ref={rootRef} aria-hidden={!active}>
      <div className="stage" aria-label="Projects grid" role="region">
        {ys.map((_, j) =>
          xs.map((_, i) => {
            const k = j * pool.nx + i;
            const p = projects[cellProj[k] ?? 0];
            return (
              <div
                key={k}
                className="gv-cell"
                ref={(el) => {
                  cellRefs.current[k] = el;
                }}
              >
                <div
                  className="sv-media"
                  ref={(el) => {
                    mediaRefs.current[k] = el;
                  }}
                >
                  <div className="sv-grey">
                    <Image key={p.slug} src={p.image} alt="" fill sizes={IMAGE_SIZES} draggable={false} />
                  </div>
                  <div
                    className="sv-colour"
                    ref={(el) => {
                      colourRefs.current[k] = el;
                    }}
                  >
                    <Image key={p.slug} src={p.image} alt={p.name} fill sizes={IMAGE_SIZES} draggable={false} />
                  </div>
                </div>
              </div>
            );
          }),
        )}
        <canvas className="lens-canvas" ref={canvasRef} aria-hidden="true" />
        <div className="stage-vignette" aria-hidden="true" />
      </div>

      {/* Edge rulers */}
      {(["top", "bottom", "left", "right"] as const).map((side) => (
        <div key={side} className={`gticker gticker-${side}`} aria-hidden="true">
          <div className="gticker-strip">
            <div
              className="gt-band"
              ref={(el) => {
                rulerRefs.current[side] = el;
              }}
            />
          </div>
        </div>
      ))}

    </div>
  );
}
