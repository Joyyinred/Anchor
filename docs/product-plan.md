# Anchor — an AI focus companion for starting and staying

> Audience: people who struggle to start, drift easily, or work in fragments — students and knowledge workers, with ADHD-adjacent patterns very much in mind.

---

## One-line positioning

A desktop-pet AI that works alongside you: when a big task has you stuck at the starting line, it shrinks the task to an absurdly small first physical action and gets you moving; when you genuinely drift, it pulls you back in the voice of someone who *remembers what you were doing* — and it is smart enough to **know the difference between looking something up, switching to an AI assistant, chewing on a hard problem, and actually wandering off.** In those first three cases it says nothing.

**Tagline:** *Just start. I'll keep you here.*

**The name.** *Anchor* is both the value (keeping you anchored to the task) and the mechanism: drift is detected by **how long it's been since you touched the anchor** — the page where the real work happens — not by how many tabs you switched. The pet is that anchor, personified.

**The thesis.** The two real failure points for people who struggle to focus are **start paralysis** and **mid-session drift**. Existing tools either list your tasks (without getting you moving) or count minutes and nag (interrupting you when you're actually focused). Anchor does two things, at the right moments: **helps you start**, and **pulls you back only when you've really left.**

---

## The pain (the author is the user)

Two moments that keep happening during study, coding and writing:

1. **Start paralysis.** A big, scary task — *"ten-page paper due tomorrow"*, *"no idea where this bug even starts"*. You know you should. You don't. Two hours go by.
2. **Mid-session drift.** You finally start, and somehow you're on YouTube. Half an hour is gone — and **you never noticed leaving.**

Why existing tools fail:

- **To-do lists and Pomodoro timers** list tasks and count time. Nothing helps with the 0→1 moment, and nothing catches you at the exact moment you drift in a way that doesn't annoy.
- **Focus apps and site blockers** block "distracting sites" wholesale. But coding needs Stack Overflow and writing needs Google Scholar. **They can't tell research from wasting time**, so they either hit the wrong thing or get switched off.
- **Nothing understands what you're doing right now**, so every reminder is either too dumb (a popup after five minutes on one page, right as you're deep in a problem) or too loud (an alarm every time you switch tabs).

Anchor exists for exactly those two moments, and its right to exist rests on the one thing the others can't do: **telling task-internal switching and deep reading apart from real drift.**

---

## The two core capabilities

### 1. The starter coach (first half — start paralysis)

You hand the pet the task you can't begin. It:

- **Shrinks it to something absurdly small.** *"Write the paper"* becomes one physical action you can't refuse: *"Open the doc and type just the title."* Lowering the activation energy is the whole point.
- **Uses what's in front of you.** If you already have the lecture open, the first step is *"press play on the video you have open"*, not *"search for a lecture."*
- **Asks one clarifying question if the task is too vague to ever judge pages against** — and only one.

This step also collects everything the second half needs: what you're working on, and which page is the **anchor**. The coach's output *is* the drift detector's frame of reference.

> **Shipped:** one LLM call → one first action, with a fixed fallback if the call fails. The original plan's "stay with you for the first two minutes and adapt to what you're stuck on" was not built; the single well-chosen step turned out to be the part that mattered.

### 2. Focus companionship (second half — mid-session drift)

