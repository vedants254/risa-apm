"use client";

import { AlertCircle, ArrowUp, Loader2, MessageSquare, Mic, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnalystMark } from "@/components/analyst/AnalystMark";
import { ConfirmCard } from "@/components/analyst/ConfirmCard";
import { ToolCalls } from "@/components/analyst/ToolCalls";
import { SUGGESTIONS } from "@/components/analyst/suggestions";
import { type Msg } from "@/components/analyst/types";
import { VoiceMode } from "@/components/analyst/VoiceMode";
import { useShell } from "@/components/shared";
import { cn } from "@/lib/utils";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Markdown from "./Markdown";


function HeaderButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} className="rounded-full text-muted-foreground hover:text-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function MissingKey({ message, date }: { message?: string | null; date: string }) {
  const key = message?.match(/[A-Z]+_API_KEY/)?.[0] ?? "OPENAI_API_KEY";
  const code = "font-mono text-xs";
  return (
    <div className="pt-2 text-[13px] text-muted-foreground">
      <h3 className="text-sm font-medium text-foreground">Add an API key to use the analyst</h3>
      <p className="mt-1">{message ?? `Set ${key} in app/.env.local to enable the copilot.`}</p>
      <ol className="mt-3 list-decimal space-y-1 pl-4">
        <li>
          Copy <span className={code}>app/.env.local.example</span> to <span className={code}>app/.env.local</span>
        </li>
        <li>
          Set <span className={cn(code, "text-foreground")}>{key}</span>
        </li>
        <li>
          Restart <span className={code}>npm run dev</span>
        </li>
      </ol>
      <p className="mt-3">
        The data tools work without a key:{" "}
        <a className="text-foreground underline underline-offset-4" href={`/api/tools?name=diagnose&date=${date}`} target="_blank" rel="noreferrer">
          diagnose output
        </a>
        .
      </p>
    </div>
  );
}

