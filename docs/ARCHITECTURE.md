# Anchor · Architecture on one page

Anchor is **not** an app with a server behind it. It is a **Chrome extension** — a small program that lives inside your browser, with almost all of its code running on your own machine. The only thing that ever leaves the machine is an occasional question to a cloud LLM: *"is this page related to the task?"* and, once per session, *"what is one physical first step for this task?"*

---

## 1. The big picture: it all runs on your computer

![Overview](arch-1-overview.en.svg)

The grey box on the left is your computer. Everything inside it — the page you're reading, the Anchor extension itself — runs locally. **There is no server of ours anywhere.** The cloud on the right is the one thing outside the machine: an LLM served by Groq (`openai/gpt-oss-20b` for classification, `openai/gpt-oss-120b` for the starter coach). The extension sends it a page title, a URL and your task sentence. Nothing else.

> **Privacy, in one sentence:** your browsing history never goes anywhere, because there is no "our server" for it to go to. Full statement in [`contract-v4.md` §5.3](contract-v4.md#53-privacy-statement).

---

## 2. Inside the extension: six parts

A Manifest V3 extension is not one blob; it's several parts with separate jobs.

![Anatomy](arch-2-anatomy.en.svg)

- **`manifest.json`** — a plain-text registration form: *"I have these parts, I need these permissions."* It does no work.
- **Service worker** (`src/platform/background/`) — the brain. Both halves of the engine run here. One hard fact about it: **Chrome puts it to sleep after ~30 seconds of idle and wakes it on demand.** Every piece of state that matters is written to `chrome.storage.local` and re-hydrated on wake. (We got bitten by this once: `Infinity` doesn't survive JSON serialization, so "resting until you say otherwise" silently became "resting until the worker was recycled". See [`contract-v4.md` §3.8](contract-v4.md#38-rest-mode).)
- **Content script** (`src/platform/content/`) — a small script injected into every page you visit. It does three things: reports keystrokes / scrolling / video play-pause to the brain (the *texture* signal), extracts your latest message on AI-chat sites, and **mounts the floating cat**.
- **The floating pet** — a Shadow DOM island on the host page. Draggable, remembers its position across sites, and clicks pass straight through to the page everywhere the cat isn't standing. Its visibility properties are pinned with inline `!important`, because host pages *will* try to hide it.
- **Side panel** (`src/sidepanel/`) — the same React tree, rendered in Chrome's side panel. Kept as a fallback for pages an extension can't inject into (`chrome://`, the Web Store, PDFs).
- **`chrome.tabs` / `chrome.idle` / `chrome.alarms` / `chrome.storage.local`** — browser-provided: which tab is active, whether the system is idle, a one-minute heartbeat that also keeps the worker alive, and a local key-value store that survives restarts.

---

## 3. The stack, layer by layer

![Stack](arch-3-stack.en.svg)

- **TypeScript.** JavaScript is the only language a browser speaks; TypeScript is JavaScript with type labels. The contract's `interface`s *are* those labels — pass the wrong field and the compiler refuses.
- **Why the two engine halves are "pure TypeScript".** Perception (`src/engine/perceiver.ts`) and decision (`src/engine/detector.ts`) deliberately touch no Chrome API. They are data in, data out. That is what makes them testable outside a browser — **316 unit tests replay recorded signal streams** — and what let two people build the two halves in parallel and join them without surprises.
- **React + CSS + Lottie.** The pet, the check-in bubble, the onboarding form and the session summary are React components. Styling is plain CSS (no Tailwind, no component library — we wanted every pixel to be ours). The cat is a Lottie animation, rendered with the `lottie_light` build because MV3's CSP forbids the `eval()` the full build uses.
- **A hand-written state machine** (`src/engine/pet-state.ts`) for the three moods — companion / observing / check-in. We planned XState; a 100-line function turned out to be clearer.
- **Groq API.** Two calls, two models, both with local fallbacks:
  - *Relevance classifier* — `gpt-oss-20b`, `temperature: 0`, cached per page + title + latest chat message.
  - *Starter coach* — `gpt-oss-120b`, given the task sentence **and the page you currently have open**.
- **Vite + `@crxjs/vite-plugin`.** Compiles the source into files Chrome can load. `npm run build` → `dist/` → *Load unpacked*. No store listing, no server, one minute.

---

## 4. What each feature actually relies on

| What you see | How it works | Built with |
|---|---|---|
| It knows which page you're on | Tab activation / navigation events | `chrome.tabs`, `chrome.webNavigation` |
| It knows you've walked away | System idle state | `chrome.idle` |
| It knows whether you're typing or scrolling | Content script listens to the page | Content script + Page Visibility |
| It decides whether a page is relevant | Domain + path + title (+ your latest chat message on AI sites) → LLM → cached | Groq `gpt-oss-20b` + `storage.local` |
| "How long since you touched the anchor" | A timestamp in the perception half, reset on real interaction | Pure TypeScript |
| Whether to speak at all | Two channels (DRIFT / STUCK), each needing 30 s of sustained evidence, gated by cooldown, grace period and rest | Pure TypeScript (`detector.ts`) |
| A check-in that sounds like a friend | Templated wording with variant rotation, regex-tested against lecturing words | Pure TypeScript (`wording.ts`) — **not** an LLM |
| "Pull me back" actually switching tabs | `chrome.tabs.update` on the tab the anchor snapshot came from | `chrome.tabs` |
| One physical first step to start | One LLM call with the task + open page; falls back to a fixed step | Groq `gpt-oss-120b` |
| The cat's three moods | State machine over the evidence sustainers | `pet-state.ts` + CSS |
| "This counts as work" is remembered | Written to the session whitelist (per-page on mixed-content sites like YouTube) | `storage.local` |
| Still sane when offline | Built-in entertainment blacklist; everything else stays `UNKNOWN` | A constant table |
| Prompt changes are measured, not eyeballed | 16 fixed tasks, 12 mechanical checks, action-shape distribution | `evals/` (Groq, not part of `npm test`) |

---

## 5. Where it runs · how to install · who owns which layer

**Where:** everything except the LLM call runs inside the browser sandbox; all data stays on the machine.
**Install:** `npm run build`, then *Load unpacked* on the `dist/` folder. Publishing to the Chrome Web Store is a distribution concern, not a demo concern.
**One honest caveat:** calling Groq directly from an extension exposes the API key on the client. A shipped product would put a tiny relay in front of it. For a hackathon, the key lives in `chrome.storage.local` and the user pastes it in themselves — and **the extension works without one**.

**Two people, one seam:**

- **A — perception + signals + platform** owns the bottom three layers: browser APIs, signal collection, the perception half, plus the service-worker lifecycle and permissions.
- **B — decision + dialogue + presentation** owns the top two: the decision half, all wording, the pet, the floating host, the starter coach.
- The line between them is one typed object, **`FeatureFrame`**. It is the only interface the two halves share, and the contract document ([`contract-v4.md`](contract-v4.md)) is what both are held to.

Read the stack diagram bottom-to-top and you've traced one drift, from *being noticed* to *being pulled back*.
