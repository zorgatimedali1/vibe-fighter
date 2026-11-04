# Voxel Fighter — product analysis & feature roadmap

Status of this document: written after the engine/animation pass (guard rework, per-fighter spells,
six bot tiers, per-fighter animation styles). It is a plan, not a promise: estimates assume one
experienced developer and are in **dev-days** (multiply by 1.6 for solo part-time).

## 0. Shipped since the first draft (depth pass)

The "the game is too simple" pass landed these, ahead of the roadmap below:

| Was | Where it lives now | Status |
| --- | --- | --- |
| Overdrive meter + EX spell per fighter (E1) | `server/src/engine/moves.ts` (`OVERDRIVES`), `CombatRoom.ts`, HUD gold bar, `E` | ✅ done |
| Perfect guard / parry (E5) | 3-frame fresh tap; no guard cost, no blockstun, +6 Overdrive | ✅ done |
| Throw tech (E2) | grab vs grab cancels with pushback | ✅ done |
| Light chains (`J → K → I`) | `canCancel` gatlings | ✅ done |
| Training room (B1 + B2 + B3) | `mode: 'training'` room, `client/src/ui/Training.ts`, input history, frame readout | ✅ done |
| Ping + difficulty in the HUD | `NetcodeClient.pingMs`, `.ping`, stage tag | ✅ done |
| Input queue bug: presses arriving late after every hitstop | queue drained during hitstop, presses latched | ✅ fixed |
| Round timer stopping during hitstop | clock ticks on real ticks | ✅ fixed |
| Neon-dusk backdrops → MK/SF-style arenas (F-pillar, unplanned) | `client/src/stage/Stages.ts` rewritten: Suzaku Castle, The Pit, Goro's Lair, Air Force Base, Monastery Courtyard, Temple of the Sun | ✅ done |
| X account login (A1-ish, social) | `server/src/auth/x.ts` + `session.ts`, `/#session=` fragment, mock login for local dev | ✅ done |
| Matchmaking queue (C1/C2) | `server/src/matchmaker.ts`, `queue:*` socket events, server-created rooms, live search/cancel UI | ✅ done |
| Points + ladder + leaderboard (D1/D2) | `server/src/rating.ts` (Elo + LP), `db.ts` (SQLite, idempotent settlement), Ladder tab, `/api/leaderboard` | ✅ done |

Consequence for the ordering: Phase 3 (depth) is now **wakeups, juggles, second fighter**, and Phase 1
is **accounts + history + tutorial** (the training room covers the lab, not the first five minutes).

---

## 1. What the game is today

| System | State | Notes |
| --- | --- | --- |
| Match core | **Solid** | 60 Hz server-authoritative loop, frame-data state machine, AABB hit/hurt boxes, 60-tick lag-comp, trades/clashes, best-of-3, reconnect grace, input sanitation (`server/src/engine/CombatRoom.ts`) |
| Netcode | **Good enough** | Server tick + client prediction/reconciliation, 30 Hz snapshots, RTT probe; no rollback and none needed for a 2.5D fighter at this cadence |
| Roster | **5 fighters** | Shared normals, one exclusive spell each, distinct palettes/stances/spell VFX |
| Stages | **6 themes** | Procedural, seeded from match id + fighter pair (`client/src/stage/Stages.ts`) |
| Art | **100% procedural** | Box fighters + 26 clips, no asset pipeline (`ProceduralFighter.ts`); optional GLB path |
| Audio | **Minimal** | ~7 synthesized SFX, no music, no VO (`client/src/audio/Sfx.ts`) |
| Modes | **2** | Practice vs 6 bot tiers, and room-code PvP |
| Identity | **None** | Guest ids in `sessionStorage`; profile in `localStorage` (`client/src/ui/profile.ts`) |
| Persistence | **None** | Rooms live in a `Map`; restart loses everything; no match history |
| Matchmaking | **None** | Hand-shared 6-char codes only |
| Progression | **Cosmetic** | Level/XP derived from local wins, nothing unlockable |
| Money | **Stubbed** | Escrow addresses are placeholders; dev mode only (`client/src/Web3Hud.ts`) |
| Ops | **Single process** | Console logs only, no metrics, no graceful shutdown, no CI |
| Platforms | **Desktop** | Keyboard + gamepad; no touch, no PWA |

