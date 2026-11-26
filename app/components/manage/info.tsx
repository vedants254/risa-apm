"use client";

/** A small info icon whose tooltip carries the explanation a caption used to. */
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoTip({ children, label = "More about this" }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-5 items-center justify-center rounded-sm align-middle text-muted-foreground transition-colors duration-(--dur-1) outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Info className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80 text-left leading-relaxed font-normal">
        <div className="space-y-1">{children}</div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Section title with an optional info tooltip. */
export function TitleWithInfo({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {title}
      {children && <InfoTip label={`About ${title.toLowerCase()}`}>{children}</InfoTip>}
    </span>
  );
}

/** Campaign status as a small neutral dot and muted text. No tinted pill. */
export function StatusDot({ status }: { status: string }) {
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span
        aria-hidden
        className={
          status === "active"
            ? "size-1.5 rounded-full bg-foreground"
            : status === "paused"
              ? "size-1.5 rounded-full border border-muted-foreground"
              : "size-1.5 rounded-full bg-muted-foreground/50"
        }
      />
      {label}
    </span>
  );
}
