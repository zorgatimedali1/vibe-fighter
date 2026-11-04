# VIBE FIGHTER

1v1 best-of-3 browser fighter with a full arcade move set, mana spells and a fresh procedural arena every match. Server-authoritative at 60 Hz, $1 on-chain stakes in production, free practice mode for development.

## Play it now (no wallet, no assets)

```bash
npm install
npm run play          # builds the client, starts the server
```

Open http://localhost:3000, pick a fighter, then **Fight bot**. For two players, both enter the same room code (two tabs works).

For development with hot reload, run `npm run dev:server` and `npm run dev:client` in two terminals and open http://localhost:5173.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | `A` / `D` (or `←` / `→`) | D-pad / left stick |
| Jump | `W` (or `↑`) | D-pad up |
| Crouch | `S` (or `↓`) | D-pad down |
| Jab | `J` | X / Square |
| Quick kick | `K` | B / Circle |
| Haymaker | `I` | Y / Triangle |
| Low kick | `U` | A / Cross |
| Sweep | `S` + `U` | down + A |
| Block | `L` | RB / RT |
| Spell | `Q` | LB |
| Overdrive (EX) | `E` | View / Back |
| Grab | `H` | LT |
| Dash | `Shift` (or double-tap a direction) | R3 |
| Hitbox debug | `F1` | — |

Air normals: `J` / `K` while airborne (one per jump, both are overheads). Light normals gatling into each other and into heavies (`J → K → I`), and anything that connects can be cancelled into the spell or the EX. The tail of a dash can be cancelled into a normal.

## Moves, guard and mana

Every fighter shares the same nine normal moves, the same 100 HP and the same movement. What differs is the **signature spell**: exactly one per fighter, and only that fighter can cast it.

| Move | Startup | Active | Recovery | Notes |
| --- | --- | --- | --- | --- |
| Jab | 4 | 3 | 7 | fastest poke |
| Quick kick | 6 | 3 | 9 | longer reach |
| Haymaker | 9 | 4 | 18 | heavy punish |
| Low kick | 12 | 4 | 20 | low, hard knockdown |
| Sweep | 11 | 4 | 22 | low, hard knockdown |
| Air jab | 5 | 4 | 10 | overhead, airborne |
| Dive kick | 7 | 5 | 12 | overhead, airborne |
| Spell | per fighter | | | 32–55 mana, see below |
| Overdrive | per fighter | | | full EX bar, see below |
| Grab | 12 | 2 | 20 | unblockable, hard knockdown, techable |

