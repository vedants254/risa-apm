/**
 * Page scaffolding (server-safe). Every page is:
 *   <PageContainer>
 *     <PageHeader title description actions />
 *     <PageToolbar>filters…</PageToolbar>          (optional, sticky)
 *     <PageSection title caption action>…</PageSection>  (repeat; hairline between)
 *   </PageContainer>
 * Sections are divided by whitespace, not lines or cards.
 */
import { cn } from "@/lib/utils";

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-0 w-full max-w-[1280px] px-6 pt-5 pb-12 min-[1440px]:px-8", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  /** One line: what this page answers. */
  description?: React.ReactNode;
  /** Secondary buttons plus at most one primary. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl leading-tight font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The 44px filter row under the page header. Sticks to the top of the sheet while scrolling. */
export function PageToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="toolbar"
      className={cn(
        "sticky top-0 z-20 -mx-6 mb-8 flex min-h-11 flex-wrap items-center gap-2 bg-card px-6 py-1.5 min-[1440px]:-mx-8 min-[1440px]:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A section: 14/600 heading, an optional caption, an optional right-aligned action
 * ("View all", a filter), 16px gap, content. Sections are separated by 40px of space, no line.
 * Keep captions only when they change how a number is read (a denominator, a definition).
 */
export function PageSection({
  title,
  caption,
  action,
  children,
  className,
  id,
}: {
  title?: React.ReactNode;
  caption?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={title && id ? `${id}-title` : undefined}
      className={cn("pb-10 last:pb-4", className)}
    >
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && (
              <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-foreground">
                {title}
              </h2>
            )}
            {caption && <p className="mt-0.5 text-[13px] text-muted-foreground">{caption}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2 text-[13px]">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A group of related items. By default it is only whitespace (no border, no fill).
 * `tone="muted"` adds a quiet fill: use it only for confirm cards and similar must-notice groups.
 * Never nest groups.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  tone = "default",
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "muted";
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg", tone === "muted" ? "bg-muted/70" : "", className)}>
      {(title || actions) && (
        <div className={cn("flex items-start justify-between gap-3", tone === "muted" && "px-4 pt-3")}>
          <div className="min-w-0">
            {title && <div className="text-sm font-semibold text-foreground">{title}</div>}
            {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(tone === "muted" ? "p-4" : "", (title || actions) && "pt-3", bodyClassName)}>{children}</div>
    </div>
  );
}