**Honest summary:** the *engine* is ahead of the *game around it*. What exists is an excellent
vertical slice — the part that is hardest to build is done and tested. What is missing is the
product loop that turns a slice into something people come back to.

---

## 2. The idea, and where it is strong / weak

**The pitch (as written):** instant-play browser 1v1 fighter, best-of-3, one signature spell per
fighter, $1 on-chain stakes, free practice mode.

### Strong
- **Zero friction.** No download, no install, no wallet for practice. This is the single biggest
  advantage over Steam fighters — use it, don't bury it.
- **60 Hz authoritative netcode with lag compensation** is genuinely rare in a browser game.
- **Procedural art** means content is cheap to produce: a new fighter is code, not a $3k art order.
- **Micro-stakes** is a real hook for a niche audience, and the server-signed result flow already
  exists in skeleton form.
- **Distinct identity.** Voxel/N64 toy-box look + arcade-flyer UI is memorable in a genre full of
  anime fighters.

### Weak / risky
1. **The staking layer is the least trustworthy part of the stack.** No accounts, no persistence,
   no anti-collusion, placeholder contract, no dispute path, no KYC/jurisdiction story. Real money
   is a *liability* until identity and history exist — one contested settlement kills the product.
2. **Asymmetric spells vs "fair wager".** The README still claims every fighter is identical for
   fairness, but spells now differ (that was the request). Money and asymmetry need an explicit
   policy: mirror-only for staked matches, or pick/ban, or equalise spells again.
3. **No onboarding.** A brand-new player versus even the Normal bot loses without learning why.
   There is no tutorial, no training room, no frame data, no "you got punished because X" feedback.
4. **No reason to return.** No ladder, no quests, no unlocks, no seasons, no friends. One session
   is the whole product.
5. **Mechanical depth is thin.** One spell, no super meter, no throw tech, no wakeup options, no
   juggles, no parry. After ~30 minutes a player has seen everything the combat can do.
6. **Brand confusion.** "Voxel Fighter" vs "VIBE FIGHTER", escrow domain `VoxelFighterEscrow`,
   two READMEs (the root one is stale). Pick one name before marketing.
7. **Single-process ops.** Every live match dies with a deploy or crash; no horizontal scale.

### The strategic choice (the one decision that shapes everything else)

| Direction | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **A. Casual arcade** (party fighter, cosmetics, mobile) | Widest audience, cheapest to sustain, no legal risk | Lower ARPU, needs content cadence | Good fallback |
| **B. Competitive ladder** (ranked, seasons, training tools) | Deep retention, natural reason to improve, staking fits later | Hardest to balance, needs a critical mass of players | **Recommended primary** |
| **C. Wager-first** (money as the hook) | Sharp differentiator, clear revenue | Legal/compliance heavy, attracts cheaters/colluders, needs trust before scale | **Gate behind A/B** — never the launch feature |

**Recommendation:** build **B**, keep **A** as the on-ramp (free, mobile-friendly), and treat **C**
as a *later premium mode* unlocked by accounts + ladder + history. Ship fun first; money is a
feature of trust, not a feature of the engine.

---

## 3. North-star metrics (instrument before optimising)

| Metric | Why | Target by end of Phase 2 |
| --- | --- | --- |
| Tutorial completion | Is onboarding working? | ≥ 70% of new players |
| First-match completion | Does the client survive? | ≥ 85% |
| D1 / D7 return | Retention | D1 ≥ 25%, D7 ≥ 8% |
| Matches per session | Fun / loop | ≥ 3 |
| Median queue time | Matchmaking health | < 45 s |
| Rematch rate | Quality of matchmaking | ≥ 20% |
| Guard-break events per match | Is the new depth being used? | 1–3 |
| Crash-free sessions | Ops | ≥ 99.5% |

