"use client";

import { animate } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RollText } from "@/components/RollText";
import { filterItems, filters, projects, typeMeta, type Filter } from "@/config/projects";
import { site } from "@/config/site";
import { ease } from "@/lib/ease";
import { playTick } from "@/lib/sound";
import { CursorCaption } from "./CursorCaption";
import { GridView } from "./GridView";
import { SliderView, type Orientation } from "./SliderView";
import { TrustedBadge } from "./TrustedBadge";
import "./home.css";

const VIEWS = ["slider", "grid", "list"] as const;
type View = (typeof VIEWS)[number];

/** A line of text that rises out of a mask on entrance and rolls on hover. */
function Line({ children }: { children: ReactNode }) {
  return (
    <span className="reveal-mask">
      <span data-reveal="line">
        <RollText>{children}</RollText>
      </span>
    </span>
  );
}

type Props = {
  entered: boolean;
  sound: boolean;
  onToggleSound: () => void;
};

export function Home({ entered, sound, onToggleSound }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navCaretRef = useRef<HTMLSpanElement>(null);
  const filterLinks = useRef<Partial<Record<Filter, HTMLAnchorElement>>>({});
  const toggleRef = useRef<HTMLDivElement>(null);
  const toggleCaretRef = useRef<HTMLSpanElement>(null);
  const viewButtons = useRef<Partial<Record<View, HTMLButtonElement>>>({});

  const [filter, setFilter] = useState<Filter>("works");
  const [fisheye, setFisheye] = useState(false);
  const items = useMemo(() => filterItems(filter), [filter]);
  const [view, setView] = useState<View>("slider");
  const viewRef = useRef<View>("slider");
  // Slider and list are one strip (row / column). The grid morphs out of and back into
  // the row, so moving list ⇄ grid turns the column back into a row first.
  const [sliderActive, setSliderActive] = useState(true);
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [gridOn, setGridOn] = useState(false);
  const [gridMounted, setGridMounted] = useState(false);
  // Project the incoming view centres on; the outgoing view's current project.
  const [centerProject, setCenterProject] = useState(0);
  const activeProject = useRef(0);
  const metaRefs = useRef<Partial<Record<"index" | "name" | "type" | "tag", HTMLElement | null>>>({});

  // Header meta (grid and list) follows the centred project without re-rendering.
  const onActiveChange = useCallback((i: number) => {
    activeProject.current = i;
    const p = projects[i];
    const m = metaRefs.current;
    if (m.index) m.index.textContent = `${String(i + 1).padStart(2, "0")}.`;
    if (m.name) m.name.textContent = p.name;
    if (m.type) m.type.textContent = typeMeta(p);
    if (m.tag) m.tag.textContent = p.tag;
  }, []);
  useEffect(() => onActiveChange(activeProject.current), [onActiveChange]);

  const enterGrid = useCallback(() => {
    setCenterProject(activeProject.current);
    setGridMounted(true);
    setSliderActive(false);
    setGridOn(true);
  }, []);

  const switchView = (v: View) => {
    playTick();
    if (v === viewRef.current) return;
    viewRef.current = v;
    setView(v);
    if (v === "grid") {
      if (orientation === "vertical") setOrientation("horizontal"); // enterGrid once the row is back
      else enterGrid();
    } else if (gridOn) {
      setGridOn(false); // onGridExited hands back to the strip
    } else {
      setOrientation(v === "list" ? "vertical" : "horizontal");
    }
  };

  const onGridExited = useCallback(() => {
    if (viewRef.current === "grid") return;
    setCenterProject(activeProject.current);
    setSliderActive(true);
    if (viewRef.current === "list") setOrientation("vertical");
  }, []);

  const onRotated = useCallback(
    (o: Orientation) => {
      if (o === "horizontal" && viewRef.current === "grid") enterGrid();
    },
    [enterGrid],
  );

  // Red ▶ in the nav follows the hovered link and returns to the current filter.
  const moveNavCaret = useCallback((link: HTMLElement | null | undefined) => {
    const nav = navRef.current;
    const caret = navCaretRef.current;
    if (!nav || !caret || !link) return;
    const n = nav.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    const gap = 8;
    caret.style.transform = `translate3d(${l.left - n.left - gap - caret.offsetWidth}px, ${l.top - n.top}px, 0)`;
  }, []);

  // Red ▲ under the view switch follows the hovered button.
  const moveToggleCaret = useCallback((btn: HTMLElement | null | undefined) => {
    const caret = toggleCaretRef.current;
    if (!caret || !btn) return;
    caret.style.transform = `translate3d(${btn.offsetLeft + btn.offsetWidth / 2 - caret.offsetWidth / 2}px, 0, 0)`;
  }, []);

  useLayoutEffect(() => {
    const place = () => {
      moveNavCaret(filterLinks.current[filter]);
      moveToggleCaret(viewButtons.current[view]);
    };
    place();
    // Fonts swap in after first paint and shift the text, so measure again once they're ready.
    document.fonts?.ready.then(place);
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [filter, view, moveNavCaret, moveToggleCaret]);

  // Page entrance once the intro hands over: lines rise, blocks fade up 28px.
  useEffect(() => {
    const root = rootRef.current;
    if (!entered || !root) return;
    const opts = { duration: 0.9, ease: ease.power3Out };
    const lines = root.querySelectorAll("[data-reveal='line']");
    const blocks = root.querySelectorAll("[data-reveal='chrome'], [data-reveal='block'], [data-reveal='foot']");
    const a = animate(lines, { transform: ["translateY(110%)", "translateY(0%)"] }, opts);
    const b = animate(blocks, { opacity: [0, 1], transform: ["translateY(28px)", "translateY(0px)"] }, opts);
    return () => {
      a.stop();
      b.stop();
    };
  }, [entered]);

  const chooseFilter = (f: Filter) => {
    playTick();
    if (f !== filter) setFilter(f);
  };

  return (
    <div className={`landing view-${view}${entered ? " is-entered" : ""}`} ref={rootRef}>
      <SliderView
        items={items}
        entered={entered}
        fisheye={fisheye}
        active={sliderActive}
        centerProject={centerProject}
        onActiveChange={onActiveChange}
        orientation={orientation}
        onRotated={onRotated}
      />
      {gridMounted && (
        <GridView
          items={items}
          active={gridOn}
          centerProject={centerProject}
          fisheye={fisheye}
          onActiveChange={onActiveChange}
          onExited={onGridExited}
        />
      )}
      <CursorCaption />

      {/* Centred project, spread across the middle of the screen (grid and list views) */}
      {(["index", "name", "type", "tag"] as const).map((slot) => (
        <div key={slot} className={`meta-slot meta-${slot}`}>
          <div className="reveal-mask">
            <p
              className="meta meta-line"
              ref={(el) => {
                metaRefs.current[slot] = el;
              }}
            />
          </div>
        </div>
      ))}

      <header className="chrome" data-reveal="chrome">
        <p className="logo">
          <Line>
            {site.monogram}
            <sup>®</sup>
          </Line>
        </p>
        <p className="tagline">
          {site.tagline.map((line, i) => (
            <span key={line}>
              {i > 0 && <br />}
              <Line>{line}</Line>
            </span>
          ))}
        </p>

        <nav
          className="nav-right"
          aria-label="Primary"
          ref={navRef}
          onMouseLeave={() => moveNavCaret(filterLinks.current[filter])}
        >
          <span className="nav-site-caret is-visible" ref={navCaretRef} aria-hidden="true" />
          <div className="nav-filters">
            {filters.map(({ filter: f, label }) => (
              <a
                key={f}
                href={`#${f}`}
                className={filter === f ? "is-current" : undefined}
                ref={(el) => {
                  if (el) filterLinks.current[f] = el;
                }}
                onMouseEnter={(e) => {
                  playTick();
                  moveNavCaret(e.currentTarget);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  chooseFilter(f);
                }}
              >
                <Line>{label}</Line>
              </a>
            ))}
          </div>
          {site.nav.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onMouseEnter={(e) => {
                playTick();
                moveNavCaret(e.currentTarget);
              }}
            >
              <Line>{link.label}</Line>
            </a>
          ))}
        </nav>
      </header>

      <div
        className="view-toggle"
        data-reveal="block"
        ref={toggleRef}
        onMouseLeave={() => moveToggleCaret(viewButtons.current[view])}
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className={v === view ? "is-active" : undefined}
            ref={(el) => {
              if (el) viewButtons.current[v] = el;
            }}
            aria-pressed={v === view}
            onMouseEnter={(e) => {
              playTick();
              moveToggleCaret(e.currentTarget);
              // Warm up the grid (and its images) before the click.
              if (v === "grid" && entered) setGridMounted(true);
            }}
            onClick={() => switchView(v)}

          >
            <Line>{v}</Line>
          </button>
        ))}
        <span className="toggle-caret" ref={toggleCaretRef} aria-hidden="true" />
      </div>

      <div className="trusted" data-reveal="foot">
        <TrustedBadge />
        <button
          type="button"
          className="fisheye-toggle"
          aria-pressed={fisheye}
          onMouseEnter={playTick}
          onClick={() => {
            playTick();
            setFisheye((v) => !v);
          }}
        >
          <RollText>fisheye:{fisheye ? "[on]" : "[off]"}</RollText>
        </button>
      </div>

      <button
        type="button"
        className="sound-toggle"
        aria-pressed={sound}
        onMouseEnter={playTick}
        onClick={onToggleSound}
      >
        <Line>sound:{sound ? "[on]" : "[off]"}</Line>
      </button>

      <div className="hand-control" data-reveal="foot">
        {/* Hand-gesture control needs camera tracking; not built yet. */}
        <button type="button" className="hand-toggle" aria-pressed={false} aria-disabled onMouseEnter={playTick}>
          <RollText>gestures:[off]</RollText>
        </button>
      </div>
    </div>
  );
}
