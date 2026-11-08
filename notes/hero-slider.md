# Hero slider: reference findings (built: src/components/home/SliderView.tsx)

Source: `resources/code/remyshoots.co.za/_next/static/chunks/395o8uf5ca3i5.js` (slider view),
`07favsyc_fvex.js` (page chrome: header/footer/toggles), constants in module 21307.
The original renders tiles with react-three-fiber (WebGL). A DOM/CSS version can match it visually; the fisheye lens needs WebGL.

## Layout (from user screenshot)
- Header: `RS®` logo · tagline "documenting emotion, movement and meaning." · view switch `SLIDER GRID LIST` (red caret under active) · filters `▶ WORKS(21) / STILLS(13) / MOTION(8)` · ABOUT · CONTACT
- Middle: row of portrait tiles, centre tile full colour, others greyscale and dimmed. A `[DRAG]` cursor label on hover.
- Footer: client logo box (corner brackets) · `FISHEYE:[OFF]` · centre project name + `STILLS[9] • EVENTS` with a red caret above · `SOUND:[ON]` · `GESTURES:[OFF]` · tick ruler along the bottom edge.

## Constants
- SLIDER_CELL_RATIO = 758/1116 (tile w/h)
- tile size: camera fov 48°, z 10 → visibleH = 2·tan(24°)·10; tile h = min(0.72·visibleH, …)
- INACTIVE_OPACITY 0.5, INACTIVE_SAT 0. Blend by `n = clamp(1 - |offset|)`
- TICK_PITCH 100px per project (× tickScale), TICKS_PER_GROUP 7, the ticker shows 41 groups (−20..20)
- Ticker group width = (84 + 22·n)·scale; name/meta opacity = clamp((n − .55)/.45); tick height 12+4n, centre 32
- DRAG_GAIN 2.2 (mobile 2.6 at ≤760px); flick: velocity EMA `v = .7v + .3·dx/dt`, release adds 140·v if the press lasted < 90ms; commit threshold 0.1 cell, then snap to an integer
- Wheel: target += 0.0016·clamp(delta, ±140), snap after 160ms idle
- Position smoothing: pos += (target − pos)·(1 − exp(−dt·7))
- playTick on every tick crossing (pos·7 rounding), throttled to 20ms in sound.ts
- Intro after entering: tiles slide in from 3× the screen width, ease 1 − exp(−4dt), a tick at each tile passed; holds 250ms first; text lines rise with yPercent 110→0 over 1.3s power3.out
- Mobile (≤760px): a rotating dial (72 marks every 5°, a major mark every 60°, radius 217px) replaces the ticker
- typeMeta: stills → `stills[count]`; motion → `motion[mm:ss]`

## Assets
`resources/images/remyshoots.co*.za/api/sanity-image` are 13 WebP portraits (~1080×1440). Mux thumbnails are under `image.mux.com/*/thumbnail.webp`.
Use them as dev placeholders only (copy to `public/dev/` with a `.webp` extension).
