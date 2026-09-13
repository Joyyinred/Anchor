# Anchor — Submission

A Chrome extension that notices when you've drifted from your task — not by counting tabs or blocking domains, but by judging what's actually on the page — and helps you start in the first place.

---

## The problem

Two moments break most people's focus, and neither one is really about willpower.

**Starting is the hardest part.** A big, vague task — "finish the paper," "fix this bug" — sits there and you know you should start, and don't, sometimes for hours.

**Drift is invisible from the inside.** You start working, and at some point, without ever deciding to, you're on YouTube. You don't notice until it's already cost you twenty minutes.

Existing tools don't fix either one. To-do lists and pomodoro timers help you *list* work and *count* time, but nobody helps you take the first step, and nobody notices the moment you actually drift. Site blockers go the other way: they block by domain, so they can't tell "looking something up on Stack Overflow" from "doomscrolling Reddit" — they either over-block and get disabled, or under-block and do nothing.

Anchor's bet is that both moments are solvable with the same idea: **judge relevance by what's actually on the page, against the task you declared — not by domain, and not by how many tabs you switched.**

People who struggle with task initiation and attention regulation — ADHD very much included — feel this hardest. But losing time to a page that quietly stopped being about your task is a cost everyone pays working in a browser.

---

## Who it's for

- **Builders & coders** — deep in a flow across an IDE, docs, and an AI chat. Anchor learns that rhythm and doesn't flag the switching itself as drift.
- **Researchers & students** — long stretches of reading. Anchor treats stillness on one page as focus, not a problem.
- **Course & lecture watchers** — hours of video as the task itself. Anchor catches the moment a lecture becomes background noise, without policing every pause.

Built first for people who find starting and staying the hardest — ADHD included — and just as useful for anyone who's ever opened one tab and lost an hour.

---

## The solution

Two capabilities, one underlying engine.

**Starter Coach.** The first time you open the side panel, it asks what you're working on. Type something like *"study neural networks"* — if that's too vague to ever judge pages against, it asks one follow-up question, never more — and it replies with one small, physical first action ("press play on the video you already have open"). You're moving inside two minutes.

**Focus Companion.** Once you're working, a small floating pet sits quietly on the page. It watches for the *shape* of drifting and asks one gentle question only when it's confident enough — never on a single blip.

---

## How it works (the technical core)

### Four signals, evaluated together

A background detection loop combines four signals into one `FeatureFrame` every time something changes:

1. **Context relevance** — is the current page's content actually about the declared task? Classified by an LLM per page and cached, with a fast-path blacklist/whitelist for known non-work and mixed-content domains.
2. **Anchor detachment** — how long since you last meaningfully interacted with a page the LLM judged relevant.
3. **Interaction texture** — purposeful input, passive scrolling, or idle.
4. **Jump pattern** — orbiting relevant tabs versus a rabbit hole through unrelated ones.

No single signal fires an alert. A channel only triggers after its condition has held continuously for a 30-second sustained window, which is what keeps a single distracted glance from becoming a false alarm.

### Two independent detection channels

- **DRIFT** — you've left the relevant context and haven't come back. Answered with *Still on track*, *This counts as work* (whitelists that page for the session), or *Drifted — pull me back* (switches your browser tab back to where you left off).
- **STUCK** — you're still on the relevant page, but nothing's moved for 15 minutes. Answered with *Deep in thought* or *Drifted — pull me back*.

### Session profiles mute the wrong signal for the work

Three archetypes tune which signals are trusted, because "drift" looks different depending on what you're doing:

| Profile | What it's for | What it mutes |
|---|---|---|
| `CREATOR` | Coding & building | Rapid switching between an IDE, docs, and an AI chat is normal — the jump-pattern signal is muted |
| `READER` | Deep reading & study | Sitting still on one page is normal, not stuck — passive-texture signal is muted |
| `VIEWER` | Watching a lecture or course video | Passive playback isn't drift, and the STUCK channel is disabled entirely |

### Adaptive backoff, not a fixed timer

Answer a check-in "still focused" enough times in a row and the next threshold gets longer — fewer interruptions as you prove you're reliably on task. Answer "drifted" and the ladder resets to baseline sensitivity (it does **not** make the next check-in come sooner — the risk of annoying false alarms is handled entirely by the sustained-window requirement and per-page whitelisting, not by escalating checks). A wrongly flagged page can be whitelisted for the rest of the session instantly, at either domain granularity (most sites) or exact-page granularity (mixed-content domains like YouTube or Reddit, where whitelisting the wrong *video* shouldn't whitelist the whole domain).

### Rest mode & session summary

**Take a break** silences both detection channels completely until you click **Back to it** — nothing times it out automatically. After 15 minutes it offers one soft reminder, with a **5 more minutes** option that postpones without ending the break. **Done for today** closes the session with a short, non-judgmental summary: how long you focused, how many times you drifted, how many breaks you took — no score, just what happened.

