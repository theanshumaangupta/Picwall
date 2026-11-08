import type { ReactNode } from "react";

/** Text that rolls up to a duplicate of itself (or `to`) when its parent link/button is hovered. */
export function RollText({ children, to }: { children: ReactNode; to?: ReactNode }) {
  return (
    <span className="roll">
      <span className="roll-inner">
        <span className="roll-face">{children}</span>
        <span className="roll-face" aria-hidden="true">
          {to ?? children}
        </span>
      </span>
    </span>
  );
}
