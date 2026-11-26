"use client";

/**
 * Tasks and the decision log. Same API calls as before (/api/tasks, /api/actions); the list is a
 * server-rendered prop, so a task the analyst creates appears here on the next router.refresh().
 */
import { Check, MessageSquareText, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DecisionBadge, EmptyState, PageSection, useShell } from "@/components/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, OptionSelect, PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, api, sentence, type Option } from "@/components/manage/form";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  owner_name: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  source: string;
  created_at: string;
}
export interface ActionItem {
  id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  kind: string;
  description: string;
  owner_name: string | null;
  due_date: string | null;
  status: string;
  source: string;
  created_at: string;
}

type Opt = { id: string; name: string };

const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
const STATUS_ORDER = ["todo", "in_progress", "done"];
/** created_at is IST wall-clock text; a task this recent gets a "New" chip (e.g. just made by the analyst). */
const NEW_WINDOW_MS = 30 * 60 * 1000;

function istMillis(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const v = Date.parse(`${ts.slice(0, 19).replace(" ", "T")}+05:30`);
  return Number.isNaN(v) ? null : v;
}

/** Where a task or decision came from, as a small icon beside its title (the words are in the tooltip). */
function SourceIcon({ source }: { source: string }) {
  if (source !== "copilot" && source !== "recommendation") return null;
  const Icon = source === "copilot" ? MessageSquareText : Scale;
  const text = source === "copilot" ? "Created by the analyst" : "Created from a recommendation";
  return (
    <span className="inline-flex shrink-0 text-muted-foreground" title={text}>
      <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  );
}

