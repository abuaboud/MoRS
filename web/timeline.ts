// The agent timeline as a small store: gateway events in, render-ready items out.
// Events: say/think (Claude's words), script start/end (execute_code), act (one game action),
// tool (get_state/screenshot), goal (the user's prompt), run/runinfo/result (transcript boundaries).

export type Act = { t: number; req: string; res?: string; ok: boolean; ms?: number; script?: string };
export type Word = { type: "think" | "say"; text: string; t: number };
export type Script = {
  no: number; id: string; t: number; code: string; acts: Act[]; why: Word[];
  done?: { ok: boolean; result: string; console: string[]; t: number };
};
export type Item = { key: string; fresh: boolean; t: number } & (
  | { kind: "think" | "say"; text: string }
  | { kind: "script"; script: Script }
  | { kind: "tool"; name: string; frame?: string }
  | { kind: "sep"; text: string; done?: boolean }
  | { kind: "act"; act: Act }
);
type Draft<T> = T extends unknown ? Omit<T, "key"> : never;
export type Mind = { text: string; t: number; kind: "think" | "say"; fresh: boolean; no: number };

export function describe(req: string): { op: string; target: string } {
  try {
    const { op, name, option, ...rest } = JSON.parse(req);
    let target = [option, name].filter(Boolean).join(" → ");
    if (op === "login") target = `as ${rest.username}`;
    else if (op === "walk" || op === "click") target = `${rest.x}, ${rest.y}`;
    else if (op === "key") target = rest.key;
    else if (op === "type") target = JSON.stringify(rest.text);
    else if (op === "camera") target = Object.entries(rest).map(([k, v]) => `${k} ${v}`).join(" · ");
    else if (rest.x != null) target += ` @ ${rest.x}, ${rest.y}`;
    return { op, target };
  } catch {
    return { op: "?", target: req };
  }
}

/** What a script is for: its first comment if it has one, else its first line of code. */
export function scriptTitle(code: string) {
  const lines = code.split("\n").map((l) => l.trim()).filter(Boolean);
  const comment = lines.find((l) => l.startsWith("//"));
  return (comment ? comment.replace(/^\/\/\s*/, "") : lines[0] ?? "").slice(0, 160);
}

/** One-line outcome instead of raw JSON: first error, else the last result messages, else what it returned. */
export function outcome(raw: string | undefined): { text: string; bad: boolean } {
  let v: unknown;
  try { v = JSON.parse(raw ?? ""); } catch { return { text: String(raw ?? "").slice(0, 160), bad: false }; }
  const find = (key: string) => {
    const out: string[] = [];
    (function walk(x: unknown) {
      if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) { if (k === key && typeof y === "string") out.push(y); else walk(y); }
    })(v);
    return out;
  };
  const err = find("error")[0];
  if (err) return { text: err, bad: true };
  const res = find("result");
  if (res.length) return { text: res.slice(-2).join(" · "), bad: false };
  if (v && typeof v === "object" && !Array.isArray(v)) return { text: "returned " + Object.keys(v).slice(0, 6).join(", "), bad: false };
  return { text: JSON.stringify(v).slice(0, 160), bad: false };
}

const tidy = (s: string) => s.replace(/-/g, " ").replace(/\s+/g, " ").trim();

/** An action in plain words: "Walk to 3222, 3218", "Talk to Cook", "Continue dialogue". */
export function humanAct(req: string): string {
  let a: any;
  try { a = JSON.parse(req); } catch { return req; }
  const name = a.name ?? "";
  switch (a.op) {
    case "walk": return `Walk to ${a.x}, ${a.y}`;
    case "npc": case "object": case "groundItem": return `${tidy(a.option ?? "Use")} ${name}`.trim();
    case "widget":
      if (!name || name.toLowerCase() === String(a.option).toLowerCase()) return `Open ${tidy(a.option)}`;
      return `${tidy(a.option)} ${name}`;
    case "key": return a.key === "space" ? "Continue dialogue" : /^[1-5]$/.test(a.key) ? `Pick option ${a.key}` : `Press ${a.key}`;
    case "type": return `Type "${a.text}"`;
    case "login": return `Log in as ${a.username}`;
    case "camera": return a.zoom != null ? "Zoom the camera" : "Turn the camera";
    case "click": return "Click on the screen";
    case "menu": return "Check the right-click menu";
    case "varp": return "Check quest progress";
    case "collision": return "Look for a way through";
    default: return tidy(String(a.op ?? "Action"));
  }
}

