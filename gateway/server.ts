// MoRS gateway.
//  /client  WebSocket from the game client (MoRS loader): JPEG frames in, input + SDK requests out
//  /view    WebSocket from browsers: frames out, mouse/keyboard in
//  GET /state, POST /act   SDK API, relayed to the client ("id\npath\nbody" -> "id\njson")
//  /, /jav_config.ws, /world_list.ws   static
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import viewer from "../web/index.html"; // React + shadcn viewer, bundled by Bun on the fly

const PORT = Number(process.env.PORT ?? 8888);
const HOST = process.env.HOST ?? "127.0.0.1";
const WEB = join(import.meta.dir, "../web");

type Role = { role: "client" | "view" };
let client: Bun.ServerWebSocket<Role> | null = null;
const views = new Set<Bun.ServerWebSocket<Role>>();
const waiting = new Map<string, (json: string) => void>();
let reqId = 0;
const timeline: string[] = []; // dashboard events (actions, scripts, tool calls, agent messages), replayed to new viewers
let lastFrame: Uint8Array | null = null; // latest JPEG, served at /screenshot

function broadcastText(msg: string) {
  for (const v of views) v.send(msg);
}

function emit(event: Record<string, unknown>) {
  const msg = JSON.stringify(event);
  timeline.push(msg);
  if (timeline.length > 2000) timeline.shift();
  broadcastText(msg);
}

// Follow the newest Claude transcript and surface the agent's own words + run results. Two sources:
// runs/*.jsonl (headless `claude -p --output-format stream-json`) and Claude Code's own session logs
// for this folder (an interactive `claude` opened here). Both use the same {type, message} lines.
const ROOT = join(import.meta.dir, "..");
const TRANSCRIPTS = [join(ROOT, "runs"), join(homedir(), ".claude/projects", ROOT.replace(/[^A-Za-z0-9]/g, "-"))];
let tailFile = "";
let tailOffset = 0;
let openScript: string | null = null; // the execute_code call currently running; its actions nest under it
const toolNames = new Map<string, string>();
async function tailTranscript() {
  try {
    let newest = "", newestM = 0;
    for (const dir of TRANSCRIPTS) {
      if (!existsSync(dir)) continue;
      for (const f of new Bun.Glob("*.jsonl").scanSync(dir)) {
        const m = (await Bun.file(join(dir, f)).stat()).mtimeMs;
        if (m > newestM) [newest, newestM] = [join(dir, f), m];
      }
    }
    if (!newest) return;
    if (newest !== tailFile) {
      tailFile = newest;
      tailOffset = 0;
      emit({ type: "run", t: Date.now(), file: basename(newest) });
    }
    const file = Bun.file(tailFile);
    if (file.size <= tailOffset) return;
    const text = await file.slice(tailOffset, file.size).text();
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return;
    tailOffset += Buffer.byteLength(text.slice(0, lastNl + 1));
    for (const line of text.slice(0, lastNl).split("\n")) {
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const t = e.timestamp ? Date.parse(e.timestamp) : Date.now(); // session logs carry real times; replays keep them
      if (e.type === "assistant") {
        for (const c of e.message?.content ?? []) {
          if (c.type === "text" && c.text.trim()) emit({ type: "say", t, text: c.text });
          if (c.type === "thinking" && c.thinking?.trim()) emit({ type: "think", t, text: c.thinking });
          if (c.type !== "tool_use") continue;
          const tool = String(c.name).split("__").pop()!;
          toolNames.set(c.id, tool);
          if (tool === "execute_code") {
            openScript = c.id;
            emit({ type: "script", phase: "start", id: c.id, t, code: c.input?.code ?? "" });
          } else if (tool === "get_state" || tool === "screenshot") {
            emit({ type: "tool", t, name: tool, frame: tool === "screenshot" && lastFrame ? Buffer.from(lastFrame).toString("base64") : undefined });
          }
        }
      } else if (e.type === "user") {
        // what the user asked for: a plain-text prompt (tool results come back as user turns too)
        const content = e.message?.content;
        const said = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n") : "";
        // a subagent's prompt (parent_tool_use_id) is Claude talking to itself, not the goal
        if (said.trim() && !e.isMeta && !e.parent_tool_use_id && !/^\s*<|^\[Request interrupted/.test(said)) emit({ type: "goal", t, text: said.trim() });
        for (const c of Array.isArray(content) ? content : []) {
          if (c?.type !== "tool_result" || toolNames.get(c.tool_use_id) !== "execute_code") continue;
          const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x: any) => x.text ?? "").join("\n");
          const lines = text.split("\n");
          const result = lines.filter((l: string) => l.startsWith("=> ")).pop()?.slice(3) ?? "";
          const consoleLines = lines.filter((l: string) => !l.startsWith("  · ") && !l.startsWith("=> "));
          emit({ type: "script", phase: "end", id: c.tool_use_id, t, ok: !c.is_error && !/^\{"error"/.test(result), result, console: consoleLines.slice(-60) });
          if (openScript === c.tool_use_id) openScript = null;
        }
      } else if (e.type === "system" && e.subtype === "init") {
        emit({ type: "runinfo", t, model: e.model, tools: e.tools?.length, mcp: e.mcp_servers });
      } else if (e.type === "result") {
        emit({ type: "result", t, ok: e.subtype === "success", turns: e.num_turns, cost: e.total_cost_usd, ms: e.duration_ms });
      }
    }
  } catch {}
}
setInterval(tailTranscript, 500);

