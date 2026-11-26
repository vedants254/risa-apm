/**
 * Minimal, safe markdown renderer for analyst answers (no HTML injection: everything is
 * rendered as React text nodes). Supports paragraphs, headings, lists, tables, rules,
 * bold, italic and inline code. Legacy [Evidence] / [Estimate] / [Assumption] tags from older
 * answers are dropped: they rendered as dotted chips that read as a second bullet inside list items.
 */
import React from "react";
import { cn } from "@/lib/utils";

const LEGACY_LABEL = /\s*\[(?:evidence|estimate|assumption)s?\]:?/gi;

function inline(raw: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const text = raw.replace(LEGACY_LABEL, "").replace(/^\s+/, "");
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold">{inline(tok.slice(2, -2), k)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded-sm bg-muted px-1 py-px font-mono text-xs">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** "₹12,345", "INR 1,200", "-3.4%", "1.62x", "+120", "12 / 40" count as numbers and are right-aligned. */
const NUMERIC = /^[-+−–]?\s*(?:₹|INR\s?|Rs\.?\s?)?[-+−]?[\d,]+(?:\.\d+)?\s?(?:%|×|x|k|K|L|lakh|pp)?(?:\s*\/\s*[\d,.]+)?$/;
const isNumeric = (c: string) => NUMERIC.test(c.replace(/\*\*/g, "").trim());

function Table({ rows, k }: { rows: string[][]; k: number }) {
  const [head, ...body] = rows;
  const cols = head?.length ?? 0;
  // A column is numeric when most of its non-empty body cells are numbers.
  const numericCol = Array.from({ length: cols }, (_, j) => {
    const cells = body.map((r) => r[j] ?? "").filter((c) => c && c !== "—" && c !== "-" && c.toLowerCase() !== "n/a");
    return cells.length > 0 && cells.filter(isNumeric).length / cells.length >= 0.6;
  });
  return (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px] tabular">
        {head && (
          <thead>
            <tr>
              {head.map((c, j) => (
                <th
                  key={j}
                  scope="col"
                  className={cn("h-8 border-b px-2 py-1.5 text-left align-bottom text-xs leading-tight font-medium text-muted-foreground first:pl-0 last:pr-0", numericCol[j] && "text-right")}
                >
                  {inline(c, `h${k}-${j}`)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="[&:last-child>td]:border-b-0">
              {Array.from({ length: cols }, (_, j) => (
                <td key={j} className={cn("h-8 border-b border-border/60 px-2 py-1 align-middle leading-snug first:pl-0 last:pr-0", numericCol[j] ? "text-right whitespace-nowrap" : "min-w-20", j === 0 && "font-medium")}>
                  {inline(r[j] ?? "", `c${k}-${ri}-${j}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LIST = /^\s*([-*•]|\d+[.)])\s+/;

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={b++} className="my-3 border-border" />);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push(<Table key={b++} rows={rows} k={b} />);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push(
        <h4 key={b++} className="mt-4 mb-1 text-sm font-semibold text-foreground first:mt-0">
          {inline(h[2].replace(/\*\*/g, ""), `hd${b}`)}
        </h4>,
      );
      i++;
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && (LIST.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        // Strip every leading marker so "- • text" or "• • text" renders with one bullet.
        if (LIST.test(lines[i])) items.push(lines[i].replace(LIST, "").replace(/^(?:[-*•·]\s+)+/, ""));
        else items[items.length - 1] += ` ${lines[i].trim()}`; // wrapped continuation line
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={b++} className={cn("my-2 space-y-1 pl-5 marker:text-muted-foreground", ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, j) => (
            <li key={j} className="pl-0.5">
              {inline(it, `li${b}-${j}`)}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (!para.length) {
      // A line that looks like a block start but did not match a block: render it as text.
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={b++} className="my-2 first:mt-0 last:mb-0">
        {inline(para.join(" "), `p${b}`)}
      </p>,
    );
  }
  return <div className={cn("text-sm leading-[1.55] text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>{blocks}</div>;
}
