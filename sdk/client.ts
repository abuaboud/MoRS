// Plumbing: talks to the gateway (which relays to the in-client Bridge).
// state() is a full snapshot; act(op, args) performs one input action and returns {ok, result|error}.

export type Pos = { x: number; y: number; plane: number };
export type RawNpc = { name: string; index: number; id: number; pos: Pos; distance: number; actions: string[]; inCombat: boolean; interactingWithMe: boolean };
export type RawObject = { name: string; id: number; pos: Pos; distance: number; actions: string[] };
export type RawItem = { name: string; id: number; quantity: number; slot?: number };
export type RawGroundItem = { name: string; id: number; quantity: number; pos: Pos };
export type State = {
  gameState: string;
  tick: number;
  ui: string[];
  loginIndex?: number;
  player?: { name: string; pos: Pos; animation: number; moving: boolean; interacting: string | null; hp: number; runEnergy: number };
  skills?: Record<string, number>;
  inventory?: RawItem[];
  equipment?: RawItem[];
  tutorialProgress?: number;
  npcs?: RawNpc[];
  objects?: RawObject[];
  groundItems?: RawGroundItem[];
  hintArrowNpc?: string;
  hintArrowPoint?: Pos;
  messages?: string[];
};
export type Result = { ok: boolean; result?: string; error?: string; [k: string]: unknown };

export class BridgeClient {
  constructor(
    public url = process.env.MORS_GATEWAY ?? "http://127.0.0.1:8888",
    public log: (line: string) => void = () => {},
    public headers: Record<string, string> = {},
  ) {}

  async state(): Promise<State> {
    return (await fetch(`${this.url}/state`, { headers: this.headers })).json() as Promise<State>;
  }

  /** `quiet` keeps a helper's own lookups (walkTo's map reads) out of the viewer's action log. */
  async act(op: string, args: Record<string, unknown> = {}, quiet = false): Promise<Result> {
    const headers = quiet ? { ...this.headers, "x-mors-quiet": "1" } : this.headers;
    const res = await fetch(`${this.url}/act`, { method: "POST", headers, body: JSON.stringify({ op, ...args }) });
    const r = (await res.json()) as Result;
    this.log(`${op} ${JSON.stringify(args)} -> ${r.ok ? r.result : r.error}`);
    return r;
  }

  /** liquid's Time.sleepUntil: poll state until the condition holds (one game tick = 600ms). */
  async sleepUntil(cond: (s: State) => boolean, timeoutMs = 10_000, pollMs = 300): Promise<State | null> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const s = await this.state();
      if (cond(s)) return s;
      await sleep(pollMs);
    }
    return null;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