/** Repeated actions collapse into one ("Walk ×10", "Continue dialogue ×4"); failures stay separate. */
export function groupActs(acts: Act[]) {
  const groups: { label: string; op: string; ok: boolean; acts: Act[] }[] = [];
  for (const a of acts) {
    const { op } = describe(a.req);
    const text = humanAct(a.req);
    const key = op === "walk" ? "Walk" : op === "camera" ? "Turn the camera" : text;
    const last = groups.at(-1);
    if (last && last.label === key && last.ok === a.ok) last.acts.push(a);
    else groups.push({ label: key, op, ok: a.ok, acts: [a] });
  }
  return groups;
}

/** A step's headline: its first comment if Claude wrote one, else the actions it took. */
export function stepTitle(s: Script) {
  const lines = s.code.split("\n").map((l) => l.trim());
  const comment = lines.find((l) => l.startsWith("//"))?.replace(/^\/\/\s*/, "");
  if (comment) return comment.charAt(0).toUpperCase() + comment.slice(1);
  const groups = groupActs(s.acts);
  if (!groups.length) return codeIntent(s.code) ?? (s.done ? "Looked around" : "Working…");
  const parts = groups.slice(0, 3).map((g) => (g.acts.length > 1 ? `${g.label} ×${g.acts.length}` : g.label));
  return parts.join(", ") + (groups.length > 3 ? `, and ${groups.length - 3} more` : "");
}

