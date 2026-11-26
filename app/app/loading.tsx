import { PageSkeleton } from "@/components/shared/skeletons";

/** Shown inside the sheet while a page's server data loads. */
export default function Loading() {
  return <PageSkeleton />;
}
