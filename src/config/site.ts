export const site = {
  name: "DEBOLINA KAR",
  /** Short mark used in the page header */
  monogram: "DK",
  tagline: ["A visual archive of frames, faces", "and the stories between them."],
  // Images to preload during the intro. Progress tracks these for real.
  preload: [] as string[],
  nav: [
    { label: "about", href: "#about" },
    { label: "contact", href: "#contact" },
  ],
  // Placeholder client logos for the footer badge (dev only, see public/dev/clients).
  clients: ["nike", "netflix", "adidas", "levis", "new-balance", "puma", "sony", "redbull"],
};
