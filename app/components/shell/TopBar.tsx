"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, House, Search } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activeNavItem } from "./nav";
import { useShell } from "./shell-context";

export default function TopBar() {
  const pathname = usePathname();
  const { analystOpen, toggleAnalyst, openCommandPalette, withDate } = useShell();
  const page = activeNavItem(pathname);
  const isHome = page.href === "/";

  return (
    <header className="flex h-(--topbar-h) shrink-0 items-center gap-1.5 pr-(--sheet-inset) pl-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger className="size-8 rounded-full text-muted-foreground hover:text-foreground [&_svg]:size-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Toggle sidebar <kbd className="ml-1 font-mono">[</kbd>
        </TooltipContent>
      </Tooltip>

      {/* Home icon, then the page. On Home itself the icon carries the "Home" label. */}
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap gap-1 text-[13px] sm:gap-1">
          <BreadcrumbItem>
            {isHome ? (
              <BreadcrumbPage className="inline-flex items-center gap-1.5 px-1 font-medium">
                <House strokeWidth={1.5} className="size-4 text-muted-foreground" aria-hidden />
                Home
              </BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link
                  href={withDate("/")}
                  aria-label="Home"
                  className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors duration-(--dur-1) hover:bg-accent hover:text-foreground"
                >
                  <House strokeWidth={1.5} className="size-4" />
                </Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {!isHome && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="truncate px-1 font-medium">{page.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={openCommandPalette}
          className="h-7 w-40 justify-start gap-1.5 pr-2 pl-2.5 text-xs font-normal text-muted-foreground max-md:w-7 max-md:justify-center max-md:px-0"
          aria-label="Search pages and campaigns"
        >
          <Search strokeWidth={1.5} className="size-3.5" />
          <span className="max-md:hidden">Jump to…</span>
          <kbd className="ml-auto font-sans text-[11px] text-muted-foreground max-md:hidden">Ctrl K</kbd>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={toggleAnalyst}
              aria-label="Ask the analyst"
              aria-pressed={analystOpen}
              aria-controls="analyst-panel"
              className="size-9 rounded-full bg-primary text-primary-foreground shadow-none hover:bg-primary-hover aria-pressed:bg-primary-tint aria-pressed:text-primary aria-pressed:hover:bg-primary-tint [&_svg]:size-5"
            >
              <Bot strokeWidth={1.75} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Ask the analyst</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
