# HONEST_ASSESSMENT.md

> **PURPOSE: this file is a frozen, dated, outside read on the product — not a status log.**
> Don't edit old entries. When this exercise gets repeated (recommended every few months, or after
> a major feature push), **append a new dated entry below the previous one** so you can compare
> verdicts over time and actually see whether the app is getting easier to trust and use, or just
> bigger. This is meant to be read months from now, not buried in a commit.

---

## ENTRY 2026-08-29 — asked directly: "would you use this long-term, or once and forget it?"

**THE VERDICT: I'D USE IT HARD FOR ABOUT TWO WEEKS, THEN QUIETLY STOP OPENING IT.**

Not because it's bad engineering — the opposite, actually — but because of a specific mismatch
between the engineering and the product. This is an honest outside read, not a takedown: the fair
case for the app is real (see the bottom section), but the five reasons below are the ones that
would actually make me close the tab and not come back.

### What would hook me initially

The core loop is genuinely good: dump a raw thought, get it auto-extracted into typed entities,
watch it associatively link into a galaxy that has real gravitational logic behind it (not just a
pretty force-graph). Chat-with-cited-answers is legitimately useful for recall. The financial
tooling is competent and fully offline-capable. For the first couple of weeks, exploring the galaxy
and watching Soumaya connect dots would be a real hook.

### Why I'd drop it — concrete, not vibes; things directly hit in one audit session

**1. THE TAXONOMY TAX IS TOO HIGH FOR A JOURNALING HABIT.**
Before writing a thought down, this app eventually wants you to understand 9 cognitive-object
kinds (is this a "motivation" or an "intention"? a "goal" or an "identity"?), 11 dock tabs, a full
Financial OS, Journeys, an achievement economy, and a Hangar. Tools that survive as a *daily habit*
are usually nearly invisible — a text box. This one asks you to learn its worldview first.

**2. THE AUTOMATIC "MAGIC" DOESN'T CONSISTENTLY EARN TRUST — PROVEN REPEATEDLY, NOT ASSUMED.**
In one audit session alone: a skill's mastery jumped to "Practiced" almost instantly because of a
linking bug that had been live since at least July; a whole financial forecasting engine was fully
built, tested, and never called by anything; a bill-risk warning system only worked if you happened
to have Telegram linked; two entire features (Lens and Views) did the literal same thing without
either side knowing about the other. When "it connects things for you automatically" is the whole
point, and that keeps silently not working, it's corrosive to the exact trust the product needs.

**3. EVEN THE OWNER DIDN'T HAVE A FULL MENTAL MODEL OF IT ANYMORE.**
Real quotes from this project, this week: "mind tab doesn't only consist of tracked people, there
is more" (didn't fully know the Mind tab's own contents) and "skills has an issue with progressing
too fast idk why" (a bug noticed but not diagnosable, tracing back to an abandoned debugging session
from weeks earlier, evidenced by leftover `console.log` statements never cleaned up). Not a knock —
a signal. If the builder can't hold the whole thing in their head, a new user has no chance, and the
owner isn't visiting every corner often enough to have caught this by using it — which says
something real about actual day-to-day retention.

**4. THE GALAXY IS A PHENOMENAL DEMO AND A MEDIOCRE RETRIEVAL TOOL.**
For actually finding "that thing I wrote six weeks ago," a search box beats flying a 3D camera
through space nine times out of ten — and real engineering effort went into just holding 60fps on a
mid-range phone. Delight has a cost, and on day 15 you want speed, not wonder.

**5. STRUCTURAL FRAGILITY.**
Deploys are manual, GitHub Actions is blocked, there was a Fly billing hold at one point — the live
app you'd build a daily habit around can lag behind all the work happening in a session like this
one. A second brain you can't rely on being *current* breaks the habit loop before it forms.

### The fair flip side — don't skip this part

As an **engineering artifact**, this is well above what a solo project usually reaches: real test
discipline (500+ tests and climbing), offline-first architecture with genuine no-API-key fallbacks,
multi-tenant scoping done correctly everywhere, a measurement culture instead of guessing (perf
harnesses, not eyeballing). If the goal was "prove what's buildable," the answer is a strong yes.

If the goal is "something opened every day for a year," the bet is this needs *less friction*, not
more features — the automatic behavior working invisibly instead of another dormant/silently-broken
thing turning up every time someone looks closely.

