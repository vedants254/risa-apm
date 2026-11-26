/**
 * The analyst's mark: a friendly robot head in the brand violet with an orange antenna tip.
 * Duotone line drawing on a transparent background; colours come from tokens only
 * (`primary` for the body, `chart-2` for the accent, `card` for the eyes).
 * `animated` adds a short entrance that is skipped under reduced motion.
 */
import { cn } from "@/lib/utils";

export function AnalystMark({ size = 64, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={cn("shrink-0", animated && "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-90 motion-safe:duration-(--dur-3)", className)}
    >
      {/* Antenna with the orange tip */}
      <path d="M32 15V9" className="stroke-primary" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx="32" cy="7" r="3.5" className="fill-chart-2" />
      {/* Ears */}
      <rect x="4.5" y="28" width="6" height="12" rx="3" className="fill-primary/15 stroke-primary" strokeWidth={2.5} />
      <rect x="53.5" y="28" width="6" height="12" rx="3" className="fill-primary/15 stroke-primary" strokeWidth={2.5} />
      {/* Head */}
      <rect x="11" y="15" width="42" height="38" rx="13" className="fill-primary/10 stroke-primary" strokeWidth={2.5} />
      {/* Face screen */}
      <rect x="17.5" y="23" width="29" height="20" rx="8" className="fill-primary" />
      {/* Eyes and smile */}
      <circle cx="26" cy="31.5" r="2.75" className="fill-card" />
      <circle cx="38" cy="31.5" r="2.75" className="fill-card" />
      <path d="M28 37.25c2.4 1.9 5.6 1.9 8 0" className="stroke-card" strokeWidth={2.25} strokeLinecap="round" />
    </svg>
  );
}
