import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Backpack as BackpackIcon, Brain as BrainIcon, Camera as CameraIcon, ChartLineUp as ChartLineUpIcon, ChatCircleDots as ChatCircleDotsIcon, CheckCircle as CheckCircleIcon, CircleNotch as CircleNotchIcon, Clock as ClockIcon, Code as CodeIcon, Coins as CoinsIcon, Cursor as CursorIcon, Eye as EyeIcon, Info as InfoIcon, Keyboard as KeyboardIcon, MapPin as MapPinIcon, MapTrifold as MapTrifoldIcon, Mouse as MouseIcon, Package as PackageIcon, PersonSimpleWalk as PersonSimpleWalkIcon, SignIn as SignInIcon, Sparkle as SparkleIcon, Target as TargetIcon, Trophy as TrophyIcon, User as UserIcon, Warning as WarningIcon, XCircle as XCircleIcon,
  type Icon as IconSvgElement,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Timeline, groupActs, humanAct, stepOutcome, stepTitle, type Item, type Script } from "./timeline";

// ---------------------------------------------------------------- helpers

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
const fmtMs = (ms?: number | null) =>
  ms == null ? "–" : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Claude's words, lightly formatted: `code`, **bold**, quoted names and tile coordinates stand out. */
function rich(text: string) {
  return esc(text)
    .replace(/"([^"\n<>]{1,40})"/g, '<span class="font-medium text-foreground">"$1"</span>')
    .replace(/`([^`]+)`/g, '<code class="rounded-sm border bg-muted px-1 font-mono text-[0.88em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>');
}

/** TypeScript highlighting for Claude's scripts: comments, strings, keywords, numbers, `sdk`, calls, properties. */
function highlight(code: string) {
  const re = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|await|async|return|for|of|in|if|else|while|break|continue|new|function|try|catch|throw|true|false|null|undefined|typeof|instanceof)\b|(=>)|\b(\d+(?:\.\d+)?)\b|\b(sdk|console|Math|JSON)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()|(?<=\.)([A-Za-z_$][\w$]*)/g;
  let out = "", last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] || m[4] ? "k" : m[5] ? "n" : m[6] ? "m" : m[7] ? "f" : "p";
    out += `<span class="tok-${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

const OP_ICON: Record<string, IconSvgElement> = {
  walk: PersonSimpleWalkIcon, npc: UserIcon, object: TargetIcon, groundItem: PackageIcon, widget: MouseIcon,
  key: KeyboardIcon, type: KeyboardIcon, click: CursorIcon, login: SignInIcon, camera: CameraIcon,
  menu: MouseIcon, varp: InfoIcon, collision: MapTrifoldIcon,
};

/** Every icon is Phosphor's filled weight (DESIGN.md): solid glyphs read cleanly at small sizes. */
const Icon = ({ icon: Glyph, size = 16, className }: { icon: IconSvgElement; size?: number; className?: string }) => (
  <Glyph size={size} weight="fill" className={className} aria-hidden />
);

function Label({ icon, children }: { icon: IconSvgElement; children: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-2 text-muted-foreground">
      <Icon icon={icon} size={14} />
      <span className="font-mono text-[11px] uppercase tracking-wider">{children}</span>
    </div>
  );
}

const Panel = ({ className, children }: { className?: string; children: ReactNode }) => (
  <Card className={cn("gap-0 rounded-md border-0 p-4 shadow-card", className)}>{children}</Card>
);