Everything below assumes these are wired first — otherwise you are flying blind.

---

## 4. Feature backlog by pillar

Legend: **S** ≤ 1 day, **M** 2–4 days, **L** 5–10 days, **XL** > 10 days. "How" points at the real
seams in this codebase.

### Pillar A — Foundation: identity, persistence, observability

Without this, nothing else compounds (ladder, replays, quests, anti-abuse all need it).

| # | Feature | Why | How | Effort |
| --- | --- | --- | --- | --- |
| A1 | **Accounts** (wallet or device token → `playerId`) | One identity for stats, ladder, purchases | `players` table; upgrade `sessionStorage` guest id to a signed session cookie/JWT; new `session.ts` in `server/src` | M |
| A2 | **SQLite persistence** (`node:sqlite` or better-sqlite3) | Matches, players, ratings survive restarts | Write in `hooks.settle` (already the single funnel in `CombatRoom`); schema in `server/src/db.ts` | M |
| A3 | **Match history API + UI** | Proof of progress, replay entry point, dispute evidence | `GET /api/me/matches`; a "History" tab in `Lobby`; rows from `matches` | M |
| A4 | **Analytics pipeline** | Know what players do/drop | Emit `match_start`, `match_end`, `tutorial_step`, `queue_join` to an events table; batch export to PostHog/Plausible | S |
| A5 | **Structured logs + error tracking + metrics** | Debug production | pino + `GET /metrics` (Prometheus) + Sentry (client & server) | S |
| A6 | **Graceful shutdown** | No lost matches on deploy | On `SIGTERM`: stop matchmaking, let live rooms finish or forfeit to the present player, flush DB | S |
| A7 | **CI: tests + typecheck + build + headless smoke** | Stop regressions | GitHub Actions; the Playwright bot-match smoke I used locally is ~80 lines | S |
| A8 | **Version the wire protocol + move data** | Clients/replays must agree on frame data | `PROTOCOL_VERSION` in `types/combat.ts`, checked at auth; store `moveDataHash` with each match | S |

**Exit criteria:** after a restart, a player still has a name, a rating and a match list; a crash
loses at most the match in flight.

### Pillar B — Onboarding & training (highest fun-per-effort)

| # | Feature | Why | How | Effort |
| --- | --- | --- | --- | --- |
| B1 | **Training room** | The single best retention tool in fighting games | `CombatRoom` opts `{ mode: 'training' }`: no timer/rounds, infinite HP/mana toggles, dummy behaviour (`stand`, `block all`, `jab`, `jump`), input history overlay, frame-advantage readout from `hit_confirmed`/`block_confirmed` | M |
| B2 | **Move list + frame data overlay** | Players can't learn invisible rules | Reuse `MOVE_ROWS` from `Lobby`; new overlay in `client/src/ui/Training.ts` | S |
| B3 | **Input display** | Teaches buffering/cancels | Draw the last ~60 input frames from `InputManager` | S |
| B4 | **Tutorial: 6 scripted lessons** | Move → jump → block a heavy → punish a whiff → land the spell → break a guard | Scripted bot steps (`Bot.ts` gains a `script()` mode); completion persisted (A1) | M |
| B5 | **"Why you lost" tips** | Turns losses into lessons | Post-match panel from event counts: blocked % vs hit %, guard breaks taken, whiffs punished | S |
| B6 | **Adaptive first bot** | New players shouldn't meet Normal | Default new accounts to Rookie, escalate after 3 wins (bot difficulty already exists) | S |

**Exit criteria:** a first-time player can reach "I understand guard, spell and punishing" in under
10 minutes, measured by tutorial completion.

### Pillar C — Matchmaking & social (makes it a multiplayer game)