Once you start, the cat sits quietly (hover it to see how long you've been focused — a supporting detail, not the star). It continuously judges whether you've left the task, and **only when it is confident** does it check in — one non-judgmental question, with a "micro-restart" that takes you back to where you were.

*When to speak and when to stay quiet* is the technical soul of the product. Next section.

---

## The detection design (why this isn't a timer with an LLM sticker)

### Five principles

1. **No single signal ever counts.** Switching tabs, staying long, opening a window — none of these triggers anything alone. Only when several independent signals agree.
2. **Everything is judged against the declared task.** The question is never *"did you switch?"* but *"does where you are now have anything to do with what you said you'd do?"*
3. **We detect *leaving the anchor*, not *switching*.** The core signal is *how long since you touched the page where the work happens.* Task-internal switching keeps **coming back** to the anchor; drift **abandons** it.
4. **A false positive costs far more than a miss.** Breaking real focus once is worse than missing one drift — especially for people for whom focus is hard to reach. So: conservative, and willing to miss.
5. **Ask, never assert.** Never *"you drifted!"* — always *"looks like you might have wandered?"* The user has the final say, and their answer tunes the system.

### The frame of reference: three things set at the start

- **The task**, one sentence — *"debug my React login flow"*, *"read chapter 3 and take notes"*.
- **A session profile** that decides which signals to mute — this is the direct answer to *"switching isn't drifting"*:
  - **Creator / researcher** — bouncing between IDE, docs, AI and search is *normal*, even productive → **switch-frequency signals are muted**; only *"landed somewhere irrelevant and hasn't returned to the anchor in a long time"* counts.
  - **Deep reader / writer** — staying on one page for a long time is *normal* → **dwell-time signals are muted**; only *"left the reading/writing cluster for passive consumption"* counts.
- **The anchor** — which tab is the real work. Taken from the page open when you declare the task.

> **Shipped:** the three presets (CREATOR / READER / VIEWER) exist in the engine with different thresholds and muting. Phase one runs everyone on CREATOR; automatic profile inference is on the roadmap.

### The four signals (all in-browser, near-zero cost)

1. **Context relevance.** Is the current page related to the task? Judged lazily by the LLM per page (and, on AI-chat sites, per latest message), cached. Task = *"research X"*: `scholar.google.com` relevant, `react.dev` relevant, `youtube.com/watch` irrelevant, a subreddit — depends. **This is a real AI judgment, not a hard-coded blacklist** (the blacklist is only a fallback).
2. **Anchor detachment.** How long since a meaningful interaction with the anchor. **The strongest, cheapest signal.**
3. **Interaction texture.** Purposeful (typing, deliberate scrolling), passive (feed scrolling, autoplay), or idle. Passive consumption is drift's signature.
4. **Jump pattern.** Orbiting task-relevant domains (IDE ↔ docs ↔ AI ↔ SO, returning to the anchor) versus hopping between irrelevant ones — the rabbit-hole / doomscroll shape.

### The decision (simple, reliable, and it shipped)

Two independent channels, each requiring its evidence to hold for **30 continuous seconds** before speaking (a page on the built-in entertainment blacklist takes a faster lane — 15 s of anchor detachment instead of the profile's minutes — because that verdict is certain, not a guess):

- **DRIFT** fires only when: the page is irrelevant **and** the anchor has been untouched past the profile's threshold **and** (texture is passive **or** the jump pattern is a rabbit hole).
- **STUCK** fires only when: the page *is* relevant, nothing has moved for the profile's threshold, and no video is playing.

Neither fires because you merely switched, merely stayed, landed on an unfamiliar-but-relevant site, or are within the opening grace period. After any check-in there's a cooldown, and evidence gathered before it is discarded.

The check-in is phrased as a question:

> *"Last I saw you on the login bug — now you're on YouTube. Still researching, or did your mind wander?"*

- **"This counts as work"** → that page is whitelisted for the session. It never asks about it again.
- **"Drifted — pull me back"** → a micro-restart line, and it actually switches you back to the tab you left.

> **Shipped:** the original plan described a 0–1 "confidence score". What shipped is stricter and more legible: two boolean channels with evidence sustainers. Same intent, easier to test and to explain.

### Adaptive backoff (turning the biggest risk into the pitch)

Every check-in answer feeds back. *"Still on track"* raises the STUCK threshold a rung; *"drifted"* resets it and shortens the next cooldown; *"this counts as work"* whitelists. **"How do you guarantee you won't nag me while I'm focused?" — this is the answer.** Single-session heuristics only; cross-session learning is roadmap.

---

## A typical session

1. You open the pet: *"I have a problem set due tomorrow and I can't start."*
2. **The coach** gives you one absurdly small first step, and now it knows the task and the anchor.
3. You work. The cat sits quietly. You bounce between IDE, docs, AI, Stack Overflow — **it says nothing.**
4. Somehow you're on YouTube; the anchor's been untouched for five minutes and you're scrolling — **the signals agree, the channel fires.**
5. The cat checks in, remembering what you were on, and takes you back.
6. **Done for today** shows a short, non-judgmental summary — how long, how many check-ins, how many breaks.

---

## MVP scope

### ✅ Built (a complete, differentiated loop)

- **Starter coach** — task → one physical first action (using the open page), one clarifying question at most, local fallback.
- **The drift engine** — four signals, two channels, profile-based muting, evidence sustainers, cooldown, grace period; 316 unit tests.
- **Non-judgmental check-in + micro-restart** — remembers context; *pull me back* switches tabs for real.
- **Adaptive whitelist + backoff** — one *"this counts as work"* and it stays quiet; thresholds move with your answers.
- **Rest mode** — quiet until *you* say you're back; soft reminder at 15 min with *"5 more minutes."*
- **The pet** — a floating cat on the page (Shadow DOM), three moods, drag-anywhere, hover for controls; side panel as fallback.
- **Session summary** and focused-minutes display (a supporting detail, deliberately quiet).
- **AI-chat awareness** — on claude.ai, reads your latest message so a drifting *conversation* is noticed even when the tab never changes.

### 🔸 Narrowed on purpose

- **A Chrome extension, not a web app.** Only an extension can see which tab is active, the switch sequence and system idle — the preconditions for all four signals. A web app only knows *"I was hidden"*, not where you went; it would degrade into a switch-alarm.
- **Profiles:** three presets defined; phase one runs on CREATOR.
- **Backoff:** single-session heuristics, no long-term learning.
- **Summary:** a basic count for this session, no trend analysis.

### ❌ Explicitly out (roadmap)

- **Desktop-wide monitoring** (seeing you switch to any desktop app) — needs Electron/Tauri and OS permissions.
- **Planning your study schedule from long-term history** — needs data that doesn't exist on day one.
- Cross-session weak-spot profiles, cross-device sync.
- **Hard blocking.** We pull you back intelligently; we don't wall you in.

**The narrowing rule:** make one line — *start paralysis → helped to start → switching not interrupted → real drift pulled back* — work end to end, rather than cover every platform with every signal half-done.

---

## Tech stack (as shipped)

- **Form factor:** Chrome extension (Manifest V3). React + plain CSS. The pet renders into a Shadow DOM on the host page; the same React tree also renders in the side panel. `npm run build` → *Load unpacked* — no store listing, no review.
- **Pet animation:** Lottie (`lottie_light` build; MV3's CSP forbids the `eval()` in the full build). *Kitty Cat Error 404* by Sepehr Radfar, LottieFiles, Lottie Simple License.
- **Signals:** `chrome.tabs`, `chrome.idle`, `chrome.webNavigation`, `chrome.alarms`, Page Visibility, a content script for keystrokes / scroll / video events. Zero backend.
- **AI:** Groq — `openai/gpt-oss-20b` for page relevance (`temperature: 0`, cached), `openai/gpt-oss-120b` for the starter coach. Check-in wording, backoff and the profile are **local logic, not LLM calls.** Every LLM path has a local fallback; the extension runs without a key.
- **Storage:** everything in `chrome.storage.local`. **No database, no Supabase, no server** — the original plan listed Supabase; we never needed it.
- **Testing:** Vitest, 316 tests on the pure engine; a separate prompt eval harness (`evals/`) that hits Groq and is deliberately not part of `npm test`.

---

## Differentiation

| Compared to | What they do | What Anchor does |
|---|---|---|
| To-do lists / Pomodoro | *List* tasks, *count* time | Gets you across the 0→1 line, then **pulls you back when you actually drift** |
| Focus apps / site blockers (Forest, Cold Turkey…) | Block "distracting sites" wholesale | **Understands what you're doing** — tells research from drift; no collateral damage, no walls |
| Dwell-time nags (popup after X minutes) | One threshold | **Multiple signals against a declared task**; would rather miss than interrupt |
| General AI assistants | You ask, it answers | **Proactive**, at the right moment, tied to the precise signal of *leaving the anchor* |

**In one sentence:** other tools either list or nag; Anchor is the one that **knows what you're doing right now, so it knows when to pull you back and when to shut up.**

---

## Demo script (two moments of contrast)

1. **Start (empathy):** *"Problem set due tomorrow, can't begin."* → the pet gives one absurdly small step; thirty seconds later you are physically typing.
2. **Not interrupting (contrast #1, the most important):** you code, and in front of the judges you **bounce furiously** between IDE, docs, Stack Overflow, AI — the cat **doesn't move, doesn't speak.** Narration: *"Any other tool would have popped three times by now. It knows I'm looking things up."*
3. **Pulling back (contrast #2, the climax):** you "accidentally" drift to YouTube and start scrolling → seconds later (demo mode, 30× time compression) the cat checks in: *"You left the loop bug a few minutes ago — still researching, or did your mind wander?"* → *"drifted"* → a micro-restart, and it switches you back to that line of code.
4. **Close:** *"Focused 38 minutes, pulled back once."* One line: *Anchor doesn't nag and doesn't block. It's the friend who knows when you actually need a hand.*

**Demo discipline:** rehearsed, stable scenarios only; the contrast between steps 2 and 3 is the memory; the check-in wording is tuned in advance to sound like a friend, not a supervisor. **Turn on demo mode**, or step 3 takes five minutes of real time.

---

## Roadmap

Anchor's engine — *judge "have they left the anchor" from several signals against a declared task* — applies to any setting where you need to intervene in someone's attention at the right moment, in the right tone. The engine already has no idea what a browser tab is; only the signal collector does.

- **Near:** from the browser to the **whole desktop** (Electron/Tauri; see you switch to any app — a stronger signal). A **mobile companion** for declaring the task and getting the first step.
- **Mid:** **learn across sessions** — when you focus best, which tasks drift most, which sites are your personal traps — and **plan sessions for you.** This is the "proactive planning" idea from the very first sketch; it belongs here, once there's data.
- **Far:** from an individual tool to an **attention-health profile** — non-judgmental focus data a person could share with a coach or clinician.

We started with *in the browser, one profile, demonstrable today* — the clearest signals and the most solid ground — and grow toward *cross-platform and aware of your long-term patterns.*