function EmptyChat({
  onPick,
  disabled,
  onChat,
  onVoice,
  showChoice,
}: {
  onPick: (s: string) => void;
  disabled: boolean;
  onChat: () => void;
  onVoice: () => void;
  /** The Chat / Voice pair; hidden once Chat is chosen (the header mic still opens voice). */
  showChoice: boolean;
}) {
  const { range } = useShell();
  return (
    <div className="flex flex-col items-center px-2 pt-8 text-center">
      <AnalystMark size={72} animated />
      <p className="mt-4 max-w-[21rem] text-sm leading-relaxed text-foreground">
        I&apos;m ready to help analyse attendee growth{range.eventName ? ` for ${range.eventName}` : ""}. What would you like to explore?
      </p>
      <ul className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className="rounded-full bg-muted px-3 py-1.5 text-left text-[13px] text-foreground transition-colors duration-(--dur-1) hover:bg-primary-tint hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      {showChoice && (
        <div className="mt-8 flex items-center gap-2">
          <Button variant="ghost" onClick={onChat} className="h-12 gap-2.5 rounded-full bg-muted px-6 text-[15px] text-foreground hover:bg-accent [&_svg]:size-5">
            <MessageSquare strokeWidth={1.75} aria-hidden />
            Chat
          </Button>
          <Button onClick={onVoice} className="h-12 gap-2.5 rounded-full px-6 text-[15px] [&_svg]:size-5">
            <Mic strokeWidth={1.75} aria-hidden />
            Voice
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Copilot({ date, onClose }: { date: string; onClose?: () => void }) {
  const router = useRouter();
  const { withDate } = useShell();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<{ provider?: string; model?: string; missing?: string | null }>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** Chat (typed, persisted) or voice (a live speech session; see components/analyst/VoiceMode.tsx). */
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  /** The empty state is a choice screen (Chat or Voice) with no composer until Chat is chosen. */
  const [chatChosen, setChatChosen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/chat", { cache: "no-store" });
      const j = await r.json();
      if (j.error) return setErr(j.error);
      setConfigured(j.configured);
      setStatus({ provider: j.provider, model: j.model, missing: j.missing_key_message });
      setMsgs(j.messages);
    } catch (e) {
      setErr(`Could not load the conversation: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* ignore */
    }
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [msgs, busy, err]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setErr(null);
    setBusy(true);
    setChatChosen(true);
    setInput("");
    setMsgs((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: t, meta: { date } }]);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: t, date }),
      });
      const j = await r.json();
      if (j.error) setErr(j.error);
      else if (!j.ok && !j.message_id) setErr(j.message);
      await load();
    } catch (e) {
      setErr((e as Error).message);
      setInput(t); // let the user retry without retyping
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const resolve = async (messageId: string, index: number, action: "confirm" | "dismiss", kind: "task" | "campaign_update") => {
    try {
      const r = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, index, action }),
      });
      const j = await r.json();
      if (j.error) {
        setErr(j.error);
        toast.error(action === "confirm" ? "Could not apply the draft" : "Could not dismiss the draft", { description: j.error });
      } else if (action === "confirm") {
        const href = withDate(kind === "task" ? "/tasks" : "/campaigns");
        toast.success(kind === "task" ? "Task created" : "Campaign updated", {
          description: kind === "task" ? String((j.result as { title?: string } | undefined)?.title ?? "") || undefined : undefined,
          action: { label: kind === "task" ? "Open tasks" : "Open campaigns", onClick: () => router.push(href) },
        });
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    await load();
    router.refresh(); // dashboard reflects the new task / campaign status
  };

  const clear = async () => {
    await fetch("/api/chat", { method: "DELETE" });
    setErr(null);
    setChatChosen(false); // back to the Chat / Voice choice
    await load();
    inputRef.current?.focus();
  };

  const locked = busy || configured === false;
  // The first screen is a choice (Chat or Voice): the composer appears once Chat is chosen.
  const showComposer = configured === false || chatChosen || busy || msgs.length > 0;
  // At most one primary button: only the newest pending draft gets it.
  const lastPending = (() => {
    for (let mi = msgs.length - 1; mi >= 0; mi--) {
      const ps = msgs[mi].meta?.proposals ?? [];
      for (let pi = ps.length - 1; pi >= 0; pi--) if (ps[pi].state === "pending") return `${msgs[mi].id}:${pi}`;
    }
    return null;
  })();

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <AnalystMark size={22} />
          <span className="truncate">Ask the analyst</span>
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          {mode === "chat" ? (
            <>
              {configured === true && (msgs.length > 0 || chatChosen) && (
                <HeaderButton label="Talk to the analyst" onClick={() => setMode("voice")} disabled={busy}>
                  <Mic className="size-4" strokeWidth={1.5} aria-hidden />
                </HeaderButton>
              )}
              <HeaderButton label="New chat" onClick={() => setConfirmClear(true)} disabled={busy || msgs.length === 0}>
                <SquarePen className="size-4" strokeWidth={1.5} aria-hidden />
              </HeaderButton>
            </>
          ) : (
            <HeaderButton
              label="Back to chat"
              onClick={() => {
                setChatChosen(true);
                setMode("chat");
              }}
            >
              <MessageSquare className="size-4" strokeWidth={1.5} aria-hidden />
            </HeaderButton>
          )}
          {onClose && (
            <HeaderButton label="Close the analyst" onClick={onClose}>
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </HeaderButton>
          )}
        </div>
      </div>

      {mode === "voice" ? (
        <VoiceMode
          date={date}
          onBack={() => {
            setChatChosen(true);
            setMode("chat");
          }}
        />
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_12px)]" aria-live="polite" aria-busy={busy}>
            <div className="space-y-6 px-4 py-4">
              {configured === false && <MissingKey message={status.missing} date={date} />}
              {configured === true && msgs.length === 0 && !busy && (
                <EmptyChat
                  onPick={send}
                  disabled={locked}
                  onChat={() => {
                    setChatChosen(true);
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  onVoice={() => setMode("voice")}
                  showChoice={!chatChosen}
                />
              )}

              {msgs.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm break-words whitespace-pre-wrap text-foreground">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id}>
                    <ToolCalls tools={m.meta?.tools ?? []} />
                    {m.meta?.error ? (
                      <div className="flex gap-2 text-[13px] text-foreground">
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                        <Markdown text={m.content} className="text-[13px]" />
                      </div>
                    ) : (
                      <Markdown text={m.content} />
                    )}
                    {m.meta?.ungrounded?.length ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Some figures could not be checked against the data: {m.meta.ungrounded.join(", ")}
                      </p>
                    ) : null}
                    {(m.meta?.proposals ?? []).map((c, i) => (
                      <ConfirmCard
                        key={i}
                        card={c}
                        primary={lastPending === `${m.id}:${i}`}
                        onResolve={(a) => resolve(m.id, i, a, c.kind)}
                        tasksHref={withDate("/tasks")}
                        campaignsHref={withDate("/campaigns")}
                      />
                    ))}
                  </div>
                ),
              )}

              {busy && (
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
                  Checking the data
                </div>
              )}
              {err && (
                <div className="flex items-start gap-2 text-[13px] text-foreground" role="alert">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 flex-1 break-words">{err}</span>
                  <button type="button" onClick={() => setErr(null)} aria-label="Dismiss the error" className="shrink-0 rounded-sm text-muted-foreground transition-colors duration-(--dur-1) hover:text-foreground">
                    <X className="size-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              )}
            </div>
          </div>

          {showComposer && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="shrink-0 px-3 pt-2 pb-3"
            >
              <div className="flex items-end gap-2 rounded-2xl border border-input bg-card py-1.5 pr-1.5 pl-3.5 transition-colors duration-(--dur-1) focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
                <textarea
                  ref={inputRef}
                  rows={1}
                  className="block max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed"
                  placeholder={configured === false ? "Add an API key to start chatting" : "Ask about pace, campaigns or tasks"}
                  aria-label="Question for the analyst"
                  aria-describedby="analyst-composer-hint"
                  value={input}
                  disabled={locked}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                />
                <span id="analyst-composer-hint" className="sr-only">
                  Enter to send, Shift and Enter for a new line.
                </span>
                <Button type="submit" size="icon" aria-label="Send" disabled={locked || !input.trim()} className="rounded-full">
                  {busy ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden /> : <ArrowUp className="size-4" strokeWidth={2} aria-hidden />}
                </Button>
              </div>
            </form>
          )}
        </>
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the current conversation. Tasks and campaign changes you already confirmed are kept, and pending drafts are discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={clear}>Clear and start new</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
