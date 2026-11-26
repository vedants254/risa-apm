import { ActionItems, NewTaskButton, TaskBoard, type ActionItem, type Task } from "@/components/TaskBoard";
import { TitleWithInfo } from "@/components/manage/info";
import { KpiStrip, PageContainer, PageHeader, PageSection, StatBlock } from "@/components/shared";
import { snapshotDate } from "@/lib/metrics";
import { listActions, listCampaigns, listOwners, listTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ d?: string; campaign?: string }> }) {
  const sp = await searchParams;
  // "Overdue" is judged against the snapshot date, so tasks read correctly on the dataset's own timeline.
  const today = await snapshotDate(sp.d);
  const tasks = (await listTasks()) as unknown as Task[];
  const actions = (await listActions()) as unknown as ActionItem[];
  const campaigns = ((await listCampaigns()) as { campaign_id: string; campaign_name: string }[]).map((c) => ({ id: c.campaign_id, name: c.campaign_name }));
  const owners = Array.from(new Set((await listOwners()).map((o) => o.owner_name))).filter(Boolean);
  const open = tasks.filter((t) => t.status !== "done");
  const initialCampaign = sp.campaign && campaigns.some((c) => c.id === sp.campaign) ? sp.campaign : "";

  return (
    <PageContainer>
      <PageHeader
        title="Tasks"
        actions={<NewTaskButton campaigns={campaigns} owners={owners} />}
      />

      <PageSection>
        <KpiStrip>
          <StatBlock label="Open tasks" value={open.length} />
          <StatBlock label="High priority, open" value={open.filter((t) => t.priority === "high").length} />
          <StatBlock
            label={
              <TitleWithInfo title="From insights">
                <p>Created by the analyst or from a recommendation.</p>
              </TitleWithInfo>
            }
            value={tasks.filter((t) => t.source !== "manual").length}
          />
          <StatBlock label="Overdue" value={open.filter((t) => t.due_date && t.due_date < today).length} />
        </KpiStrip>
      </PageSection>

      <TaskBoard tasks={tasks} campaigns={campaigns} owners={owners} today={today} initialCampaign={initialCampaign} />

      <ActionItems items={actions} campaigns={campaigns} owners={owners} />
    </PageContainer>
  );
}
