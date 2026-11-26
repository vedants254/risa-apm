"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NAV } from "./nav";
import SettingsDialog from "./SettingsDialog";
import { useShell } from "./shell-context";

/*
 * Rows are 40px with 18px icons in one column. Active item: violet text and icon on a light
 * violet tint. No group labels, and the gap between groups equals the gap between rows
 * so the list reads as one even column.
 */
const ITEM =
  "h-10 gap-3 rounded-lg px-3 text-[15px] text-sidebar-foreground transition-colors duration-(--dur-1) hover:bg-sidebar-accent hover:text-foreground data-active:bg-primary-tint data-active:font-medium data-active:text-primary data-active:hover:bg-primary-tint [&_svg]:size-[18px] [&_svg]:text-muted-foreground [&[data-active]_svg]:text-primary group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-[11px]!";

export default function AppSidebar() {
  const pathname = usePathname();
  const { withDate } = useShell();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="h-(--topbar-h) justify-center px-2 py-0">
        <Link
          href={withDate("/")}
          aria-label="CampusFest home"
          className="flex min-w-0 items-center gap-3 rounded-md px-1.5 py-1 text-[19px] font-semibold tracking-[-0.01em] text-foreground group-data-[collapsible=icon]:px-[5px]"
        >
          <Image src="/brand/campusfest-mark.png" alt="" width={36} height={36} unoptimized loading="eager" className="size-9 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">CampusFest</span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1 px-0 pt-3">
        {NAV.map((g) => (
          <SidebarGroup key={g.label} className="py-0">
            <SidebarMenu className="gap-1">
              {g.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label} className={ITEM}>
                      <Link href={withDate(item.href)} aria-current={active ? "page" : undefined}>
                        <Icon strokeWidth={1.5} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" onClick={() => setSettingsOpen(true)} className={ITEM} aria-haspopup="dialog">
              <Settings strokeWidth={1.5} />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Sidebar>
  );
}
