import { Database, Filter, House, ListChecks, Megaphone, Scale, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  /** One line: the question this page answers (searched by the command palette, not shown). */
  hint: string;
  icon: LucideIcon;
}
export interface NavGroup {
  /** Not rendered in the sidebar (the list is short enough without labels); groups only add space. */
  label: string;
  items: NavItem[];
}

/** Single source for the sidebar, the breadcrumb and the command palette. Home is "/". */
export const NAV: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { href: "/", label: "Home", hint: "Are we on pace for the visitor goal?", icon: House },
      { href: "/funnel", label: "Funnel", hint: "Where do people drop off?", icon: Filter },
    ],
  },
  {
    label: "Act",
    items: [
      { href: "/campaigns", label: "Campaigns", hint: "How is each campaign doing, and who owns it?", icon: Megaphone },
      { href: "/diagnose", label: "Diagnose & decide", hint: "Which campaign do we scale, change or stop?", icon: Scale },
      { href: "/tasks", label: "Tasks", hint: "What is due and who owns it?", icon: ListChecks },
      { href: "/data", label: "Data editor", hint: "Edit the raw tables and see every page update", icon: Database },
    ],
  },
];

export const NAV_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

export function activeNavItem(pathname: string) {
  return NAV_ITEMS.find((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href))) ?? NAV_ITEMS[0];
}

/** Query params that belong to one page and must not follow you to another. */
export const PAGE_PARAMS = ["c", "from", "to", "table", "q", "offset", "metric"];
