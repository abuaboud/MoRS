Complete the quest Gertrude's Cat. Log in as "islander2" (password "islander2").

Every game action must go through `mcp__mors__execute_code` (TypeScript with `sdk` in scope); use `get_state` and `screenshot` to look. Read `playing/CLAUDE.md` and `playing/islander2/CLAUDE.md` first.
Quest progress is the low 3 bits of varp 180: `(await sdk.client.act("varp", {id: 180})).value & 7` (0 = not started, 6 = complete). You are done when it is 6. Take a screenshot at the end and report.

Rules: play like a normal player on the real game. Only use normal game actions (walk, click NPCs/objects/items/widgets, dialogue keys, camera). Do NOT type "::" server commands or teleport; they are disabled and count as cheating. Learn the way a player would, from the game and the OSRS wiki: don't read the game server's source code or files (`../openrune`), and don't change any code. If something in the game looks broken, say exactly what and stop.
Before you stop, update `playing/islander2/CLAUDE.md` and any lesson for every account in `playing/CLAUDE.md`.
