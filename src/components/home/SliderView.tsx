"use client";

import { animate } from "motion/react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { projects, typeMeta } from "@/config/projects";
import { ease } from "@/lib/ease";
import { playTick } from "@/lib/sound";
import {
  COMPACT_BP,
  IMAGE_SIZES,
  INACTIVE_OPACITY,
  VIEW_MOVE_S,
  cellSize,
  clamp,
  followSpeed,
  mediaTransform,
  mod,
  nearestPos,
  oddAtLeast,
  viewMoveEase,
  whenTilesPainted,
  wrap,
} from "./gallery";

// ---- Constants ported from the reference slider (module 21307) ----
const TICKS_PER_GROUP = 7;
const TICK_PITCH = 100; // px per project at 1728px wide
const DRAG_GAIN = 2.2;
const MOBILE_DRAG_GAIN = 2.6;
const FLICK_COMMIT_CELLS = 0.1;
const INTRO_HOLD_MS = 250;
// The page entrance hands off to the slider at 60% of its 0.9s timeline, minus the hold.
const INTRO_HANDOFF_MS = 0.9 * 0.6 * 1000 - INTRO_HOLD_MS;
const FILTER_S = 1.6;

const GROUPS = Array.from({ length: 41 }, (_, i) => i - 20);
const VGROUPS = Array.from({ length: 21 }, (_, i) => i - 10); // side rulers in list mode
const DIAL_MARKS = Array.from({ length: 72 }, (_, i) => i * 5);

const tickScale = (w: number) => clamp(0.7, 1.15, w / 1728);
const isCompact = () => window.innerWidth <= COMPACT_BP;

/** Enough tiles to cover the screen as a row (slider) and as a column (list). */
function poolSize(W: number, H: number) {
  const c = cellSize(W, H);
  return oddAtLeast(5, Math.max(Math.ceil(W / Math.max(1e-6, c.w)), Math.ceil(H / Math.max(1e-6, c.h))) + 2);
}

export type Orientation = "horizontal" | "vertical";

const poolSlots = (n: number) => Array.from({ length: n }, (_, i) => i - (n - 1) / 2);

function slotProjects(slots: number[], items: number[], pos: number) {
  const pool = slots.length;
  return slots.map((s) => {
    const e = wrap(-pool / 2, pool / 2, s - pos);
    return items[mod(Math.round(pos + e), items.length)] ?? 0;
  });
}

type Controller = {
  render: () => void;
  setItems: (items: number[], animated: boolean) => void;
  setFisheye: (on: boolean) => void;
  intro: () => void;
  setActive: (active: boolean, centerProject: number) => void;
  setShown: (shown: boolean) => void;
  setOrientation: (o: Orientation) => void;
};

type GroupRefs = {
  el: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  type: HTMLElement;
  tag: HTMLElement;
  ticks: HTMLElement[];
  project: number;
};

type VGroupRefs = { el: HTMLElement; ticks: HTMLElement[] };

type Props = {
  items: number[];
  entered: boolean;
  fisheye: boolean;
  /** False while another view (grid) is showing: tiles hide, input is ignored. */
  active: boolean;
  /** Project to centre on when becoming active again. */
  centerProject: number;
  onActiveChange: (project: number) => void;
  /** "vertical" is the list view: the row turns into a column (the reference's `rot`). */
  orientation: Orientation;
  onRotated: (o: Orientation) => void;
  /**
   * Whether the tiles are drawn. Separate from `active` so the outgoing view can stay
   * on screen, underneath, until the incoming one has painted its images.
   */
  shown: boolean;
  /** Fired once after becoming active, when the visible tiles' images are painted. */
  onShown: () => void;
};

