// Porcelain, modelled on liquid-automation's script API:
//   method groups (inventory, npcs, objects, walking, skills, widgets, dialogue, bank, game),
//   wrappers with interact(), chainable queries, and Time-style sleepUntil.
// Every action returns {ok, result|error}; errors say what was nearby so an agent can recover.
import { BridgeClient, chebyshev, sleep, type Pos, type RawGroundItem, type RawItem, type RawNpc, type RawObject, type Result, type State } from "./client.ts";

// ---------------------------------------------------------------- queries

export class Query<T extends { name: string; distance?: number }> {
  constructor(private items: T[], private wrap: (t: T) => Interactable<T>) {}
  name(...names: string[]) {
    const n = names.map((s) => s.toLowerCase());
    return new Query(this.items.filter((i) => n.includes(i.name.toLowerCase())), this.wrap);
  }
  nameContains(part: string) {
    return new Query(this.items.filter((i) => i.name.toLowerCase().includes(part.toLowerCase())), this.wrap);
  }
  action(action: string) {
    return new Query(this.items.filter((i: any) => (i.actions ?? []).some((a: string) => a.toLowerCase() === action.toLowerCase())), this.wrap);
  }
  filter(fn: (t: T) => boolean) {
    return new Query(this.items.filter(fn), this.wrap);
  }
  nearest() {
    return new Query([...this.items].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)), this.wrap);
  }
  first(): Interactable<T> | null {
    return this.items.length ? this.wrap(this.items[0]) : null;
  }
  all(): Interactable<T>[] {
    return this.items.map(this.wrap);
  }
  get size() {
    return this.items.length;
  }
}

// ---------------------------------------------------------------- wrappers

export class Interactable<T extends { name: string }> {
  constructor(protected sdk: Sdk, public raw: T, private kind: "npc" | "object" | "groundItem" | "widget") {}
  get name() {
    return this.raw.name;
  }
  get pos(): Pos | undefined {
    return (this.raw as any).pos;
  }
  get actions(): string[] {
    return (this.raw as any).actions ?? [];
  }
  /** Right-click → option. Walks closer first if the target is off-screen. */
  async interact(option: string): Promise<Result> {
    const args: Record<string, unknown> = { name: this.raw.name, option };
    if (this.kind === "object" && this.pos) Object.assign(args, { x: this.pos.x, y: this.pos.y });
    const r = await this.sdk.client.act(this.kind, args);
    if (r.ok || !/not found on screen/.test(r.error ?? "") || !this.pos) return r;
    const w = await this.sdk.walking.walkTo(this.pos, 3);
    if (!w.ok) return w;
    return this.sdk.client.act(this.kind, args);
  }
}

export class Npc extends Interactable<RawNpc> {
  get inCombat() {
    return this.raw.inCombat;
  }
}
export class GameObject extends Interactable<RawObject> {}
export class GroundItem extends Interactable<RawGroundItem> {}

// ---------------------------------------------------------------- method groups

class Inventory {
  constructor(private sdk: Sdk) {}
  async items(): Promise<RawItem[]> {
    return (await this.sdk.client.state()).inventory ?? [];
  }
  async count(name?: string) {
    const items = await this.items();
    return name ? items.filter((i) => i.name.toLowerCase() === name.toLowerCase()).reduce((n, i) => n + i.quantity, 0) : items.length;
  }
  async contains(...names: string[]) {
    const items = await this.items();
    return names.some((n) => items.some((i) => i.name.toLowerCase() === n.toLowerCase()));
  }
  async isFull() {
    return (await this.items()).length >= 28;
  }
  async freeSpace() {
    return 28 - (await this.items()).length;
  }
  /** Inventory item option, e.g. interact("Bronze dagger", "Wield"). Opens the inventory tab first. */
  async interact(item: string, option: string): Promise<Result> {
    await this.sdk.widgets.openTab("Inventory");
    return this.sdk.client.act("widget", { name: item, option });
  }
  async use(item: string, on: { npc?: string; object?: string; item?: string }): Promise<Result> {
    const r = await this.interact(item, "Use");
    if (!r.ok) return r;
    if (on.npc) return this.sdk.client.act("npc", { name: on.npc, option: "use" });
    if (on.object) return this.sdk.client.act("object", { name: on.object, option: "use" });
    return this.sdk.client.act("widget", { name: on.item, option: "use" });
  }
  async dropAll(name: string): Promise<Result> {
    await this.sdk.widgets.openTab("Inventory");
    let dropped = 0;
    while (await this.contains(name)) {
      const r = await this.sdk.client.act("widget", { name, option: "Drop" });
      if (!r.ok) return { ok: false, error: r.error, dropped };
      dropped++;
      await sleep(120);
    }
    return { ok: true, result: `dropped ${dropped} ${name}` };
  }
}

