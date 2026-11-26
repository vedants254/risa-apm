"use client";

import { createContext, useContext } from "react";
import type { DataRange } from "@/lib/range";

export interface ShellState {
  /** Snapshot date (YYYY-MM-DD) from the ?d= query param. */
  date: string;
  /** Navigate to the same page at another snapshot date (keeps other params). */
  setDate: (d: string) => void;
  /** True while a date change is loading; pages may dim stale data. */
  pending: boolean;
  /** Build a link to `href` that keeps the snapshot date. */
  withDate: (href: string, d?: string) => string;
  /** The active dataset's dates, name and id (from the event table, via the root layout). */
  range: DataRange;
  analystOpen: boolean;
  setAnalystOpen: (open: boolean) => void;
  toggleAnalyst: () => void;
  openCommandPalette: () => void;
}

export const ShellContext = createContext<ShellState | null>(null);

/** Shell state for client components inside the app (snapshot date, analyst panel, command palette). */
export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <Shell>.");
  return ctx;
}
