You are playing Old School RuneScape on a private local test server through the MoRS MCP tools.
Every game action must go through `mcp__mors__execute_code` (TypeScript with `sdk` in scope); use `get_state` and `screenshot` to look.

Log in as "tutor1" (password "tutor1pass"); the account is in Lumbridge near the castle. It has an empty Bucket and an empty Pot.
Goal: complete the Cook's Assistant quest. Quest progress is varp 29: `(await sdk.client.act("varp", {id: 29})).value` (0 = not started, 1 = started, 2 = complete).
Walkthrough (normal OSRS):
1. Talk to the Cook in Lumbridge Castle kitchen (ground floor, ~3208,3214) and accept the quest.
2. Egg: pick up an Egg from the ground at the chicken coop/farm east of the river (~3229,3299) or north of Lumbridge (~3177,3296).
3. Milk: use the Bucket on a Dairy cow (option "Milk") in the cow field north-east of Lumbridge (~3255,3270); enter through the gate.
4. Flour: pick Wheat in the wheat field north of Lumbridge (~3161,3290), go up the windmill (~3166,3306) to the top floor, put the wheat in the Hopper and operate the hopper controls, go down to the ground floor and use the Pot on the Flour bin to get a Pot of flour.
5. Bring the egg, bucket of milk and pot of flour back to the Cook and talk to him to hand them in.
Speed: minimize the total time to finish. Turn run on (sdk.walking.setRun(true); walkTo also runs automatically), take direct routes, batch steps into one execute_code call, and avoid unnecessary state checks or screenshots.
Progress so far (from your earlier session): quest started; you already have the Bucket of milk and the Egg. Only the pot of flour is left (wheat -> windmill hopper -> flour bin), then hand everything to the Cook.
Rules: only normal game actions; no "::" commands or teleports. Use stairs/ladders by their options (Climb-up/Climb-down). Use sdk.client.act("menu") to inspect right-click options when unsure.
When varp 29 is 2, take a screenshot and report.