### What happens next
See **[docs/OPTIMIZATION_ROADMAP.md](./docs/OPTIMIZATION_ROADMAP.md)** — the user's explicit call
was **don't rip anything out**; the tabs and features stay. The roadmap is about making reasons
1–5 above stop being true through fixing, consolidating, and surfacing what's already built, not
through deletion. Re-read this entry after each phase of that roadmap ships and see how many of the
five reasons still hold.

---

## ENTRY 2026-08-29 (same day) — re-asked after shipping Mission Control + Progressive Discovery

**THE VERDICT: STILL WOULDN'T CALL IT SOLVED — BUT I'D PUSH MY OWN TIMELINE FROM TWO WEEKS TO
ROUGHLY A MONTH, WITH ONE HONEST ASTERISK: NONE OF THIS IS LIVE YET.**

That asterisk matters more than it sounds — every fix below shipped to a branch tonight. The actual
app on my phone, right now, is byte-for-byte what it was this morning. So this re-read is a
prediction about a build I haven't actually lived with, not a report from having used it. Worth
saying plainly instead of letting the excitement of "we shipped it" imply more than it should.

Going through the original five, honestly, one at a time:

**1. TAXONOMY TAX — genuinely reduced for day one, not eliminated.** A brand-new brain now opens to
7 tabs instead of 11, and a real Mission Control screen (agenda, safe-to-spend, journey progress,
one thing worth revisiting) instead of an empty dock asking you to pick a destination. That's a real
smoother on-ramp. But it's front-loaded: the moment you log your first memory, Progress and Hangar
are already back (Codex entries unlock that fast), and Insights reappears the first time you connect
two memories. So this buys you the first few captures, not the first few weeks — the full 11-tab,
9-kind surface is still exactly as complex as it always was once you're actually using the thing.
Softer landing, same mountain.

**2. TRUST IN THE AUTOMATION — infrastructure exists now; trust itself hasn't been earned yet, and
can't be, by a commit.** The specific bugs (bill-risk, skill overlinking, the dead onRecall wire) are
fixed, and there's now a real "last time each tool actually fired" systems-check panel instead of
silence. That's the right kind of fix — visibility instead of hoping. But trust is a property of
lived experience, not of code existing: I'd need to actually watch the automation behave correctly
for a few weeks, with the diagnostics panel confirming it rather than me finding a new dead wire by
accident, before my guard would actually come down. Necessary, not sufficient, and time can't be
compressed by writing more code in one sitting.

**3. THE OWNER'S MENTAL MODEL — the specific evidence (stale Help menu, an unnoticed skill bug) is
now fixed, but that's a symptom, not the disease.** Better docs help you look something up once
you're already confused. They don't reduce how often a project this large produces confusion in the
first place — that's downstream of #1, and #1 only moved for day one.

**4. RETRIEVAL SPEED — one real, concrete win, plus one structural thing that can't change without
changing what the galaxy is.** Search being physically unreachable from the very first screen a
returning user sees was a genuine, embarrassing bug (found by actually checking, not assumed) — now
fixed, and Mission Control's "one memory worth revisiting" plus reminder/agenda surfacing means a lot
of what I'd have gone hunting for is just sitting on the landing screen already. But for the "I need
that specific thing from six weeks ago" case, it's still type-into-a-box vs. fly-a-camera, and that
trade-off is what the galaxy IS — no amount of surrounding polish removes it, nor should it.

**5. DEPLOY FRAGILITY — completely untouched, and the most important line in this whole entry.**
Still manual `fly deploy`, still no working CI, still ops work outside what a coding session can fix
on its own. Every improvement above is theoretical to an actual user until that changes. A second
brain habit needs to be *current* to be trusted daily, and tonight didn't move that at all.

### Net honest read

The two changes that would genuinely hit me on day one — a real landing screen instead of a blank
dock, and search actually being reachable — are the kind of fix that extends how long the initial
hook lasts, which is a fair, non-cosmetic reason to push my estimate out. But the underlying bet from
the first entry hasn't changed: this is still a *complexity and trust* problem more than a *missing
feature* problem, and neither of those resolves in one session, however well-executed. The measure
that actually matters — reading this entry again in a month, after the app has actually been lived
in — is still ahead, not behind.

---

## ENTRY 2026-10-29 — asked directly: "what is this app supposed to be, because we added a lot"

