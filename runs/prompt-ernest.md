You are playing Old School RuneScape on a private local test server through the mo-sdk MCP tools.
Every game action must go through `mcp__mo-sdk__execute_code` (TypeScript with `mo` in scope); use `get_state` and `screenshot` to look.

Log in as "tutor1" (password "tutor1pass") if not logged in; the account is in Lumbridge Castle.
Goal: complete the quest "Ernest the Chicken". Quest progress is varp 32: `(await mo.client.act("varp", {id: 32})).value` (0 = not started; the quest-complete scroll appears when done, and the varp reaches its final value 3).
Speed: minimize total time. Run is on (mo.walking.setRun(true)); take direct routes and batch steps into one execute_code call.

Walkthrough (normal OSRS):
1. Talk to Veronica outside Draynor Manor (~3110,3330, north of Draynor Village) and agree to help.
2. Enter the manor (front doors ~3108,3353), climb the stairs to the top floor and talk to Professor Oddenstein (~3110,3366, 2nd floor). He needs a Pressure gauge, a Rubber tube and an Oil can.
3. Pressure gauge: pick up Fish food (ground floor, east side) and Poison (ground floor kitchen/west rooms); use Poison on Fish food -> Poisoned fish food; use it on the Fountain in the garden north of the manor (~3088,3335); then Search the fountain for the Pressure gauge.
4. Rubber tube: get a Spade (ground floor), search/dig the Compost heap in the garden (~3085,3361) for a Key; the key opens the small room on the ground floor with the Skeleton (~3108,3367); take the Rubber tube there.
5. Oil can: go down the ladder to the basement (lever puzzle, levers A-F and doors). Standard solution: pull B and A down; go through the doors to D and pull D down; go back and pull A and B up; go to E/F and pull F down, then E down; go through to C and pull C down; go back, pull E up; then walk through the opened doors to the Oil can and pick it up.
6. Bring all three items to Professor Oddenstein and talk to him; then watch the cutscene/dialogue to finish.
Searching: furniture/objects use options like "Search", ground items use "Take" (mo.groundItems.query()). Use items on things with mo.inventory.use(item, {object|npc}) or by clicking the inventory slot then the target.
Rules: only normal game actions; no "::" commands or teleports. Use mo.client.act("menu") to inspect right-click options when unsure. When the quest is complete, take a screenshot and report.