/** Names a zone, once, in small mono caps: Goal, Claude, Running, Action log. The only labels on the screen. */
const Eyebrow = ({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) => (
  <div className={cn("flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground", className)}>
    {children}{right != null && <span className="ml-auto tabular-nums">{right}</span>}
  </div>
);

// ---------------------------------------------------------------- data

const timeline = new Timeline();
// ?video&player=<name>&speed=<n>: a fixed 1280x720 layout for tools/video/panel.ts, which replays recorded
// events into `window.mors.timeline` and drops the game footage into #game-slot (765x503 CSS px)
const VIDEO = (() => { const q = new URLSearchParams(location.search); return q.has("video") ? { player: q.get("player") ?? "", speed: q.get("speed") ?? "" } : null; })();
if (VIDEO) (window as any).mors = { timeline };

const useTimeline = () => { useSyncExternalStore(timeline.subscribe, () => timeline.version); return timeline; };

function useGateway(canvas: React.RefObject<HTMLCanvasElement | null>) {
  const [live, setLive] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => {
    let closed = false, timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/view`);
      ws.current = sock;
      sock.binaryType = "blob";
      let replay = true, drawing = false;
      sock.onopen = () => { setLive(true); timeline.reset(); setTimeout(() => (replay = false), 800); };
      sock.onclose = () => { setLive(false); if (!closed) timer = setTimeout(connect, 1500); };
      sock.onmessage = async (e) => {
        if (typeof e.data === "string") { try { timeline.handle(JSON.parse(e.data), !replay); } catch (err) { console.warn(err); } return; }
        const ctx = canvas.current?.getContext("2d");
        if (!ctx || drawing) return; // drop frames we can't keep up with
        drawing = true;
        const bmp = await createImageBitmap(e.data);
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        drawing = false;
      };
    };
    if (VIDEO) return;
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, []);
  const send = (o: object) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(o));
  return { live, send };
}

function useGameState() {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { setS(await (await fetch("/state")).json()); } catch {}
      if (!stop) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  return s;
}

function useNow(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(i); }, [ms]);
}

// ---------------------------------------------------------------- header

function Header({ live, s }: { live: boolean; s: any }) {
  const tl = useTimeline();
  useNow();
  const st = tl.stats;
  const done = !tl.runStart && !!tl.run;
  const clock = tl.runStart ? fmtMs(Date.now() - tl.runStart) : done ? `$${tl.run!.cost.toFixed(2)}` : "–";
  const goal = tl.goal?.text.split("\n")[0].split(/(?<=[.!?])\s/)[0]; // the ask itself; the rest (logins, references) stays in the tooltip
  // icons stay grey; the only colour is the problems icon, because that one is a status
  const stats: [IconSvgElement, string, string, string][] = [
    [CodeIcon, "text-muted-foreground", String(st.scripts), "steps"],
    [CursorIcon, "text-muted-foreground", String(st.acts), "actions"],
    [WarningIcon, st.fail ? "text-red" : "text-muted-foreground", String(st.fail), "problems"],
    [done ? CoinsIcon : ClockIcon, "text-muted-foreground", clock, ""],
  ];
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 lg:px-5">
      <div className="flex shrink-0 items-center gap-2">
        <div className="grid size-6 place-items-center rounded-sm bg-primary text-primary-foreground"><Icon icon={SparkleIcon} size={14} /></div>
        <span className="text-[15px] font-semibold tracking-tight">MoRS</span>
      </div>
      {/* the account name is in the game itself; the header only speaks up when the connection drops */}
      {!VIDEO && !live && <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-red"><span className="size-1.5 rounded-full bg-red" />Reconnecting…</span>}
      {VIDEO?.speed && <span className="shrink-0 rounded-full bg-primary px-2 py-px text-[12px] font-medium text-primary-foreground tabular-nums">{VIDEO.speed === "1" ? "Real time" : `${VIDEO.speed}×`}</span>}
      {goal && (
        <span className="flex min-w-0 flex-1 items-center gap-2.5 border-l pl-3" title={tl.goal!.text}>
          <Eyebrow className="shrink-0">Goal</Eyebrow>
          <span className="truncate text-[14px] font-medium">{goal}</span>
        </span>
      )}
      <div className="ml-auto hidden shrink-0 items-center gap-4 md:flex">
        {stats.map(([icon, color, value, label]) => (
          <span key={label || "clock"} className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Icon icon={icon} size={13} className={color} />
            <span className="font-medium text-foreground/80 tabular-nums">{value}</span>
            {label && <span className="text-muted-foreground">{label}</span>}
          </span>
        ))}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- game

function Game({ canvas, send }: { canvas: React.RefObject<HTMLCanvasElement | null>; send: (o: object) => void }) {
  const tl = useTimeline();
  const at = (e: React.MouseEvent | React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) * 765) / r.width), y: Math.round(((e.clientY - r.top) * 503) / r.height) };
  };
  useEffect(() => {
    const c = canvas.current!;
    const wheel = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <canvas
        ref={canvas} width={765} height={503} tabIndex={0}
        aria-label="Game client. Click to focus for keyboard input."
        className="block aspect-[765/503] w-full rounded-md bg-black shadow-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={(e) => { canvas.current!.focus(); send({ type: "mousedown", button: e.button, ...at(e) }); e.preventDefault(); }}
        onMouseUp={(e) => send({ type: "mouseup", button: e.button, ...at(e) })}
        onMouseMove={(e) => send({ type: "mousemove", buttons: e.buttons, ...at(e) })}
        onWheel={(e) => send({ type: "wheel", delta: Math.sign(e.deltaY), ...at(e) })}
        onKeyDown={(e) => { send({ type: "keydown", key: e.key, keyCode: e.keyCode }); if (e.key.length > 1 || e.key === " ") e.preventDefault(); }}
        onKeyUp={(e) => send({ type: "keyup", key: e.key, keyCode: e.keyCode })}
      />

    </div>
  );
}

// ---------------------------------------------------------------- state rail

const TUT: [number, string][] = [[1,"Talk to the Gielinor Guide"],[3,"Open the Settings tab"],[7,"Talk to the Gielinor Guide"],[10,"Leave the house"],[20,"Talk to the Survival Expert"],[40,"Net some shrimp"],[50,"Open the Skills tab"],[70,"Chop a tree"],[80,"Light a fire"],[90,"Cook the shrimp"],[120,"Go through the gate"],[130,"Enter the kitchen"],[140,"Talk to the Master Chef"],[150,"Make bread dough"],[160,"Bake the bread"],[170,"Leave by the back door"],[210,"Enter the Quest Guide's house"],[220,"Talk to the Quest Guide"],[230,"Open the Quest tab"],[240,"Talk to the Quest Guide"],[250,"Climb down the ladder"],[260,"Talk to the Mining Instructor"],[300,"Mine tin"],[310,"Mine copper"],[320,"Smelt a bronze bar"],[330,"Talk to the Mining Instructor"],[350,"Smith a bronze dagger"],[360,"Go through the gate"],[370,"Talk to the Combat Instructor"],[390,"Open the Equipment tab"],[405,"Wield the dagger"],[410,"Talk to the Combat Instructor"],[420,"Wield sword and shield"],[430,"Open Combat Options"],[440,"Enter the rat pen"],[450,"Kill a rat (melee)"],[470,"Talk to the Combat Instructor"],[480,"Kill a rat (ranged)"],[500,"Climb the ladder"],[510,"Use the bank"],[525,"Go to the Account Guide"],[530,"Talk to the Account Guide"],[531,"Open Account Management"],[532,"Talk to the Account Guide"],[540,"Leave through the door"],[550,"Talk to Brother Brace"],[560,"Open the Prayer tab"],[570,"Talk to Brother Brace"],[580,"Open the Friends tab"],[600,"Talk to Brother Brace"],[610,"Leave the chapel"],[620,"Talk to the Magic Instructor"],[630,"Open the Magic tab"],[650,"Cast Wind Strike on a chicken"],[670,"Go to the mainland"]];

function Row({ icon, color, label, fit, children }: { icon: IconSvgElement; color: string; label: string; fit?: boolean; children: ReactNode }) {
  return (
    <div className={fit ? "shrink-0" : "min-w-0 flex-1"}>
      <div className="mb-0.5 flex items-center gap-1.5 text-muted-foreground">
        <Icon icon={icon} size={12} className={color} />
        <span className="whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.08em]">{label}</span>
      </div>
      <div className="truncate text-[13px] leading-5 text-foreground/80">{children}</div>
    </div>
  );
}

/** A short list cut between items, never inside one: "Man, Door, Rat +3". */
const List = ({ items, n, empty }: { items: string[]; n: number; empty: string }) =>
  items.length ? <>{items.slice(0, n).join(", ")}{items.length > n && <span className="text-muted-foreground"> +{items.length - n}</span>}</> : <>{empty}</>;

/** The key parts of get_state, one line each, small enough to sit beside the game. */
/** One row of what Claude reads, coloured by kind; only what the game screen doesn't already show (the name, health,
 *  gear and chat are all in the client itself). */
function StateRow({ s }: { s: any }) {
  if (!s?.player) return <p className="text-[13px] text-muted-foreground">{s?.error ?? (s ? "Not logged in yet" : "Waiting for the game…")}</p>;
  const p = s.player;
  const inv: any[] = s.inventory ?? [];
  const near = [...(s.npcs ?? []), ...(s.objects ?? []).filter((o: any) => o.distance <= 6)]
    .sort((a, b) => a.distance - b.distance)
    .filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i)
    .slice(0, 5);
  const trained = Object.entries((s.skills ?? {}) as Record<string, number>)
    .filter(([n, l]) => l > (n === "Hitpoints" ? 10 : 1)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tp = s.tutorialProgress;
  let step = -1;
  if (tp != null && tp < 1000) { step = TUT.findIndex(([v]) => v > tp) - 1; if (step < 0) step = TUT.length - 1; }
  return (
    <div className="flex gap-x-6">
      <Row color="text-k-where" icon={MapPinIcon} label="Where" fit><span className="tabular-nums">{p.pos.x}, {p.pos.y}</span></Row>
      {step >= 0 && <Row color="text-k-tutorial" icon={TrophyIcon} label={`Tutorial ${step + 1}/${TUT.length}`}>{TUT[step][1]}</Row>}
      <Row color="text-k-backpack" icon={BackpackIcon} label="Backpack" fit><span className="tabular-nums">{inv.length}/28</span></Row>
      <Row color="text-k-nearby" icon={EyeIcon} label="Nearby"><List items={near.map((x: any) => x.name)} n={3} empty="–" /></Row>
      <Row color="text-k-skills" icon={ChartLineUpIcon} label="Skills"><List items={trained.map(([n, l]) => `${n} ${l}`)} n={3} empty="All level 1" /></Row>
    </div>
  );
}

// ---------------------------------------------------------------- Claude's mind

/** The card under the game: Claude's latest words first, then (live only) the state it reads, in one row. */
function ClaudeCard({ s }: { s?: any }) {
  const tl = useTimeline();
  const m = tl.mind;
  const [shown, setShown] = useState(m?.text ?? "");
  useEffect(() => {
    if (!m) return setShown("");
    if (!m.fresh || matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(m.text);
    // type the newest thought out, so you watch it form
    let i = 0, raf = 0;
    const step = Math.max(2, Math.ceil(m.text.length / 90));
    const tick = () => { i = Math.min(m.text.length, i + step); setShown(m.text.slice(0, i)); if (i < m.text.length) raf = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [m]);
  const typing = !!m && shown.length < m.text.length;
  return (
    <Panel className="gap-0 overflow-hidden p-0">
      <div className="flex flex-col gap-1.5 px-5 pb-4 pt-3.5" aria-label={m?.kind === "think" ? "Claude is thinking" : "Claude says"}>
        <Eyebrow><Icon icon={m?.kind === "think" ? BrainIcon : ChatCircleDotsIcon} size={12} className="text-claude" />Claude</Eyebrow>
        {m ? (
          <p className="m-0 line-clamp-2 text-[16px] leading-[1.55] tracking-[-0.01em] [overflow-wrap:anywhere]">
            {typing ? <>{shown}<span className="caret" /></> : <span dangerouslySetInnerHTML={{ __html: rich(m.text) }} />}
          </p>
        ) : <p className="m-0 text-[15px] text-muted-foreground">Claude's thoughts show up here as it plays.</p>}
      </div>
      {s !== undefined && <div className="border-t bg-subtle px-5 py-3"><StateRow s={s} /></div>}
    </Panel>
  );
}

// ---------------------------------------------------------------- timeline

function StepStatus({ s, size = 16 }: { s: Script; size?: number }) {
  const o = stepOutcome(s);
  if (!s.done) return <Icon icon={CircleNotchIcon} size={size} className={cn("text-blue", !VIDEO && "animate-spin")} />;
  if (!s.done.ok) return <Icon icon={XCircleIcon} size={size} className="text-red" />;
  if (o?.bad || s.acts.some((a) => !a.ok)) return <Icon icon={WarningIcon} size={size} className="text-amber" />;
  return <Icon icon={CheckCircleIcon} size={size} className="text-teal" />;
}

/** A step's name: Claude's own comment if it wrote one, else its first action and a grey "+N" for the rest. */
function StepTitle({ s, className = "text-[14px] font-medium" }: { s: Script; className?: string }) {
  const comment = s.code.split("\n").map((l) => l.trim()).find((l) => l.startsWith("//"));
  if (comment) return <div className={cn("truncate", className)}>{stepTitle(s)}</div>;
  const groups = groupActs(s.acts);
  if (!groups.length) return <div className={cn("truncate", className)}>{stepTitle(s)}</div>;
  const first = groups.find((g) => !["varp", "camera", "menu"].includes(g.op)) ?? groups[0];
  return (
    <div className={cn("flex min-w-0 items-baseline gap-1.5", className)}>
      <span className="truncate">{first.label}{first.acts.length > 1 && <span className="tabular-nums"> ×{first.acts.length}</span>}</span>
      {groups.length > 1 && <span className="shrink-0 text-muted-foreground tabular-nums">+{groups.length - 1}</span>}
    </div>
  );
}

function StepCard({ s, onOpen, code }: { s: Script; onOpen: () => void; code?: boolean }) {
  const o = stepOutcome(s);
  const bad = o?.bad ? o : null; // a plain result ("Menu", "1", raw JSON) is noise; only say how it went when it went wrong
  // chips only add something when the title is Claude's own comment; otherwise the title already lists the actions
  const groups = s.code.split("\n").some((l) => l.trim().startsWith("//")) ? groupActs(s.acts) : [];
  return (
    <button type="button" onClick={onOpen} className="w-full px-4 py-2.5 text-left transition-colors hover:bg-background focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <div className="flex items-start gap-2.5">
        <div className="mt-[3px]"><StepStatus s={s} size={14} /></div>
        <div className="min-w-0 flex-1">
          <StepTitle s={s} className="text-[13px] text-foreground/80" />
          {bad && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{bad.text}</p>}
          {groups.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {groups.slice(-6).map((g, i) => (
                <span key={i} title={g.acts.map((a) => `${humanAct(a.req)} → ${a.res ?? ""}`).join("\n")}
                  className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
                  <Icon icon={g.ok ? OP_ICON[g.op] ?? CursorIcon : WarningIcon} size={12} className={g.ok ? "" : "text-red"} />
                  {g.label}{g.acts.length > 1 && <span className="tabular-nums">×{g.acts.length}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function Words({ item }: { item: Extract<Item, { kind: "think" | "say" }> }) {
  const [open, setOpen] = useState(false);
  const long = item.text.length > 320;
  return (
    <div className="flex gap-2.5 px-4 py-3">
      <Icon icon={item.kind === "think" ? BrainIcon : ChatCircleDotsIcon} size={15} className="mt-1 shrink-0 text-claude" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline justify-between gap-2">
          <time className="font-mono text-[11px] text-muted-foreground">{fmtTime(item.t)}</time>
        </div>
        <p className={cn("whitespace-pre-wrap text-sm leading-6", !open && long && "line-clamp-5")} dangerouslySetInnerHTML={{ __html: rich(item.text) }} />
        {long && <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs text-link hover:underline">{open ? "Show less" : "Show more"}</button>}
      </div>
    </div>
  );
}

function TimelineItem({ item, onOpen, code }: { item: Item; onOpen: (s: Script) => void; code?: boolean }) {
  switch (item.kind) {
    case "think":
    case "say":
      return <Words item={item} />;
    case "script":
      return <StepCard s={item.script} onOpen={() => onOpen(item.script)} code={code} />;
    case "tool":
      return (
        <div className="flex items-center gap-3 pl-1 text-[13px] text-muted-foreground">
          <Icon icon={item.name === "screenshot" ? EyeIcon : InfoIcon} size={15} />
          {item.name === "screenshot" ? "Looked at the screen" : "Checked the game state"}
          {item.frame && <img src={`data:image/jpeg;base64,${item.frame}`} alt="What Claude saw" className="h-12 rounded-sm border" />}
        </div>
      );
    case "sep":
      return (
        <div className={cn("flex items-center gap-3 py-1 text-xs", item.done ? "text-link" : "text-muted-foreground")}>
          <span className="h-px flex-1 bg-border" />{item.text} · {fmtTime(item.t)}<span className="h-px flex-1 bg-border" />
        </div>
      );
    case "act":
      return (
        <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-muted-foreground">
          <Icon icon={OP_ICON[JSON.parse(item.act.req || "{}").op] ?? CursorIcon} size={14} />
          <span className="truncate">You: {humanAct(item.act.req)}</span>
          <span className={cn("ml-auto shrink-0", !item.act.ok && "text-destructive")}>{item.act.ok ? "done" : "failed"}</span>
        </div>
      );
  }
}

/** The script Claude is running right now, readable: a white card on the sidebar's grey, so it reads as "now". */
function CodePanel({ s, onOpen }: { s: Script | undefined; onOpen: (s: Script) => void }) {
  const bad = s && stepOutcome(s)?.bad ? stepOutcome(s) : null;
  return (
    <section className="flex min-h-0 flex-col gap-2 px-4 pb-4 pt-4">
      <Eyebrow>Running</Eyebrow>
      {s ? (
        <button type="button" onClick={() => onOpen(s)} className="flex min-h-0 flex-col overflow-hidden rounded-md bg-card text-left shadow-card">
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <StepStatus s={s} />
            <div className="min-w-0 flex-1"><StepTitle s={s} className="text-[15px] font-medium" /></div>
          </div>
          {bad && <p className="-mt-1.5 truncate px-3.5 pb-2.5 pl-[40px] text-[13px] text-muted-foreground">{bad.text}</p>}
          <pre className="m-0 min-h-0 overflow-hidden whitespace-pre-wrap border-t bg-code px-3.5 py-3 font-mono text-[12px] leading-[1.15rem]"
            dangerouslySetInnerHTML={{ __html: highlight(s.code.split("\n").slice(0, 16).join("\n")).replace(/([,;{(])/g, "$1<wbr>") }} />
        </button>
      ) : <p className="text-[14px] text-muted-foreground">The code Claude writes shows up here.</p>}
    </section>
  );
}

/** The right column, on a grey surface: the running script, then the action log (every step before it), quieter. */
function TimelinePanel({ onOpen }: { onOpen: (s: Script) => void }) {
  const tl = useTimeline();
  const items = tl.items.filter((it) => it.kind === "script" || it.kind === "act");
  const finished = !!tl.run && !tl.runStart; // nothing is running: the last script is just another log row
  const current = finished ? undefined : (items.find((it) => it.kind === "script") as Extract<Item, { kind: "script" }> | undefined);
  const log = items.filter((it) => it !== current);
  return (
    <aside className="flex min-h-0 flex-col border-t bg-subtle lg:border-l lg:border-t-0">
      {!finished && <CodePanel s={current?.script} onOpen={onOpen} />}
      <Eyebrow className="border-t px-4 pb-1.5 pt-3.5" right={log.length}>Action log</Eyebrow>
      {/* the fixed video frame fades its last row instead of cutting it */}
      <ScrollArea className={cn("min-h-0 flex-1 max-lg:h-[60vh]", VIDEO && "[mask-image:linear-gradient(to_bottom,#000_calc(100%-40px),transparent)]")}>
        <div className="divide-y divide-border/70">
          {log.map((it) => <div key={it.key} className={cn(it.fresh && "fresh")}><TimelineItem item={it} onOpen={onOpen} /></div>)}
        </div>
      </ScrollArea>
    </aside>
  );
}

function StepDialog({ s, onClose }: { s: Script | null; onClose: () => void }) {
  const [showCode, setShowCode] = useState(false);
  useEffect(() => setShowCode(false), [s]);
  if (!s) return null;
  const o = stepOutcome(s);
  let pretty = s.done?.result ?? "";
  try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch {}
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="gap-0 overflow-hidden rounded-lg p-0 shadow-modal sm:max-w-3xl">
        <DialogHeader className="border-b p-5">
          <div className="flex items-center gap-2.5">
            <StepStatus s={s} />
            <DialogTitle className="text-base tracking-tight">{stepTitle(s)}</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Step {s.no} · {fmtTime(s.t)} · {s.acts.length} action{s.acts.length === 1 ? "" : "s"}{s.done ? ` · took ${fmtMs(s.done.t - s.t)}` : " · still running"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[72vh]">
          <div className="grid gap-6 p-5">
            {s.why.length > 0 && (
              <section>
                <Label icon={BrainIcon}>Why Claude did this</Label>
                <div className="grid gap-2">
                  {s.why.map((w, i) => <p key={i} className="whitespace-pre-wrap border-l-2 pl-3 text-sm leading-6" dangerouslySetInnerHTML={{ __html: rich(w.text) }} />)}
                </div>
              </section>
            )}
            <section>
              <Label icon={CursorIcon}>What it did</Label>
              {s.acts.length ? (
                <ol className="grid gap-1.5">
                  {s.acts.map((a, i) => {
                    const { op } = JSON.parse(a.req || "{}");
                    return (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <Icon icon={a.ok ? OP_ICON[op] ?? CursorIcon : WarningIcon} size={15} className={cn("mt-0.5 shrink-0", a.ok ? "text-muted-foreground" : "text-destructive")} />
                        <span className="min-w-0 flex-1">
                          {humanAct(a.req)}
                          {!a.ok && <span className="block text-[13px] text-muted-foreground">{a.res}</span>}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{fmtMs(a.ms)}</span>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="text-sm text-muted-foreground">{stepTitle(s) === "Looked around" ? "No game actions, it only looked around." : "The actions for this step weren't recorded. Open the code to see what it tried."}</p>}
            </section>
            {o && !s.acts.some((a) => !a.ok && a.res === o.text) && ( // say how it went only if the action list hasn't already
              <section>
                <Label icon={o.bad ? WarningIcon : CheckCircleIcon}>How it went</Label>
                <p className="text-sm">{o.text}</p>
              </section>
            )}
            <section>
              <button type="button" onClick={() => setShowCode(!showCode)} className="flex items-center gap-2 text-sm text-link hover:underline">
                <Icon icon={CodeIcon} size={15} /> {showCode ? "Hide the code" : "Show the code Claude wrote"}
              </button>
              {showCode && (
                <div className="mt-3 grid gap-3">
                  <pre className="max-h-80 overflow-auto rounded-md bg-code p-4 font-mono text-[12.5px] leading-5 shadow-card" dangerouslySetInnerHTML={{ __html: highlight(s.code) }} />
                  {!!s.done?.console.length && <pre className="max-h-52 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{s.done.console.join("\n")}</pre>}
                  {s.done && <pre className="max-h-52 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{pretty}</pre>}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- app

function VideoApp() {
  return (
    <div className="flex h-dvh flex-col">
      <Header live s={null} />
      <main className="grid min-h-0 flex-1 grid-cols-[813px_minmax(0,1fr)]">
        <div className="flex flex-col justify-center gap-2 p-6">
          <div id="game-slot" className="h-[503px] w-[765px] rounded-md bg-black shadow-card" />
          <div className="mt-3"><ClaudeCard /></div>
        </div>
        <TimelinePanel onOpen={() => {}} />
      </main>
    </div>
  );
}

function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { live, send } = useGateway(canvas);
  const s = useGameState();
  const [open, setOpen] = useState<Script | null>(null);
  useTimeline(); // keep the open dialog live while its step runs
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        <Header live={live} s={s} />
        <main className="grid min-w-0 flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(420px,36%)]">
          <ScrollArea className="min-w-0 lg:min-h-0">
            <div className="flex min-w-0 flex-col gap-5 p-4 lg:p-5">
              <div className="mx-auto flex w-full flex-col gap-4 lg:max-w-[calc((100dvh-15rem)*765/503)]">
                <Game canvas={canvas} send={send} />
                <ClaudeCard s={s} />
              </div>
            </div>
          </ScrollArea>
          <TimelinePanel onOpen={setOpen} />
        </main>
      </div>
      <StepDialog s={open} onClose={() => setOpen(null)} />
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(VIDEO ? <TooltipProvider><VideoApp /></TooltipProvider> : <App />);
