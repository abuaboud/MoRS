# API reference

There are three ways in, from friendliest to rawest:

1. **The SDK** (`sdk`): what Claude uses inside `execute_code`, and what you'd use in your own scripts.
2. **Raw actions** (`sdk.client.act(op, args)`): one input action at a time.
3. **HTTP**: `GET /state` and `POST /act` on the gateway, from any language.

Every action, at every level, returns the same shape:

```ts
{ ok: true,  result: "Talk-to Cook" }
{ ok: false, error: "npc 'cook' not found on screen nearby" }
```

Nothing throws for game failures. Check `ok` and read `error`.

## Using the SDK from your own script

```ts
import { Sdk } from "./sdk/api.ts";

const sdk = new Sdk(); // talks to http://127.0.0.1:8888, or $MORS_GATEWAY
await sdk.game.login("mobot", "mobotpass1");
const r = await sdk.chop("Tree", { untilLevel: 5 });
console.log(r);
```

Run it with `bun my-script.ts` while the gateway and client are up.

## SDK

All methods are `async`.

### Game

| Call | What it does |
|---|---|
| `sdk.game.login(user, pass)` | Logs in and waits until you're in the world (up to 30s). Unknown usernames are registered automatically on OpenRune. |
| `sdk.game.messages()` | The last 15 game messages ("You get some logs.", "You can't reach that!"). |
| `sdk.state()` | The full [state snapshot](#state). |
| `sdk.sleepUntil(state => bool, timeoutMs?)` | Polls the state until your condition holds. Returns the state, or `null` on timeout. |
| `sdk.sleep(ms)` | Waits. One game tick is 600ms. |

### Things in the world

```ts
const tree  = await sdk.objects.nearest("Oak", "Chop down");
const guard = await sdk.npcs.nearest("Guard");
const goblins = (await sdk.npcs.query()).name("Goblin").filter(n => !n.inCombat).nearest().all();
const loot  = (await sdk.groundItems.query()).nameContains("bones").first();

await tree?.interact("Chop down");
```

| Call | Returns |
|---|---|
| `sdk.npcs.nearest(name)` | `Npc` or `null` |
| `sdk.objects.nearest(name, action?)` | `GameObject` or `null` (optionally only ones with that action) |
| `sdk.npcs.query()` / `sdk.objects.query()` / `sdk.groundItems.query()` | A `Query` you can chain |

**Query** methods (each returns a new query): `.name(...names)`, `.nameContains(part)`, `.action(action)`, `.filter(fn)`, `.nearest()`. To finish, use `.first()`, `.all()` or `.size`.

**Wrappers** (`Npc`, `GameObject`, `GroundItem`) have `.name`, `.pos`, `.actions`, `.raw` (the state entry) and `.interact(option)`. `interact` right-clicks and picks `option`. If the target isn't on screen, it walks closer and tries again. `Npc` also has `.inCombat`.

### Inventory

| Call | What it does |
|---|---|
| `sdk.inventory.items()` | Items with `name`, `id`, `quantity`, `slot` |
| `sdk.inventory.count(name?)` | Total quantity of `name`, or the number of slots used |
| `sdk.inventory.contains(...names)` / `isFull()` / `freeSpace()` | Checks |
| `sdk.inventory.interact(item, option)` | For example `("Bronze dagger", "Wield")`. Opens the inventory tab first. |
| `sdk.inventory.use(item, { npc \| object \| item })` | "Use X on Y" |
| `sdk.inventory.dropAll(name)` | Drops every `name` |

### Moving around

| Call | What it does |
|---|---|
| `sdk.walking.walkTo({x, y}, within = 1)` | Walks there in 14-tile hops along `route`, and runs when it has the energy. Fails with "stuck at x,y …" once 4 hops in a row don't get it closer. |
| `sdk.walking.route({x, y})` | Finds a way over the loaded area (~50 tiles around you) with the client's collision map: around walls, fences and water, with closed doors counted as walls. Returns `{path, left}`, where `path` ends at the reachable tile nearest the target and `left` is how far that tile still is from it. |
| `sdk.walking.setRun(on)` / `isRunning()` | The run orb |
| `sdk.camera.turnTo({x, y})` | Turns to face a tile |
| `sdk.camera.set({ yaw, pitch })` | yaw `0..2047` (0 is north, 512 west, 1024 south, 1536 east), pitch `128` (flat) to `383` (top-down) |
| `sdk.camera.zoom(notches)` | Mouse wheel, -30..30 notches: negative zooms in. Not the `zoom` level that `state()` reports. |
| `sdk.camera.state()` | `{ yaw, pitch, zoom }` |

### Interfaces and talking

| Call | What it does |
|---|---|
| `sdk.widgets.openTab(tab)` | `"Inventory"`, `"Skills"`, `"Settings"`, `"Quest List"`, `"Equipment"`, `"Combat Options"`, `"Prayer"`, `"Magic"`, `"Friends List"`, `"Account Management"` |
| `sdk.widgets.click(textOrName, option)` | Clicks any visible button, item or spell by its text and option |
| `sdk.dialogue.text()` | What's in the chatbox right now (same as `state.ui`) |
| `sdk.dialogue.canContinue()` / `continueAll()` | "Click here to continue" through a conversation. Stops at a choice. |
| `sdk.dialogue.choose(text)` | Picks a numbered option by partial text |
| `sdk.talkTo(name)` | Talk-to, then click through. Returns `{ ok, dialogue: [...] }`. |
| `sdk.bank.open()` / `depositInventory()` | Nearest booth or banker |
| `sdk.skills.level(name)` | For example `level("Woodcutting")` |

### Ready-made loops

| Call | What it does |
|---|---|
| `sdk.chop(tree = "Tree", { untilLevel?, timeoutMs? })` | Chops until the inventory is full or the level is reached. Returns `{ ok, result, logs }`. |

## Raw actions

`sdk.client.act(op, args)` sends one action to the Bridge. The SDK is built on these. At heart there are two: **`walk`** and **interact** (`npc`, `object`, `groundItem` and `widget` all take the same `name` + `option`). The rest are keys, typing, and read-only helpers.

| `op` | Args | What happens |
|---|---|---|
| `login` | `username`, `password` | Fills the login screen and logs in |
| `walk` | `x`, `y` | Clicks the tile in the game view, or on the minimap if it's not visible. Fails if the tile is outside the loaded area. |
| `npc` | `name` and/or `index`, `option`, optional `x`, `y` | Hovers the closest NPC whose name contains `name` ("Sedridor" finds "Archmage Sedridor") and picks that NPC's menu option. `x, y` or `index` (from `state.npcs`) pins the exact one; `index` alone needs no name. |
| `object` | `name`, `option`, optional `x`, `y` | Same for objects. `x, y` pins the exact one. |
| `groundItem` | `name`, `option` | Same for items on the ground |
| `widget` | `name?`, `option` | Any visible interface element with that option |
| `camera` | `yaw`, `pitch`, `faceX`/`faceY`, `zoom` | See camera above |
| `key` | `key` | `"space"`, `"enter"`, `"escape"`, `"backspace"`, `"F1"`…, or one character |
| `type` | `text` | Types text. Lines starting with `::` are refused. |
| `click` | `x`, `y` | A raw left click on the 765×503 canvas |
| `menu` | none | Lists the right-click menu entries under the mouse |
| `varp` | `id` | Reads a game variable, for example `29` (Cook's Assistant) or `281` (Tutorial Island). Returns `value`. |
| `varbit` | `id` | Reads part of a game variable, for example `3468` (Misthalin Mystery). Returns `value`. |
| `collision` | `x`, `y`, `radius = 6` | A grid of collision flags around a tile (`0` = walkable). Useful for finding gates. |

## HTTP

The gateway listens on `127.0.0.1:8888`.

| Endpoint | Method | Body / response |
|---|---|---|
| `/state` | GET | The [state](#state) as JSON |
| `/act` | POST | `{"op": "npc", "name": "Cook", "option": "Talk-to"}` → `{ok, result \| error}` |
| `/screenshot` | GET | The latest frame as JPEG |
| `/event` | POST | Adds a custom event to the viewer timeline |
| `/` | GET | The live viewer |

```sh
curl -s localhost:8888/state | jq .player
curl -s localhost:8888/act -d '{"op":"walk","x":3222,"y":3218}'
```

If no client is connected, every call answers `{"ok": false, "error": "game client not connected to the gateway"}`. If the client doesn't reply within 30s, you get `"client did not answer in 30s"`.

## State

`GET /state` (or `sdk.state()`) gives you everything a player could see at a glance. Here is a real snapshot, trimmed:

```json
{
  "gameState": "LOGGED_IN",
  "tick": 1947,
  "ui": ["Cook", "What am I to do?", "Click here to continue"],
  "player": {
    "name": "tutor1",
    "pos": { "x": 3161, "y": 3288, "plane": 0 },
    "animation": -1, "moving": true, "interacting": null,
    "hp": 16, "maxHp": 16, "prayer": 1, "runEnergy": 1, "combatLevel": 14
  },
  "skills": { "Attack": 1, "Hitpoints": 16, "Woodcutting": 12, "...": 1 },
  "inventory": [{ "name": "Bronze axe", "id": 1351, "quantity": 1, "slot": 1 }],
  "equipment": [{ "name": "Shortbow", "id": 841, "quantity": 1 }],
  "tutorialProgress": 1000,
  "camera": { "yaw": 0, "pitch": 340, "zoom": 512 },
  "npcs": [{
    "name": "Goblin", "index": 19329, "id": 3031,
    "pos": { "x": 3146, "y": 3298, "plane": 0 }, "distance": 15,
    "actions": ["Attack"], "inCombat": false, "interactingWithMe": false
  }],
  "objects": [{ "name": "Tree", "id": 1276, "pos": { "x": 3160, "y": 3292, "plane": 0 }, "distance": 4, "actions": ["Chop down"] }],
  "groundItems": [{ "name": "Bones", "id": 526, "quantity": 1, "pos": { "x": 3150, "y": 3297, "plane": 0 } }],
  "hintArrowNpc": "Cook",
  "messages": ["You get some logs.", "You can't reach that!"]
}
```

| Field | Meaning |
|---|---|
| `gameState` | `LOGIN_SCREEN`, `LOGGING_IN`, `LOADING`, `LOGGED_IN`, … When you're not logged in, you only get this, `tick`, `ui` and `loginIndex`. |
| `tick` | Game ticks since login (one every 600ms) |
| `ui` | Every line of visible chatbox text: NPC dialogue, numbered options, tutorial hints, "Click here to continue" |
| `player.pos` | World tile. `plane` is the floor (0 = ground). `y > 9000` means underground. |
| `player.animation` | `-1` when idle. Anything else means busy (chopping, fighting, cooking…). |
| `player.moving` | `true` while walking or running |
| `player.interacting` | Name of whatever you're fighting or talking to, or `null` |
| `player.runEnergy` | 0–100 |
| `skills` | Real (unboosted) level for every skill |
| `inventory` / `equipment` | What you carry and wear. Only inventory items have `slot` (0–27). |
| `tutorialProgress` | Tutorial Island step (varp 281). `1000` means done. |
| `camera` | yaw 0–2047 (0 north), pitch, and 3D zoom |
| `npcs` | NPCs within 20 tiles, with their right-click options. `inCombat` means they have a health bar showing. |
| `objects` | Objects within 20 tiles that have an option (trees, doors, ladders, ranges…), plus named scenery within 10 tiles that has none (paintings, candles: `actions` is `[]`, but you can still use an item on them). |
| `groundItems` | Items on the ground within 20 tiles |
| `hintArrowNpc` / `hintArrowPoint` | Where the yellow hint arrow points, if there is one. Very handy on Tutorial Island. |
| `messages` | The last 15 game messages, oldest first |

**Coordinates** are OSRS world tiles: x grows east, y grows north. Lumbridge castle is around `3222, 3218`.