/** Read what a script meant to do from its SDK calls, for steps whose actions weren't recorded. */
function codeIntent(code: string): string | null {
  const q = (args: string) => /["'`]([^"'`]+)["'`]/.exec(args)?.[1] ?? "";
  const phrases: string[] = [];
  const add = (p: string) => { if (p && !phrases.includes(p)) phrases.push(p); };
  for (const m of code.matchAll(/\.(\w+)\(([^()]*)\)/g)) {
    const [, fn, args] = m;
    const named = /name\s*:\s*["'`]([^"'`]+)/.exec(args)?.[1], option = /option\s*:\s*["'`]([^"'`]+)/.exec(args)?.[1];
    if (fn === "act") {
      const op = q(args);
      if (op === "walk") add("Walk");
      else if (op === "collision") add("Look for a way through");
      else if (op === "varp") add("Check quest progress");
      else if (op === "menu") add("Check the right-click menu");
      else if (op === "key") add("Press keys");
      else if (option || named) add(tidy(`${option ?? "Use"} ${named ?? ""}`));
    }
    else if (fn === "interact") add(tidy(q(args)) || "Interact");
    else if (fn === "talkTo") add(`Talk to ${q(args)}`);
    else if (fn === "walkTo") add("Walk");
    else if (fn === "login") add("Log in");
    else if (fn === "continueAll") add("Click through dialogue");
    else if (fn === "choose") add(`Choose "${q(args)}"`);
    else if (fn === "chop") add("Chop trees");
    else if (fn === "dropAll") add(`Drop ${q(args)}`);
    else if (fn === "openTab") add(`Open ${q(args)}`);
    else if (fn === "open" && /bank/.test(code)) add("Open the bank");
    else if (fn === "use") add(`Use ${q(args)}`);
    else if (fn === "turnTo" || fn === "zoom") add("Turn the camera");
  }
  if (!phrases.length) return /sdk\.state\(|get_state/.test(code) ? "Looked around" : null;
  return phrases.slice(0, 3).join(", ") + (phrases.length > 3 ? `, and ${phrases.length - 3} more` : "");
}

/** A finished step in plain words; null when there's nothing human to say. */
export function stepOutcome(s: Script): { text: string; bad: boolean } | null {
  if (!s.done) return null;
  const o = outcome(s.done.result);
  if (o.bad) return o;
  if (!s.done.ok) return { text: o.text && o.text !== '""' ? o.text : "The code stopped with an error", bad: true };
  if (o.text.startsWith("returned ") || o.text === "undefined" || o.text === "null") return null;
  return { text: tidy(o.text).replace(/^./, (c) => c.toUpperCase()), bad: false };
}

export class Timeline {
  items: Item[] = [];
  scripts = new Map<string, Script>();
  stats = { scripts: 0, acts: 0, fail: 0, msSum: 0, msN: 0 };
  mind: Mind | null = null;
  trail: string[] = [];
  runStart: number | null = null;
  goal: { text: string; t: number } | null = null; // the latest thing the user asked Claude to do
  run: { turns: number; cost: number; ms: number; ok: boolean } | null = null;
  now = { text: "Agent idle", busy: false };
  private lastWords: Word[] = [];
  private thoughts = 0;
  private seq = 0;
  private listeners = new Set<() => void>();
  private queued = false;
  version = 0;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private changed() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.version++; for (const l of this.listeners) l(); });
  }

  reset() {
    Object.assign(this, { items: [], goal: null, mind: null, trail: [], runStart: null, run: null, thoughts: 0, lastWords: [] });
    this.scripts.clear();
    this.stats = { scripts: 0, acts: 0, fail: 0, msSum: 0, msN: 0 };
    this.now = { text: "Agent idle", busy: false };
    this.changed();
  }

  private push(item: Draft<Item>) {
    this.items.unshift({ ...item, key: String(++this.seq) } as Item);
    if (this.items.length > 500) this.items.pop();
  }

  private words(m: any, fresh: boolean) {
    const type = m.type as "think" | "say";
    this.lastWords.push({ type, text: m.text, t: m.t });
    if (this.mind) this.trail = [this.mind.text, ...this.trail].slice(0, 3);
    this.mind = { text: m.text, t: m.t, kind: type, fresh, no: type === "think" ? ++this.thoughts : this.thoughts };
    this.push({ kind: type, text: m.text, t: m.t, fresh });
    if (type === "say") this.now = { text: `Claude: ${m.text.split("\n")[0]}`, busy: true };
  }

  handle(m: any, fresh: boolean) {
    switch (m.type) {
      case "say":
      case "think":
        this.words(m, fresh);
        break;
      case "script":
        if (m.phase === "start") {
          const s: Script = { no: ++this.stats.scripts, id: m.id, t: m.t, code: m.code ?? "", acts: [], why: this.lastWords };
          this.lastWords = [];
          this.scripts.set(m.id, s);
          this.push({ kind: "script", script: s, t: m.t, fresh });
          this.now = { text: `Step ${s.no} started`, busy: true };
        } else {
          const s = this.scripts.get(m.id);
          if (!s) break;
          s.done = { ok: m.ok, result: m.result ?? "", console: m.console ?? [], t: m.t };
          this.now = { text: `Step ${s.no} finished`, busy: false };
        }
        break;
      case "act": {
        const a: Act = { t: m.t, req: m.req, res: m.res, ok: !!m.ok, ms: m.ms, script: m.script };
        this.stats.acts++;
        if (!a.ok) this.stats.fail++;
        if (typeof a.ms === "number") { this.stats.msSum += a.ms; this.stats.msN++; }
        const s = a.script ? this.scripts.get(a.script) : undefined;
        const { op, target } = describe(a.req);
        if (s) {
          s.acts.push(a);
          if (!s.done) this.now = { text: `Step ${s.no}: ${humanAct(a.req)}`, busy: true };
        } else this.push({ kind: "act", act: a, t: a.t, fresh });
        break;
      }
      case "tool":
        this.push({ kind: "tool", name: m.name, frame: m.frame, t: m.t, fresh });
        break;
      case "goal":
        this.goal = { text: m.text, t: m.t };
        break;
      case "run": // a new transcript is a new run: start the counters over
        this.reset();
        this.runStart = m.t;
        this.run = null;
        this.push({ kind: "sep", text: `Run started · ${m.file}`, t: m.t, fresh });
        break;
      case "runinfo":
        this.push({ kind: "sep", text: `${m.model ?? "model ?"} · ${(m.mcp ?? []).map((x: any) => `${x.name} ${x.status}`).join(", ")}`, t: m.t, fresh });
        break;
      case "result":
        this.run = { turns: m.turns, cost: m.cost ?? 0, ms: m.ms, ok: m.ok };
        this.runStart = null;
        this.now = { text: "Run finished", busy: false };
        this.push({ kind: "sep", done: m.ok, text: `Run ${m.ok ? "finished" : "ended"} · ${m.turns} turns · $${(m.cost ?? 0).toFixed(2)}`, t: m.t, fresh });
        break;
      default:
        return;
    }
    this.changed();
  }
}
