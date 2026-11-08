"use client";

import { useEffect, useRef } from "react";

const FOLLOW_RATE = 12; // ≈ the reference's 0.25s power3.out follow

/**
 * Bracketed label that trails the mouse over the gallery: "view project" on the
 * centred tile, "drag" anywhere else. Hidden over links and buttons.
 */
export function CursorCaption() {
  const rootRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const hint = hintRef.current;
    if (!root || !hint || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let tx = x;
    let ty = y;
    let raf = 0;
    let last = 0;
    let text = "";

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const f = 1 - Math.exp(-dt * FOLLOW_RATE);
      x += (tx - x) * f;
      y += (ty - y) * f;
      root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = Math.hypot(tx - x, ty - y) > 0.3 ? requestAnimationFrame(frame) : 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      const el = document.elementFromPoint(tx, ty);
      let next = "";
      if (el && !el.closest("a, button, .loader") && el.closest(".slider-view.is-active, .grid-view.is-active")) {
        next = el.closest(".is-center") ? "view project" : "drag";
      }
      if (next !== text) {
        if (!text) {
          // Appear at the pointer instead of sliding in from the last spot.
          x = tx;
          y = ty;
        }
        text = next;
        if (next) hint.textContent = next;
        root.classList.toggle("is-visible", !!next);
      }
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onLeave = () => {
      text = "";
      root.classList.remove("is-visible");
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="cursor-caption" ref={rootRef} aria-hidden="true">
      <span className="cursor-hint" ref={hintRef} />
    </div>
  );
}
