/**
 * Safe arithmetic evaluator for the copilot's `calculate` tool (no eval).
 * Supports + - * / % ^, parentheses, unary minus, and min, max, round(x, digits), abs, sqrt, floor, ceil.
 */
type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "id"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.replace(/_/g, ""); // allow 120_000 style separators (commas are argument separators)
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = s.slice(i).match(/^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i);
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = s.slice(i).match(/^[a-z_]+/i);
    if (id) {
      out.push({ t: "id", v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ("+-*/%^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in expression.`);
  }
  return out;
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
};

export function evaluate(expr: string): number {
  if (expr.length > 500) throw new Error("Expression too long.");
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v && t.v !== v)) throw new Error(`Expected "${v ?? "token"}" in expression.`);
    p++;
    return t;
  };
  const primary = (): number => {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression.");
    if (t.t === "num") return (p++, t.v);
    if (t.t === "op" && t.v === "(") {
      eat("(");
      const v = add();
      eat(")");
      return v;
    }
    if (t.t === "op" && (t.v === "-" || t.v === "+")) {
      p++;
      const v = power();
      return t.v === "-" ? -v : v;
    }
    if (t.t === "id") {
      p++;
      if (t.v === "pi") return Math.PI;
      const f = FUNCS[t.v];
      if (!f) throw new Error(`Unknown function "${t.v}".`);
      eat("(");
      const args: number[] = [add()];
      while (peek()?.v === ",") {
        eat(",");
        args.push(add());
      }
      eat(")");
      return f(...args);
    }
    throw new Error(`Unexpected "${t.v}".`);
  };
  const power = (): number => {
    const b = primary();
    if (peek()?.v === "^") {
      eat("^");
      return b ** power();
    }
    return b;
  };
  const mul = (): number => {
    let v = power();
    while (peek() && ["*", "/", "%"].includes(String(peek().v))) {
      const op = eat().v;
      const r = power();
      if ((op === "/" || op === "%") && r === 0) throw new Error("Division by zero.");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() && ["+", "-"].includes(String(peek().v))) {
      const op = eat().v;
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = add();
  if (p !== toks.length) throw new Error(`Unexpected "${toks[p].v}" in expression.`);
  if (!Number.isFinite(v)) throw new Error("Result is not a finite number.");
  return v;
}