function tellClientViewers() {
  client?.send(JSON.stringify({ type: "viewers", count: views.size }));
}

function toClient(path: string, body = ""): Promise<string> {
  if (!client) return Promise.resolve(JSON.stringify({ ok: false, error: "game client not connected to the gateway" }));
  const id = String(++reqId);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(JSON.stringify({ ok: false, error: "client did not answer in 30s" }));
    }, 30_000);
    waiting.set(id, (json) => {
      clearTimeout(timer);
      resolve(json);
    });
    client!.send(`${id}\n${path}\n${body}`);
  });
}

Bun.serve<Role, "/">({
  port: PORT,
  hostname: HOST,
  development: process.env.NODE_ENV !== "production",
  routes: { "/": viewer },
  async fetch(req, server) {
    const p = new URL(req.url).pathname;
    if (p === "/client" || p === "/view") {
      return server.upgrade(req, { data: { role: p.slice(1) as Role["role"] } }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (p === "/state") return new Response(await toClient("/state"), { headers: { "content-type": "application/json" } });
    if (p === "/act") {
      const body = await req.text();
      const started = Date.now();
      await tailTranscript(); // make sure the script that sent this action is already known
      const script = req.headers.get("x-mors-script") ?? openScript ?? undefined;
      const res = await toClient("/act", body);
      let entry: Record<string, unknown> = { type: "act", t: started, ms: Date.now() - started, req: body, script };
      try {
        const r = JSON.parse(res);
        entry = { ...entry, ok: r.ok, res: r.ok ? r.result : r.error };
      } catch {
        entry = { ...entry, ok: false, res };
      }
      if (!req.headers.get("x-mors-quiet")) emit(entry);
      return new Response(res, { headers: { "content-type": "application/json" } });
    }
    if (p === "/event" && req.method === "POST") {
      const ev = await req.json();
      if (ev.type === "tool" && ev.name === "screenshot" && lastFrame) ev.frame = Buffer.from(lastFrame).toString("base64");
      emit(ev);
      return new Response("ok");
    }
    if (p === "/screenshot") return lastFrame ? new Response(lastFrame as Uint8Array<ArrayBuffer>, { headers: { "content-type": "image/jpeg" } }) : new Response("no frame yet", { status: 503 });
    if (["/jav_config.ws", "/world_list.ws"].includes(p)) return new Response(Bun.file(join(WEB, p.slice(1))));
    return new Response("not found", { status: 404 });
  },
  websocket: {
    maxPayloadLength: 8 * 1024 * 1024,
    open(ws) {
      if (ws.data.role === "client") {
        client = ws;
        console.log("game client connected");
        tellClientViewers();
      } else {
        views.add(ws);
        for (const msg of timeline) ws.send(msg);
        tellClientViewers();
      }
    },
    message(ws, msg) {
      if (ws.data.role === "view") {
        client?.send(String(msg)); // input JSON
        return;
      }
      if (typeof msg !== "string") {
        lastFrame = new Uint8Array(msg as unknown as ArrayBuffer);
        for (const v of views) v.send(msg); // JPEG frame
        return;
      }
      const nl = msg.indexOf("\n");
      const id = msg.slice(0, nl);
      waiting.get(id)?.(msg.slice(nl + 1));
      waiting.delete(id);
    },
    close(ws) {
      if (ws.data.role === "client") {
        if (client === ws) client = null;
        console.log("game client disconnected");
      } else {
        views.delete(ws);
        tellClientViewers();
      }
    },
  },
});
console.log(`MoRS gateway on http://${HOST}:${PORT}`);
