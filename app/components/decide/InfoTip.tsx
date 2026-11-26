"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A small info icon whose tooltip holds the method, formula or assumptions, so captions stay short. */
export function InfoTip({ children, label = "How this is calculated", className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-sm align-middle text-muted-foreground transition-colors duration-(--dur-1) hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
            className,
          )}
        >
          <Info className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="block max-w-sm text-left leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

/** Section title with an info tip beside it. */
export function TitleWithTip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {title}
      <InfoTip label={`About ${title.toLowerCase()}`}>{children}</InfoTip>
    </span>
  );
}