export function SliderView({
  items,
  entered,
  fisheye,
  active,
  centerProject,
  onActiveChange,
  orientation,
  onRotated,
  shown,
  onShown,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tickerRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const dialNameRef = useRef<HTMLParagraphElement>(null);
  const dialTypeRef = useRef<HTMLSpanElement>(null);
  const dialTagRef = useRef<HTMLSpanElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mediaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const colourRefs = useRef<(HTMLDivElement | null)[]>([]);
  const groupRefs = useRef<(GroupRefs | null)[]>([]);
  const vtickerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const vgroupRefs = useRef<VGroupRefs[][]>([]);
  const ctrl = useRef<Controller | null>(null);
  const itemsRef = useRef(items);
  const shownOrientation = useRef<Orientation>("horizontal");
  const onActiveRef = useRef(onActiveChange);
  const onRotatedRef = useRef(onRotated);
  const onShownRef = useRef(onShown);
  const pendingShown = useRef(false);
  useEffect(() => {
    onActiveRef.current = onActiveChange;
    onRotatedRef.current = onRotated;
    onShownRef.current = onShown;
  });

  // Slot count depends on the viewport; 7 covers a typical desktop for the server render.
  const [slots, setSlots] = useState(() => poolSlots(7));
  const [slotProj, setSlotProj] = useState(() => slotProjects(poolSlots(7), items, 0));
  const slotsRef = useRef(slots);
  const slotProjRef = useRef(slotProj);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const sim = {
      pos: 0,
      target: 0,
      items: itemsRef.current,
      fade: 1,
      filterT: 1,
      lens: 0,
      rot: 0, // 0 = row (slider), 1 = column (list)
      speed: 0, // smoothed scroll speed in cells/s (drives the image lag)
      prevPos: 0,
      prevIntroX: 0,
      introX: 3 * window.innerWidth,
      introFrom: 3 * window.innerWidth,
      introRunning: false,
      introDetent: 0,
      introPasses: 0,
      parked: true,
      interactive: true,
      dragging: false,
      lastActive: -1,
      lastTick: null as number | null,
      lastDialMark: -1,
      lastDialProject: -1,
      raf: 0,
      last: 0,
    };

    let W = window.innerWidth;
    let H = window.innerHeight;
    let cell = cellSize(W, H);

    const measure = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      cell = cellSize(W, H);
      root.style.setProperty("--cell-w", `${cell.w}px`);
      root.style.setProperty("--cell-h", `${cell.h}px`);
      const ts = tickScale(W);
      root.style.setProperty("--ts", String(ts));
      root.style.setProperty("--tick-row-w", `${(6 * TICK_PITCH * ts) / 7 + 1}px`);
      const n = poolSize(W, H);
      if (n !== slotsRef.current.length) {
        const next = poolSlots(n);
        slotsRef.current = next;
        setSlots(next);
      }
      if (sim.parked) sim.introX = sim.introFrom = 3 * W;
    };

    // ---- Per-frame render: writes transforms/opacity straight to the DOM ----
    const renderTiles = () => {
      const slotList = slotsRef.current;
      const pool = slotList.length;
      const M = sim.items.length || 1;
      const lens = sim.lens;
      const angle = (sim.rot * Math.PI) / 2;
      const rotCos = Math.cos(angle);
      const rotSin = Math.sin(angle);
      let projChanged = false;
      const nextProj = slotProjRef.current.slice(0, pool);

      for (let i = 0; i < pool; i++) {
        const e = wrap(-pool / 2, pool / 2, slotList[i] - sim.pos);
        const proj = sim.items[mod(Math.round(sim.pos + e), M)] ?? 0;
        if (nextProj[i] !== proj) {
          nextProj[i] = proj;
          projChanged = true;
        }

        const tile = tileRefs.current[i];
        if (!tile) continue;
        // Spacing blends from tile width (row) to tile height (column) as the strip rotates.
        const S = e * (cell.w + (cell.h - cell.w) * sim.rot);
        const sx = S * rotCos;
        const sy = S * rotSin;
        const visible =
          Math.abs(sx) < W / 2 + cell.w && Math.abs(sy) < H / 2 + cell.h && sim.fade > 0.01;
        tile.style.visibility = visible ? "visible" : "hidden";
        if (!visible) continue;

        const n = clamp(0, 1, 1 - Math.abs(e));
        // Fisheye (DOM approximation of the WebGL lens): bulge the centre, pull the edges in.
        const ae = Math.min(2, Math.abs(e));
        const scale = 1 + lens * (0.08 - 0.1 * ae);
        const squeeze = 1 - lens * 0.04 * ae;
        const x = W / 2 + sx * squeeze + sim.introX - cell.w / 2;
        const y = H / 2 + sy * squeeze - cell.h / 2;
        tile.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
        tile.style.opacity = String(sim.fade * sim.filterT * (INACTIVE_OPACITY + (1 - INACTIVE_OPACITY) * n));
        tile.style.zIndex = String(Math.round(n * 10));
        tile.classList.toggle("is-center", n > 0.5);

        const colour = colourRefs.current[i];
        if (colour) colour.style.opacity = String(n);
        const media = mediaRefs.current[i];
        if (media) {
          const nx = clamp(-1, 1, sx / (W / 2));
          const ny = clamp(-1, 1, sy / (H / 2));
          media.style.transform = mediaTransform(nx, ny, sim.speed * rotCos, sim.speed * rotSin);
        }
      }

      if (projChanged) {
        slotProjRef.current = nextProj;
        setSlotProj(nextProj);
      }

      const activeProj = sim.items[mod(Math.round(sim.pos), M)] ?? 0;
      if (activeProj !== sim.lastActive && sim.interactive) {
        sim.lastActive = activeProj;
        onActiveRef.current(activeProj);
      }
    };

    const renderTicker = () => {
      const r = tickScale(W);
      const pitch = TICK_PITCH * r;
      const s = Math.round(sim.pos);
      const o = sim.pos - s;
      const M = sim.items.length || 1;

      if (W <= COMPACT_BP) {
        // Mobile: a dial that turns 60° per project.
        const wheel = wheelRef.current;
        if (wheel) {
          wheel.style.transform = `translateX(-50%) rotate(${-(60 * sim.pos)}deg)`;
          const mark = 12 * mod(s, 6);
          if (sim.lastDialMark !== mark) {
            wheel.children[sim.lastDialMark]?.classList.remove("is-active");
            wheel.children[mark]?.classList.add("is-active");
            sim.lastDialMark = mark;
          }
        }
        const proj = sim.items[mod(s, M)] ?? 0;
        if (sim.lastDialProject !== proj) {
          sim.lastDialProject = proj;
          const p = projects[proj];
          if (dialNameRef.current) dialNameRef.current.textContent = p.name;
          if (dialTypeRef.current) dialTypeRef.current.textContent = typeMeta(p);
          if (dialTagRef.current) dialTagRef.current.textContent = p.tag;
        }
        return;
      }

      for (let g = 0; g < GROUPS.length; g++) {
        const c = groupRefs.current[g];
        if (!c) continue;
        const d = GROUPS[g] - o;
        if (Math.abs(d) * pitch > W / 2 + pitch) {
          c.el.style.visibility = "hidden";
          continue;
        }
        c.el.style.visibility = "visible";
        const m = clamp(0, 1, 1 - Math.abs(d));
        c.el.style.transform = `translate3d(${W / 2 + d * pitch}px, 0, 0)`;

        const proj = sim.items[mod(s + GROUPS[g], M)] ?? 0;
        if (c.project !== proj) {
          c.project = proj;
          const p = projects[proj];
          c.name.textContent = p.name;
          c.type.textContent = typeMeta(p);
          c.tag.textContent = p.tag;
        }
        const textOpacity = String(clamp(0, 1, (m - 0.55) / 0.45));
        c.name.style.opacity = textOpacity;
        c.meta.style.opacity = textOpacity;

        // Ticks grow from 12px to 16px near the centre; the middle one is 32px and turns red.
        const minor = (12 + 4 * m) / 16;
        for (let t = 0; t < c.ticks.length; t++) {
          const tick = c.ticks[t];
          if (t === (TICKS_PER_GROUP - 1) / 2) tick.classList.toggle("is-active", m > 0.5);
          else tick.style.transform = `scaleY(${minor})`;
        }
      }
    };

    // Side rulers for the list view: the bottom ticker turned on its side, on both edges.
    const renderVTicker = () => {
      if (sim.rot <= 0 && !root.classList.contains("is-vertical")) return;
      const r = tickScale(W);
      const pitch = TICK_PITCH * r;
      const o = sim.pos - Math.round(sim.pos);
      for (const side of vgroupRefs.current) {
        for (let g = 0; g < side.length; g++) {
          const c = side[g];
          const d = VGROUPS[g] - o;
          if (Math.abs(d) * pitch > H / 2 + pitch) {
            c.el.style.visibility = "hidden";
            continue;
          }
          c.el.style.visibility = "visible";
          const m = clamp(0, 1, 1 - Math.abs(d));
          c.el.style.transform = `translate3d(0, ${H / 2 + d * pitch}px, 0)`;
          const minor = (12 + 4 * m) / 16;
          for (let t = 0; t < c.ticks.length; t++) {
            const tick = c.ticks[t];
            if (t === (TICKS_PER_GROUP - 1) / 2) tick.classList.toggle("is-active", m > 0.5);
            else tick.style.transform = `scaleX(${minor})`;
          }
        }
      }
    };

    const step = (dt: number) => {
      if (sim.introRunning) {
        sim.introX += (0 - sim.introX) * (1 - Math.exp(-4 * dt));
        const detent = Math.floor(sim.introX / cell.w);
        if (detent < sim.introDetent) {
          sim.introDetent = detent;
          playTick();
        }
        if (sim.introX < 0.004 * sim.introFrom) {
          sim.introX = 0;
          sim.introRunning = false;
          if (sim.introPasses === 0) playTick();
        }
      }

      sim.pos += (sim.target - sim.pos) * (1 - Math.exp(-dt * 7));
      if (Math.abs(sim.target - sim.pos) < 5e-4 && !sim.dragging) sim.pos = sim.target;

      // Scroll speed, including the intro fly-in. Jumps (view switches, filters) are ignored.
      let moved = sim.pos - sim.prevPos - (sim.introX - sim.prevIntroX) / cell.w;
      if (Math.abs(moved) > 2) moved = 0;
      sim.speed = followSpeed(sim.speed, dt > 0 ? moved / dt : 0, dt);
      sim.prevPos = sim.pos;
      sim.prevIntroX = sim.introX;

      // A tick for every ruler mark that crosses the playhead.
      const o = Math.round(sim.pos);
      const m = clamp(-3, 3, Math.round((sim.pos - o) * (TICK_PITCH / 14)));
      const f = o * TICKS_PER_GROUP + m;
      if (sim.lastTick !== null && f !== sim.lastTick && Math.abs(f - sim.lastTick) <= 3 && !sim.parked) playTick();
      sim.lastTick = f;
    };

    const busy = () => sim.introRunning || sim.dragging || sim.pos !== sim.target || sim.speed !== 0;

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - sim.last) / 1000);
      sim.last = now;
      step(dt);
      renderTiles();
      renderTicker();
      renderVTicker();
      sim.raf = busy() ? requestAnimationFrame(frame) : 0;
    };

    const wake = () => {
      if (sim.raf) return;
      sim.last = performance.now();
      sim.raf = requestAnimationFrame(frame);
    };

    // ---- Snap after wheel / drag inactivity ----
    let settleTimer = 0;
    const settleAfter = (ms: number) => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        sim.target = Math.round(sim.target);
        wake();
      }, ms);
    };

    // ---- Pointer drag with flick ----
    let pointerId = -1;
    let lastX = 0;
    let downX = 0;
    let lastY = 0;
    let downY = 0;
    const vertical = () => sim.rot > 0.5;
    let lastT = 0;
    let downT = 0;
    let startTarget = 0;
    let velocity = 0;

    const onDown = (e: PointerEvent) => {
      if (sim.parked || !sim.interactive || (e.pointerType === "mouse" && e.button !== 0)) return;
      sim.dragging = true;
      pointerId = e.pointerId;
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
      lastT = downT = performance.now();
      startTarget = sim.target;
      velocity = 0;
      root.classList.add("is-dragging");
      try {
        root.setPointerCapture(e.pointerId);
      } catch {}
      window.clearTimeout(settleTimer);
      wake();
    };

    const onMove = (e: PointerEvent) => {
      if (!sim.dragging || e.pointerId !== pointerId) return;
      const gain = W <= COMPACT_BP ? MOBILE_DRAG_GAIN : DRAG_GAIN;
      // Pixels → cells. The reference divides by (cellW / visibleW · screenW), i.e. cell width in px.
      const delta = vertical()
        ? -((e.clientY - lastY) * gain) / cell.h
        : -((e.clientX - lastX) * gain) / cell.w;
      sim.target += delta;
      const now = performance.now();
      velocity = 0.7 * velocity + (delta / Math.max(1, now - lastT)) * 0.3;
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

      // A click (no real movement) on a side tile brings that tile to the centre.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5 && performance.now() - downT < 400) {
        const frac = sim.pos - Math.round(sim.pos);
        const offset = vertical()
          ? Math.round((e.clientY - H / 2) / cell.h + frac)
          : Math.round((e.clientX - W / 2) / cell.w + frac);
        sim.target = Math.round(startTarget) + offset;
        wake();
        return;
      }

      const held = performance.now() - lastT > 90;
      const travel = sim.target + (held ? 0 : 140 * velocity) - startTarget;
      const base = Math.round(startTarget);
      sim.target =
        Math.abs(travel) < FLICK_COMMIT_CELLS
          ? base
          : base + Math.sign(travel) * Math.max(1, Math.round(Math.abs(travel)));
      wake();
    };

    const onWheel = (e: WheelEvent) => {
      if (sim.parked || !sim.interactive) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      sim.target += 0.0016 * clamp(-140, 140, d);
      wake();
      settleAfter(160);
    };

    const onKey = (e: KeyboardEvent) => {
      if (sim.parked || !sim.interactive || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const next = vertical() ? "ArrowDown" : "ArrowRight";
      const prev = vertical() ? "ArrowUp" : "ArrowLeft";
      if (e.key === next) sim.target = Math.round(sim.target) + 1;
      else if (e.key === prev) sim.target = Math.round(sim.target) - 1;
      else return;
      e.preventDefault();
      wake();
    };

    const onResize = () => {
      measure();
      wake();
    };

    let introTimer = 0;
    let rotation: { stop: () => void } | null = null;

    // ---- Controller used by the prop effects below ----
    const tickerLines = () => Array.from(tickerRef.current?.querySelectorAll<HTMLElement>(".tick-line") ?? []);

    ctrl.current = {
      render() {
        renderTiles();
        renderTicker();
        renderVTicker();
      },
      setItems(next, animated) {
        if (!animated) {
          sim.items = next;
          sim.pos = sim.target = 0;
          wake();
          return;
        }
        const half = FILTER_S / 2;
        animate(sim.filterT, 0, {
          duration: half,
          ease: ease.power2InOut,
          onUpdate: (v) => {
            sim.filterT = v;
            wake();
          },
          onComplete: () => {
            sim.items = next;
            sim.pos = sim.target = sim.prevPos = 0;
            sim.speed = 0;
            sim.lastTick = null;
            for (const g of groupRefs.current) if (g) g.project = -1;
            sim.lastDialProject = -1;
            animate(0, 1, {
              duration: half,
              ease: ease.power2InOut,
              onUpdate: (v) => {
                sim.filterT = v;
                wake();
              },
            });
          },
        });
      },
      setFisheye(on) {
        const vignette = vignetteRef.current;
        animate(sim.lens, on ? 1 : 0, {
          duration: 0.9,
          ease: ease.power2InOut,
          onUpdate: (v) => {
            sim.lens = v;
            if (vignette) vignette.style.opacity = String(v);
            wake();
          },
        });
      },
      intro() {
        measure();
        sim.introX = sim.introFrom = 3 * W;
        sim.introPasses = Math.floor(sim.introX / cell.w);
        sim.introDetent = sim.introPasses;
        introTimer = window.setTimeout(() => {
          introTimer = window.setTimeout(() => {
            sim.parked = false;
            sim.introRunning = true;
            wake();
            const lines = tickerLines();
            if (lines.length) {
              animate(lines, { transform: ["translateY(110%)", "translateY(0%)"] }, { duration: 1.3, ease: ease.power3Out });
            }
            const dial = dialRef.current;
            if (dial && isCompact()) {
              animate(dial, { transform: ["translateY(120%)", "translateY(0%)"] }, { duration: 1.3, ease: ease.power3Out });
            }
          }, INTRO_HOLD_MS);
        }, INTRO_HANDOFF_MS);
      },
      setOrientation(o) {
        const target = o === "vertical" ? 1 : 0;
        root.classList.toggle("is-vertical", o === "vertical");
        rotation?.stop();
        // Same 1.6s sextic ease as the grid morph; shorter if reversing mid-turn.
        const duration = VIEW_MOVE_S * Math.abs(target - sim.rot);
        if (duration === 0) {
          onRotatedRef.current(o);
          return;
        }
        playTick();
        const from = sim.rot;
        rotation = animate(0, 1, {
          duration,
          ease: "linear",
          onUpdate: (p) => {
            sim.rot = from + (target - from) * viewMoveEase(p);
            renderTiles();
            renderVTicker();
          },
          onComplete: () => {
            sim.rot = target;
            renderTiles();
            renderVTicker();
            onRotatedRef.current(o);
          },
        });
      },
      setShown(on) {
        sim.fade = on ? 1 : 0;
        renderTiles();
      },
      // Views swap instantly: the grid's morph starts from (and ends on) exactly this row of tiles.
      setActive(on, centerProject) {
        sim.interactive = on;
        if (on) {
          const k = sim.items.indexOf(centerProject);
          if (k >= 0) sim.pos = sim.target = nearestPos(sim.pos, k, sim.items.length);
          sim.lastTick = null;
          pendingShown.current = true;
        } else {
          sim.dragging = false;
          root.classList.remove("is-dragging");
          sim.target = Math.round(sim.target);
          sim.pos = sim.target;
        }
        // A re-centre is a jump, not movement: keep it out of the image lag.
        sim.prevPos = sim.pos;
        sim.speed = 0;
        renderTiles();
        renderTicker();
        renderVTicker();
      },
    };

    // ---- Bind ticker group refs once ----
    groupRefs.current = Array.from(tickerRef.current?.querySelectorAll<HTMLElement>(".tick-group") ?? []).map(
      (el) => ({
        el,
        name: el.querySelector(".tick-name") as HTMLElement,
        meta: el.querySelector(".tick-meta") as HTMLElement,
        type: el.querySelector(".tm-type") as HTMLElement,
        tag: el.querySelector(".tm-tag") as HTMLElement,
        ticks: Array.from(el.querySelectorAll<HTMLElement>(".tick-row i")),
        project: -1,
      }),
    );

    vgroupRefs.current = vtickerRefs.current
      .filter((el): el is HTMLDivElement => !!el)
      .map((side) =>
        Array.from(side.querySelectorAll<HTMLElement>(".vtick-group")).map((el) => ({
          el,
          ticks: Array.from(el.querySelectorAll<HTMLElement>(".vtick-col i")),
        })),
      );

    measure();
    wake();

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
      window.clearTimeout(introTimer);
      rotation?.stop();
      shownOrientation.current = "horizontal";
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      root.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      ctrl.current = null;
    };
  }, []);

  // New slots mount after a resize; position them right away instead of waiting for movement.
  useLayoutEffect(() => {
    ctrl.current?.render();
  }, [slots]);

  // Filter changes cross-fade the tiles out and back in with the new set.
  useEffect(() => {
    if (itemsRef.current === items) return;
    itemsRef.current = items;
    ctrl.current?.setItems(items, true);
  }, [items]);

  useEffect(() => {
    ctrl.current?.setFisheye(fisheye);
  }, [fisheye]);

  const centerRef = useRef(centerProject);
  useLayoutEffect(() => {
    centerRef.current = centerProject;
  });
  const wasShown = useRef(shown);
  useLayoutEffect(() => {
    if (wasShown.current === shown) return;
    wasShown.current = shown;
    ctrl.current?.setShown(shown);
  }, [shown]);

  const wasActive = useRef(active);
  useLayoutEffect(() => {
    if (wasActive.current === active) return;
    wasActive.current = active;
    ctrl.current?.setActive(active, centerRef.current);
  }, [active]);

  useLayoutEffect(() => {
    if (shownOrientation.current === orientation) return;
    shownOrientation.current = orientation;
    ctrl.current?.setOrientation(orientation);
  }, [orientation]);

  useEffect(() => {
    if (entered) ctrl.current?.intro();
  }, [entered]);

  // Handoff: once active and drawn (and any re-centred tiles have their new images
  // mounted), wait for those images to paint before the previous view is let go.
  useEffect(() => {
    if (!pendingShown.current || !active || !shown) return;
    // The flag clears only when the wait completes, so a re-run (new images mounted,
    // or React re-running effects in development) starts a fresh wait instead of dropping it.
    let cancelled = false;
    whenTilesPainted(tileRefs.current).then(() => {
      if (cancelled) return;
      pendingShown.current = false;
      onShownRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [active, shown, slotProj]);

  return (
    <div className={`slider-view${active ? " is-active" : ""}`} ref={rootRef} aria-hidden={!active}>
      <div className="stage" aria-label="Projects" role="region">
        {slots.map((_, i) => {
          const p = projects[slotProj[i] ?? 0];
          return (
            <div
              key={i}
              className="sv-tile"
              ref={(el) => {
                tileRefs.current[i] = el;
              }}
            >
              <div
                className="sv-media"
                ref={(el) => {
                  mediaRefs.current[i] = el;
                }}
              >
                <div className="sv-grey">
                  <Image
                    key={p.slug}
                    src={p.image}
                    alt=""
                    fill
                    loading="eager"
                    sizes={IMAGE_SIZES}
                    draggable={false}
                  />
                </div>
                <div
                  className="sv-colour"
                  ref={(el) => {
                    colourRefs.current[i] = el;
                  }}
                >
                  <Image
                    key={p.slug}
                    src={p.image}
                    alt={p.name}
                    fill
                    loading="eager"
                    sizes={IMAGE_SIZES}
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          );
        })}
        <div className="stage-vignette" ref={vignetteRef} aria-hidden="true" />
      </div>

      {/* Mobile dial */}
      <div className="dial" ref={dialRef} aria-hidden="true">
        <span className="dial-disc" />
        <span className="dial-top-caret" />
        <span className="reveal-mask dial-name-mask">
          <p className="dial-name" ref={dialNameRef} />
        </span>
        <p className="dial-meta">
          <span className="tm-type" ref={dialTypeRef} />
          <span className="tm-dot">•</span>
          <span className="tm-tag" ref={dialTagRef} />
        </p>
        <div className="dial-wheel" ref={wheelRef}>
          {DIAL_MARKS.map((deg) => (
            <i
              key={deg}
              className={deg % 60 === 0 ? "major" : undefined}
              style={{ transform: `rotate(${deg}deg) translateY(-217px)` }}
            />
          ))}
        </div>
      </div>

      {/* List view: rulers down both edges and a ◀ pointing at the project name */}
      {(["left", "right"] as const).map((side, si) => (
        <div
          key={side}
          className={`vticker vticker-${side}`}
          aria-hidden="true"
          ref={(el) => {
            vtickerRefs.current[si] = el;
          }}
        >
          <div className="vticker-strip">
            {VGROUPS.map((g) => (
              <div key={g} className="vtick-group">
                <div className="vtick-col">
                  {Array.from({ length: TICKS_PER_GROUP }, (_, t) => (
                    <i key={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="vticker-caret" aria-hidden="true" />

      {/* Desktop ticker: a ruler with one group of 7 ticks per project */}
      <div className="ticker" ref={tickerRef} aria-hidden="true">
        <span className="ticker-caret" />
        <div className="ticker-strip">
          {GROUPS.map((g) => (
            <div key={g} className="tick-group">
              <div className="reveal-mask">
                <p className="tick-name tick-line" />
              </div>
              <div className="reveal-mask">
                <p className="tick-meta tick-line">
                  <span className="tm-type" />
                  <span className="tm-dot">•</span>
                  <span className="tm-tag" />
                </p>
              </div>
              <div className="tick-row">
                {Array.from({ length: TICKS_PER_GROUP }, (_, t) => (
                  <i key={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
