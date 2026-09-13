# Anchor

> A focus companion that notices when you drift — and gently pulls you back.

Anchor is a Chrome extension (Manifest V3). A small floating cat lives on whatever page you're reading, watches for the *shape* of drifting, and asks one gentle question when it's confident enough. It also helps you **start**: tell it what you're working on and it hands you one physical first action.

There is no server. Everything lives in `chrome.storage.local`. The only data that ever leaves your machine is a page title and your task sentence, sent to an LLM for a relevance verdict — see [Privacy](#privacy).

---

## Quick start (for reviewers)

**Requirements:** Node.js 20 or newer, Google Chrome (or any Chromium 116+).

```bash
git clone https://github.com/Joyyinred/Anchor.git
cd Anchor
npm install
npm run build
```

This produces a `dist/` folder. Then:

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder
4. Open any website (e.g. a docs page or a YouTube video) — a cat appears in the bottom-right corner

That's enough to see the pet, the starter coach, check-ins, rest mode and the session summary. **You do not need an API key to run it** — every LLM call has a local fallback (see below). The key just makes the answers smarter.

### Optional: add a Groq API key (recommended for the full experience)

Anchor uses [Groq](https://console.groq.com) (free tier is plenty) for two things: judging whether a page is relevant to your task, and generating the starter coach's first action.

1. Get a free key at https://console.groq.com
2. Go to `chrome://extensions/` → Anchor → click **service worker** (opens the extension's console)
3. Paste and run:

```js
chrome.storage.local.set({ anchor_groq_api_key: 'gsk_your_key_here' })
```

Without a key: relevance classification falls back to a built-in blacklist plus a conservative `UNKNOWN`, and the starter coach falls back to a fixed first action. Nothing breaks — that's a design rule ([`docs/division-of-work.md` §5](docs/division-of-work.md), red line #2: *the LLM never blocks the engine, and every LLM path has a local fallback*).

### Optional: demo mode (30× faster)

Real thresholds are measured in minutes (5 min to confirm a drift, 15 min to suspect you're stuck, 15 min before a rest reminder). For a demo, compress every time constant 30×:

```js
chrome.storage.local.set({ anchor_demo_mode: true })
```

A five-minute drift now plays out in about ten seconds. Set it back to `false` to return to real timing. All scaling goes through a single function (`scaled()` in [`src/engine/types.ts`](src/engine/types.ts)) — nothing else in the codebase knows about the multiplier.

---

## How to use it

1. **Declare a task.** The first time the cat appears, it asks what you're working on. Type something like *"study neural networks"* or *"finish chapter 3 of the React docs"*. If it's too vague to ever judge pages against, it asks **one** follow-up — never more.
2. **Get a first step.** It replies with one physical action (*"Press play on the video you already have open"*). Click **Let's go**.
3. **Work.** The cat sits quietly. Hover over it for **Take a break** / **Done for today**; hover over the anchor badge by its ear to see how long you've been focused.

   Working with an AI assistant? On claude.ai, Anchor also reads your **latest message** — so if the conversation drifts from "neural networks" to "what's for dinner", the cat notices even though the tab never changed. (Only your most recent message, only on listed AI-chat sites — see [Privacy](#privacy).)
4. **When you drift**, a bubble appears with three options:
   - **Still on track** — clears this round of evidence
   - **This counts as work** — whitelists that page for the rest of the session
   - **Drifted — pull me back** — switches you back to the tab you left
5. **When you're stuck** (on the right page, no input for 15 min): *Deep in thought* / *Drifted — pull me back*.
6. **Take a break** silences everything until *you* click **Back to it**. After 15 minutes it checks in softly, with a **5 more minutes** option.
7. **Done for today** shows a short summary — how long, how many check-ins, how many breaks — and resets for the next session.

The side panel (click the toolbar icon) shows the same UI, and works on pages where an extension can't inject (`chrome://`, the Web Store, PDFs).

---

## Development

```bash
npm test              # 316 unit tests, offline, no Chrome needed
npm run typecheck     # two tsconfigs: engine (no DOM/chrome) and platform
npm run build         # production build → dist/
npm run dev           # Vite dev server (for the component preview below)
```

**Component preview** (all pet states, check-in variants, summary screens, side by side):

```bash
npm run dev
# then open http://localhost:5173/src/devpreview/index.html
```

**Starter-coach eval harness** — 16 fixed tasks, 12 mechanical checks, an action-shape distribution, run against the *production* prompt. Requires a Groq key in the environment (it hits the real API; it is deliberately not part of `npm test`):

```bash
export GROQ_API_KEY=gsk_...      # PowerShell: $env:GROQ_API_KEY = "gsk_..."
npm run eval:coach
npm run eval:coach -- --runs 3   # run the set three times to see variance
```

### After every rebuild

Three steps, every time — we lost hours to skipping the last one:

1. `npm run build`
2. `chrome://extensions/` → reload Anchor
3. **Hard-refresh any open page** (`Ctrl+Shift+R`). Pages keep running the *old* content script until reloaded.

The floating pet logs a build timestamp to the page console (`[Anchor floating build 2026-09-06 12:51:30] mounted`) so you can confirm which version is actually running.

### Where the logs are

Two separate consoles:

- **Service worker** (`chrome://extensions/` → Anchor → *service worker*): signal frames, detection results, classification, starter coach.
- **The page's own console** (F12 on the website): content-script injection, the floating pet, chat-snippet extraction.

An error in one will never show up in the other.

---

## Architecture

Two halves, one seam.

```
Chrome APIs ──► perception (A) ──► FeatureFrame ──► decision (B) ──► pet / bubble
  tabs, idle,     signals.ts         (the contract)    detector.ts        cat.tsx
  content script  perceiver.ts                          pet-state.ts       AnchorApp.tsx
                  classifier.ts                         wording.ts
```

- **Perception** collects four signals — context relevance, anchor detachment, interaction texture, jump pattern — into a `FeatureFrame`.
- **Decision** runs two independent channels, **DRIFT** and **STUCK**, on evidence *sustainers*: a channel fires only when its condition has held continuously for a 30-second window. After a check-in there's a cooldown, and evidence from before it is discarded.
- **The engine** (`src/engine/`) is pure TypeScript with no Chrome or DOM dependency, so it's fully unit-tested against recorded signal streams (`src/mock/`).
- **The floating pet** renders into a Shadow DOM on the host page; the side panel renders the same React tree. Neither host contains logic.

Full design docs (reconciled against the final code):

| Doc | What it covers |
|---|---|
| [`docs/contract-v4.md`](docs/contract-v4.md) | The contract: signal definitions, thresholds, both detection channels, rest mode, privacy — every number checked against the code |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagrams and what each feature relies on |
| [`docs/product-plan.md`](docs/product-plan.md) | The product thesis, detection principles, scope and roadmap |
| [`docs/division-of-work.md`](docs/division-of-work.md) | Division of work, the five red lines, milestones with outcomes |


---

## Privacy

- **No server.** State, session history and your API key stay in `chrome.storage.local`.
- **What is sent to the LLM:** your task sentence, the current page's title and URL, and — only on AI-chat sites like claude.ai / chatgpt.com — your most recent message in that chat (so Anchor can tell when the *conversation* drifts, not just the tab). Never full page content, never browsing history.
- **Permissions used:** `tabs`, `idle`, `storage`, `alarms`, `webNavigation`, `sidePanel`; host access on all URLs to inject the pet.

---

## Credits

The cat is *Kitty Cat Error 404* by [Sepehr Radfar](https://lottiefiles.com/free-animation/kitty-cat-error-404-fvL7jDNahz) (LottieFiles, Lottie Simple License). The original file is unmodified; the license text is in [`src/pet/assets/LICENSE.md`](src/pet/assets/LICENSE.md).

LLM inference via [Groq](https://groq.com) (`openai/gpt-oss-20b` for classification, `openai/gpt-oss-120b` for the starter coach).