function PriorityLabel({ priority }: { priority: string }) {
  if (priority === "high") return <span className="shrink-0 text-xs font-medium text-foreground">High</span>;
  if (priority === "low") return <span className="shrink-0 text-xs text-muted-foreground">Low</span>;
  return null;
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------
function TaskDialog({
  open,
  onOpenChange,
  task,
  campaigns,
  owners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null creates a new task. */
  task: Task | null;
  campaigns: Opt[];
  owners: string[];
}) {
  const router = useRouter();
  const [f, setF] = useState<Partial<Task>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF(task ?? { priority: "medium", status: "todo" });
      setErr("");
    }
  }, [open, task]);
  const set = (k: keyof Task, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      title: f.title,
      description: f.description,
      campaign_id: f.campaign_id || null,
      owner_name: f.owner_name || null,
      due_date: f.due_date || null,
      priority: f.priority,
      status: f.status,
    };
    setBusy(true);
    const j = task ? await api(`/api/tasks/${task.id}`, "PATCH", body) : await api("/api/tasks", "POST", { ...body, source: "manual" });
    setBusy(false);
    if (j.error) return setErr(j.error);
    onOpenChange(false);
    toast.success(task ? "Task updated" : "Task created", { description: f.title });
    router.refresh();
  };

  const campaignOpts: Option[] = campaigns.map((c) => ({ value: c.id, label: c.name }));
  const ownerOpts: Option[] = owners.map((o) => ({ value: o, label: o }));
  const idp = task ? `t-${task.id}` : "t-new";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
            <DialogDescription className={task ? "text-[13px]" : "sr-only"}>
              {task
                ? `${task.source === "copilot" ? "Created by the analyst" : task.source === "recommendation" ? "From a recommendation" : "Created manually"}, ${task.created_at?.slice(0, 16)} IST`
                : "Title, campaign, owner, due date, priority and status for the new task."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${idp}-title`} label="Title" className="col-span-2">
              <Input id={`${idp}-title`} required autoFocus value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field id={`${idp}-desc`} label="Description" className="col-span-2">
              <Textarea id={`${idp}-desc`} rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field id={`${idp}-campaign`} label="Campaign">
              <OptionSelect id={`${idp}-campaign`} value={f.campaign_id ?? ""} onChange={(v) => set("campaign_id", v)} options={campaignOpts} noneLabel="No campaign" />
            </Field>
            <Field id={`${idp}-owner`} label="Owner">
              <OptionSelect id={`${idp}-owner`} value={f.owner_name ?? ""} onChange={(v) => set("owner_name", v)} options={ownerOpts} noneLabel="Unassigned" />
            </Field>
            <Field id={`${idp}-due`} label="Due date">
              <Input id={`${idp}-due`} type="date" className="tabular" value={f.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} />
            </Field>
            <Field id={`${idp}-priority`} label="Priority">
              <OptionSelect id={`${idp}-priority`} value={f.priority ?? "medium"} onChange={(v) => set("priority", v)} options={PRIORITY_OPTIONS} />
            </Field>
            <Field id={`${idp}-status`} label="Status">
              <OptionSelect id={`${idp}-status`} value={f.status ?? "todo"} onChange={(v) => set("status", v)} options={TASK_STATUS_OPTIONS} />
            </Field>
          </div>
          <FormError>{err}</FormError>
          <DialogFooter className="mx-0 mb-0 border-t-0 bg-transparent p-0 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !(f.title ?? "").trim()}>
              {busy ? "Saving…" : task ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Opens the create dialog. The page header uses the primary variant. */
export function NewTaskButton({
  campaigns,
  owners,
  variant = "default",
}: {
  campaigns: Opt[];
  owners: string[];
  variant?: "default" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus strokeWidth={1.5} aria-hidden />
        New task
      </Button>
      <TaskDialog open={open} onOpenChange={setOpen} task={null} campaigns={campaigns} owners={owners} />
    </>
  );
}

function ConfirmDelete({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Task list
// ---------------------------------------------------------------------------
const rowActionCls =
  "text-muted-foreground opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

function TaskRow({
  t,
  today,
  now,
  onStatus,
  onEdit,
  onDelete,
}: {
  t: Task;
  today: string;
  now: number | null;
  onStatus: (t: Task, status: string) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const done = t.status === "done";
  const overdue = !done && !!t.due_date && t.due_date < today;
  const showPriority = !done && (t.priority === "high" || t.priority === "low");
  const showSource = t.source === "copilot" || t.source === "recommendation";
  const created = istMillis(t.created_at);
  const isNew = now !== null && created !== null && now - created >= 0 && now - created < NEW_WINDOW_MS;
  const due = t.due_date ? (
    <span className={cn("tabular", overdue ? "font-medium text-foreground" : "text-muted-foreground")} title={overdue ? `Overdue: due ${t.due_date}` : `Due ${t.due_date}`}>
      {shortDate(t.due_date)}
      {overdue && <span className="sr-only"> (overdue)</span>}
    </span>
  ) : (
    <span className="text-muted-foreground">No date</span>
  );

  return (
    <li
      className={cn(
        "group grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-lg px-2 py-2 transition-colors duration-(--dur-1) hover:bg-accent",
        // From @2xl the campaign, owner and due date each get their own column.
        "@2xl:grid-cols-[20px_minmax(0,2fr)_minmax(0,1fr)_104px_64px_120px_56px] @2xl:items-center",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen "${t.title}"` : `Mark "${t.title}" done`}
        onClick={() => onStatus(t, done ? "todo" : "done")}
        className={cn(
          "mt-0.5 flex size-4 items-center justify-center rounded-full border border-input bg-card transition-colors duration-(--dur-1) outline-none hover:border-foreground focus-visible:ring-3 focus-visible:ring-ring/50 @2xl:mt-0",
          done && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {done && <Check className="size-3" strokeWidth={2} aria-hidden />}
      </button>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(t)}
            title={t.description || undefined}
            className={cn(
              "min-w-0 truncate rounded-sm text-left text-[13px] font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              done && "text-muted-foreground line-through",
            )}
          >
            {t.title}
          </button>
          {showPriority && <PriorityLabel priority={t.priority} />}
          {showSource && <SourceIcon source={t.source} />}
          {isNew && <span className="shrink-0 text-xs font-medium text-primary">New</span>}
        </div>
        {/* Narrow layout only: campaign, owner and due date fold under the title. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground @2xl:hidden">
          <span>{t.campaign_name ?? "No campaign"}</span>
          <span aria-hidden>·</span>
          <span>{t.owner_name ?? "Unassigned"}</span>
          <span aria-hidden>·</span>
          {due}
        </div>
      </div>

      <div className="hidden min-w-0 truncate text-[13px] text-muted-foreground @2xl:block" title={t.campaign_name ?? undefined}>
        {t.campaign_name ?? "No campaign"}
      </div>
      <div className={cn("hidden min-w-0 truncate text-[13px] @2xl:block", t.owner_name ? "text-foreground" : "text-muted-foreground")}>{t.owner_name ?? "Unassigned"}</div>
      <div className="hidden text-right text-[13px] @2xl:block">{due}</div>

      <div className="col-start-3 row-start-1 flex items-center gap-1 @2xl:contents">
        <OptionSelect
          size="sm"
          value={t.status}
          onChange={(v) => onStatus(t, v)}
          options={TASK_STATUS_OPTIONS}
          ariaLabel={`Status of "${t.title}"`}
          quiet
          className="w-[120px] justify-between text-[13px]"
        />
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon-xs" className={rowActionCls} onClick={() => onEdit(t)} aria-label={`Edit "${t.title}"`}>
            <Pencil className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-xs" className={rowActionCls} onClick={() => onDelete(t)} aria-label={`Delete "${t.title}"`}>
            <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}

const STATUS_FILTERS: Option[] = [
  { value: "open", label: "Open" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "all", label: "All statuses" },
];
const SOURCE_FILTERS: Option[] = [
  { value: "manual", label: "Manual" },
  { value: "copilot", label: "Analyst" },
  { value: "recommendation", label: "Recommendation" },
];

export function TaskBoard({
  tasks,
  campaigns,
  owners,
  today,
  initialCampaign = "",
}: {
  tasks: Task[];
  campaigns: Opt[];
  owners: string[];
  /** YYYY-MM-DD used for "overdue". */
  today: string;
  initialCampaign?: string;
}) {
  const router = useRouter();
  const { setAnalystOpen } = useShell();
  const [filter, setFilter] = useState({ status: "open", owner: "", campaign: initialCampaign, source: "" });
  const [groupBy, setGroupBy] = useState<"status" | "owner">("status");
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  // Set after mount so server and client render the same markup.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [tasks]);

  const shown = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (filter.status === "all" || (filter.status === "open" ? t.status !== "done" : t.status === filter.status)) &&
          (!filter.owner || t.owner_name === filter.owner) &&
          (!filter.campaign || t.campaign_id === filter.campaign) &&
          (!filter.source || t.source === filter.source),
      ),
    [tasks, filter],
  );

  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    if (groupBy === "status") {
      for (const s of STATUS_ORDER) m.set(s, []);
      for (const t of shown) (m.get(t.status) ?? m.set(t.status, []).get(t.status)!).push(t);
      return [...m.entries()].filter(([, v]) => v.length).map(([k, v]) => ({ key: k, label: STATUS_LABEL[k] ?? sentence(k), tasks: v }));
    }
    for (const t of shown) {
      const k = t.owner_name ?? "";
      (m.get(k) ?? m.set(k, []).get(k)!).push(t);
    }
    return [...m.entries()]
      .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
      .map(([k, v]) => ({ key: k || "__unassigned", label: k || "Unassigned", tasks: v }));
  }, [shown, groupBy]);

  const setStatus = async (t: Task, status: string) => {
    if (status === t.status) return;
    const j = await api(`/api/tasks/${t.id}`, "PATCH", { status });
    if (j.error) return toast.error("Could not change the status", { description: j.error });
    const prev = t.status;
    toast.success(`Moved to ${(STATUS_LABEL[status] ?? status).toLowerCase()}`, {
      description: t.title,
      action: {
        label: "Undo",
        onClick: async () => {
          await api(`/api/tasks/${t.id}`, "PATCH", { status: prev });
          router.refresh();
        },
      },
    });
    router.refresh();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const t = deleting;
    setDeleting(null);
    const j = await api(`/api/tasks/${t.id}`, "DELETE");
    if (j.error) return toast.error("Could not delete the task", { description: j.error });
    toast.success("Task deleted", { description: t.title });
    router.refresh();
  };

  const filtered = filter.status !== "open" || filter.owner || filter.campaign || filter.source;
  const campaignOpts: Option[] = campaigns.map((c) => ({ value: c.id, label: c.name }));

  return (
    <PageSection
      id="tasks"
      title="Tasks"
      action={
        <OptionSelect
          size="sm"
          value={groupBy}
          onChange={(v) => setGroupBy(v as "status" | "owner")}
          options={[
            { value: "status", label: "Group by status" },
            { value: "owner", label: "Group by owner" },
          ]}
          ariaLabel="Group tasks by"
          quiet
          className="text-[13px]"
        />
      }
    >
      <div className="mb-2 -ml-2 flex flex-wrap items-center gap-1" role="group" aria-label="Filter tasks">
        <OptionSelect size="sm" value={filter.status} onChange={(v) => setFilter({ ...filter, status: v })} options={STATUS_FILTERS} ariaLabel="Status" quiet className="text-[13px]" />
        <OptionSelect
          size="sm"
          value={filter.owner}
          onChange={(v) => setFilter({ ...filter, owner: v })}
          options={owners.map((o) => ({ value: o, label: o }))}
          noneLabel="All owners"
          ariaLabel="Owner"
          quiet
          className="text-[13px]"
        />
        <OptionSelect
          size="sm"
          value={filter.campaign}
          onChange={(v) => setFilter({ ...filter, campaign: v })}
          options={campaignOpts}
          noneLabel="All campaigns"
          ariaLabel="Campaign"
          quiet
          className="text-[13px]"
        />
        <OptionSelect
          size="sm"
          value={filter.source}
          onChange={(v) => setFilter({ ...filter, source: v })}
          options={SOURCE_FILTERS}
          noneLabel="All sources"
          ariaLabel="Source"
          quiet
          className="text-[13px]"
        />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => setFilter({ status: "open", owner: "", campaign: "", source: "" })}>
            Clear filters
          </Button>
        )}
        <span className="sr-only" aria-live="polite">
          {shown.length} of {tasks.length} tasks shown
        </span>
      </div>

      {shown.length === 0 ? (
        <div>
          {tasks.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title="No tasks yet"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <NewTaskButton campaigns={campaigns} owners={owners} variant="ghost" />
                  <Button variant="ghost" onClick={() => setAnalystOpen(true)}>
                    Ask the analyst
                  </Button>
                </div>
              }
            />
          ) : (
            <EmptyState
              title="No tasks match these filters"
              action={
                <Button variant="ghost" onClick={() => setFilter({ status: "all", owner: "", campaign: "", source: "" })}>
                  Show all tasks
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <div className="@container">
          {groups.map((g, gi) => (
            <section key={g.key} aria-label={`${g.label}, ${g.tasks.length} tasks`} className={cn(gi > 0 && "mt-6")}>
              <h3 className="flex h-8 items-center gap-2 px-2 text-[13px] font-medium text-foreground">
                {g.label}
                <span className="font-normal text-muted-foreground tabular">{g.tasks.length}</span>
              </h3>
              <ul className="divide-y">
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} t={t} today={today} now={now} onStatus={setStatus} onEdit={setEditing} onDelete={setDeleting} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <TaskDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} task={editing} campaigns={campaigns} owners={owners} />
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this task?"
        description={
          <>
            <span className="font-medium text-foreground">{deleting?.title}</span> will be removed for everyone. This cannot be undone.
          </>
        }
        onConfirm={confirmDelete}
      />
    </PageSection>
  );
}

// ---------------------------------------------------------------------------
// Decision log (action items)
// ---------------------------------------------------------------------------
const KIND_OPTIONS: Option[] = [
  { value: "scale", label: "Scale" },
  { value: "change", label: "Change" },
  { value: "stop", label: "Stop" },
  { value: "investigate", label: "Investigate" },
  { value: "other", label: "Other" },
];
const ACTION_STATUS_OPTIONS: Option[] = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
];

function KindBadge({ kind }: { kind: string }) {
  if (kind === "scale" || kind === "change" || kind === "stop") return <DecisionBadge action={kind} />;
  return <span className="text-xs font-medium text-muted-foreground">{sentence(kind)}</span>;
}

function LogDecisionDialog({ open, onOpenChange, campaigns, owners }: { open: boolean; onOpenChange: (o: boolean) => void; campaigns: Opt[]; owners: string[] }) {
  const router = useRouter();
  const blank = { campaign_id: "", kind: "investigate", description: "", owner_name: "", due_date: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF({ campaign_id: "", kind: "investigate", description: "", owner_name: "", due_date: "" });
      setErr("");
    }
  }, [open]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const j = await api("/api/actions", "POST", { ...f, campaign_id: f.campaign_id || null, owner_name: f.owner_name || null, due_date: f.due_date || null });
    setBusy(false);
    if (j.error) return setErr(j.error);
    onOpenChange(false);
    toast.success("Decision logged", { description: f.description });
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={add} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Log a decision</DialogTitle>
            <DialogDescription className="sr-only">Kind, campaign, description, owner and due date for the decision.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field id="ai-kind" label="Kind">
              <OptionSelect id="ai-kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={KIND_OPTIONS} />
            </Field>
            <Field id="ai-campaign" label="Campaign">
              <OptionSelect
                id="ai-campaign"
                value={f.campaign_id}
                onChange={(v) => setF({ ...f, campaign_id: v })}
                options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                noneLabel="No campaign"
              />
            </Field>
            <Field id="ai-desc" label="Decision or action" className="col-span-2">
              <Textarea id="ai-desc" required rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <Field id="ai-owner" label="Owner">
              <OptionSelect id="ai-owner" value={f.owner_name} onChange={(v) => setF({ ...f, owner_name: v })} options={owners.map((o) => ({ value: o, label: o }))} noneLabel="Unassigned" />
            </Field>
            <Field id="ai-due" label="Due date">
              <Input id="ai-due" type="date" className="tabular" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
            </Field>
          </div>
          <FormError>{err}</FormError>
          <DialogFooter className="mx-0 mb-0 border-t-0 bg-transparent p-0 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !f.description.trim()}>
              {busy ? "Saving…" : "Log decision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ActionItems({ items, campaigns, owners }: { items: ActionItem[]; campaigns: Opt[]; owners: string[] }) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState<ActionItem | null>(null);

  const upd = async (a: ActionItem, body: Record<string, unknown>) => {
    const j = await api(`/api/actions/${a.id}`, "PATCH", body);
    if (j.error) return toast.error("Could not update the decision", { description: j.error });
    toast.success(`Marked ${String(body.status)}`, { description: a.description });
    router.refresh();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const a = deleting;
    setDeleting(null);
    const j = await api(`/api/actions/${a.id}`, "DELETE");
    if (j.error) return toast.error("Could not delete the decision", { description: j.error });
    toast.success("Decision deleted");
    router.refresh();
  };

  return (
    <PageSection
      id="decisions"
      title="Decision log"
      action={
        <Button variant="ghost" size="sm" onClick={() => setLogging(true)}>
          <Plus strokeWidth={1.5} aria-hidden />
          Log decision
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={Scale} title="No decisions logged" />
      ) : (
        <ul className="@container divide-y">
          {items.map((a) => {
            const closed = a.status !== "open";
            return (
              <li
                key={a.id}
                className={cn(
                  "group grid grid-cols-[72px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg px-2 py-2 transition-colors duration-(--dur-1) hover:bg-accent",
                  // From @2xl the campaign, owner and due date each get their own column.
                  "@2xl:grid-cols-[72px_minmax(0,2fr)_minmax(0,1fr)_104px_64px_104px_28px] @2xl:items-center",
                )}
              >
                <div className="pt-px @2xl:pt-0">
                  <KindBadge kind={a.kind} />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("min-w-0 truncate text-[13px] text-foreground", closed && "text-muted-foreground line-through")} title={a.description}>
                      {a.description}
                    </span>
                    <SourceIcon source={a.source} />
                  </div>
                  {/* Narrow layout only. */}
                  <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground @2xl:hidden">
                    <span>{a.campaign_name ?? "No campaign"}</span>
                    <span aria-hidden>·</span>
                    <span>{a.owner_name ?? "Unassigned"}</span>
                    {a.due_date && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="tabular">{shortDate(a.due_date)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="hidden min-w-0 truncate text-[13px] text-muted-foreground @2xl:block" title={a.campaign_name ?? undefined}>
                  {a.campaign_name ?? "No campaign"}
                </div>
                <div className={cn("hidden min-w-0 truncate text-[13px] @2xl:block", a.owner_name ? "text-foreground" : "text-muted-foreground")}>
                  {a.owner_name ?? "Unassigned"}
                </div>
                <div className="hidden text-right text-[13px] text-muted-foreground tabular @2xl:block">{a.due_date ? shortDate(a.due_date) : ""}</div>
                <div className="flex items-center gap-1 @2xl:contents">
                  <OptionSelect
                    size="sm"
                    value={a.status}
                    onChange={(v) => upd(a, { status: v })}
                    options={ACTION_STATUS_OPTIONS}
                    ariaLabel="Decision status"
                    quiet
                    className="w-[104px] justify-between text-[13px]"
                  />
                  <Button variant="ghost" size="icon-xs" className={rowActionCls} onClick={() => setDeleting(a)} aria-label="Delete decision">
                    <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <LogDecisionDialog open={logging} onOpenChange={setLogging} campaigns={campaigns} owners={owners} />
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this decision?"
        description="It will be removed from the log for everyone. This cannot be undone."
        onConfirm={confirmDelete}
      />
    </PageSection>
  );
}
