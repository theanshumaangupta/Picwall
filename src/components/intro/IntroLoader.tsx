"use client";

import { animate } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { RollText } from "@/components/RollText";
import { site } from "@/config/site";
import { ease } from "@/lib/ease";
import "./loader.css";

const GROUPS = 41;
const TICKS_PER_GROUP = 7;
const ACTIVE_GROUP = 20; // centre group, always lit
const MIN_FILL_MS = 2000; // bar never fills faster than this
const COMPACT_BP = 760;

const tickScale = () => Math.max(0.7, Math.min(1.15, window.innerWidth / 1728));
// Frame-rate independent exponential smoothing.
const easeFactor = (dt: number) => 1 - Math.exp(-(dt / 1000) * 7);

type Props = {
  onEnter: (withSound: boolean) => void;
  onDone: () => void;
};

export function IntroLoader({ onEnter, onDone }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLParagraphElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<SVGSVGElement>(null);
  const leaving = useRef(false);
  const [ready, setReady] = useState(false);

  // Entrance: every text line rises out of its mask.
  useEffect(() => {
    const lines = rootRef.current?.querySelectorAll(".loader-line");
    if (!lines) return;
    const anim = animate(
      lines,
      { transform: ["translateY(110%)", "translateY(0%)"] },
      { duration: 0.9, ease: ease.power3Out },
    );
    return () => anim.stop();
  }, []);

  // Preload + progress loop. Writes straight to the DOM each frame, no re-renders.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const images = site.preload;
    const total = images.length + 1; // +1 for the tick sound
    let loaded = 0;
    const bump = () => (loaded += 100 / total);

    let ticks: { el: HTMLElement; x: number }[] = [];
    const measure = () => {
      strip.style.setProperty("--lt-s", String(tickScale()));
      ticks = Array.from(strip.querySelectorAll<HTMLElement>(".lt-group i")).map((el) => {
        const r = el.getBoundingClientRect();
        return { el, x: r.left + r.width / 2 };
      });
    };
    measure();
    const measureRaf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);

    fetch("/tick.mp3").then(bump, bump);

    // Images load 4 at a time once the main thread is idle.
    let cancelled = false;
    const loadImages = () => {
      if (cancelled || !images.length) return;
      let next = 0;
      let inFlight = 0;
      const pump = () => {
        while (inFlight < 4 && next < images.length) {
          inFlight++;
          const img = new Image();
          img.onload = img.onerror = () => {
            inFlight--;
            bump();
            pump();
          };
          img.src = images[next++];
        }
      };
      pump();
    };
    const hasIdle = "requestIdleCallback" in window;
    const idleId = hasIdle
      ? requestIdleCallback(loadImages, { timeout: 1200 })
      : window.setTimeout(loadImages, 400);

    const start = performance.now();
    let last = start;
    let shown = 0;
    let lastPct = -1;
    let raf = 0;

    const frame = (now: number) => {
      const target = Math.min(100, ((now - start) / MIN_FILL_MS) * 100, loaded + 0.5);
      shown += (target - shown) * easeFactor(now - last);
      last = now;
      if (target >= 100 && shown > 99.6) shown = 100;

      const pct = Math.floor(shown);
      if (pct !== lastPct && pctRef.current) {
        lastPct = pct;
        pctRef.current.textContent = `${String(pct).padStart(2, "0")}%`;
      }

      const px = (shown / 100) * window.innerWidth;
      const headX = Math.max(0, Math.min(window.innerWidth - 14, px - 7));
      if (headRef.current) headRef.current.style.transform = `translate3d(${headX}px, 0, 0)`;
      for (const t of ticks) t.el.classList.toggle("is-filled", t.x <= px);

      if (shown >= 100) {
        if (headRef.current) animate(headRef.current, { opacity: 0 }, { duration: 0.5, ease: ease.power2Out });
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      if (hasIdle) cancelIdleCallback(idleId);
      else clearTimeout(idleId);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(measureRaf);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const enter = async (withSound: boolean) => {
    const root = rootRef.current;
    if (!root || leaving.current) return;
    leaving.current = true;

    const q = (sel: string) => root.querySelectorAll(sel);
    root.style.pointerEvents = "none";
    // Ticks drain back to grey via their CSS colour transition.
    q(".lt-group i.is-filled").forEach((el) => el.classList.remove("is-filled"));

    animate(q(".loader-actions, .loader-pct, .loader-head"), { opacity: 0 }, { duration: 0.4, ease: ease.power2In });
    if (window.matchMedia(`(max-width: ${COMPACT_BP}px)`).matches) {
      animate(q(".loader-strip"), { opacity: 0 }, { duration: 0.45, ease: ease.power2In });
    }
    await animate(
      q(".loader-line"),
      { transform: ["translateY(0%)", "translateY(-110%)"] },
      { duration: 0.8, ease: ease.power3In },
    );

    onEnter(withSound);
    await animate(root, { backgroundColor: "rgba(17, 17, 17, 0)" }, { duration: 0.9, ease: ease.power2InOut });
    root.style.display = "none";
    onDone();
  };

  return (
    <div className="loader" ref={rootRef}>
      <div className="loader-inner">
        <h1 className="loader-title">
          <span className="reveal-mask">
            <span className="loader-line">
              {site.name}
              <sup>®</sup>
            </span>
          </span>
        </h1>
        <p className="loader-copy">
          {site.tagline.map((line, i) => (
            <Fragment key={line}>
              {i > 0 && <br />}
              <span className="reveal-mask">
                <span className="loader-line">{line}</span>
              </span>
            </Fragment>
          ))}
        </p>
        <div className={`loader-actions${ready ? " is-ready" : ""}`}>
          <button type="button" className="loader-enter" onClick={() => enter(true)}>
            <RollText>enter with sound</RollText>
          </button>
          <button type="button" className="loader-enter-quiet" onClick={() => enter(false)}>
            <RollText>[enter without]</RollText>
          </button>
        </div>
      </div>

      <p className="loader-pct" ref={pctRef}>
        00%
      </p>

      <div className="loader-strip" ref={stripRef} aria-hidden="true">
        <div className="loader-ticks">
          {Array.from({ length: GROUPS }, (_, g) => (
            <div key={g} className={`lt-group${g === ACTIVE_GROUP ? " lt-active" : ""}`}>
              {Array.from({ length: TICKS_PER_GROUP }, (_, t) => (
                <i key={t} />
              ))}
            </div>
          ))}
        </div>
        {/* Playhead: downward triangle on a 1px stem */}
        <svg ref={headRef} className="loader-head" viewBox="0 0 14 100" preserveAspectRatio="none" fill="var(--red)">
          <path d="M7.5 11.2V100h-1V11.1L0 0h14z" />
        </svg>
      </div>
    </div>
  );
}
