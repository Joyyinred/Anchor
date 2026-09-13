# Anchor — the three contracts, v4 

> This file is **what the shipped engine actually does.** Every number below was checked against `src/engine/types.ts`, `detector.ts`, `perceiver.ts` and `src/platform/background/*`. Where the original and the code disagree, the code is stated and the change is marked **(changed)**.
>
> Scope: three contract schemas · exact definitions of the four signals · the two-channel decision · clock base · demo mode · privacy statement.
> Upstream: [`product-plan.md`](product-plan.md), [`division-of-work.md`](division-of-work.md), [README.md § Architecture](../../README.md#architecture).
> ★ This is the single source of truth for the seam between the two people: B's decision half implements §3, A's perception half implements §1–§2.

---

## 1. The four signals, precisely (A — perception half)

### Signal 1: context relevance `contextRelevance` (page level)

- **Definition:** relevance of the current active page (`domain + path + title`, plus the latest chat message on AI-chat sites) to the declared task. **The LLM is asked "is *this page titled X* related to task Z?", never "is youtube.com related?"**
- **Three states:** `RELEVANT` / `IRRELEVANT` / `UNKNOWN`
- **When `UNKNOWN` is produced (red line 1 — conservative until a verdict exists):**
  1. the LLM hasn't returned yet (async + lazy, at most once per page per session)
  2. the LLM failed and neither local list matched
  3. the LLM is low-confidence (e.g. `reddit.com/r/<something topical>`)
- **Short-circuits, highest priority first:**
  1. hit in the **demo preset cache** (§5.2) → return it; **outranks the LLM**
  2. hit in `sessionWhitelist` → `RELEVANT` (domain-level *or* page-level entry, see §2)
  3. `contentFormat === 'short_feed'` → `IRRELEVANT` (judged by shape, no LLM; `/shorts/` on video sites, `/reel/` `/reels/` on facebook)
  4. hit in the built-in entertainment blacklist (pure-entertainment sites only; **not** YouTube / Bilibili and other mixed sites) → `IRRELEVANT`
  5. none of the above → call the LLM (`openai/gpt-oss-20b`, `temperature: 0`)
- **Entry intent:** if `entryIntent === 'purposeful'`, an `UNKNOWN` verdict is not upgraded to `IRRELEVANT`.
- **Cache key:** `domain + pathPattern` (+ the chat snippet on AI-chat sites); known `code` / `docs` sites go through the domain-level whitelist.
- **Decision-half semantics:** only `IRRELEVANT` advances DRIFT; `UNKNOWN` is always conservative.
- **Privacy note:** the full `url + title` of the *current* page only is sent to the LLM; browsing history never leaves the machine. See §5.3.

### Signal 2: anchor detachment `anchorDetachedMs` + anchor matching

- **Definition:** `now − timestamp of the last meaningful interaction with the anchor`.
- **Anchor matching:** `SessionContext.anchor.matchMode` decides whether the current page still counts as the anchor:
  - `'exact'` — strict URL equality (CREATOR / READER default; IDE or document pages)
  - `'prefix'` — path-prefix match (VIEWER lecture series, e.g. `/watch?v=lec*&list=PLcourse` — the whole playlist is the anchor)
- **Meaningful interaction:** `isAnchor === true` (per matchMode) **and** `interactionType ∈ {ACTIVE_INPUT, PASSIVE_SCROLL, MEDIA_PAUSE, MEDIA_SEEK}`.
  - `PASSIVE_SCROLL` resets it: paging through slides or a paper is normal study.
  - `MEDIA_PAUSE` / `MEDIA_SEEK` count: the signature of study-style watching.
  - Answering a check-in in the UI does **not** go through the `SignalEvent` pipeline; B writes `state.lastAnswerTs` directly and it is folded into the `lastAnswerTs` patch of §3.
- **Deliberate asymmetry:** `PASSIVE_SCROLL` resets signal 2 but does *not* upgrade signal 3 to purposeful — scrolling a feed earns no credit. Different weights per signal are the design.
- **Before any anchor interaction:** count from `sessionStart` (the grace period on B's side covers it; A does nothing special).

### Signal 3: interaction texture `texture`

Events on the current active page within the last **120 seconds**. Priority top to bottom:

| Priority | State | Rule |
|---|---|---|
| 1 (highest) | `idle` | no `ACTIVE_INPUT` / `PASSIVE_SCROLL` / `MEDIA_*` in the window |
| 2 | `purposeful` | ≥1 `ACTIVE_INPUT` or `MEDIA_PAUSE` / `MEDIA_SEEK` in the window, **and** if `contextRelevance === 'IRRELEVANT'`, `ACTIVE_INPUT` does **not** upgrade (the CREATOR typing-style-drift fix) |
| 3 (lowest) | `passive` | only `PASSIVE_SCROLL` / uninterrupted `MEDIA_PLAY` with no user action (autoplay zombie) / other events not handled above |

- **Sustained-evidence rule:** the DRIFT channel does not require "the whole window passive" but "**a continuous passive segment ≥ 60 s**". Scroll 15 s → click a video and watch 20 s (`MEDIA_PLAY` → still passive, no user action) → scroll 10 s is one passive-consumption chain even though it is interrupted by playback.
- Cold start (< 2 events in the window): keep the last verdict; initial `idle`.

### Signal 4: jump pattern `jumpPattern`

The last **5 domain switches** (consecutive same-domain collapsed). Priority highest first:

| Priority | State | Rule |
|---|---|---|
| 1 (highest) | `rabbit_hole` | ≥2 **consecutive** switches to IRRELEVANT domains, each stayed on > 10 s (short-stay exemption), with no return to the anchor domain |
| 2 | `task_orbit` | ≤1 IRRELEVANT domain (slip tolerance), all others RELEVANT |
| 3 (lowest) | `stable` | sequence shorter than 3, or ≥1 return to the anchor domain, or neither of the above |

- **Slip tolerance:** one outlier does not break `task_orbit`.
- **10 s short-stay exemption:** a slip is closed within 3 s; nobody leaves a video or a feed within 10 s. (`SHORT_STAY_GRACE_MS` in `perceiver.ts`, scaled in demo mode.)
- With an `UNKNOWN` domain in the sequence: cannot be `rabbit_hole` (conservative); may be `task_orbit` if the IRRELEVANT outlier count is ≤1 and the rest are RELEVANT; otherwise `stable`.
- **Boundary:** `jumpPattern` is one of three DRIFT evidences, never a trigger by itself — a RELEVANT current page vetoes it outright.

### Auxiliary: `stillnessMs`

- Milliseconds of **no interaction at all** on the current page (scrolling and media actions included); any `ACTIVE_INPUT` / `PASSIVE_SCROLL` / `MEDIA_*` resets it; only `HIDDEN` / pure stillness accumulates.
- Used only by the STUCK channel; independent of `anchorDetachedMs` (one is "haven't touched the anchor", the other "haven't touched the current page").

---

## 2. Schemas (the single source for the cross-person seam)

```ts
// ── SignalEvent: collection → perception (A internal; events.json entry) ──
interface SignalEvent {
  timestamp: number;
  domain: string;
  url: string;
  title: string;
  contentKind: 'code' | 'docs' | 'video' | 'short_feed' | 'social_feed'
             | 'article' | 'pdf' | 'ai_chat' | 'music' | 'unknown';
  isAnchor: boolean;
  interactionType: 'ACTIVE_INPUT' | 'PASSIVE_SCROLL' | 'IDLE' | 'HIDDEN'
                 | 'MEDIA_PLAY' | 'MEDIA_PAUSE' | 'MEDIA_SEEK';
  entryIntent: 'search' | 'direct_link' | 'feed' | 'autoplay' | 'unknown';
  systemIdle: boolean;
  contentSnippet?: string; // 09-05: the text the user just typed on the page. Only on listed
                           // AI-chat sites (verified on claude.ai only); undefined everywhere
                           // else. See §5.3.
  tabId?: number;          // 09-11: the tab that produced this event; passed through to
                           // lastAnchorSnapshot.tabId so pull-back.ts can tell whether *that*
                           // tab has itself navigated away. The engine never interprets it.
}

// ── FeatureFrame: perception → decision (the A→B seam) ──
interface FeatureFrame {
  timestamp: number;
  sessionId: string;

  // the four signals
  contextRelevance: 'RELEVANT' | 'IRRELEVANT' | 'UNKNOWN';
  anchorDetachedMs: number;
  texture: 'purposeful' | 'passive' | 'idle';
  jumpPattern: 'task_orbit' | 'rabbit_hole' | 'stable';

  // extended signals
  stillnessMs: number;
  entryIntent: 'purposeful' | 'feed_driven' | 'unknown';
    // A reduces SignalEvent's 5 values to these 3.
    // entryIntent is no longer independent DRIFT evidence — only an accelerator (§3.4).
  contentFormat: 'short_feed' | 'standard';
  mediaPlaying?: boolean;  // 09-11: is the most recent MEDIA_PLAY/MEDIA_PAUSE on this page a
                           // PLAY? STUCK uses it to exempt "quietly watching a video that is
                           // still playing" (a <video> fires `play` once, at the start).

  systemIdle: boolean;
  lastAnchorSnapshot: {
    title: string;
    url: string;
    ts: number;
    tabId?: number;        // 09-11: see SignalEvent.tabId
  };

  // auxiliary
  currentDomain: string;
  currentTitle: string;
  currentContentKind: SignalEvent['contentKind'];
  currentUrl: string;      // 09-11: full URL of the current page; needed for page-level
                           // whitelist entries (below)
}

// ── SessionContext: starter coach → both halves (B writes / A·B read) ──
interface SessionContext {
  sessionId: string;
  taskDeclaration: string;        // quality: ≥ 8 characters; the coach may ask a follow-up (§5.5)
  profile: SessionProfile;
  anchor: {
    domain: string;
    url: string;
    matchMode: 'exact' | 'prefix';
  };
  // sessionWhitelist entries come in two shapes (09-11):
  //   • a bare domain ("example.com") — the original scenario-4 behaviour, matched with
  //     domainMatches() in resolveContextRelevance();
  //   • a pageKey ("domain+path") — used instead when the answered page is on a
  //     MIXED_CONTENT_DOMAIN (youtube / bilibili / reddit / x / twitter / facebook /
  //     pinterest / threads / every AI_CHAT_DOMAIN). See applyCheckInAnswer() in
  //     frame-pipeline.ts.
  // The two shapes can't be confused (a domain never contains "/", a pageKey always does).
  // Why: reproduced on a real device — after whitelisting one YouTube video, every other
  // video on youtube.com (including pure entertainment) was short-circuited RELEVANT for the
  // rest of the session.
  sessionWhitelist: string[];
  graceUntil: number;             // consumed only by B as a shared gate; A ignores it
}

interface SessionProfile {
  archetype: 'CREATOR' | 'READER' | 'VIEWER' | 'COMMUNICATOR' | 'CUSTOM';
  policy: SignalPolicy;
}

interface SignalPolicy {
  muteJumpPattern: boolean;
  mutePassiveTexture: boolean;
  stuckChannelEnabled: boolean;
  anchorDetachedThresholdMs: number;
  stuckLadderMs: number[];         // validated: must be non-empty (except VIEWER, which disables STUCK)
}

// SignalPolicy validator (src/engine/types.ts)
function validatePolicy(p: SignalPolicy): SignalPolicy {
  if (p.stuckLadderMs.length === 0) p.stuckLadderMs = [...DEFAULT_STUCK_LADDER];
  if (p.anchorDetachedThresholdMs <= 0) p.anchorDetachedThresholdMs = DEFAULT_ANCHOR_THRESHOLD;
  return p;
}
const DEFAULT_STUCK_LADDER = [10 * 60_000, 20 * 60_000];
const DEFAULT_ANCHOR_THRESHOLD = 8 * 60_000;
```

### The three presets (as shipped — `PROFILE_PRESETS` in `src/engine/types.ts`)

| Policy item | CREATOR | READER | VIEWER |
|---|---|---|---|
| muteJumpPattern | ✅ | ❌ | ❌ |
| mutePassiveTexture | ❌ | ❌ | ✅ |
| stuckChannelEnabled | ✅ | ✅ | ❌ |
| anchorDetachedThresholdMs | **5 min** (necessary condition) **(changed** from 8**)** | 8 min (necessary condition) | 20 min (demoted to sufficient condition) |
| stuckLadderMs | **[15 min, 20 min]** | [10 min, 20 min] | — |
| anchor.matchMode | exact | exact | prefix |

> CREATOR `stuckLadderMs` was `[15, 30, ∞]` in v3; v4 made it `[15, 20]` — no budget, no ∞ mute. After the second "still on track" the threshold is fixed at 20 min (even focused people drift late in a session; a screen that hasn't moved for 20 minutes is not the norm).
> CREATOR's anchor threshold was lowered 8 → 5 min on 08-30. Blacklisted pages now take a separate 15 s fast lane (§3.4), so this general threshold only governs the less certain case — "the LLM said IRRELEVANT but the site isn't on the static blacklist." 3 min felt aggressive for a borderline classifier verdict; 5 min keeps a buffer while being much faster than 8.
> **Phase one runs everyone on CREATOR.** Tutorial-following is approximated by CREATOR; `CUSTOM` combinations are phase two.

### Default strategy without a starter coach

If no `SessionContext` exists (the user skipped the coach):

- profile = **CREATOR** with the default policy above
- anchor = **the tab with the longest active time** (inferred after the first two switches)
- graceUntil = **2 minutes**
- the pet nudges softly — *"Want me to be more useful? Tell me what you're working on."* — without blocking work

---

## 3. The decision (B — decision half)

### 3.1 Clock base and frame production

**When frames are produced:**

```
event-driven:  every SignalEvent → one frame immediately
heartbeat:     if events go quiet for > 60 s, chrome.alarms produces a frame (minimum period 1 min)
               → the alarm recomputes every signal from "latest frame + now" and emits a new frame
```

**Clock base:**

- absolute time source: `Date.now()` (the browser clock; survives service-worker recycling)
- relative timers (`anchorDetachedMs` / `stillnessMs`) derive from stored `lastXxxTs` timestamps
- **Persistence across service-worker restarts:** every timestamp the decision depends on lives in `chrome.storage.local` and is re-hydrated on wake.

```ts
// B-side persisted state (as shipped)
interface BStatePersistable {
  stuckThresholdMs: number;
  stuckLadderIndex: number;
  lastCheckInTs: number;
  lastAnswerTs: number;
  restUntil: number;        // RESTING_INDEFINITELY while resting, -Infinity otherwise
  restStartTs: number;      // 09-11: when the current rest began (reminder cadence)
  restEndedTs: number;      // 09-11: when the last rest ended (STUCK baseline)
  restSnoozedUntil: number; // 09-11: "5 more minutes" on the rest reminder
  checkinCooldownMs: number;// 09-11: 5 min normally, 2 min after a confirmed drift
}
// storage key: 'anchor_bstate_{sessionId}' → chrome.storage.local
```

**A hard fact about `chrome.storage.local`:** it is JSON. `Infinity`, `-Infinity`, `NaN` and `undefined` do not survive the round trip — `Infinity` comes back as `null`. Two consequences in the code:

- "resting until told otherwise" is `RESTING_INDEFINITELY = Number.MAX_SAFE_INTEGER`, not `Infinity` (09-11; before this, a rest silently ended whenever the worker was recycled).
- hydration in `frame-pipeline.ts` normalises `lastCheckInTs / lastAnswerTs / restUntil / restStartTs ?? -Infinity`.

**Sustainers after a worker restart:** `sustainer.since` is *not* persisted. A recycled worker means no frames in between; on the next frame the cooldown is re-evaluated from `now − lastCheckInTs` and the sustainer restarts from that frame. "Worker recycled + cooldown just ended" can therefore cost one extra 30 s window — **a known limitation, not a bug.**

### 3.2 Demo-mode time compression

```ts
// Every time constant is compressed by DEMO_TIME_SCALE in demo mode.
// 09-11: 120× → 30×. At 120× most thresholds fell under a second and the demo could not be
// narrated; at 30× the key beats land at 10–30 s — long enough to say a sentence, short
// enough not to wait minutes. The one canonical definition is DEMO_TIME_SCALE in
// src/engine/types.ts; everything goes through scaled().
const DEMO_TIME_SCALE = 1 / 30;
const scaled = (ms: number, isDemoMode: boolean) => isDemoMode ? ms * DEMO_TIME_SCALE : ms;

// Key thresholds after compression (CREATOR):
//   anchorDetachedThresholdMs  5 min  →  10 s
//   stuckLadderMs[0]          15 min  →  30 s
//   SUSTAINED_EVIDENCE_MS       30 s  →   1 s
//   CHECKIN_COOLDOWN_MS        5 min  →  10 s
//   graceUntil                 2 min  →   4 s
//   rest reminder: first at 15 min → 30 s; then every 5 min → 10 s
//   (the rest window itself no longer expires — §3.8 — so it is not a scaled constant)
// isDemoMode comes from the chrome.storage.local flag `anchor_demo_mode`.
```

### 3.3 Shared gates and sustainers

```ts
const SUSTAINED_EVIDENCE_MS = scaled(30_000);
const CHECKIN_COOLDOWN_MS         = 5 * 60_000;  // after "still on track" / "this counts as work"
const DRIFTED_CHECKIN_COOLDOWN_MS = 2 * 60_000;  // after "drifted" — (changed) 09-11: a confirmed
                                                 // drift shouldn't buy five quiet minutes
// no CHECKIN_BUDGET_MAX since v4

interface EvidenceSustainer { since: number | null; }
function sustained(s: EvidenceSustainer, evidence: boolean, now: number): boolean {
  if (!evidence) { s.since = null; return false; }
  if (s.since === null) s.since = now;
  return now - s.since >= SUSTAINED_EVIDENCE_MS;
}
// accelerator: a shorter window when the page was reached feed-driven
function sustainedWithWindow(s: EvidenceSustainer, ev: boolean, now: number, win: number): boolean {
  if (!ev) { s.since = null; return false; }
  if (s.since === null) s.since = now;
  return now - s.since >= win;
}
// (as shipped) every early-exit path in the channels goes through silence(sustainer), which
// resets `since` — a bare `return false` would leave stale evidence to fire on the next frame.
```

### 3.4 Channel one: DRIFT

```ts
function isDrifting(f: FeatureFrame, p: SignalPolicy, ctx: SessionContext, state: BState): boolean {
  if (state.restUntil > now) return silence(state.driftSustainer);
  if (now - state.lastCheckInTs < state.checkinCooldownMs) return silence(state.driftSustainer);
  if (now < ctx.graceUntil) return silence(state.driftSustainer);

  // 1. shape rule: Shorts + anchor abandoned (still goes through the sustainer)
  if (f.contentFormat === 'short_feed'
      && f.anchorDetachedMs > p.anchorDetachedThresholdMs) {
    return sustained(state.driftSustainer, true, now);
  }

  // 2. (changed) 08-30 blacklist fast lane: a page on the built-in entertainment blacklist is
  //    a high-confidence IRRELEVANT, unlike an LLM verdict. It waits only 15 s of anchor
  //    detachment instead of the profile threshold — but still the full 30 s sustained
  //    window, so a slip or a redirect page cannot fire it. Checked via f.contextRelevance,
  //    not the domain table alone, so a page the user has whitelisted is respected.
  const BLACKLIST_ANCHOR_DETACHED_THRESHOLD_MS = scaled(15_000);
  if (f.contextRelevance === 'IRRELEVANT' && isBuiltinBlacklisted(f.currentDomain)
      && f.anchorDetachedMs > BLACKLIST_ANCHOR_DETACHED_THRESHOLD_MS) {
    return sustained(state.driftSustainer, true, now);
  }

  if (f.contextRelevance !== 'IRRELEVANT') {
    return sustained(state.driftSustainer, false, now);
  }

  const anchorAbandoned = f.anchorDetachedMs > p.anchorDetachedThresholdMs;

  // 3. texture: a continuous *non-purposeful* segment ≥ 60 s (passive or idle — (changed):
  //    the original said passive only; an idle stare at an irrelevant page is disengaged too)
  const textureEvidence = !p.mutePassiveTexture
    && isContinuouslyDisengaged(state, f, now, scaled(60_000));

  const jumpEvidence = !p.muteJumpPattern && f.jumpPattern === 'rabbit_hole';

  // entryIntent is an accelerator, not evidence
  const evidenceWindowMs = (f.entryIntent === 'feed_driven')
    ? scaled(15_000) : SUSTAINED_EVIDENCE_MS;

  const evidence = anchorAbandoned
    ? (textureEvidence || jumpEvidence)
    : (p.mutePassiveTexture && f.entryIntent === 'feed_driven');  // VIEWER demotion

  return sustainedWithWindow(state.driftSustainer, evidence, now, evidenceWindowMs);
}

function isContinuouslyDisengaged(state: BState, f: FeatureFrame, now: number, threshold: number): boolean {
  if (f.texture === 'purposeful') { state.passiveSince = null; return false; }
  if (state.passiveSince === null) state.passiveSince = now;
  return now - state.passiveSince >= threshold;
}
```

### 3.5 Channel two: STUCK

```ts
function isStuck(f: FeatureFrame, p: SignalPolicy, ctx: SessionContext, state: BState): boolean {
  if (state.restUntil > now) return silence(state.stuckSustainer);
  if (now - state.lastCheckInTs < state.checkinCooldownMs) return silence(state.stuckSustainer);
  if (now < ctx.graceUntil) return silence(state.stuckSustainer);

  if (!p.stuckChannelEnabled) return silence(state.stuckSustainer);
  if (f.systemIdle) return silence(state.stuckSustainer);
  if (f.texture !== 'idle') return silence(state.stuckSustainer);
  if (f.contextRelevance === 'IRRELEVANT') return silence(state.stuckSustainer);
  if (f.contentFormat === 'short_feed') return silence(state.stuckSustainer);
  if (f.mediaPlaying) return silence(state.stuckSustainer);   // (changed) 09-11: watching a
                                                              // playing video is not "stuck"

  // (changed) 09-11: the baseline is the later of "last answer" and "last rest ended", so
  // stillness accumulated while resting is not counted as being stuck
  const baseline = Math.max(state.lastAnswerTs, state.restEndedTs);
  const effectiveStillnessMs = Math.min(f.stillnessMs, now - baseline);
  return sustained(state.stuckSustainer, effectiveStillnessMs > state.stuckThresholdMs, now);
}
```

### 3.6 The STUCK ladder

```
initial = policy.stuckLadderMs[0]
  answer "deep in thought" → advance to stuckLadderMs[1] (terminal, never changes again)
  answer "drifted"         → micro-restart + reset to [0]
no ∞ mute: CREATOR 15 → 20 min, READER 10 → 20 min
```

### 3.7 Sustainer reset after a cooldown

```ts
function onCooldownEnd(state: BState): void {
  state.driftSustainer.since = null;
  state.stuckSustainer.since = null;
  state.passiveSince = null;
}
// (as shipped) implemented as discardEvidenceFromBeforeCheckIn(): evidence that accumulated
// before the check-in never carries across it.
```

### 3.8 Rest mode

```ts
interface RestState { restUntil: number; restStartTs: number; restEndedTs: number; restSnoozedUntil: number; }
// "Take a break" → restUntil = RESTING_INDEFINITELY
//   (changed) 09-11: it used to be now + 20 min with automatic resumption. On a real device
//   in demo mode that window compressed to 10 s — monitoring quietly resumed before the user
//   had actually rested. Now a rest never expires on its own.
// Both channels are silent throughout; A keeps reporting frames.
// After 15 min (from restStartTs): a soft reminder — "Rested enough? Ready to get back?"
// Then every 5 min until the user returns. "5 more minutes" sets restSnoozedUntil.
// The only way out is the user clicking "Back to it": restUntil → -Infinity, restEndedTs = now.
// restEndedTs feeds the STUCK baseline (§3.5): stillness accumulated during the rest is
// subtracted from the "stuck" evidence.
```

### 3.9 `DetectionResult`

```ts
interface DetectionResult {
  action: 'DO_NOTHING' | 'CHECK_IN_DRIFT' | 'CHECK_IN_STUCK';
  lastAnchorSnapshot?: FeatureFrame['lastAnchorSnapshot'];  // the check-in wording's data source
  currentTitle: string;
}
```

### 3.10 Check-in feedback (as shipped)

| Button | Meaning | Effect |
|---|---|---|
| *Still on track* (DRIFT) / *Deep in thought* (STUCK) | `FOCUSED` | evidence discarded; cooldown 5 min; STUCK ladder advances one rung |
| *This counts as work* (DRIFT) | `FALSE_POSITIVE` | page (or domain) added to `sessionWhitelist`; cooldown 5 min |
| *Drifted — pull me back* | `DRIFTED` | `chrome.tabs.update` to `lastAnchorSnapshot.tabId` (or a tab matching its URL); STUCK ladder resets; cooldown **2 min** |

---

## 4. Scenario acceptance table (Day 5 merge + v4 additions)

### The original 14 (v0, kept as regression)

| # | Scenario | Profile | Key `FeatureFrame` | Action |
|---|---|---|---|---|
| 1 | rapid IDE↔docs↔AI↔SO switching | CREATOR | RELEVANT, task_orbit | DO_NOTHING |
| 2 | same paper 20 min (STUCK already terminal) | READER | RELEVANT, idle | DO_NOTHING |
| 3 | YouTube entertainment + anchor 10 min + passive | CREATOR | IRRELEVANT, detached > threshold | **CHECK_IN_DRIFT** |
| 4 | answer "counts as work" → whitelist | CREATOR | RELEVANT (short-circuit) | DO_NOTHING |
| 5 | irrelevant domain in the first 2 min | any | graceUntil not reached | DO_NOTHING |
| 6 | paper, still for 10 min | READER | idle, still > 10 min | **CHECK_IN_STUCK** |
| 7 | answer "deep in thought" → threshold 20; at 15 min | READER | still ≈ 15 min < 20 | DO_NOTHING |
| 8 | YouTube tutorial via search + pause/seek | CREATOR | RELEVANT, purposeful | DO_NOTHING |
| 9 | YouTube home autoplay + anchor 12 min | CREATOR | IRRELEVANT | **CHECK_IN_DRIFT** |
| 10 | Shorts feed + anchor abandoned | any | short_feed, IRRELEVANT | **CHECK_IN_DRIFT** |
| 11 | lecture, 40 min continuous | VIEWER | RELEVANT | DO_NOTHING |
| 12 | lecture autoplay flips to unrelated | VIEWER | IRRELEVANT, feed_driven | **CHECK_IN_DRIFT** |
| 13 | coding along with a tutorial: video ↔ IDE | CREATOR | RELEVANT, task_orbit | DO_NOTHING |
| 14 | CREATOR still 12 min → 16 min | CREATOR | idle, still 12 → 16 min | 12: NO; 16: STUCK |

### v4 additions

| # | Scenario | Key | Action |
|---|---|---|---|
| 15 | reading slides by scrolling | anchorDetachedMs resets on scroll | DO_NOTHING |
| 16 | lecture series autoplay 5 → 6 | anchor prefix match, no accumulation | DO_NOTHING |
| 17 | answered "drifted" → micro-restart in progress | lastAnswerTs + sustainer + cooldown, triple safety | DO_NOTHING |
| 18 | user takes a break | restUntil hard gate | both channels silent |
| 19 | offline: a Zhihu thread | UNKNOWN (conservative) | DO_NOTHING |
| 20 | slip into YouTube, back in 3 s | task_orbit + short-stay exemption | DO_NOTHING |
| **21** | **CREATOR typing-style drift: 10 min chatting on WeChat web** | **ACTIVE_INPUT on an IRRELEVANT page does not upgrade to purposeful** | **CHECK_IN_DRIFT** |
| **22** | **no starter coach** | **inferred anchor + CREATOR default** | **basic companionship works** |
| **23** | **rest, nobody answers: reminder at 15, 20, 25 min** | **every 5 min** | **soft reminder** |
| **24** | **demo mode: YouTube entertainment** | **30× compression** | **CHECK_IN_DRIFT in ≈ 11 s** |

### Added after v4 (regression tests in `src/engine/`)

| Scenario | Test file | Why it exists |
|---|---|---|
| Observing state goes stale when the sustainer is silenced | `observing-stale.test.ts` | the pet stayed in "observing" after evidence had been cleared |
| Rest survives a service-worker restart | `rest-persistence.test.ts` | `Infinity` → `null` through storage ended rests silently |
| Rest + STUCK baseline | `detector.test.ts` | a 20-min rest immediately counted as 20 min stuck |
| Video still playing is not STUCK | `detector.test.ts` | `play` fires once; silence ≠ paused |
| Page-level whitelist on mixed-content sites | `frame-pipeline` tests | one whitelisted video whitelisted all of YouTube |

---

## 5. Additional notes

### 5.1 Known limitations (phase one, stated openly)

- **Multiple windows:** a single anchor only. A two-screen setup (IDE + docs) isn't covered — **acknowledged; first priority for phase two** (plan: an `anchorSet[]`, any hit resets).
- **`entryIntent` is unreliable:** `webNavigation.transitionType` isn't available for SPA navigation — hence demoted to an accelerator, never primary evidence.
- **LLM misclassification:** the user has to appeal once to get a page whitelisted — phase two could show a confirmation button on low confidence instead of interrupting.
- **Service-worker recycling:** sustainers aren't persisted (§3.1) — one extra window after a cooldown.
- **Pull-back with a single tab:** if the user drifted *within* the anchor tab (navigated away rather than switching tabs), "pull me back" has nothing to switch to. Known; deferred.
- **AI-chat snippet selectors:** verified on claude.ai only. On the other listed sites the extractor most likely returns nothing (which is harmless — the page just isn't snippet-aware).

### 5.2 Demo preset classification cache (as shipped)

```ts
// Outranks the LLM and the blacklist; below sessionWhitelist and the Shorts shape rule.
const DEMO_PRESET_CACHE: Record<string, 'RELEVANT' | 'IRRELEVANT'> = {
  'vscode.dev': 'RELEVANT',
  'react.dev': 'RELEVANT',
  'stackoverflow.com': 'RELEVANT',
  'github.com': 'RELEVANT',
  'docs.google.com': 'RELEVANT',
  'arxiv.org': 'RELEVANT',
  'scholar.google.com': 'RELEVANT',
  'coursera.org': 'RELEVANT',
  'weibo.com': 'IRRELEVANT',
};
// (changed) claude.ai / chat.openai.com were removed from the preset on 09-05: once the
// classifier reads the latest chat message, an AI-chat site must be judged per message,
// not pinned RELEVANT.
// YouTube / Bilibili and other "study + entertainment" sites are deliberately absent.
// Scenario 3 (YouTube drift) vs scenario 8 (YouTube tutorial) is decided by content-level
// LLM classification. Offline → YouTube is UNKNOWN → no false trigger (conservative).
```

### 5.3 Privacy statement

- **Sent to the LLM:** the current active page's full `url` + `title` + `taskDeclaration` (for classification only); the task sentence and the open page's title/URL for the starter coach.
- **On listed AI-chat sites only** (`AI_CHAT_DOMAINS` in `src/platform/background/heuristics.ts`: claude.ai, chatgpt.com / chat.openai.com, gemini.google.com, grok.com, perplexity.ai, copilot.microsoft.com, chat.deepseek.com, poe.com): the **most recent message** the user sent (truncated to ~200 characters), so the classifier can tell whether the *conversation* is still on task — **not the chat history**, just that one message. On by default, no toggle (product decision, 09-05). Reason: these sites' tab titles don't reliably change per turn, so a drifting conversation was undetectable from the title alone (reproduced: three unrelated questions in a row, title unchanged). Other domains are unaffected; the field is always empty for them. ★ Selectors are verified on claude.ai only; on the others the feature most likely silently returns nothing until verified.
- **Never sent:** browsing history, any page other than the current one, identity, page input (outside the one case above).
- **Storage:** all session data in `chrome.storage.local` (on this machine).
- **No server of ours:** nothing leaves the browser sandbox except the LLM API call.
- **For the judges:** *"We don't even have a server that could receive your browsing history — because there is no server."* If asked whether we read what the user types: **answer honestly** — only the latest message, only on the listed AI-chat sites, never the full conversation, never other sites.

### 5.4 Metrics

| Metric | Definition | Scope |
|---|---|---|
| False-positive rate | check-ins answered "still on track" / "counts as work" ÷ total check-ins | per session |
| Miss rate | self-reported "I drifted and it didn't notice" ÷ self-reported drifts | phase two (needs user feedback) |
| Cache hit rate | classification requests served from cache ÷ total | A-side counter |
| Starter-coach quality | 16 fixed tasks × 12 mechanical checks + action-shape distribution (`evals/`) | per prompt version, run against Groq |

### 5.5 `taskDeclaration` quality (as shipped)

- `taskDeclaration.length >= 8` (`MIN_TASK_DECLARATION_LENGTH`; "study" doesn't qualify).
- If shorter, the coach asks *"Can you be more specific? e.g. 'prepare for tomorrow's data structures exam'"* — at most `MAX_FOLLOWUP_ROUNDS = 2` rounds, then the input is accepted (never get stuck).
- A **semantic** quality check (is the task specific enough to judge pages against?) runs only on the first round (`roundsUsed === 0`); later rounds are length-gated only.
- The coach receives `anchorContext = { title, url }` of the page open at declaration time, so the first step can be *"press play on the video you have open"* rather than *"search for a lecture."* A `hasFabricatedSpecific()` guard rejects answers that invent a specific the user never mentioned.

---

## 6. Mocks

- `src/mock/events.json` — A-side `SignalEvent` streams (24 scenarios; `systemIdle` passthrough, `matchMode` examples, scenarios 21–24)
- `src/mock/frames.json` — B-side expected `FeatureFrame`s (co-authored; fields per §2)
