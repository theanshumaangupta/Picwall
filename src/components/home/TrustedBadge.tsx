"use client";

import { animate } from "motion/react";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { site } from "@/config/site";
import { ease } from "@/lib/ease";

const HOLD_MS = 1400;

/** Corner-bracket box that cycles through client logos: fade in 0.5s, hold 1.4s, fade out 0.5s. */
export function TrustedBadge() {
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const logos = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(".trusted-logo") ?? []);
    if (!logos.length) return;
    let stopped = false;
    let timer = 0;
    const wait = (ms: number) => new Promise<void>((r) => (timer = window.setTimeout(r, ms)));

    (async () => {
      for (let i = 0; !stopped; i = (i + 1) % logos.length) {
        const el = logos[i];
        await animate(el, { opacity: [0, 1] }, { duration: 0.5, ease: ease.power2Out });
        if (stopped) break;
        await wait(HOLD_MS);
        if (stopped) break;
        await animate(el, { opacity: 0 }, { duration: 0.5, ease: ease.power2In });
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <span className="trusted-badge" ref={rootRef}>
      {site.clients.map((slug) => (
        <Image
          key={slug}
          className="trusted-logo"
          src={`/dev/clients/${slug}.svg`}
          alt=""
          aria-hidden="true"
          width={115}
          height={64}
          unoptimized
        />
      ))}
    </span>
  );
}
