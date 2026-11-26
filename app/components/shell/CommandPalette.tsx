"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, CalendarDays, Megaphone } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { NAV_ITEMS } from "./nav";
import type { DataRange } from "@/lib/range";
import { useShell } from "./shell-context";
import { CHECKPOINTS, addDays, fmtDay } from "./timeline/model";

/** Snapshot jumps from the active dataset: countdown checkpoints, the event and the last data day. */
function jumpDates(r: DataRange): { d: string; label: string }[] {
  const out: { d: string; label: string }[] = [];
  const add = (d: string, label: string) => {
    if (d >= r.start && d <= r.end && !out.some((x) => x.d === d)) out.push({ d, label: `${label}, ${fmtDay(d)}` });
  };
  for (const x of CHECKPOINTS) add(addDays(r.eventStart, -x), `T-${x}`);
  add(addDays(r.eventStart, -1), "Event eve");
  add(r.eventEnd, "Event end");
  add(r.end, "End of history");
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

/** Ctrl/Cmd+K: jump to pages, campaigns and snapshot dates. Opens without animation (keyboard-opened UI). */
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { withDate, setDate, setAnalystOpen, range } = useShell();
  const dates = jumpDates(range);
  const [campaigns, setCampaigns] = useState<{ campaign_id: string; campaign_name: string; channel?: string }[] | null>(null);

  useEffect(() => {
    if (!open || campaigns) return;
    fetch("/api/campaigns", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCampaigns(Array.isArray(j) ? j : []))
      .catch(() => setCampaigns([]));
  }, [open, campaigns]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to"
      description="Search pages, campaigns and snapshot dates"
      className="data-open:animate-none data-closed:animate-none sm:max-w-lg"
    >
      {/* This shadcn version's CommandDialog does not provide the cmdk root, so wrap in <Command>. */}
      <Command loop>
      <CommandInput placeholder="Search pages, campaigns or dates…" />
      <CommandList>
        <CommandEmpty>No match. Try a page name or a campaign.</CommandEmpty>
        <CommandGroup heading="Pages">
          {NAV_ITEMS.map((p) => {
            const Icon = p.icon;
            return (
              <CommandItem key={p.href} value={`${p.label} ${p.hint}`} onSelect={() => run(() => router.push(withDate(p.href)))}>
                <Icon strokeWidth={1.5} />
                <span>{p.label}</span>
              </CommandItem>
            );
          })}
          <CommandItem value="Ask the analyst copilot chat" onSelect={() => run(() => setAnalystOpen(true))}>
            <Bot strokeWidth={1.5} />
            <span>Ask the analyst</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Campaigns">
          {campaigns === null ? (
            <CommandItem disabled value="loading campaigns">
              Loading campaigns…
            </CommandItem>
          ) : (
            campaigns.map((c) => (
              <CommandItem
                key={c.campaign_id}
                value={`${c.campaign_name} ${c.campaign_id} ${c.channel ?? ""}`}
                onSelect={() => run(() => router.push(`${withDate("/funnel")}&c=${encodeURIComponent(c.campaign_id)}`))}
              >
                <Megaphone strokeWidth={1.5} />
                <span>{c.campaign_name}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{c.campaign_id}</span>
              </CommandItem>
            ))
          )}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Snapshot date">
          {dates.map((x) => (
            <CommandItem key={x.d} value={`snapshot ${x.label} ${x.d}`} onSelect={() => run(() => setDate(x.d))}>
              <CalendarDays strokeWidth={1.5} />
              <span>{x.label}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{x.d}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
