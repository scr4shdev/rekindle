import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Era-styled illustrations drawn with CSS only (no image requests): printed
 * patterns that evoke mid-century postcards, record sleeves and tablecloths.
 * Used when an entity has no image and for persona cards. Purely decorative.
 */
export type EraMotif =
  | "awning"
  | "tweed"
  | "zellige"
  | "vinyl"
  | "filmstrip"
  | "pennant"
  | "gingham"
  | "portrait"
  | "stamp"
  | "houndstooth"
  | "screen"
  | "pages"
  | "sunrise";

const c = (v: string, pct = 100) => (pct === 100 ? `var(${v})` : `color-mix(in oklch, var(${v}) ${pct}%, transparent)`);

const MOTIFS: Record<EraMotif, CSSProperties> = {
  awning: {
    background: `repeating-linear-gradient(90deg, ${c("--primary", 85)} 0 22px, ${c("--card")} 22px 44px)`,
  },
  tweed: {
    backgroundColor: c("--sage-soft"),
    backgroundImage: `repeating-linear-gradient(45deg, ${c("--sage", 35)} 0 2px, transparent 2px 9px), repeating-linear-gradient(-45deg, ${c("--sage", 25)} 0 2px, transparent 2px 9px)`,
  },
  zellige: {
    backgroundColor: "oklch(0.42 0.09 250)",
    backgroundImage:
      "radial-gradient(circle at 50% 50%, oklch(0.93 0.03 85) 0 18%, transparent 19%), conic-gradient(from 45deg, oklch(0.55 0.11 200) 0 25%, oklch(0.42 0.09 250) 0 50%, oklch(0.55 0.11 200) 0 75%, oklch(0.42 0.09 250) 0)",
    backgroundSize: "36px 36px",
  },
  vinyl: {
    backgroundImage: `radial-gradient(circle at 68% 58%, ${c("--primary")} 0 13%, oklch(0.93 0.03 85) 13.5% 14.5%, transparent 15%), radial-gradient(circle at 68% 58%, transparent 0 58%, ${c("--ochre-soft")} 58.5%), repeating-radial-gradient(circle at 68% 58%, oklch(0.2 0.01 50) 0 3px, oklch(0.3 0.01 50) 3px 4px)`,
  },
  filmstrip: {
    backgroundColor: "oklch(0.22 0.015 50)",
    backgroundImage:
      "repeating-linear-gradient(90deg, oklch(0.93 0.02 80) 0 9px, transparent 9px 22px), repeating-linear-gradient(90deg, oklch(0.93 0.02 80) 0 9px, transparent 9px 22px), linear-gradient(oklch(0.22 0.015 50) 0 15%, transparent 15% 85%, oklch(0.22 0.015 50) 85%), radial-gradient(ellipse at 40% 40%, oklch(0.78 0.06 75), oklch(0.5 0.05 60) 75%)",
    backgroundSize: "100% 7%, 100% 7%, 100% 100%, 100% 100%",
    backgroundPosition: "0 4%, 0 96%, 0 0, 0 0",
    backgroundRepeat: "repeat-x, repeat-x, no-repeat, no-repeat",
  },
  pennant: {
    backgroundImage: `repeating-linear-gradient(-30deg, ${c("--primary", 80)} 0 26px, ${c("--card")} 26px 40px, oklch(0.45 0.09 250) 40px 66px, ${c("--card")} 66px 80px)`,
  },
  gingham: {
    backgroundColor: c("--card"),
    backgroundImage: `linear-gradient(90deg, ${c("--rose", 45)} 50%, transparent 50%), linear-gradient(${c("--rose", 45)} 50%, transparent 50%)`,
    backgroundSize: "28px 28px",
  },
  portrait: {
    backgroundColor: c("--ochre-soft"),
    backgroundImage: `radial-gradient(ellipse 30% 40% at 50% 50%, ${c("--card")} 0 92%, ${c("--ochre")} 93% 97%, transparent 98%), repeating-linear-gradient(0deg, ${c("--ochre", 18)} 0 1px, transparent 1px 6px)`,
  },
  stamp: {
    backgroundColor: c("--sage-soft"),
    backgroundImage: `radial-gradient(circle, ${c("--card")} 0 4px, transparent 4.5px), linear-gradient(160deg, ${c("--sage", 40)}, transparent 70%)`,
    backgroundSize: "16px 16px, 100% 100%",
  },
  houndstooth: {
    backgroundColor: c("--card"),
    backgroundImage: `linear-gradient(45deg, ${c("--foreground", 70)} 25%, transparent 25% 50%, ${c("--foreground", 70)} 50% 75%, transparent 75%)`,
    backgroundSize: "14px 14px",
  },
  screen: {
    backgroundColor: "oklch(0.3 0.02 220)",
    backgroundImage:
      "radial-gradient(ellipse 60% 55% at 50% 50%, oklch(0.75 0.03 200) 0, oklch(0.4 0.03 220) 70%, transparent 71%), repeating-linear-gradient(0deg, oklch(1 0 0 / 7%) 0 1px, transparent 1px 3px)",
  },
  pages: {
    backgroundColor: c("--card"),
    backgroundImage: `repeating-linear-gradient(0deg, ${c("--muted-foreground", 25)} 0 1px, transparent 1px 18px), linear-gradient(90deg, transparent 0 14%, ${c("--rose", 50)} 14% 14.6%, transparent 14.6%)`,
  },
  sunrise: {
    backgroundColor: c("--ochre-soft"),
    backgroundImage: `repeating-conic-gradient(from 270deg at 50% 100%, ${c("--ochre", 30)} 0 6deg, transparent 6deg 12deg), radial-gradient(circle at 50% 100%, ${c("--primary", 70)} 0 22%, transparent 22.5%)`,
  },
};

export function EraArt({
  motif,
  className,
  children,
}: {
  motif: EraMotif;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden={children ? undefined : true}
      className={cn("relative isolate overflow-hidden", className)}
      data-motif={motif}
    >
      <div className="absolute inset-0 -z-10" style={MOTIFS[motif]} />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_55%,oklch(0.2_0.03_50/22%))]" />
      {children}
    </div>
  );
}