class Npcs {
  constructor(private sdk: Sdk) {}
  async query(): Promise<Query<RawNpc>> {
    const s = await this.sdk.client.state();
    return new Query(s.npcs ?? [], (n) => new Npc(this.sdk, n, "npc"));
  }
  async nearest(name: string): Promise<Npc | null> {
    return (await this.query()).name(name).nearest().first() as Npc | null;
  }
}

class Objects {
  constructor(private sdk: Sdk) {}
  async query(): Promise<Query<RawObject>> {
    const s = await this.sdk.client.state();
    return new Query(s.objects ?? [], (o) => new GameObject(this.sdk, o, "object"));
  }
  /** Nearest object with this name (and this action, if given). */
  async nearest(name: string, action?: string): Promise<GameObject | null> {
    let q = (await this.query()).name(name);
    if (action) q = q.action(action);
    return q.nearest().first() as GameObject | null;
  }
}

class GroundItems {
  constructor(private sdk: Sdk) {}
  async query(): Promise<Query<RawGroundItem>> {
    const s = await this.sdk.client.state();
    return new Query(s.groundItems ?? [], (g) => new GroundItem(this.sdk, g, "groundItem"));
  }
}

class Skills {
  constructor(private sdk: Sdk) {}
  async level(skill: string) {
    return (await this.sdk.client.state()).skills?.[skill] ?? 0;
  }
}

class Walking {
  constructor(private sdk: Sdk) {}

  async isRunning(): Promise<boolean> {
    return (await this.sdk.client.act("varp", { id: 173 })).value === 1;
  }

  /** Toggle run like a player: click the run orb by the minimap. */
  async setRun(on = true): Promise<Result> {
    if ((await this.isRunning()) === on) return { ok: true, result: `run already ${on ? "on" : "off"}` };
    return this.sdk.client.act("widget", { name: "Toggle Run", option: "Toggle Run" });
  }

  /**
   * Route over the loaded scene (~50 tiles around you) with the client's own collision map, like a player
   * reading the map: walls, fences and water go around, closed doors count as walls. Returns the tiles from
   * the next step to the reachable tile nearest `target` (the target itself when it's in view and reachable).
   */
  async route(target: { x: number; y: number }, within = 1): Promise<{ path: { x: number; y: number }[]; left: number } | null> {
    const me = (await this.sdk.client.state()).player!.pos;
    const R = 50, N = 2 * R + 1;
    const c = await this.sdk.client.act("collision", { x: me.x, y: me.y, radius: R }, true);
    const rows = (c as { rows?: string[] }).rows;
    if (!c.ok || !rows || rows.length !== N) return null;
    // rows run north to south; flags[i][j] is tile (me.x - R + i, me.y - R + j)
    const flags = Array.from({ length: N }, () => new Int32Array(N));
    rows.forEach((row, k) => row.split(":")[1].trim().split(/\s+/).forEach((h, i) => (flags[i][N - 1 - k] = parseInt(h, 16))));
    const FULL = 0x100 | 0x40000 | 0x200000; // object, floor decoration, floor (out of scene reads as ffffff)
    // [dx, dy, wall on the destination's side facing us]
    const dirs = [[0, 1, 0x20], [0, -1, 0x2], [1, 0, 0x80], [-1, 0, 0x8]] as const;
    const prev = new Int32Array(N * N).fill(-1);
    const start = R * N + R;
    prev[start] = start;
    const queue = [start];
    let goal = start, goalScore = Infinity;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q], i = Math.floor(cur / N), j = cur % N;
      const score = chebyshev({ x: me.x - R + i, y: me.y - R + j }, target);
      if (score < goalScore) { goal = cur; goalScore = score; }
      if (score <= within) break;
      for (const [dx, dy, wall] of dirs) {
        const ni = i + dx, nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const next = ni * N + nj;
        if (prev[next] !== -1 || flags[ni][nj] & (FULL | wall)) continue;
        prev[next] = cur;
        queue.push(next);
      }
    }
    const path: { x: number; y: number }[] = [];
    for (let k = goal; k !== start; k = prev[k]) path.unshift({ x: me.x - R + Math.floor(k / N), y: me.y - R + (k % N) });
    return { path, left: goalScore };
  }

  /**
   * Walk to a tile in minimap-sized hops along `route`, running when there is energy.
   * Queues the next hop before the player stops, so movement stays continuous.
   */
  async walkTo(target: { x: number; y: number }, within = 1, timeoutMs = 120_000): Promise<Result> {
    const end = Date.now() + timeoutMs;
    const first = await this.sdk.client.state();
    if ((first.player?.runEnergy ?? 0) > 10) await this.setRun(true);
    // moving isn't progress: wandering around a fence never gets closer, so expire on distance left, not position.
    // A scene reload can reveal the way is much longer than it looked: that starts the count again. A tile of
    // wobble (stepping back and forth at a closed door) doesn't.
    let best = Infinity;
    let stuck = 0;
    while (Date.now() < end) {
      const me = (await this.sdk.client.state()).player!.pos;
      if (chebyshev(me, target) <= within) return { ok: true, result: `at ${me.x},${me.y}` };
      const route = await this.route(target, within);
      const left = route ? route.path.length + route.left : chebyshev(me, target);
      if (left < best || left > best + 5) { best = left; stuck = 0; }
      else if (++stuck >= 4) return { ok: false, error: `stuck at ${me.x},${me.y}, ${chebyshev(me, target)} tiles from ${target.x},${target.y}: not getting closer; open a closed door/gate, or walk via a waypoint you know is on the way (a road, a bridge)` };
      if (route && route.path.length === 0)
        return { ok: false, error: `no way from ${me.x},${me.y} toward ${target.x},${target.y} within the ~50 tiles loaded around you: this is a dead end. Open a closed door/gate, or walk via a waypoint you know is on the way (a road, a bridge)` };
      // the minimap is round: cap the hop at 13 tiles, shrinking it if the click is refused
      let radius = 13;
      let hop = { x: target.x, y: target.y };
      let r: Result = { ok: false, error: "" };
      while (radius >= 4) {
        if (route) hop = route.path[Math.min(radius, route.path.length) - 1];
        else {
          const dx = target.x - me.x, dy = target.y - me.y, d = Math.hypot(dx, dy);
          hop = d <= radius ? { x: target.x, y: target.y } : { x: Math.round(me.x + (dx / d) * radius), y: Math.round(me.y + (dy / d) * radius) };
        }
        r = await this.sdk.client.act("walk", hop);
        if (r.ok || !/too far/.test(r.error ?? "")) break;
        radius -= 3;
      }
      if (!r.ok) return r;
      const finalHop = chebyshev(hop, target) <= within;
      // keep moving: re-plan when close to this hop (or when we stop early), not after a full stop
      await this.sdk.client.sleepUntil((s) => {
        const p = s.player!.pos;
        return chebyshev(p, hop) <= (finalHop ? within : 3) || !s.player!.moving;
      }, 12_000, 200);
    }
    return { ok: false, error: "walkTo timed out" };
  }
}

