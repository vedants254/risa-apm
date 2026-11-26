"use client";

import { motion, useReducedMotion } from "motion/react";
import Copilot from "@/components/Copilot";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/**
 * The analyst (copilot) slot. Docked inside the sheet at 1280px and wider (the resizable
 * panel lives in Shell); an overlay Sheet below 1280px. The Copilot internals are owned
 * by the copilot agent; this file only frames them.
 */
export function DockedAnalyst({ date, onClose }: { date: string; onClose: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.aside
      id="analyst-panel"
      aria-label="Ask the analyst"
      className="flex h-full min-h-0 flex-col bg-background/60"
      initial={reduce ? false : { x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
    >
      <Copilot date={date} onClose={onClose} />
    </motion.aside>
  );
}

export function OverlayAnalyst({ date, open, onOpenChange }: { date: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[var(--analyst-w)]" id="analyst-panel">
        <SheetTitle className="sr-only">Ask the analyst</SheetTitle>
        <SheetDescription className="sr-only">Questions about pace, campaigns and tasks, answered from live tools.</SheetDescription>
        <Copilot date={date} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