| # | Feature | Why | How | Effort |
| --- | --- | --- | --- | --- |
| C1 | **Quick Match** | Room codes are a demo feature | `queue:join {fighter, mode}` → server pairs by rating + region → emits `queue:matched` → both clients auto-auth into the room | M |
| C2 | **Ping-aware pairing** | Feel matters | Reuse the existing `rtt` probe pre-match; prefer < 120 ms, never pair > 200 ms | S |
| C3 | **Rematch / runback** | Keeps a good match going | Currently bot-only (`main.ts` `rematch`); add server-side `match:rematch` that reuses the room | S |
| C4 | **Challenge links** | Frictionless friend invites | `?room=ABCD` deep link, auto-fills the code (2 h) | S |
| C5 | **Spectate** | Community, tournaments, streams | `CombatRoom` gets a `spectators` set; broadcast snapshots + events to them; read-only join | M |
| C6 | **Emotes / quick chat** | Humanises online play | 4 canned events, 3 s cooldown, mapped to a wheel; never free text | S |
| C7 | **Replays** | Learning, sharing, anti-cheat | Record `{tick, actions}` per player + match seed (make `Bot` use a seeded PRNG); replay in a headless room or as a snapshot file; `GET /api/match/:id/replay` | M |
| C8 | **Daily rotating stage / "arena of the day"** | Cheap variety | Seed `pickStage` from the date | S |

**Exit criteria:** two strangers can meet, fight, rematch and watch the replay without exchanging a
code.

### Pillar D — Progression & retention (the reason to come back)

| # | Feature | Why | How | Effort |
| --- | --- | --- | --- | --- |
| D1 | **Server-side XP & levels** | Local levels are trivially editable and don't travel | `players.xp`; award on match end; migrate `Profile` from localStorage | S |
| D2 | **Ranked ladder (Glicko-2)** | The competitive core | Rating per player, seasonal reset; leaderboard `GET /api/ladder`; rank badge in HUD | M |
| D3 | **Unlockables: palettes** | Cheapest possible cosmetics (no new art) | `LOOKS`/`SWATCH` already table-driven — add a palette id per fighter, unlock at levels/quests | S |
| D4 | **Daily quests** | A daily reason to log in | Event-driven counters ("block 20 hits", "land 3 spells", "win without a guard break"); claim UI | M |
| D5 | **Seasons** | Long-term cadence | Season table, soft reset, seasonal reward palette/title | S |
| D6 | **Profile: badges, best fighter, win-rate by matchup** | Identity and bragging rights | Aggregate from `matches` | S |
| D7 | **Friend list / follow** | Social glue | Friend codes, presence over socket.io namespaces | M |

**Exit criteria:** a player has a rating, a rank, a daily goal and something to unlock — all
server-side.

### Pillar E — Combat depth (the game itself)

The engine is clean enough to add mechanics cheaply. Do these in this order — each one multiplies
the others.

| # | Feature | Why | How | Effort |
| --- | --- | --- | --- | --- |
| E1 | **Overdrive meter + second spell** | Gives every fighter a comeback tool and a second decision | New `overdrive` resource (damage dealt/taken); `SPELLS[id].overdrive` variant; cast with Q when full; new FX/VFX per fighter | L |
| E2 | **Throw tech + whiff punish window** | Grabs are currently free pressure | `Grab` gets a tech window when both grab within 3 ticks; whiffed grab = long recovery | M |
| E3 | **Wakeup options** | Knockdown is currently a dead moment | `KNOCKDOWN` → choice of quick rise / delayed rise / wakeup attack with 1 frame of armour | M |
| E4 | **Juggle state** | Magma Fist launches but nothing follows | `AIRBORNE_HIT` state, juggle counter, damage decay | M |
| E5 | **Just-block / parry** | Skill expression above "hold L" | 3-frame perfect-guard window → no guard damage + small meter reward | S |
| E6 | **Two new fighters** | Content cadence | One zoner (trap/summon), one grappler (armoured command grab); needs spell + stance + stage affinity + tests (~3 days each once E1 lands) | M each |
| E7 | **Matchup balance pass** | Ensure the roster is playable | Use training mode + bot sims (`server/test/sim.ts` already runs thousands of ticks) to measure win rates; tune `SPELLS` numbers | L, recurring |
| E8 | **Staking policy** | Resolve the fairness contradiction | Mirror-only for staked; free play keeps asymmetric spells; or pick/ban draft for staked | S (design) |

