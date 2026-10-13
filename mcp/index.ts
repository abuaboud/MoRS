// MoRS MCP server: lets Claude drive the game through the SDK.
// Tools: execute_code (run TypeScript with `sdk` in scope), get_state, screenshot.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BridgeClient } from "../sdk/client.ts";
import { Sdk } from "../sdk/api.ts";

const GATEWAY = process.env.MORS_GATEWAY ?? "http://127.0.0.1:8888";
const server = new McpServer({ name: "mors", version: "0.1.0" });

const API_DOC = `\`sdk\` (all methods async; actions return {ok, result|error}):
sdk.game.login(user, pass)            sdk.game.messages()
sdk.state() -> {player{name,pos,animation,moving,hp,maxHp,prayer,runEnergy,combatLevel}, camera{yaw,pitch,zoom}, skills{Woodcutting,...}, inventory[], equipment[], npcs[], objects[], groundItems[], ui[] (chatbox/dialogue text), tutorialProgress, hintArrowNpc, messages[]}
sdk.npcs.nearest(name) / (await sdk.npcs.query()).name(..).action(..).nearest().first()  → npc.interact("Talk-to"|"Attack"|...)
sdk.objects.nearest(name, action?) / (await sdk.objects.query())                       → obj.interact("Chop down"|"Open"|"Climb-down"|...)
(await sdk.groundItems.query())                                                        → item.interact("Take")
sdk.inventory.items() count(name) contains(...) isFull() interact(item, option) use(item, {npc|object|item}) dropAll(name)
sdk.walking.walkTo({x,y}, within=1) (runs automatically)   sdk.walking.setRun(true|false)   sdk.walking.isRunning()   sdk.skills.level("Woodcutting")
sdk.widgets.openTab("Inventory"|"Skills"|"Settings"|"Quest List"|"Equipment"|"Combat Options"|"Prayer"|"Magic"|"Friends List"|"Account Management")
sdk.widgets.click(textOrName, option)
sdk.dialogue.text() canContinue() continueAll() choose(text)      sdk.talkTo(npcName) -> {dialogue[]}
sdk.bank.open() depositInventory()
sdk.camera.state() -> {yaw,pitch,zoom}   sdk.camera.turnTo({x,y})   sdk.camera.set({yaw: 0..2047 (0=N,512=W,1024=S,1536=E), pitch: 128..383})   sdk.camera.zoom(notches, negative=in)
sdk.chop(tree="Tree", {untilLevel, timeoutMs})
sdk.sleepUntil(state => bool, timeoutMs)   sdk.sleep(ms)   sdk.client.act(op, args) raw: walk|npc|object|groundItem|widget|click|key|type|menu|login|camera|collision|varp({id})
console.log(...) is returned to you along with the action log.`;

server.tool(
  "execute_code",
  `Run TypeScript (the body of an async function) against the live game with \`sdk\` in scope. Return a value or console.log to report. Write loops that finish a whole task in one call rather than one call per click.\n${API_DOC}`,
  { code: z.string().describe("async function body, e.g. `return await sdk.chop('Tree', {untilLevel: 5})`"), timeoutSeconds: z.number().optional() },
  async ({ code, timeoutSeconds }) => {
    const out: string[] = [];
    const log = (...a: unknown[]) => out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    // the gateway's dashboard builds script cards from Claude's transcript and nests these actions under them
    const sdk = new Sdk(new BridgeClient(GATEWAY, (line) => out.push(`  · ${line}`)));
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    let result: unknown;
    try {
      const fn = new AsyncFunction("sdk", "console", code);
      result = await Promise.race([
        fn(sdk, { log, info: log, error: log, warn: log }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeoutSeconds ?? 600}s`)), (timeoutSeconds ?? 600) * 1000)),
      ]);
    } catch (e) {
      result = { error: String(e) };
    }
    return { content: [{ type: "text", text: [...out.slice(-100), "=> " + JSON.stringify(result)].join("\n") }] };
  },
);

server.tool("get_state", "Current game state JSON: player, skills, inventory, nearby npcs/objects, dialogue text.", {}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(await new BridgeClient(GATEWAY).state()) }] };
});

server.tool("screenshot", "Current frame of the game client.", {}, async () => {
  const res = await fetch(`${GATEWAY}/screenshot`);
  if (!res.ok) return { content: [{ type: "text", text: await res.text() }] };
  return { content: [{ type: "image", data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: "image/jpeg" }] };
});

await server.connect(new StdioServerTransport());
