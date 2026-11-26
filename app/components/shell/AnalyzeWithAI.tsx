"use client";

import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "./shell-context";

/** Page-level entry to the analyst: a filled violet button that opens the analyst panel (it never closes it). */
export default function AnalyzeWithAI() {
  const { setAnalystOpen } = useShell();
  return (
    <Button
      onClick={() => setAnalystOpen(true)}
      aria-controls="analyst-panel"
      className="h-9 gap-2 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover [&_svg]:size-[18px]"
    >
      <Bot strokeWidth={1.75} aria-hidden />
      Analyze with AI
    </Button>
  );
}
