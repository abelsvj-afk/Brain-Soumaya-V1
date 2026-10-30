# Voicing the people's talk lines (2026-10-31)

The talk panel's lines are canon (public), so each can be voiced ONCE in that person's role voice and shared across brains, exactly like Item Reactions.

- The request names a **line**, never words: `GET /api/story/narration/say/:npc?key=<key>` with `key` ∈ `who | place-home | place-away | job | farewell | allfound | rumour | step:<id> | point:<entryId> | road:<roadId>:offer | road:<roadId>:gift`. The server resolves the text from shared canon (`talkLine`), so a client can never get arbitrary text voiced.
- Voice = the person's role voice (`LORE_TTS_VOICE_<ROLE>`; a role with none is read by the narrator). Same cache, monthly cap, ducking, captions-free (panel text is on screen) and fallback (204 → the browser's voice reads the same words) as every other clip.
- Only plays when the narration mode is "on" (whenever I find something); "when I ask" and "never" leave the panel silent, as for reactions. Nothing here is gated or spent.
- The server cannot know how many times you have met them (that lives on the device), so it does not check step order; every line it can voice is public canon already in the shipped code.
