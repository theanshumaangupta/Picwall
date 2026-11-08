"use client";

import { animate } from "motion/react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { projects, typeMeta } from "@/config/projects";
import { ease } from "@/lib/ease";
import { playTick } from "@/lib/sound";

// ---- Constants ported from the reference slider (module 21307) ----
const COMPACT_BP = 760;
const CELL_RATIO = 587.67 / 876.58; // tile w / h
const INACTIVE_OPACITY = 0.5;
const TICKS_PER_GROUP = 7;
const TICK_PITCH = 100; // px per project at 1728px wide
const DRAG_GAIN = 2.2;
const MOBILE_DRAG_GAIN = 2.6;
const FLICK_COMMIT_CELLS = 0.1;
const INTRO_HOLD_MS = 250;
// The page entrance hands off to the slider at 60% of its 0.9s timeline, minus the hold.
const INTRO_HANDOFF_MS = 0.9 * 0.6 * 1000 - INTRO_HOLD_MS;
const FILTER_S = 1.6;
const PARALLAX_PCT = 6; // image travel inside a tile, % of tile width

const GROUPS = Array.from({ length: 41 }, (_, i) => i - 20);
const DIAL_MARKS = Array.from({ length: 72 }, (_, i) => i * 5);

const mod = (a: number, n: number) => ((a % n) + n) % n;
const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));
const wrap = (min: number, max: number, v: number) => min + mod(v - min, max - min);
const tickScale = (w: number) => clamp(0.7, 1.15, w / 1728);
const isCompact = () => window.innerWidth <= COMPACT_BP;

function cellSize(W: number, H: number) {
  if (W <= COMPACT_BP) return { w: H * (758 / 1116), h: H };
  const h = Math.min(((587.67 / 1728) * W * 1.15) / CELL_RATIO, 0.72 * H);
  return { w: h * CELL_RATIO, h };
}

function poolSize(W: number, H: number) {
  const n = Math.ceil(W / Math.max(1e-6, cellSize(W, H).w)) + 2;
  return Math.max(5, n % 2 === 0 ? n + 1 : n);
}

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

type Props = {
  items: number[];
  entered: boolean;
  fisheye: boolean;
};

export function SliderView({ items, entered, fisheye }: Props) {
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
  const ctrl = useRef<Controller | null>(null);
  const itemsRef = useRef(items);

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
      introX: 3 * window.innerWidth,
      introFrom: 3 * window.innerWidth,
      introRunning: false,
      introDetent: 0,
      introPasses: 0,
      parked: true,
      dragging: false,
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
        const S = e * cell.w;
        const visible = Math.abs(S) < W / 2 + cell.w && sim.fade > 0.01;
        tile.style.visibility = visible ? "visible" : "hidden";
        if (!visible) continue;

        const n = clamp(0, 1, 1 - Math.abs(e));
        // Fisheye (DOM approximation of the WebGL lens): bulge the centre, pull the edges in.
        const ae = Math.min(2, Math.abs(e));
        const scale = 1 + lens * (0.08 - 0.1 * ae);
        const x = W / 2 + S * (1 - lens * 0.04 * ae) + sim.introX - cell.w / 2;
        tile.style.transform = `translate3d(${x}px, ${(H - cell.h) / 2}px, 0) scale(${scale})`;
        tile.style.opacity = String(sim.fade * sim.filterT * (INACTIVE_OPACITY + (1 - INACTIVE_OPACITY) * n));
        tile.style.zIndex = String(Math.round(n * 10));

        const colour = colourRefs.current[i];
        if (colour) colour.style.opacity = String(n);
        const media = mediaRefs.current[i];
        if (media) {
          const norm = clamp(-1, 1, S / (W / 2));
          media.style.transform = `translate3d(${-norm * PARALLAX_PCT}%, 0, 0) scale(${1 / 0.88})`;
        }
      }

      if (projChanged) {
        slotProjRef.current = nextProj;
        setSlotProj(nextProj);
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

      // A tick for every ruler mark that crosses the playhead.
      const o = Math.round(sim.pos);
      const m = clamp(-3, 3, Math.round((sim.pos - o) * (TICK_PITCH / 14)));
      const f = o * TICKS_PER_GROUP + m;
      if (sim.lastTick !== null && f !== sim.lastTick && Math.abs(f - sim.lastTick) <= 3 && !sim.parked) playTick();
      sim.lastTick = f;
    };

    const busy = () => sim.introRunning || sim.dragging || sim.pos !== sim.target;

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - sim.last) / 1000);
      sim.last = now;
      step(dt);
      renderTiles();
      renderTicker();
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
    let lastT = 0;
    let downT = 0;
    let startTarget = 0;
    let velocity = 0;

    const onDown = (e: PointerEvent) => {
      if (sim.parked || (e.pointerType === "mouse" && e.button !== 0)) return;
      sim.dragging = true;
      pointerId = e.pointerId;
      lastX = downX = e.clientX;
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
      const delta = -((e.clientX - lastX) * gain) / cell.w;
      sim.target += delta;
      const now = performance.now();
      velocity = 0.7 * velocity + (delta / Math.max(1, now - lastT)) * 0.3;
      lastT = now;
      lastX = e.clientX;
      wake();
    };

    const onUp = (e: PointerEvent) => {
      if (!sim.dragging || e.pointerId !== pointerId) return;
      sim.dragging = false;
      pointerId = -1;
      root.classList.remove("is-dragging");

      // A click (no real movement) on a side tile brings that tile to the centre.
      if (Math.abs(e.clientX - downX) < 5 && performance.now() - downT < 400) {
        const offset = Math.round((e.clientX - W / 2) / cell.w + (sim.pos - Math.round(sim.pos)));
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
      if (sim.parked) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      sim.target += 0.0016 * clamp(-140, 140, d);
      wake();
      settleAfter(160);
    };

    const onKey = (e: KeyboardEvent) => {
      if (sim.parked || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") sim.target = Math.round(sim.target) + 1;
      else if (e.key === "ArrowLeft") sim.target = Math.round(sim.target) - 1;
      else return;
      wake();
    };

    const onResize = () => {
      measure();
      wake();
    };

    // ---- Controller used by the prop effects below ----
    const tickerLines = () => Array.from(tickerRef.current?.querySelectorAll<HTMLElement>(".tick-line") ?? []);

    ctrl.current = {
      render() {
        renderTiles();
        renderTicker();
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
            sim.pos = sim.target = 0;
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
        window.setTimeout(() => {
          window.setTimeout(() => {
            sim.parked = false;
            sim.introRunning = true;
            wake();
            animate(
              tickerLines(),
              { transform: ["translateY(110%)", "translateY(0%)"] },
              { duration: 1.3, ease: ease.power3Out },
            );
            const dial = dialRef.current;
            if (dial && isCompact()) {
              animate(dial, { transform: ["translateY(120%)", "translateY(0%)"] }, { duration: 1.3, ease: ease.power3Out });
            }
          }, INTRO_HOLD_MS);
        }, INTRO_HANDOFF_MS);
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

  useEffect(() => {
    if (entered) ctrl.current?.intro();
  }, [entered]);

  return (
    <div className="slider-view" ref={rootRef}>
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
                    sizes="(max-width: 760px) 70vw, 30vw"
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
                    sizes="(max-width: 760px) 70vw, 30vw"
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
