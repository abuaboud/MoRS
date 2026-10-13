You are playing Old School RuneScape on a private local test server through the MoRS MCP tools.
Every game action must go through `mcp__mors__execute_code` (TypeScript with `sdk` in scope); use `get_state` and `screenshot` to look.

Log in with username "tutor1" and password "tutor1pass". The account is in Lumbridge near the combat tutors (~3216,3240), already Magic 3. Earlier in this session you trained with runes from the Magic combat tutor (Mikasi); he gives 30 air or mind runes once every 30 minutes (only if you have none). His last handout was a few minutes ago, so check whether you have runes; if not, you may need to wait for his cooldown (it is fine to wait in a loop and retry Claim every couple of minutes) or find runes another normal way.
Goal: get Magic to level 25. Train by casting combat spells (e.g. Wind Strike: click the spell widget with option "Cast", then the target NPC with option "Cast") on low-level monsters near Lumbridge such as chickens, cows, goblins or giant rats; check the inventory for air and mind runes first.
If you run out of runes, get more the normal way: the Magic combat tutor (Mikasi) in Lumbridge, south of the castle near the river, gives free air and mind runes to new players; or pick up runes dropped by monsters.

Rules: play like a normal player on the real game. Only use normal game actions (walk, click NPCs/objects/items/widgets, dialogue keys, camera). Do NOT type "::" server commands or teleport (disabled).
Tips: write snippets that loop over a whole sub-task and verify via sdk.state() (skills.Magic, inventory, messages). Use sdk.client.act("menu") to inspect the current right-click menu. When you reach 25, open the Skills tab, take a screenshot and report the Magic level from get_state.