class Widgets {
  constructor(private sdk: Sdk) {}
  /** Click any visible widget by text/name and option (tab stones, buttons, spells). */
  async click(name: string | null, option: string): Promise<Result> {
    return this.sdk.client.act("widget", { ...(name ? { name } : {}), option });
  }
  /** Side tabs: "Inventory", "Skills", "Settings", "Quest List", "Equipment", "Combat Options", "Prayer", "Magic", "Friends List", "Account Management". */
  async openTab(tab: string): Promise<Result> {
    return this.sdk.client.act("widget", { name: tab, option: tab });
  }
}

class Dialogue {
  constructor(private sdk: Sdk) {}
  async text(): Promise<string[]> {
    return (await this.sdk.client.state()).ui;
  }
  async canContinue() {
    return (await this.text()).some((l) => /click here to continue|click to continue/i.test(l));
  }
  /** Press space through every "continue" page; returns the lines seen. Stops at options. */
  async continueAll(max = 30): Promise<string[]> {
    const seen: string[] = [];
    for (let i = 0; i < max && (await this.canContinue()); i++) {
      seen.push((await this.text()).join(" | "));
      await this.sdk.client.act("key", { key: "space" });
      await sleep(700);
    }
    return seen;
  }
  /** Choose a numbered option by (partial) text. */
  async choose(text: string): Promise<Result> {
    const lines = (await this.text()).filter((l) => !/^select an option$/i.test(l));
    const i = lines.findIndex((o) => o.toLowerCase().includes(text.toLowerCase()));
    if (i < 0) return { ok: false, error: `no option "${text}"; dialogue: ${lines.join(" | ")}` };
    return this.sdk.client.act("key", { key: String(i + 1) });
  }
}

class Bank {
  constructor(private sdk: Sdk) {}
  async open(): Promise<Result> {
    const booth = (await (await this.sdk.objects.query()).action("Bank").nearest().first()) ?? (await (await this.sdk.npcs.query()).action("Bank").nearest().first());
    if (!booth) return { ok: false, error: "no bank booth or banker nearby" };
    return booth.interact("Bank");
  }
  async depositInventory(): Promise<Result> {
    return this.sdk.widgets.click("Deposit inventory", "Deposit inventory");
  }
}