**THE VERDICT: THE CORE IS INTACT, BUT THE LAST WEEK GREW THE APP FASTER THAN ANYONE COULD LOOK AT IT —
AND IT SHOWED. THE MOST VISIBLE FAILURE WAS REAL: FOR ABOUT SIX DAYS NONE OF THE WORLDS COULD BE REACHED,
AND THEN, ONCE THEY COULD, OPENING THE APP DROPPED THE OWNER INTO A FLYING SHIP INSTEAD OF HOME.**

### What it is supposed to be (from the owner's own documents)
A second brain you talk to: dump a thought, it becomes a star in a galaxy; chat with cited answers; the daily
loop lands on a front face (Observatory + home galaxy); Journeys, money, people connect through it. The Worlds
vision brief says it directly: *"The core stays a second brain. All of this sits ON TOP of the brain, to make
coming back to remember things entertaining — scenery and gamification in service of memory, never instead of it."*
It also asked for "a few" spaces, "not dozens," each answering *what second-brain job lives here.*

### What actually happened — measured, not felt
Between 2026-10-21 (`6160d00`) and today, eight days:
- source code **99,700 → 135,100 lines** (+36%), **+106 source files**, **+182 test files**
- 3D models **9 files / 33 MB → 185 files / 108 MB**
- database tables **66 → 90**; **7 new server route modules** (fleet defense, garden, missions, NPCs, tours,
  travel, world changes); **10 new top-level screens/overlays** mounted in the app
- on top of that, the owner's own 11 dock tabs and the Tools menu are unchanged — the new surface is mostly
  *beside* the core, reached through Tools → Travel. That part was done right.

### What went wrong (all found by running the real app in a browser, none by the test suite)
1. **Unreachable for ~6 days.** Seven PRs of world UI were mounted where the screen couldn't show them, and a
   merged PR broke the stylesheet. 2,400 tests passed throughout: they never lay anything out.
2. **Travel never played.** The panel, the scene layer and the map each held their own copy of state and never
   told each other, so warping drew nothing.
3. **The app opened into a saved world / an unfinished flight** instead of home. The old build never finished
   journeys, so most brains were left mid-flight and every launch replayed one. (Fixed 2026-10-29.)
4. **Built work didn't match approved work.** The Growing Place the owner approved ("Pass. Lets move on",
   2026-10-22) is a warm, dawn-lit forested hillside; the shipped scene is a dark brown plain with a tree.
5. **Work landed on the wrong branch.** GitHub's default branch was still the old one, so PR #125 (Station
   interior) merged where Fly doesn't deploy. Two branches silently diverged.
6. **Content that was promised isn't there.** Scale's centrepiece `ISS-A.glb` and probe models were never uploaded.
7. **A delegated task has no trace.** Muse's model-slimming brief has no branch, no report, and every model is
   byte-for-byte unchanged.

### How this maps onto the five original reasons (2026-08-29)
- **#3 the owner can't hold the whole app in their head — got worse, with evidence.** The owner could not tell
  whether any world worked, and it took a week and an outside check to find out why.
- **#5 deploy fragility — got worse.** Two live branches, a wrong default, and a "pushed" fix the owner hasn't
  seen because it isn't deployed.
- **#1 taxonomy tax / #2 trust in automation** — unchanged by Worlds; the front face is as light as before.
- **#4 retrieval** — Worlds neither helps nor hurts it; ~108 MB of scenery now sits beside a search box.

### What I'd do, in order (nothing here removes a feature — the roadmap's ground rule stands)
1. Deploy and confirm on the owner's phone that the app opens on home and a warp plays start to finish.
2. **Declare the next stretch stabilisation, not expansion** (CLAUDE.md already says to re-freeze before the
   next major expansion; Worlds was one). Per world, "done" means: matches its approved mock-up, passes
   `scripts/worlds-check.mjs`, and the owner has seen it on a phone — not "tests pass."
3. Make `main` the GitHub default branch and keep it the only target.
4. Resolve the two open content gaps (Scale uploads; Muse's slimming) before adding anything new.
5. Before any new world system (fleets, missions, defense, commissions…), ask the brief's own question: what
   second-brain job does it do? Several of those answer it only loosely.

---

<!-- Next entry: copy the "## ENTRY <date>" pattern above and append below this line. Do not
     overwrite prior entries — the comparison over time is the entire point of this file. -->
