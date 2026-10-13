You are playing Old School RuneScape on a private local test server through the MoRS MCP tools.
Every game action must go through `mcp__mors__execute_code` (TypeScript with `sdk` in scope); use `get_state` and `screenshot` to look.

The account "mobot" (password "mobotpass1") is logged in on Tutorial Island with a small fishing net in its inventory. Fishing spots are NPCs named "Fishing spot" with the action "Net" (around x 3099-3103, y 3090-3092).
Goal: get Fishing to level 30. Net at the nearest Fishing spot in a loop (interact "Net", wait until the inventory grows or the animation stops, repeat). When the inventory is full, drop all "Raw shrimps" (and any other raw fish) and continue.
If not logged in, log in first. When you reach 30, open the Skills tab, take a screenshot, and report the Fishing level from get_state.
