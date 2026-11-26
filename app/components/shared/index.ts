/** Shared building blocks for pages. See docs/ui_foundation.md. */
export { PageContainer, PageHeader, PageSection, PageToolbar, SectionCard } from "./page";
export { KpiStrip, Num, Sparkline, StatBlock, type StatDelta, type StatFormat } from "./stat";
export { DecisionBadge, StatusChip, campaignStatusTone, type ChipTone, type Decision } from "./badges";
export { DataTable, type DataColumn, type DataRow } from "./data-table";
export { EmptyState } from "./empty-state";
export { KpiStripSkeleton, PageSkeleton, TableSkeleton } from "./skeletons";
export { useShell } from "@/components/shell/shell-context";
