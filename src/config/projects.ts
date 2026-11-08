// Portfolio entries for the home slider. Images under /dev are placeholders
// copied from the reference site and must be replaced before going public.

export type ProjectType = "stills" | "motion";

export type Project = {
  slug: string;
  name: string;
  type: ProjectType;
  /** stills: number of frames in the gallery */
  count?: number;
  /** motion: running time in seconds */
  duration?: number;
  tag: string;
  image: string;
};

const still = (n: number) => `/dev/still-${String(n).padStart(2, "0")}.webp`;
const motion = (n: number) => `/dev/motion-${String(n).padStart(2, "0")}.webp`;

export const projects: Project[] = [
  { slug: "city-run", name: "City Women's Run", type: "stills", count: 9, tag: "events", image: still(1) },
  { slug: "after-hours", name: "After Hours", type: "motion", duration: 74, tag: "music", image: motion(1) },
  { slug: "front-row", name: "Front Row", type: "stills", count: 14, tag: "fashion", image: still(2) },
  { slug: "market-day", name: "Market Day", type: "stills", count: 11, tag: "documentary", image: still(3) },
  { slug: "slow-burn", name: "Slow Burn", type: "motion", duration: 128, tag: "campaign", image: motion(2) },
  { slug: "blonde-ambition", name: "Blonde Ambition", type: "stills", count: 8, tag: "editorial", image: still(4) },
  { slug: "rooftop-sessions", name: "Rooftop Sessions", type: "stills", count: 16, tag: "music", image: still(5) },
  { slug: "first-light", name: "First Light", type: "motion", duration: 45, tag: "brand", image: motion(3) },
  { slug: "sunday-best", name: "Sunday Best", type: "stills", count: 12, tag: "portrait", image: still(6) },
  { slug: "street-level", name: "Street Level", type: "stills", count: 20, tag: "personal", image: still(7) },
  { slug: "in-motion", name: "In Motion", type: "motion", duration: 92, tag: "sport", image: motion(4) },
  { slug: "the-gathering", name: "The Gathering", type: "stills", count: 18, tag: "events", image: still(8) },
  { slug: "golden-hour", name: "Golden Hour", type: "stills", count: 10, tag: "editorial", image: still(9) },
  { slug: "nightshift", name: "Nightshift", type: "motion", duration: 61, tag: "music", image: motion(5) },
  { slug: "home-ground", name: "Home Ground", type: "stills", count: 22, tag: "documentary", image: still(10) },
  { slug: "quiet-rooms", name: "Quiet Rooms", type: "stills", count: 7, tag: "portrait", image: still(11) },
  { slug: "pulse", name: "Pulse", type: "motion", duration: 103, tag: "campaign", image: motion(6) },
  { slug: "closing-night", name: "Closing Night", type: "stills", count: 15, tag: "events", image: still(12) },
  { slug: "salt-and-sun", name: "Salt & Sun", type: "stills", count: 26, tag: "personal", image: still(13) },
  { slug: "long-way-home", name: "Long Way Home", type: "motion", duration: 156, tag: "documentary", image: motion(7) },
  { slug: "afterglow", name: "Afterglow", type: "motion", duration: 38, tag: "brand", image: motion(8) },
];

export type Filter = "works" | ProjectType;

export const filters: { filter: Filter; label: string }[] = [
  { filter: "works", label: `works(${projects.length})` },
  { filter: "stills", label: `stills(${projects.filter((p) => p.type === "stills").length})` },
  { filter: "motion", label: `motion(${projects.filter((p) => p.type === "motion").length})` },
];

/** Indexes into `projects` that a filter shows. */
export function filterItems(filter: Filter): number[] {
  return projects.flatMap((p, i) => (filter === "works" || p.type === filter ? [i] : []));
}

/** `stills[9]` or `motion[01:14]`, as in the reference ticker. */
export function typeMeta(p: Project) {
  if (p.type === "motion" && p.duration != null) {
    const m = Math.floor(p.duration / 60);
    const s = Math.floor(p.duration % 60);
    return `motion[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}]`;
  }
  return `${p.type}[${p.count ?? 0}]`;
}