---

## Two models, two jobs

Anchor uses two differently-sized models from Groq for two genuinely different jobs, rather than one model for everything:

| | Relevance classifier | Starter coach |
|---|---|---|
| Model | `openai/gpt-oss-20b` | `openai/gpt-oss-120b` |
| Job | One quick judgment: is this page about the task? | Turn a vague task into one small first action; write every check-in's wording |
| Call frequency | Every new page | Once per task, once per check-in |
| Tuned for | Speed, consistency (temperature 0) | Reasoning quality |

Every LLM call has a local, deterministic fallback (a static domain blacklist for classification; a fixed first action for the coach) — the LLM never blocks the core loop, and nothing breaks without a key. That's an explicit design rule, not an afterthought.

---

## Engineering: what real MV3 constraints forced

- **Service-worker sleep.** Chrome kills the background script when idle. Every timestamp the detector depends on is persisted to `chrome.storage.local` and rehydrated on wake — never held only in memory.
- **Shadow DOM injection.** The floating pet renders inside a shadow root on whatever page you're on, so the host page's CSS can never leak in, and Anchor's styles can never leak out.
- **Content-script lifecycle.** A fresh build doesn't reach tabs that are already open. Every page load is treated as a resumable session, never assumed to be a fresh start.

The codebase is split into an **engine** (`src/engine/` — perception and decision logic, pure TypeScript, zero Chrome or DOM dependency) and a **platform** layer (`src/platform/` — Chrome APIs, DOM, content scripts, network calls). The engine is fully unit-tested (316 tests); the platform layer is verified on real devices instead, and every bug found there became a regression test before being called fixed (see `updateNote/updateNote.md` for the day-by-day log).

---

## Tech stack

- **Platform:** Chrome Extension, Manifest V3. No server — everything runs client-side.
- **Language:** TypeScript throughout, with two separate `tsconfig`s enforcing the engine/platform boundary.
- **Build:** Vite + `@crxjs/vite-plugin`.
- **UI:** React — a side panel and an in-page floating widget (Shadow DOM), hand-written CSS.
- **Pet animation:** `lottie-web` (light/no-eval build, required by MV3's CSP against `eval`-based expressions).
- **Reasoning:** Groq (OpenAI-compatible API) — `openai/gpt-oss-20b` and `openai/gpt-oss-120b`.
- **Storage:** `chrome.storage.local` only. No database, no backend.
- **Testing:** Vitest for the engine (316 tests); a separate eval harness (17 fixed tasks, 13 mechanical checks, an action-shape distribution) exercises the starter-coach prompt against the real API and is deliberately excluded from `npm test`.

---

## What's built vs. the original plan

- Session profiles expanded from two to three (`CREATOR` / `READER` / `VIEWER`) once it became clear a lecture-watcher's "stuck" looks nothing like a reader's.
- Storage ended up 100% local (`chrome.storage.local`, no backend) — a stronger privacy story than the original plan, which had assumed a database.
- Added beyond the original MVP scope: rest mode with a snooze, an end-of-session reflection summary, demo-mode time compression (every threshold scaled 30× for live demos), and a dedicated eval harness for the starter-coach prompt.
- Per-page (not just per-domain) session whitelisting was added after a real-device bug: whitelisting one YouTube video was silently whitelisting the entire domain for the rest of the session.

## Known limitations

- Chat-message sensing (used to judge drift *within* an AI conversation, not just by tab) is implemented and tested against `claude.ai`'s DOM structure; other AI-chat sites are recognized for classification purposes but don't yet get the same message-level signal.
- Single-window, single-anchor model — Anchor currently tracks one active task context at a time.
- Classification degrades gracefully but does get coarser offline: without a Groq key, relevance falls back to a static blacklist plus a conservative `UNKNOWN` verdict rather than true content judgment.

---

## Privacy

- **No server.** State, session history, and your API key stay in `chrome.storage.local`, on your machine.
- **What's sent to the LLM:** your task sentence, and the current page's title and URL. On a curated list of AI-chat sites (`claude.ai`, `chatgpt.com`, `chat.openai.com`, `gemini.google.com`, `grok.com`, `perplexity.ai`, `copilot.microsoft.com`, `chat.deepseek.com`, `poe.com`) — your latest typed message, never the full page or your chat history.
- **Permissions used:** `tabs`, `idle`, `storage`, `alarms`, `webNavigation`, `sidePanel`, plus host access on all URLs to inject the floating pet.

---

## Try it

```bash
git clone https://github.com/Joyyinred/Anchor.git
cd Anchor
npm install
npm run build
```

Load `dist/` as an unpacked extension at `chrome://extensions`. No API key required to see the full loop — every LLM path has a local fallback; a key just makes the answers smarter. See [`README.md`](../README.md) for the full quick-start, including demo mode.
