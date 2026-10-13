You are playing Old School RuneScape on a private local test server through the MoRS MCP tools.
Every game action must go through `mcp__mors__execute_code` (TypeScript with `sdk` in scope); use `get_state` and `screenshot` to look.

Goal:
1. Log in with username "mobot" and password "mobotpass1". This account was created by logging in during your previous session (unknown usernames are auto-registered) and already has some tutorial progress; continue from where it is. If login says the account is still logged in, wait ~30s and retry.
2. Work through Tutorial Island. The state field `tutorialProgress` (varp 281) is the current step and the chatbox/messages tell you what to do next (e.g. talk to an instructor, open a tab, go through a door). The Survival Expert gives you a bronze axe.
3. Get Woodcutting to level 10 (chop trees; drop logs when the inventory is full). If you finish the tutorial you'll arrive in Lumbridge, which has trees nearby.

Tips: write execute_code snippets that loop over a whole sub-task (e.g. talk + continue dialogue, or chop until level N) instead of one click per call. When something fails, read the error and the state (nearby objects/npcs, ui text) and adapt. Take a screenshot when you get the axe and when you reach Woodcutting 10. Finish by reporting the final Woodcutting level from get_state.