**Guard (0–100).** Holding `L` blocks every strike, projectile and spell for **zero damage** — only a grab gets through, and low/overhead no longer bypass a guard. Guarding is not free: every blocked hit drains the guard meter (9–32, from the move's `guardDamage`), it refills at +15/s after 40 frames out of guard, and an empty meter causes a **guard break** — a 55-frame stagger with no guard and no inputs. Blocking a rushdown is correct; blocking forever is a mistake.

| Fighter | Spell | Mana | Damage | What makes it unique |
| --- | --- | --- | --- | --- |
| Ram | Seismic Wave | 42 | 14 | slow rolling **low** shockwave, hard knockdown — jump it |
| Cap | Gale Slash | 32 | 6×2 | cheap **two-hit** crescent; cuts twice even on guard |
| Antenna | Signal Beam | 55 | 18 | head-height **hitscan lance** (6.4 m) — crouch under it |
| Mohawk | Magma Fist | 55 | 21 | **armoured** reversal, hard knockdown, huge recovery |
| Prop | Cyclone | 48 | 15 | **arcing overhead** vortex that shoves the caster backwards |

**Mana (0–100):** start at 30, regen +6/s, +6 per hit landed, +3 per hit blocked. Every spell has its own cost (32–55), frames and hit behaviour, so picking a fighter is picking a game plan. Projectiles clash and cancel each other when they meet at the same height.

### Overdrive and the EX spell

The gold **Overdrive** bar fills as you deal (+0.8 per damage) and take (+1.0 per damage) damage, plus a little for blocking. A full bar buys that fighter's **EX spell** on `E` — no mana required, and it resets each round.

| Fighter | EX | Damage | What it changes |
| --- | --- | --- | --- |
| Ram | Continental Rift | 16×2 | armoured double shockwave, knocks down twice |
| Cap | Tempest Barrage | 7×3 | three crescents in one breath — shreds a guard meter |
| Antenna | Orbital Lance | 24 | full-height lance: crouching does **not** duck it |
| Mohawk | Volcanic Overdrive | 30 | armoured reversal with a hard knockdown |
| Prop | Eye of the Storm | 15×2 | double vortex, huge guard damage, recoils 0.9 m |

Every EX is slow to recover, so it is a committed comeback tool rather than free damage.

### Defence: guard, perfect guard, tech

- **Guard** blocks every strike, projectile and spell for zero damage. Only a grab gets through.
- Guarding is not free: blocked hits drain the **guard meter** (9–32 per hit). It refills +15/s after 40 frames, and an empty meter causes a **guard break** — a 55-frame stagger.
- **Perfect guard:** a *fresh* tap of `L` within 3 frames of a hit costs no guard damage, refunds all blockstun (so you can punish the attacker's recovery) and pays +6 Overdrive. Holding block cannot parry; you have to re-tap.
- **Throw tech:** two grabs that meet cancel each other, with pushback and no damage.

### Practice room

`TRAINING LAB` in the lobby opens a room with infinite mana and Overdrive, no clock, no round ends, a dummy you can set to stand / block / jump / jab / walk, a spawn reset, an input-history strip, and a live readout of the last exchange's damage, hitstun and knockdown. Hitbox debug is on by default there.

**Combos** scale: 100% / 80% / 65% / 50% damage for the 1st–4th+ hit, so a long combo cannot delete a round.

## Practice bots

Six skill tiers, selectable in the lobby (and remembered between sessions): **Rookie**, **Easy**,
**Normal**, **Hard**, **Insane**, **Nightmare**. Tiers change reaction frames, guard chance,
anti-air and whiff-punish rates, combo conversion, spell usage, how eagerly the bot punishes a low
guard meter — and, crucially, **how often it acts**: each bot only makes a fresh decision every N
ticks (`idleMin`/`idleMax`) and only attacks with `attackRate`, with low tiers poking almost
exclusively with lights (`heavy`). Nothing about damage, speed or frame data changes.

Measured against a scripted, passive player (time to land 100 damage):
Rookie never gets there in 150 s, Easy ~43 s, Normal ~18 s, Hard ~12 s, Insane ~12 s — so Easy is a
slow, hesitant sparring partner rather than a frame-perfect wall.

## Fighters tab

The roster is a loadout screen: the 3D preview on the left with the fighter's name, archetype,
height, spell, EX and home stage; on the right a panel with `Fighters` / `Spells` tabs, a search box,
a 3-column card grid (selected card highlighted with a check), an **EQUIPPED** bar and a
`FIGHT AS <name>` shortcut.

## X sign-in, ranked queue and the ladder

**Sign in with X.** The lobby's `SIGN IN WITH X` button starts a server-side OAuth 2.0 flow
(authorization code + PKCE). The access token stays on the server; the browser only ever receives a
signed session token, passed back in the URL **fragment** (`/#session=…`) so it never appears in a
server log or a `Referer` header, and stripped from the address bar immediately.

Configuration (see `server/.env.example`):

```bash
X_CLIENT_ID=...          # OAuth 2.0 app at developer.x.com, "Read" permission
X_CLIENT_SECRET=...
X_REDIRECT_URI=http://localhost:3000/auth/x/callback
```

With no `X_CLIENT_ID`, the server runs a **mock login** (`/auth/x/start?as=yourname`), which mints a
stable local identity — the whole queue → match → points → leaderboard path works offline.

**Ranked queue (account-only).** Pick `Ranked`, hit `FIND MATCH`, and the server pairs you with
someone near your hidden Elo rating (window starts at ±80 and widens 18/second, capped at ±700,
2-minute timeout). The queue refuses guests — you need a signed-in account, and the server enforces
it, not just the UI. Both players are attached to a server-created room; nobody can fake a match id.
The queue rejects double-joins, queueing while already in a match, and silently drops players who
disconnect.

**Points.** Winning pays **+25 LP** (+2 per streak win, capped at +10); losing costs **18 LP**, with
a floor of 0, so playing always moves you up over time. A hidden Elo rating (K=28, provisional 40
for the first 10 games) drives matchmaking only. Tiers: Bronze → Silver (1000) → Gold (1400) →
Platinum (1800) → Diamond (2200) → Master (2600).

**Settlement safety.** Points are awarded only by the server, only from `RoomHooks.settle`, and the
match row is unique per match id — a duplicate settlement, a reconnect race or a crash cannot
double-count. A forfeit before the fight starts (disconnect inside the countdown) is a **no
contest**: no points and no Elo change.

**Leaderboard.** `Ladder` tab (top 50 by LP, your row highlighted), plus the API:
`GET /api/leaderboard?limit=50` and `GET /api/me` (Bearer session).

**Storage.** `server/data/voxel.db` (SQLite via Node's built-in `node:sqlite`, no native build) holds
`players` and `matches`; the session key lives next to it. Both are git-ignored. Point `DB_PATH` at
another file to separate environments.

## Look: arcade fighting-game arenas

The fighters and HUD keep the toy-box arcade look, but every arena is now built the way the
classics stage a fight: a painted sky with its own sun or moon, one dominant far silhouette, real
mid-ground architecture right behind the fighters (railings, pillars, fences, gate walls), a near
band with statues and torches framing the shot, and a readable floor material under the action.
Warm practical lights (torches, braziers, lanterns, glowing lava seams) do the lighting instead of
flat neon washes.

## Stages

Every match seeds its arena from the match ID plus the fighter pair, so no two matches look alike.
Six stages, each a nod to the genre's classics without copying them:

| Stage | Reads as | Signature |
| --- | --- | --- |
| **Suzaku Castle** | Sunset castle bridge | low sun, tiled castle roofs, red banners, cherry blossom |
| **The Pit** | Moonlit bridge over spikes | big moon, iron railing, spike bed, dead trees, green braziers |
| **Goro's Lair** | Lava cavern | stalactite ceiling, lava falls and pool, skull piles, bone arch |
| **Air Force Base** | Military runway | chain-link fence, hangar, parked jet, mountains, painted runway |
| **Monastery Courtyard** | Night temple courtyard | lit gate, pillar colonnade, monk onlookers, snow, stone medallion |
| **Temple of the Sun** | Sun-worshipper temple | giant statue head, ruined columns, palms, braziers, sandstone sun disc |

Each one is built from the same depth bands (sky plate → far silhouette → mid architecture → near
framing → floor) with per-stage parallax, bobbing crowds, torch flicker and an atmosphere field
(embers, snow, dust, petals, ash or stars). Affinity: Ram → Lair, Cap → Air Base, Antenna →
Courtyard, Mohawk → The Pit, Prop → Suzaku Castle. `?stage=<id>` pins an arena for previewing.

## Layout

- `client/src/ProceduralFighter.ts`: box-built fighters with a full humanoid rig (hips → spine → neck/head, shoulders → elbows → hands, hips → knees → feet) and 26 pose-authored clips keyed to the server's frame data: idle/walk with weight shift, a four-stage jump (launch → float → fall → land), directional high/low hit reacts, knockdown → getup, victory, and a per-fighter spell cast. **Every fighter has its own animation identity**: a stance layer, swing amplitudes for arms/legs/torso twist and an optional southpaw mirror are applied to all clips, so Ram's wide heavy swings, Cap's compact left-handed rushdown, Antenna's long lanky limbs, Mohawk's huge hooks and Prop's loose flailing all read differently while staying frame-accurate. No `.glb` required; set `VITE_USE_GLB=1` to load `/models/<id>.glb` instead.
- `client/src/moves.ts`: client mirror of the move registry, mana/guard constants, six bot tiers, per-fighter spell themes and stage affinity.
- `client/src/fx/Fx.ts`: pooled voxel sparks, impact rings, slashes, projected damage numbers, combo popups, spell names, screen flash, dash/heavy afterimages, landing dust and a per-fighter spell release (slam shockwave, crescent arcs, energy lance of the spell's real reach, rising flame, cyclone rings).
- `client/src/ui/Training.ts`: practice-room overlay (dummy control, input history, frame readout).
- `client/src/stage/Stages.ts`: seeded stage picker + the six procedural arenas (sky plates with painted suns/moons and clouds, far silhouettes, mid architecture, near framing, floor materials, crowds, atmosphere).
- `server/src/engine/moves.ts`: authoritative frame data, mana, guard, overdrive, dash and combo tuning plus the spell + EX registry.
- `server/src/engine/CombatRoom.ts`: 60 Hz loop, frame-data state machine, AABB hit/hurt boxes, 60-tick history with RTT/2 lag compensation (max 150 ms), trades/clashes, universal guard + guard meter/guard break, perfect guard, throw tech, multi-hit projectiles, per-spell caster recoil, training room, cancels, grabs, best-of-3, disconnect grace.
- `server/src/engine/Bot.ts`: server-side sparring bot with six difficulty tiers, human-ish reactions, guard, anti-airs, zoning, grab/sweep mixups and guard-break punishes.
- `server/src/crypto/verifier.ts`: `MatchLocked` event verification and the EIP-712 `Victory` signer.
- `server/src/auth/session.ts`: HMAC-signed session tokens (7-day TTL, constant-time verify).
- `server/src/auth/x.ts`: X OAuth 2.0 + PKCE (state, verifier, token exchange, profile) and the dev mock identity.
- `server/src/db.ts`: SQLite player/match store — ladder writes are transactional and idempotent per match id.
- `server/src/rating.ts`: Elo + LP maths, tiers and progress (pure, unit-tested).
- `server/src/matchmaker.ts`: the ranked queue (windows, timeout, dedupe, greedy pairing; unit-tested).
- `server/src/server.ts`: Socket.io, wallet/session auth, rate limiting, room routing, queue + leaderboard API, static hosting of `client/dist`.
- `server/test/sim.ts`: headless combat tests (`npm test`).

## Going live with money (DEV_MODE=false)

1. Deploy an escrow contract that emits `MatchLocked(uint256 indexed matchId, address player1, address player2, uint256 totalPot)` once both $1 stakes are in, and has `createMatch()`, `joinMatch(matchId)` and `claimVictory(matchId, winner, p1Rounds, p2Rounds, deadline, signature)`.
2. `claimVictory` must verify an EIP-712 signature with domain `{name: "VoxelFighterEscrow", version: "1", chainId, verifyingContract}` and type `Victory(uint256 matchId,address winner,uint8 p1Rounds,uint8 p2Rounds,uint256 deadline)`, signed by the key in `SERVER_SIGNER_PK`. The escrow domain name is intentionally unchanged from the original deployment; include a refund path for matches that never settle.
3. Fill in `server/.env` (see `.env.example`) and set `ESCROW_ADDRESS` / `STAKE_TOKEN` in `client/src/Web3Hud.ts`.
4. Have the contract audited before real funds touch it.

## Status

Tested: `npm test -w server` runs every suite in one pass — `rating` (Elo/LP maths, tiers), `matchmaking` (windows, timeout, dedupe, closest-opponent pairing), `db` (settlement, idempotency, leaderboard ordering/limits) and `sim` (frame data for all ten moves, damage, universal guard, perfect guard, throw tech, the light chain, overdrive + EX, per-fighter spells, guard regeneration, six bot tiers, training room, projectiles, cancels, lag comp, input sanitation, best-of-3 settlement and a full bot match). `npm run typecheck -w server` and `npm run typecheck -w client` are clean, and `npm run build -w client` produces the bundle.

Known limits: desktop controls only (no touch), draws replay the round indefinitely, and jumps are server-driven so they feel slightly delayed on high ping. Asymmetric spells mean fighter choice now matters mechanically — for wagered play consider mirror matches or a pick-and-ban step.
