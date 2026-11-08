@AGENTS.md

# PicWall

## Project goal
We are rebuilding an existing website (**remyshoots.co.za**, a production studio's portfolio) as **PicWall**.
The user shows the original site page by page (screenshots or descriptions) and says what to build next.
Match the original's layout, motion and feel as closely as possible, while keeping the PicWall name and copy.

## Reference resources: `resources/`
`resources/` is a saved copy of the original site. **Check it before building anything**, so you can match real values instead of guessing them.

| Folder | Contents | Use it for |
|---|---|---|
| `resources/code/remyshoots.co.za/_next/static/chunks/` | Built JS bundles and one CSS file (`1kpbxe9qqm9zq.css`) | Colours, spacing, font sizes, animation timings/easings, component behaviour. The files are minified, so search them (Grep) rather than reading them top to bottom |
| `resources/code/fonts.googleapis*.com/css2` | Google Fonts CSS | Finding out which font families and weights the site uses |
| `resources/fonts/` | 2 `.woff2` font files | Identifying the fonts. Load the equivalents with `next/font` |
| `resources/images/` | Site images plus Mux video thumbnails (`image.mux.com`) | Layout reference and placeholder content during development |
| `resources/videos/remyshoots.co.za/tick.mp3` | UI tick sound (likely the loader / "enter with sound" tick) | Sound design reference |
| `resources/other/` | A binary blob | Probably not useful |

`resources/files-that-could-not-be-added.txt` lists URLs that could not be saved.

Treat `resources/` as **read-only reference material**. Don't import from it in app code. The images, fonts, audio and brand belong to the original studio. Use them only as local placeholders while developing, and replace them with PicWall's own assets before anything goes public. `resources/` should not ship.

## Stack
- Next.js 16 (App Router, `src/` dir). It has breaking changes, so read `node_modules/next/dist/docs/` before using unfamiliar APIs (see AGENTS.md)
- Tailwind CSS 4. Theme tokens are in `src/app/globals.css` (`bg-background`, `text-accent`, `text-muted`, `bg-tick`)
- Motion (`motion/react`) for UI animation. Add GSAP + ScrollTrigger only when scroll-driven effects are needed
- Fonts: Inter (display) and Roboto Mono (UI labels), set up in `src/app/layout.tsx`

## Structure
- `src/config/site.ts`: brand name, tagline, list of images to preload
- `src/components/Experience.tsx`: client root; shows the intro, then the site
- `src/components/intro/`: intro screen (`IntroScreen`) and ruler-scale loader (`RulerLoader`)
- `src/components/home/`: landing page after the intro. `Home` (header, view switching, centred-project meta, footer toggles, entrance animation), `SliderView` (tile strip: horizontal = slider, vertical = list view; ruler ticker, side rulers, mobile dial; one rAF loop that writes transforms directly), `GridView` (2D grid, edge rulers; morphs out of / back into the slider row), `CursorCaption` ("drag" / "view project"), `TrustedBadge`, `gallery.ts` (shared geometry + easing), `lens.ts` (fisheye: the reference's lens projection, drawn in WebGL over the DOM tiles while the lens is on), `home.css`
- The original's grid and list JS chunks were not saved; their values come from its CSS, the slider's `rot` code, and the user's screenshots
- `src/config/projects.ts`: portfolio entries, filters, `typeMeta()`. Images point at `public/dev/` placeholders (copied from `resources/`, must be replaced before going public)

## Conventions
- Animate only `transform` and `opacity`. Pages will be image-heavy.
- No `Math.random()` / `Date.now()` during render, because they cause hydration mismatches. Use deterministic noise (see `RulerLoader`).
- Use `next/image` for images: lazy loading, responsive sizes, and `priority` only for above-the-fold images.

## Commands
- `npm run dev`: dev server at http://localhost:3000
- `npx tsc --noEmit` and `npx eslint src`: type-check and lint
- If CSS edits don't show up, Turbopack's persistent cache is stale. Stop the server, delete `.next/` and restart.
