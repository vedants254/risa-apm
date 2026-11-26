"use client";

/** Small form helpers shared by the campaign, task and data editors. */
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Radix Select cannot hold an empty value, so "none" is a sentinel that maps to "" / null. */
export const NONE = "__none__";

/** JSON fetch that never throws: network failures come back as `{ error }` like API errors do. */
export async function api<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T & { error?: string }> {
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await r.json()) as T & { error?: string };
  } catch (e) {
    return { error: `Could not reach the server (${(e as Error).message}).` } as T & { error?: string };
  }
}

export function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** A shadcn Select over plain string values. `noneLabel` adds an empty choice that maps to "". */
export function OptionSelect({
  id,
  value,
  onChange,
  options,
  noneLabel,
  placeholder,
  size = "default",
  className,
  ariaLabel,
  disabled,
  quiet,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  noneLabel?: string;
  placeholder?: string;
  size?: "sm" | "default";
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Borderless trigger for filter rows and table cells: ink text, background on hover only. */
  quiet?: boolean;
}) {
  const v = value === "" && noneLabel ? NONE : value;
  return (
    <Select value={v} onValueChange={(x) => onChange(x === NONE ? "" : x)} disabled={disabled}>
      <SelectTrigger id={id} size={size} aria-label={ariaLabel} className={cn(
          "w-full bg-card",
          quiet && "w-auto gap-1 rounded-full border-transparent bg-transparent pr-2 pl-3 shadow-none transition-colors duration-(--dur-1) hover:bg-accent data-[state=open]:bg-accent",
          className,
        )}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Inline error under a form, announced to screen readers. */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[13px] text-danger">
      {children}
    </p>
  );
}

export const TASK_STATUS_OPTIONS: Option[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];
export const PRIORITY_OPTIONS: Option[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
export const CAMPAIGN_STATUS_OPTIONS: Option[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "stopped", label: "Stopped" },
];

export const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : s);