class Camera {
  constructor(private sdk: Sdk) {}
  /** yaw 0..2047 (0 north, 512 west, 1024 south, 1536 east), pitch 128 (flat) .. 383 (top-down), zoom = 3D zoom scale */
  async state(): Promise<{ yaw: number; pitch: number; zoom: number } | undefined> {
    return (await this.sdk.client.state() as any).camera;
  }
  /** Turn the camera to look toward a tile. */
  turnTo(tile: { x: number; y: number }): Promise<Result> {
    return this.sdk.client.act("camera", { faceX: tile.x, faceY: tile.y });
  }
  set(opts: { yaw?: number; pitch?: number }): Promise<Result> {
    return this.sdk.client.act("camera", opts);
  }
  /** Scroll-zoom: negative = in, positive = out (wheel notches). */
  zoom(notches: number): Promise<Result> {
    return this.sdk.client.act("camera", { zoom: notches });
  }
}

class Game {
  constructor(private sdk: Sdk) {}
  async login(username: string, password: string): Promise<Result> {
    if ((await this.sdk.client.state()).gameState === "LOGGED_IN") return { ok: true, result: "already logged in" };
    await this.sdk.client.act("login", { username, password });
    const s = await this.sdk.client.sleepUntil((s) => s.gameState === "LOGGED_IN" && !!s.player, 30_000);
    return s ? { ok: true, result: `logged in as ${s.player!.name} at ${s.player!.pos.x},${s.player!.pos.y}` } : { ok: false, error: "login timed out" };
  }
  async messages(): Promise<string[]> {
    return (await this.sdk.client.state()).messages ?? [];
  }
}

// ---------------------------------------------------------------- entry point

export class Sdk {
  readonly client: BridgeClient;
  readonly game = new Game(this);
  readonly inventory = new Inventory(this);
  readonly npcs = new Npcs(this);
  readonly objects = new Objects(this);
  readonly groundItems = new GroundItems(this);
  readonly skills = new Skills(this);
  readonly walking = new Walking(this);
  readonly widgets = new Widgets(this);
  readonly dialogue = new Dialogue(this);
  readonly bank = new Bank(this);
  readonly camera = new Camera(this);

  constructor(client = new BridgeClient()) {
    this.client = client;
  }

  state(): Promise<State> {
    return this.client.state();
  }

  sleepUntil(cond: (s: State) => boolean, timeoutMs?: number) {
    return this.client.sleepUntil(cond, timeoutMs);
  }

  sleep = sleep;

  /** Talk to an NPC and click through its dialogue. */
  async talkTo(name: string): Promise<{ ok: boolean; dialogue: string[]; error?: string }> {
    const npc = await this.npcs.nearest(name);
    if (!npc) return { ok: false, dialogue: [], error: `no ${name} nearby` };
    const r = await npc.interact("Talk-to");
    if (!r.ok) return { ok: false, dialogue: [], error: r.error };
    await this.client.sleepUntil((s) => s.ui.some((l) => /continue/i.test(l)) || s.ui.some((l) => /select an option/i.test(l)), 15_000);
    return { ok: true, dialogue: await this.dialogue.continueAll() };
  }

  /** Woodcutting loop: chop the nearest `tree` until the inventory is full or `untilLevel` is reached. */
  async chop(tree = "Tree", opts: { untilLevel?: number; timeoutMs?: number } = {}): Promise<Result> {
    const end = Date.now() + (opts.timeoutMs ?? 300_000);
    let logs = 0;
    while (Date.now() < end) {
      const s = await this.state();
      const lvl = s.skills?.Woodcutting ?? 0;
      if (opts.untilLevel && lvl >= opts.untilLevel) return { ok: true, result: `Woodcutting ${lvl}`, logs };
      if ((s.inventory?.length ?? 0) >= 28) return { ok: true, result: "inventory full", logs };
      const t = await this.objects.nearest(tree, "Chop down");
      if (!t) return { ok: false, error: `no "${tree}" with Chop down nearby. Objects: ${[...new Set(s.objects?.map((o) => o.name))].join(", ")}`, logs };
      const r = await t.interact("Chop down");
      if (!r.ok) return { ok: false, error: r.error, logs };
      const before = s.inventory?.length ?? 0;
      await this.sleepUntil((s2) => s2.player!.animation !== -1, 5_000);
      await this.sleepUntil((s2) => (s2.inventory?.length ?? 0) > before || s2.player!.animation === -1, 40_000);
      logs += Math.max(0, ((await this.state()).inventory?.length ?? 0) - before);
    }
    return { ok: false, error: "chop timed out", logs };
  }
}
