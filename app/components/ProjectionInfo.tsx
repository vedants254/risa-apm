"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * "How this is projected": a small card that opens beside the link on hover or click (not a centred dialog).
 * It stays open while the pointer is over it, so the "See it by campaign" link inside can be clicked.
 */
export function ProjectionInfo({ label, lines, link }: { label: string; lines: string[]; link?: { href: string; text: string } }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onMouseEnter={show}
        onMouseLeave={hide}
        className="inline-flex cursor-pointer items-center gap-1 rounded-full text-[13px] font-medium text-primary transition-colors duration-(--dur-1) outline-none select-none hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="w-80 max-h-[min(60vh,420px)] overflow-y-auto rounded-xl p-4 text-[13px] leading-relaxed text-foreground"
      >
        <div className="space-y-2">
          {lines.map((l, i) => (
            <p key={i} className="tabular">
              {l}
            </p>
          ))}
          {link && (
            <Link href={link.href} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
              {link.text}
              <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
