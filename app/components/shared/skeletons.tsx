/** Loading placeholders shaped like the real page, so nothing jumps when data lands (server-safe). */
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "./page";

export function KpiStripSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-1 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div>
      <div className="flex h-8 items-center border-b">
        <Skeleton className="h-3 w-20" />
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-9 items-center gap-4 border-b border-border/70">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={c === 0 ? "h-3.5 w-32" : "ml-auto h-3.5 w-14"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <PageContainer>
      <div className="space-y-2 pb-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <KpiStripSkeleton />
      <div className="mt-8">
        <Skeleton className="h-56 w-full" />
      </div>
      <div className="mt-8">
        <TableSkeleton />
      </div>
    </PageContainer>
  );
}
