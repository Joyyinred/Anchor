# Anchor — two people, 25 days: division of work


## 1. Architecture and the three contracts

**The main data path:**

```
signal collection (A) → SignalEvent → perception half (A) → FeatureFrame → decision half (B) → DetectionResult → pet UI (B)
                                                                    ↑
                          starter coach (B) writes SessionContext at session start; both halves read it as their frame of reference
```

**Three seams, and who guards each:**

| Contract | Direction | Owner | Purpose |
|---|---|---|---|
| `SignalEvent` | collection → perception | **A internal** (mock entry point) | Where `events.json` fake data enters; real signals later use the same door |
| **`FeatureFrame`** | **perception → decision** | **A ↔ B jointly** | ★ The seam between the two people: the four signals, computed |
| `SessionContext` | starter coach → both halves | **B writes / A·B read** | The frame of reference: task / profile / anchor / whitelist / grace period |
| `DetectionResult` | decision → UI | **B internal** | Action + which signals lit up + wording |

> Only two of these cross the people boundary: `FeatureFrame` (A→B) and `SessionContext` (B→A). Guard those two and the two of us can work in parallel the whole time.
> Full definitions in [`contract-v4.md`](contract-v4.md) §2.

### The two halves in one picture

Left half A "watches and records", right half B "judges and speaks". The purple `FeatureFrame` in the middle is a status report passed every second; the yellow `SessionContext` at the bottom is the frame of reference B hands A at session start (the only reverse arrow in the diagram). **Those two arrows are the entire interface between us.**

![](anchor_two_halves_dataflow.en.svg)

---

## 2. Roles

### A ｜ Perception + signal collection + platform ("reads the world")

- **Signal collection:** `chrome.tabs` / `chrome.idle` / `chrome.webNavigation` / Page Visibility / content-script events → `SignalEvent` (with `title`, `contentKind`, and — on AI-chat sites — `contentSnippet`).
- **The perception half:** four signals → `FeatureFrame`
  - page-vs-task relevance classification (LLM, async + lazy + cached; the demo preset cache outranks the LLM)
  - anchor detachment (the strongest, cheapest signal; `anchor.matchMode` exact/prefix)
  - interaction texture (purposeful / passive / idle; 120 s window; continuous passive ≥ 60 s; `ACTIVE_INPUT` on an IRRELEVANT page does *not* upgrade)
  - jump pattern (task_orbit / rabbit_hole; slip tolerance + 10 s short-stay exemption + priority order)
- **MV3 platform risk** (service-worker lifecycle, permission model, content-script injection) — **owned from day 1.**
- **Outcome:** all of the above shipped. A also owns `pull-back.ts` (the tab switch behind "pull me back"), `session-summary.ts`, the chat-snippet extractor (`chat-sites.ts`) and the frame pipeline that hydrates B's state after a service-worker restart.

### B ｜ Decision + dialogue + presentation ("shows the pet")

- **The decision half:** eats `FeatureFrame` → `DetectionResult`
  - `applyProfileMuting` (the profile decides which signals are muted) + thresholds / grace period
  - two-channel decision (DRIFT + STUCK) + shared gates (cooldown / rest / grace) + evidence sustainers + the `lastAnswerTs` anti-loop patch
  - DEMO_MODE time compression (`DEMO_TIME_SCALE = 1/30`; lowered from 1/120 on 09-11 — at 120× most thresholds fell under a second and the demo could not be narrated)
  - adaptive backoff (adjust thresholds from `CheckInFeedback`; STUCK ladder ends at 20 min, no ∞ mute)
  - the three-state machine (companion / observing / check-in)
- **All dialogue wording:** starter-coach breakdown, check-ins, micro-restarts (**a friend, not a supervisor** — the demo lives or dies here; check-in wording is fed by `lastAnchorSnapshot`).
- **Presentation:** pet UI + check-in interaction + floating host / side panel + session summary.
- **Outcome:** all shipped. Two deviations from the plan: the state machine is **hand-written** (`pet-state.ts`, ~100 lines) rather than XState; and the floating pet is a **content-script Shadow DOM island**, not `documentPictureInPicture` — PiP would have been a separate window the user has to keep open, and can't be dragged around the page. B also owns the prompt eval harness (`evals/`).

**Tie-break rule (from the original):** whoever has kiosk/system experience takes A; whoever has a feel for UI takes B; otherwise flip a coin, both halves are hard enough.

---

## 3. Phase one (Day 1–10): each half stands on its own → merge to prove "smart non-interruption"

### Day 1–2 ｜ Fix the three contracts together (the only thing that *must* be pair-designed)

A deep design session, not typing interface stubs. Decided together, in one sitting:

- **The exact definition of the four signals and the shape of `FeatureFrame`** — the one piece of signal-definition + scoring logic worth two people's time.
- **A sketch of the decision formula** (how the four signals AND/OR together; how a profile mutes).
- The `SignalEvent` / `SessionContext` schemas.
- **Two mock sets:** `events.json` (A tests perception) + `frames.json` (B tests decision).
- Then split immediately and go parallel.

**Outcome:** contract v4 with 22 audit revisions was frozen on Day 2. Both mock files live in `src/mock/`.

### Day 3–5 ｜ Parallel: A on perception + platform, B on decision + pet components

**A (nothing here depends on B)**

- MV3 skeleton + permissions + service-worker lifecycle working (**platform risk first**).
- Signal collection: active-tab domain / switch sequence / idle → `SignalEvent` (**coarse texture first, refine in phase two**; platform stability over precision).
- Perception half: four signals → `FeatureFrame`; LLM relevance classification wired (async + cache skeleton; demo preset cache).
- Unit tests: `events.json` → assert `FeatureFrame`'s jumpPattern / texture / anchorDetachedMs / contextRelevance / stillnessMs / systemIdle.

**B (nothing here depends on A's browser)**

- Decision half: `applyProfileMuting` + `isDrifting` / `isStuck` thresholds + grace period + backoff heuristics → `DetectionResult`; shared gates (restUntil / `CHECKIN_COOLDOWN_MS` / graceUntil) + evidence sustainers + `lastAnswerTs` patch + DEMO_MODE time compression.
- Hand-write `frames.json`: the "expected `FeatureFrame`" for the 25 scenarios, fed to the decision half (which incidentally sets the acceptance bar for A's perception half).
- A standalone React pet component (companion / observing / check-in), **not yet inside the extension.**
- Unit tests: `frames.json` → assert the action.

> **★ Day 5 hard checkpoint ★ (the first merge of the two halves)**
> Compose A's perception half and B's decision half as pure functions (both TypeScript, zero glue cost) and run the 25 scenarios **end to end**. All green or no Day 6:
> 1. Coding · rapid IDE↔docs↔AI↔SO switching (all relevant domains) → **DO_NOTHING throughout** (★ switching is not a false positive)
> 2. Deep reading · same page 20 min, no switch, no input → **DO_NOTHING** (deep reading is not a false positive)
> 3. Coding · drift to YouTube + anchor untouched 10 min + passive scrolling → **CHECK_IN_DRIFT** (real drift is caught)
> 4. User answers "this counts as work" → **DO_NOTHING and that domain never fires again** (adaptive whitelist)
> 5. Switching to an irrelevant domain in the first 2 min → **DO_NOTHING** (grace period)
> 6–20. v4 regression scenarios (STUCK ladder, VIEWER lectures, slip tolerance, offline degradation… see [`contract-v4.md`](contract-v4.md) §4)
> 21. **CREATOR typing-style drift** (`ACTIVE_INPUT` on an IRRELEVANT page does not upgrade texture) → **CHECK_IN_DRIFT** (★ blind-spot fix verified)
> 22. **No starter coach: default strategy** → **basic companionship works**
> 23. **Rest mode, nobody answers** → **reminder repeats every 5 min**
> 24. **DEMO time compression** → **CHECK_IN_DRIFT within seconds**
> 25. **`lastAnchorSnapshot` data source verified** → check-in wording is assertable
>
> Plus each half's own smoke tests. **Not all 25 green → no Day 6; polish the decision logic in place.** This step costs only fake data — the cheapest possible verification — and it proves the `FeatureFrame` seam lines up.

**Outcome:** passed. The scenario suite grew as bugs were found; the final engine suite is **316 tests** (`npm test`, offline, no Chrome).

### Day 6–8 ｜ Merge: real signals into perception, the pet into the extension

- A's real `SignalEvent` stream replaces `events.json` — because the `FeatureFrame` seam was fixed early, **B's decision half changes by zero lines.**
- B's pet component goes into the MV3 side panel; run the full loop "a real check-in fires inside the extension".
- This is where MV3 bites hardest (permissions / lifecycle / side panel); two people together is faster.

> **★ Day 8 hard checkpoint ★**
> Reproduce both contrast moments reliably in a real browser: **frantic tab switching does not interrupt + drifting to an irrelevant site triggers a check-in.** Not stable → keep polishing, **no Day 9.**

**Outcome:** passed, with the side panel as the host. The floating pet came later (B16, 09-02 → 09-06).

### Day 9–10 ｜ Wire the starter coach, close the loop end to end

- B wires the minimal starter coach (one LLM call → the first physical action + a `SessionContext`).
- Confirm `SessionContext` (task / profile / anchor) reaches A's perception half correctly — **this is the B→A seam, both must understand it.**
- End to end: start → companion → real drift pulled back → session summary.

**Outcome:** done. The coach prompt then went through five more revisions (v1→v5.1) driven by real-device failures, ending with `anchorContext` (the coach is told which page is open) and the eval harness.

---

## 4. Phase two (Day 11–25): the core is stable, three tracks in parallel

### Track one ｜ A: perception + platform (the "perception" side of the moat)

- Day 11–14: **content-level classification** (YouTube / Reddit / Slack judged by `domain + path + title`, cached — closing the biggest hole); async LLM classification + cache + warm-up.
- Day 15–18: finer texture (keystroke / feed_scroll / media_seek); more `contentKind`s; short-video feeds judged by shape.
- Day 19–22: graceful degradation (never crash on an exception; offline → local black/white lists).
- Day 23–25: integration, bug-fixing, ammunition for technical Q&A (false-positive rate, cache hit rate — definitions in [`contract-v4.md`](contract-v4.md) §5.4).

**Outcome:** all landed, plus things not in the plan: **AI-chat snippet extraction** (09-05; a drifting *conversation* on claude.ai is noticed even though the tab never changes), `pull-back.ts` with `tabId` tracking (09-11), `mediaPlaying` so STUCK doesn't fire while a video is playing (09-11), page-level whitelist entries for mixed-content sites (09-11), and `restEndedTs` so a rest doesn't count as being stuck.

### Track two ｜ B: decision + dialogue + presentation (the "decision" side of the moat, and the face of the demo)

- Day 11–14: adaptive backoff heuristics; the three-state machine.
- Day 15–18: check-in / micro-restart wording, iterated (**friend, not supervisor**); starter-coach prompt polish; the pet's three-state animation; check-in interaction UI.
- Day 19–22: session summary + focused-minutes in the corner (**a supporting detail, don't let it steal the show**); (if there's room) the floating pet.
- Day 23–25: merge with track three, focus on demo recording.

**Outcome:** all landed. Highlights: the hand-written state machine; observing-state animation v2 (strong glow, no colour change — chosen by A); the **floating pet via content script** (drag anywhere, position remembered, hover to reveal controls, transparent cat-only); `RESTING_INDEFINITELY` replacing `Infinity` after it silently became `null` through `chrome.storage`; and the **eval harness** (16 tasks × 12 mechanical checks + an action-shape distribution) once we learned that a pass rate saturates and stops discriminating between prompt versions.

### Track three ｜ Shared: deck + demo (rolling from Day 11)

- Day 11 on: deck skeleton; **drop in real screenshots / numbers weekly**, don't write it at the end.
- Day 15: demo script first draft; walk it through and let "which contrast moment doesn't play reliably" drive engineering.
- Day 20–23: **record a backup demo video** (live triggering is random; always have a fallback).
- Day 24–25: final deck + final video + README / docs (hard deliverables).

> **A 15–20 minute daily sync.** The failure mode of three parallel tracks is interfaces drifting apart in silence. One alignment a day is nearly free and pays for itself many times over.

---

## 5. Five stability red lines (no exceptions)

1. **Domain classification never blocks the engine.** LLM classification is async; until a verdict exists everything is `UNKNOWN` and conservative (no check-in); verdicts are cached; demo domains are **warmed into the cache** beforehand.
2. **There is always a local black/white-list fallback.** Offline or on API failure, the built-in entertainment blacklist plus the session whitelist still give a reasonable answer; the system never goes fully mute. **The demo preset cache outranks the LLM** (scenario 3 plays even offline). Same rule for the starter coach: a fixed fallback first step, and the extension runs with no API key at all.
3. **A backup demo video is mandatory.** Live triggering is random; record a clean stable take in advance.
4. **The `FeatureFrame` seam is the lifeline of parallel work.** Anyone changing a `FeatureFrame` field **must say so at that day's sync**, or the decision half will silently misjudge in ways that are very hard to trace. (In practice: `mediaPlaying`, `currentUrl` and `lastAnchorSnapshot.tabId` were each added this way, on 09-11.)
5. **The DEMO_MODE time-scale constant changes in exactly one place** (`DEMO_TIME_SCALE` in `src/engine/types.ts`, applied through `scaled()`). Every time parameter in the source is written as its real value, so demo and real behaviour cannot fork.

A sixth rule we adopted after the fact, learned the hard way between 08-31 and 09-06: **"code exists and tests are green" is not "feature works."** Four times a feature was hollow in the real host because the pipeline that feeds it was never connected. Every feature now gets a real-device check before it is marked done.


> **Each of us guards one half of the engine; the two halves meet at a single seam, `FeatureFrame`. Day 5 merges them on fake data, Day 8 on real signals.**

