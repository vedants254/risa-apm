"use client";

import { MotionConfig } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useMediaQuery } from "@/hooks/use-media-query";
import { resolveDate, type DataRange } from "@/lib/range";
import AppSidebar from "./AppSidebar";
import { DockedAnalyst, OverlayAnalyst } from "./AnalystPanel";
import CommandPalette from "./CommandPalette";
import { PAGE_PARAMS } from "./nav";
import { ShellContext, type ShellState } from "./shell-context";
import Timeline from "./Timeline";
import TopBar from "./TopBar";

/** The analyst panel opens by default on wide screens; the user's choice is remembered. */
const ANALYST_KEY = "copilotOpen";
const ANALYST_DEFAULT_OPEN_MIN_WIDTH = 1440;
/** Below this width the analyst becomes an overlay Sheet (docs/ui_reference.md section 4). */
const DOCK_QUERY = "(min-width: 1280px)";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Global shortcuts: `[` toggles the sidebar, Ctrl/Cmd+K opens the command palette. */
function Shortcuts({ onCommand }: { onCommand: () => void }) {
  const { toggleSidebar } = useSidebar();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onCommand();
      } else if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, onCommand]);
  return null;
}

export default function Shell({ children, range }: { children: React.ReactNode; range: DataRange }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  // ?d= is clamped into the active dataset's range, so a date from a previous dataset never sticks.
  const date = resolveDate(sp.get("d"), range);
  const [pending, startTransition] = useTransition();
  const [analystOpen, setAnalystOpenState] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const docked = useMediaQuery(DOCK_QUERY, true);

  useEffect(() => {
    let open = window.innerWidth >= ANALYST_DEFAULT_OPEN_MIN_WIDTH;
    try {
      const v = localStorage.getItem(ANALYST_KEY);
      if (v !== null) open = v === "1";
    } catch {
      /* storage unavailable: keep the width default */
    }
    setAnalystOpenState(open);
  }, []);

  const setAnalystOpen = useCallback((open: boolean) => {
    setAnalystOpenState(open);
    try {
      localStorage.setItem(ANALYST_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const withDate = useCallback(
    (href: string, d: string = date) => {
      const params = new URLSearchParams(sp.toString());
      params.set("d", d);
      // Page-specific params don't carry across pages.
      if (href !== pathname) for (const k of PAGE_PARAMS) params.delete(k);
      return `${href}?${params.toString()}`;
    },
    [sp, pathname, date],
  );

  const setDate = useCallback(
    (d: string) => startTransition(() => router.push(withDate(pathname, resolveDate(d, range)), { scroll: false })),
    [router, withDate, pathname, range],
  );

  const openCommandPalette = useCallback(() => setCommandOpen(true), []);

  const ctx = useMemo<ShellState>(
    () => ({
      date,
      setDate,
      pending,
      withDate,
      range,
      analystOpen,
      setAnalystOpen,
      toggleAnalyst: () => setAnalystOpen(!analystOpen),
      openCommandPalette,
    }),
    [date, setDate, pending, withDate, range, analystOpen, setAnalystOpen, openCommandPalette],
  );

  const content = (
    <main className="h-full min-h-0 overflow-y-auto" aria-busy={pending}>
      <div className={`transition-opacity duration-(--dur-2) ${pending ? "opacity-60" : ""}`}>{children}</div>
    </main>
  );

  return (
    <MotionConfig reducedMotion="user">
      <ShellContext.Provider value={ctx}>
        <SidebarProvider
          className="h-svh min-h-0 overflow-hidden"
          style={{ "--sidebar-width": "var(--sidebar-w)", "--sidebar-width-icon": "var(--sidebar-w-icon)" } as React.CSSProperties}
        >
          <Shortcuts onCommand={openCommandPalette} />
          <AppSidebar />
          <SidebarInset className="min-h-0 min-w-0 bg-background">
            <TopBar />
            {/* The sheet: white on the page colour, set apart by tone and a soft shadow (no border), inset 8px. */}
            <div className="mr-(--sheet-inset) mb-(--sheet-inset) flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card shadow-sheet max-md:ml-(--sheet-inset)">
              <Timeline date={date} onChange={setDate} pending={pending} range={range} />
              <div className="min-h-0 flex-1">
                {/* The group stays mounted so toggling the analyst never remounts the page. */}
                <ResizablePanelGroup orientation="horizontal" id="sheet-panels">
                  <ResizablePanel id="content" minSize={480}>
                    {content}
                  </ResizablePanel>
                  {docked && analystOpen && (
                    <>
                      <ResizableHandle aria-label="Resize the analyst panel" className="bg-transparent transition-colors duration-(--dur-1) hover:bg-border focus-visible:bg-ring" />
                      <ResizablePanel id="analyst" defaultSize={380} minSize={340} maxSize={480}>
                        <DockedAnalyst key={range.datasetId} date={date} onClose={() => setAnalystOpen(false)} />
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </div>
            </div>
          </SidebarInset>
          {!docked && <OverlayAnalyst key={range.datasetId} date={date} open={analystOpen} onOpenChange={setAnalystOpen} />}
          <CommandPalette key={range.datasetId} open={commandOpen} onOpenChange={setCommandOpen} />
        </SidebarProvider>
      </ShellContext.Provider>
    </MotionConfig>
  );
}
