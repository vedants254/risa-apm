"use client";

import { SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { KpiStrip, StatBlock } from "@/components/shared";
import { InfoTip } from "@/components/decide/InfoTip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { inr } from "@/lib/format";
import { useShell } from "@/components/shell/shell-context";

type SettingsKey = "thresholds" | "projection" | "simulator";
interface ThresholdField {
  k: string;
  label: string;
  /** One line under the field: what the number means. */
  hint?: string;
  step?: number;
}

async function saveSettings(keyName: SettingsKey, f: Record<string, string>) {
  const value = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)]));
  const bad = Object.entries(value).find(([, v]) => !Number.isFinite(v));
  if (bad) throw new Error(`"${bad[0]}" must be a number.`);
  const r = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: keyName, value }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
}

/** Editable decision thresholds (persisted in app_settings). Inline form; `ThresholdSheet` wraps it in a side sheet. */
export function ThresholdEditor({
  values,
  keyName,
  fields,
  onSaved,
}: {
  values: Record<string, number>;
  keyName: SettingsKey;
  fields: ThresholdField[];
  onSaved?: () => void;
}) {
  const router = useRouter();
  const formId = useId();
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])));
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveSettings(keyName, f);
      toast.success("Thresholds saved", { description: "Recommendations recomputed with the new rules." });
      router.refresh();
      onSaved?.();
    } catch (err) {
      toast.error("Could not save the thresholds", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-2">
        {fields.map((x) => (
          <div key={x.k} className="grid gap-1.5">
            <Label htmlFor={`${formId}-${x.k}`} className="text-[13px] font-medium">
              {x.label}
            </Label>
            <Input
              id={`${formId}-${x.k}`}
              className="w-32 tabular"
              type="number"
              inputMode="decimal"
              step={x.step ?? 0.05}
              value={f[x.k] ?? ""}
              onChange={(e) => setF({ ...f, [x.k]: e.target.value })}
            />
            {x.hint && <p className="text-xs text-muted-foreground">{x.hint}</p>}
          </div>
        ))}
      </div>
      <SheetFooter className="flex-row justify-end border-t">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and recompute"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** "Edit thresholds" button that opens the threshold form in a side sheet. */
export function ThresholdSheet({ values, keyName, fields }: { values: Record<string, number>; keyName: SettingsKey; fields: ThresholdField[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
          Edit thresholds
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="gap-0 sm:max-w-sm">
        <SheetHeader className="border-b">
          <SheetTitle>Decision thresholds</SheetTitle>
          <SheetDescription>Ratios are against the median campaign (or the overall stage rate). Saving recomputes every recommendation.</SheetDescription>
        </SheetHeader>
        {/* Remount on open so the form always starts from the saved values. */}
        {open && <ThresholdEditor values={values} keyName={keyName} fields={fields} onSaved={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}

/** Two-date picker for "what changed" (kept in the URL). */
export function ComparePicker({ from, to }: { from: string; to: string }) {
  const { range } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set(k, v);
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <Input
        type="date"
        aria-label="Compare from"
        className="h-7 w-[136px] tabular"
        value={from}
        min={range.start}
        max={range.end}
        onChange={(e) => e.target.value && set("from", e.target.value)}
      />
      <span className="text-muted-foreground">to</span>
      <Input
        type="date"
        aria-label="Compare to"
        className="h-7 w-[136px] tabular"
        value={to}
        min={range.start}
        max={range.end}
        onChange={(e) => e.target.value && set("to", e.target.value)}
      />
    </div>
  );
}

interface SimResult {
  moved_inr: number;
  visitors_lost: number;
  visitors_gained: number;
  net_visitor_change: number;
  from: { campaign_name: string; marginal_cac_per_visitor: number | null; base_inr: number; base_kind: string };
  to: { campaign_name: string; marginal_cac_per_visitor: number | null; effective_cac_after_diminishing: number | null };
  formula: string[];
  assumptions: string[];
  error?: string;
}

type Base = "spend_to_date" | "planned_budget";

/** Budget reallocation simulator (estimate). */
export function Simulator({
  date,
  campaigns,
  defaultFrom,
  defaultTo,
  available = true,
}: {
  date: string;
  campaigns: { id: string; name: string }[];
  defaultFrom: string;
  defaultTo: string;
  /** False when no campaign has a marginal CAC (no spend or registrations in the window). */
  available?: boolean;
}) {
  const id = useId();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [pctV, setPct] = useState(20);
  const [base, setBase] = useState<Base>("spend_to_date");
  const [res, setRes] = useState<SimResult | null>(null);
  const [ranWith, setRanWith] = useState("");
  const [busy, setBusy] = useState(false);
  const inputsKey = `${from}|${to}|${pctV}|${base}|${date}`;
  const stale = res !== null && ranWith !== inputsKey;

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, from_campaign_id: from, to_campaign_id: to, pct: pctV / 100, base }),
      });
      setRes(await r.json());
      setRanWith(inputsKey);
    } catch (err) {
      setRes({ error: (err as Error).message } as SimResult);
    } finally {
      setBusy(false);
    }
  };

  const campaignSelect = (value: string, onChange: (v: string) => void, label: string, fieldId: string) => (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={fieldId} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={!available}>
        <SelectTrigger id={fieldId} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {campaigns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      <form onSubmit={run} aria-disabled={!available} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_auto]">
        {campaignSelect(from, setFrom, "From", `${id}-from`)}
        {campaignSelect(to, setTo, "To", `${id}-to`)}
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-pct`} className="text-xs font-normal text-muted-foreground">
            Share to move
          </Label>
          <div className="flex h-8 items-center gap-3">
            <input
              id={`${id}-pct`}
              type="range"
              min={5}
              max={100}
              step={5}
              value={pctV}
              onChange={(e) => setPct(Number(e.target.value))}
              disabled={!available}
              className="min-w-0 flex-1 accent-primary disabled:opacity-50"
              aria-valuetext={`${pctV}%`}
            />
            <span className="w-10 text-right text-sm font-medium tabular">{pctV}%</span>
          </div>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-base`} className="text-xs font-normal text-muted-foreground">
            Of
          </Label>
          <Select value={base} onValueChange={(v) => setBase(v as Base)} disabled={!available}>
            <SelectTrigger id={`${id}-base`} className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="spend_to_date">Spend to date</SelectItem>
              <SelectItem value="planned_budget">Planned budget</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={!available || busy || from === to} className="sm:col-span-2 sm:justify-self-start xl:col-span-1">
          {busy ? "Simulating…" : "Simulate"}
        </Button>
      </form>
      {!available && <p className="text-[13px] text-muted-foreground">Needs spend and registrations in the recent window</p>}
      {available && from === to && <p className="text-xs text-muted-foreground">Pick two different campaigns</p>}

      {res?.error && <p className="text-[13px] text-foreground">{res.error}</p>}
      {res && !res.error && (
        <div className={stale ? "opacity-60" : undefined}>
          <div className="mb-4 flex items-start gap-1">
            <p className="text-sm text-foreground">
              Moving <span className="font-medium tabular">{inr(res.moved_inr)}</span> from {res.from.campaign_name} to {res.to.campaign_name} nets an
              estimated{" "}
              <span className="font-medium tabular">
                {res.net_visitor_change >= 0 ? "+" : "−"}
                {Math.abs(Math.round(res.net_visitor_change)).toLocaleString("en-IN")} visitors
              </span>
              .{stale && <span className="text-muted-foreground"> Inputs changed; simulate again.</span>}
            </p>
            <InfoTip label="Formula and assumptions">
              <span className="block font-medium">Inputs</span>
              <span className="block tabular">
                {inr(res.moved_inr)} of {inr(res.from.base_inr)} {res.from.base_kind}
              </span>
              <span className="block tabular">
                {res.from.campaign_name}: {inr(res.from.marginal_cac_per_visitor)} per visitor lost
              </span>
              <span className="block tabular">
                {res.to.campaign_name}: {inr(res.to.effective_cac_after_diminishing)} per visitor gained, after diminishing returns
              </span>
              <span className="mt-2 block font-medium">Formula</span>
              {res.formula.map((x) => (
                <span key={x} className="block">
                  {x}
                </span>
              ))}
              <span className="mt-2 block font-medium">Assumptions</span>
              {res.assumptions.map((x) => (
                <span key={x} className="block">
                  {x}
                </span>
              ))}
            </InfoTip>
          </div>
          <KpiStrip>
            <StatBlock label="Budget moved" value={res.moved_inr} format="inr" />
            <StatBlock label="Visitors lost" value={-Math.round(res.visitors_lost)} />
            <StatBlock label="Visitors gained" value={Math.round(res.visitors_gained)} />
            <StatBlock label="Net change" value={Math.round(res.net_visitor_change)} />
          </KpiStrip>
        </div>
      )}
    </div>
  );
}
