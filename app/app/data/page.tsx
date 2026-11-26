import DataEditor, { ResetButton } from "@/components/DataEditor";
import DatasetUpload from "@/components/DatasetUpload";
import { TitleWithInfo } from "@/components/manage/info";
import { DataTable, PageContainer, PageHeader, PageSection, type DataColumn, type DataRow } from "@/components/shared";
import { n, shortDate } from "@/lib/format";
import { getDataQuality, getDataRange, snapshotDate } from "@/lib/metrics";
import { listEdits } from "@/lib/repo";

export const dynamic = "force-dynamic";

const label = (k: string) => (k ? (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ") : k);

function Breakdown({ title, entries }: { title: string; entries: [string, number][] }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
      {entries.length ? (
        <dl className="mt-2 text-[13px]">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-1">
              <dt className="min-w-0 truncate text-muted-foreground" title={k}>
                {label(k)}
              </dt>
              <dd className="text-foreground tabular">{n(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">None</p>
      )}
    </div>
  );
}

export default async function DataPage({ searchParams }: { searchParams: Promise<{ d?: string; upload?: string }> }) {
  const sp = await searchParams;
  const d = await snapshotDate(sp.d);
  const range = await getDataRange();
  const dq = await getDataQuality(d);
  const edits = (await listEdits(25)) as { id: string; at: string; table_name: string; row_ref: string | null; action: string; detail: string }[];

  const editColumns: DataColumn[] = [
    { id: "at", header: "When (IST)", className: "tabular" },
    { id: "table", header: "Table" },
    { id: "row", header: "Row" },
    { id: "action", header: "Action" },
    { id: "detail", header: "Detail", className: "text-muted-foreground" },
  ];
  const editRows: DataRow[] = edits.map((e) => ({
    id: e.id,
    cells: {
      at: e.at,
      table: <span className="font-mono text-xs">{e.table_name}</span>,
      row: e.row_ref ? <span className="font-mono text-xs">{e.row_ref}</span> : null,
      action: label(e.action),
      detail: (
        <span className="block max-w-[480px] truncate" title={e.detail}>
          {e.detail}
        </span>
      ),
    },
  }));

  return (
    <PageContainer>
      <PageHeader
        title="Data editor"
        description="Every metric recomputes from these rows"
        actions={
          <>
            <ResetButton />
            <DatasetUpload autoOpen={sp.upload === "1"} />
          </>
        }
      />

      <PageSection
        id="tables"
        title={
          <TitleWithInfo title="Raw tables">
            <p>Stored exactly as imported, duplicates included. Metrics deduplicate by stable ID when they are computed; nothing is cached.</p>
            <p>Editing or deleting a row applies to every import copy with the same stable ID. Stable IDs cannot be edited.</p>
            <p>Timestamps are IST wall-clock text (YYYY-MM-DD HH:MM:SS); +05:30 or Z offsets are converted.</p>
          </TitleWithInfo>
        }
      >
        {/* Keyed by dataset so an import or reset reloads the editor instead of showing old rows. */}
        <DataEditor key={range.datasetId} />
      </PageSection>

      <PageSection
        id="quality"
        title={
          <TitleWithInfo title="Data quality">
            <p>Deduplicated, up to the end of {shortDate(d)} {d.slice(0, 4)}. Only external people count toward goals.</p>
          </TitleWithInfo>
        }
      >
        <div className="@container">
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 @2xl:grid-cols-3">
            <Breakdown title="Import copies removed" entries={Object.entries(dq.duplicates_removed).filter(([, v]) => v > 0)} />
            <Breakdown title="People by type" entries={Object.entries(dq.person_types)} />
            <Breakdown title="Check-ins by result and verification" entries={Object.entries(dq.checkins_by_result_verification)} />
          </div>
        </div>
      </PageSection>

      <PageSection id="changes" title="Recent changes">
        <DataTable
          columns={editColumns}
          rows={editRows}
          compact
          maxHeight={360}
          className="rounded-none border-0"
          caption="Recent changes"
          empty={{ title: "No changes yet", description: "Edits to rows, tasks and campaigns are logged here." }}
        />
      </PageSection>
    </PageContainer>
  );
}
