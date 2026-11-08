// GSAP's named eases as cubic-béziers, so timings ported from the reference site match.
export const ease = {
  power2In: [0.55, 0.085, 0.68, 0.53],
  power2Out: [0.25, 0.46, 0.45, 0.94],
  power2InOut: [0.455, 0.03, 0.515, 0.955],
  power3In: [0.55, 0.055, 0.675, 0.19],
  power3Out: [0.215, 0.61, 0.355, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;
