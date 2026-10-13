# MoRS

You can play Old School RuneScape here, on a local private server, through the `mors` MCP tools (`execute_code`, `get_state`, `screenshot`).

## Starting up

When asked to spin up or play, bring these up in order, skipping anything already running. Check ports with `nc -z 127.0.0.1 <port>`. Run long-lived processes in the background with logs in `logs/`. Tell the user the first start takes 10+ minutes, and point them to http://localhost:8888 to watch.

1. **Checkouts.** `../openrune` (`git clone --depth 1 https://github.com/OpenRune/OpenRune-Server.git ../openrune`) and `../runelite` (`git clone --depth 1 https://github.com/runelite/runelite.git ../runelite`), if missing.
2. **Server on :43594.** In `../openrune`, run `./gradlew install` once (creates `.data/client.key`), then `./gradlew run`. Wait until the log says "Server ready". It needs Java 21.
3. **Client libraries**, if `client/lib/injected-client.jar` is missing: `./setup-libs.sh ../runelite ../openrune/.data/client.key`, then `bun install`.
4. **Gateway on :8888.** `bun gateway/server.ts`
5. **Game client.** `./run-client.sh` (Docker). It is up when `curl -s localhost:8888/state` returns a `gameState`.

Needs Java, Bun, Docker and git. If one is missing, tell the user what to install.

If the `mors` tools aren't available, the user needs to approve the project MCP server (`.mcp.json`) and restart `claude` here.

## Memory: read it first, write it back

`playing/` is your long-term memory. Nothing else survives between sessions.

- `playing/CLAUDE.md` holds what we know about this world: server quirks, routes, quest steps, SDK workarounds.
- `playing/<account>/CLAUDE.md` holds one account's story: where it is, what's done, what's half-done.

Before playing an account, read both. If the account is new, create its folder and file (copy the shape of an existing one). While you play, and always before you stop, update them: the account's position, levels, finished and in-progress goals, and any lesson that will save the next session time. Keep entries short, edit stale lines instead of piling on, and put lessons that apply to every account in the shared file.

## Playing

- Use `execute_code` with the `sdk` object. Write loops that finish a whole sub-task in one call, not one click per call. The full API is in `docs/api.md`.
- Everything expires, so you notice when you're stuck. Every loop and wait gets a deadline (max tries or seconds, e.g. `sleepUntil(..., 8000)`), and every loop checks that something changed (position, inventory, `ui`, the quest varp). If nothing changed for a few tries, or the deadline passes, stop and return what you saw instead of repeating the same click.
- Unknown usernames are registered on first login. Pick any name and password unless the user gives one.
- Read errors. They name what was nearby. "stuck at x,y" usually means a closed door or gate: find it in `objects` and `Open` it.
- Use `sdk.walking.walkTo` for distance. It hops 14 tiles at a time. A raw `walk` act only reaches tiles in the loaded area around you.
- Play like a person. Server commands (`::tele`, `::item`, …) are blocked and must not be attempted.
- Take a `screenshot` at milestones, and say what you did in plain words when you finish.

## Working on the code

See `docs/how-it-works.md`. Rebuild the client with `./build.sh` (`./run-client.sh` does it for you). Restart the gateway to pick up changes in `gateway/` or `web/` (React + shadcn, see `DESIGN.md`): Bun bundles the viewer on the fly but caches it, so a refresh alone can show stale styles.
