import type { Metadata } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Suspense } from "react";
import Shell from "@/components/shell/Shell";
import { getDataRange } from "@/lib/metrics";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/*
 * Fonts: the only place typefaces are chosen. The CSS variables they define
 * (--font-ui-sans, --font-ui-mono) are mapped to font-sans / font-heading / font-mono
 * in app/globals.css.
 * - Plus Jakarta Sans: geometric, close to the CampusFest wordmark. It ships a `tnum`
 *   feature (all digits 600 units wide), which the `tabular` utility switches on.
 * - IBM Plex Mono: only for IDs, UTM strings, SQL, tool calls and T-labels.
 */
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ui-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-ui-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CampusFest Growth Center",
  description: "Attendee growth analytics, campaign management and an AI growth analyst for event attendee growth.",
  icons: { icon: "/brand/campusfest-mark-64.png" },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The timeline and default snapshot date follow the active dataset.
  const range = await getDataRange();
  return (
    <html lang="en" className={`h-full ${sans.variable} ${mono.variable}`}>
      <body className="h-full">
        <TooltipProvider delayDuration={300}>
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
            <Shell range={range}>{children}</Shell>
          </Suspense>
          <Toaster position="bottom-right" theme="light" />
        </TooltipProvider>
      </body>
    </html>
  );
}
