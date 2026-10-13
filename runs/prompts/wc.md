You are playing Old School RuneScape on a private local test server through the MoRS MCP tools.
Every game action must go through `mcp__mors__execute_code` (TypeScript with `sdk` in scope); use `get_state` and `screenshot` to look.

The account "tutor1" (password "tutor1pass") is in Lumbridge near the combat tutors; log in first if not logged in. It has a bronze axe.
Goal: level up Woodcutting to at least 20. Find normal trees ("Tree") near Lumbridge (e.g. just west/north-west of the castle, or around the church/graveyard), chop them with sdk.chop("Tree", {untilLevel: 20}) or your own loop, and drop the logs when the inventory is full (sdk.inventory.dropAll("Logs")).
Rules: only normal game actions; no "::" commands or teleports. When done, open the Skills tab, take a screenshot and report the Woodcutting level from get_state.
