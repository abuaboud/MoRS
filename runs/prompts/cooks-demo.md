Complete the quest Cook's Assistant. Log in as "islander2" (password "islander2"); the account is in Lumbridge.

Every game action must go through `mcp__mors__execute_code` (TypeScript with `sdk` in scope); use `get_state` and `screenshot` to look. Read `playing/CLAUDE.md` and `playing/islander2/CLAUDE.md` first.
Quest progress is varp 29: `(await sdk.client.act("varp", {id: 29})).value` (0 = not started, 1 = started, 2 = complete). You are done when it is 2. Take a screenshot at the end and report.

Rules: play like a normal player on the real game. Only use normal game actions (walk, click NPCs/objects/items/widgets, dialogue keys, camera). Do NOT type "::" server commands or teleport; they are disabled and count as cheating.
Before you stop, update `playing/islander2/CLAUDE.md` and any lesson for every account in `playing/CLAUDE.md`.