**Exit criteria:** a skilled player has at least three meaningful decisions per round beyond
"attack or block".

### Pillar F — Platform & polish

| # | Feature | Why | How | Effort |
| --- | --- | --- | --- | --- |
| F1 | **Touch controls** | Mobile is most of the web | Virtual stick + 4 buttons writing into `InputManager`'s bitmask; tap-to-block | M |
| F2 | **PWA (installable, offline training)** | Removes the browser tab; enables push later | `manifest.json` + service worker caching the bundle/fonts; training room works offline against the client-side dummy | S |
| F3 | **Rebindable keys + gamepad remap** | Accessibility, laptops, arcade sticks | `KEYMAP` from localStorage + settings panel; the comment in `InputManager` already promises it | S |
| F4 | **Music** | The biggest missing "feels like a game" element | Procedural loop per stage via WebAudio, or 6 small ogg loops; duck on KO | M |
| F5 | **KO / round-end camera** | Drama | `SceneManager` camera states: slow-mo, zoom on the loser, whip pan | S |
| F6 | **Colorblind + reduced-motion + text scale** | Reach and comfort | Shape-coded guard bar, palette option, `prefers-reduced-motion` already partially handled | S |
| F7 | **Hitstop/impact tuning pass** | Feel | Per-move hitstop, freeze frames on guard break, screen-shake curve | S |
| F8 | **Quality toggle** | Low-end devices | Pixel-ratio cap, shadow toggle, particle budget in `Fx` | S |
| F9 | **Brand cleanup** | Trust | One name everywhere; delete the stale root copies (`combat.ts`, `CombatRoom.ts`, `server.ts`, `verifier.ts`, `voxel-fighter.zip`) and the duplicate root README | S |

### Pillar G — Real money (only after A–D are live)

| # | Feature | Why | How | Effort |
| --- | --- | --- | --- | --- |
| G1 | **Escrow contract + tests on testnet** | The current addresses are placeholders | Solidity `createMatch/joinMatch/claimVictory/refund`; Foundry tests; deploy to Base Sepolia | L |
| G2 | **Dispute / refund path** | Money must never be stuck | On-chain timelock refund if not settled in N hours; support tooling | M |
| G3 | **Collusion & multi-account detection** | Wagering attracts fraud | Pair-history graph, device fingerprint, velocity limits, stake caps | L |
| G4 | **Responsible play** | Ethical + legal | Age gate, deposit/stake limits, self-exclusion, session reminders | M |
| G5 | **Jurisdiction / KYC / terms** | Legal necessity | **Get counsel.** Geoblocking may be required; KYC above thresholds | XL, non-engineering |

---

## 5. Phased timeline

Dates assume full-time; stretch ×1.6 for part-time. Each phase ends with a shippable build.

### Phase 0 — "Trust the numbers" (1 week, ~5 days)
A4 analytics · A5 logs/metrics/Sentry · A6 graceful shutdown · A7 CI · F9 brand cleanup · C4 deep link.
**Exit:** you can see what players do, and a deploy doesn't silently kill matches.

### Phase 1 — "A game you can learn" (2 weeks, ~10 days)
A1 accounts · A2 SQLite · A3 history · B1 training · B2 move list · B3 input display · B4 tutorial ·
B6 adaptive first bot · D1 server XP.
**Exit:** a new player is taught the game and their progress survives a refresh. Biggest retention
jump per day of work in the whole plan.

### Phase 2 — "A game you can play with strangers" (3 weeks, ~15 days)
C1 Quick Match · C2 ping pairing · C3 rematch · C5 spectate · C7 replays · D2 ladder · D3 palettes ·
D4 daily quests.
**Exit:** strangers meet in < 45 s, get a rating, get a daily goal, can watch the replay.

### Phase 3 — "A game you can get good at" (4 weeks, ~20 days)
E1 Overdrive · E2 throw tech · E3 wakeups · E5 just-block · E4 juggles · E7 balance pass · E6 new
fighter #1 · F4 music · F5 KO camera.
**Exit:** depth; the skill ceiling is visibly higher than "mash".

### Phase 4 — "A game you can carry" (3 weeks, ~15 days)
F1 touch · F2 PWA · F3 rebinds · F6 accessibility · F8 quality toggle · E6 fighter #2 · D7 friends ·
D5 seasons.
**Exit:** works on a phone, installable, seasonal.

### Phase 5 — "Money, if it still makes sense" (4+ weeks, gated)
G1–G5, legal review first, testnet first, stake caps, mirror-only staked mode.
**Exit:** only if Phases 0–4 show retention worth monetising.

---

## 6. Quick wins (this week, each ≤ 1 day)

1. `?room=CODE` deep link + "copy invite" (C4).
2. Online rematch (C3).
3. Ping + "opponent rating" in the HUD header (C2).
4. Rebindable keys (F3).
5. Splash of background music per stage (F4).
6. PWA manifest + install prompt (F2).
7. Delete the stale root copies and unify the name (F9).
8. Post-match "why you lost" panel from existing events (B5).

---

## 7. Architecture changes these features will force

| Change | Needed by | Note |
| --- | --- | --- |
| Room registry abstraction (currently a module-level `Map` in `server.ts`) | C1, C5, D2, G3 | Extract `RoomRegistry` so matchmaking, spectate and persistence can query it |
| `hooks.settle` → transaction (match row + ratings + quests + replay) | A2, D2, D4 | It is already the single funnel — keep it that way |
| Seeded RNG for `Bot` and any future randomness | C7 replays, E7 balance sims | `Bot.ts` uses `Math.random` today |
| Versioned snapshot/input protocol | A8, C7 | Reject mismatched clients with a clear message |
| Redis adapter + sticky sessions (or a room service) | C1, C5, Phase 4 | Not before >1 process |
| Client-side simulation for offline training | F2 | Optional; a server training room is enough at first |

---

## 8. Risks and open decisions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Asymmetric spells vs wagering fairness | Disputes, "p2w" accusations | Mirror-only staked mode; publish the policy in the rules screen |
| Solo-dev scope | Nothing ships | Ship phases, not features; every phase must be playable |
| Balance work is unbounded | Burnout | Use bot sims + telemetry win rates; timebox each pass |
| Cheating/collusion at stake | Financial | Stake caps, device graph, delayed payouts, KYC above limits |
| Legal exposure of staking | Existential | Counsel before any real money; geoblocking; no US-first launch without advice |
| Single-process ops | Outages | Graceful shutdown + match recovery before growth |

**Decisions I need from you (they change the ordering):**
1. **Free-play ladder first, or staking first?** (I recommend ladder; money is Phase 5.)
2. **Asymmetric spells for money?** Mirror-only, or pick/ban, or re-equalise spells.
3. **Mobile as a target?** If yes, touch + PWA jump forward and the HUD needs a mobile layout.

---

## 9. What NOT to build yet

- **More fighters before training + ladder.** Content without a loop is a demo with more art.
- **Rollback netcode.** The current model is fine at 60 Hz for this input count; it is a month of
  work for a marginal feel gain at < 80 ms.
- **3D rigged models / GLB pipeline.** Procedural is the cost advantage; keep it.
- **Free-text chat.** Moderation burden you don't need.
- **A token / NFT / marketplace.** It does not solve a player problem and adds regulatory surface.
- **Match replays before accounts.** You'd have nowhere to keep them.

---

## 10. Suggested first commit of work (if you agree with the order)

1. `server/src/db.ts` — SQLite schema (`players`, `matches`, `ratings`, `events`).
2. `server/src/session.ts` — device token → stable `playerId`.
3. Wire `hooks.settle` to write a match row + award XP + emit one analytics event.
4. `GET /api/me` and `GET /api/me/matches`; a History tab in the lobby.
5. Training room flag in `CombatRoom` + a Training entry in the lobby.
6. CI workflow running `npm test`, both typechecks, client build, and a Playwright bot-match smoke.

Everything after that (matchmaking, ladder, depth) builds on these five files.
