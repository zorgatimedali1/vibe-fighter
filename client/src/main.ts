import * as THREE from 'three';
import { CHARACTERS } from './characters';
import { SceneManager } from './SceneManager';
import { FighterModel } from './FighterModel';
import { AnimationController } from './AnimationController';
import { HitboxSystem } from './HitboxSystem';
import { InputManager, Action } from './InputManager';
import { NetcodeClient, type NetHandlers, type MatchStart, type Snapshot, type PlayerSnap } from './NetcodeClient';
import { Web3Hud, createMatch, joinMatch, walletLogin } from './Web3Hud';
import { Lobby, type LobbyChoice } from './ui/Lobby';
import { Profile } from './ui/profile';
import { LobbyPreview } from './LobbyPreview';
import { audio } from './audio/Sfx';
import { pickStage, affinityStage, THEMES, type StageTheme } from './stage/Stages';
import { Fx } from './fx/Fx';
import {
  FIGHT, MOVES, OD_COST, spellFor, totalFrames, moveTiming, ATTACK_NAMES, DIFFICULTY_INFO,
  type MoveName, type SpellTheme,
} from './moves';
import { TrainingPanel } from './ui/Training';
import { captureSession, getSession } from './session';

const TICK = 1 / 60;
const params = new URLSearchParams(location.search);
const SERVER = params.get('server') ?? (import.meta.env.DEV ? `http://${location.hostname}:3000` : location.origin);

interface Game {
  net: NetcodeClient; myIdx: 0 | 1;
  me: FighterModel; opp: FighterModel; meA: AnimationController; oppA: AnimationController;
  meH: HitboxSystem; oppH: HitboxSystem; hud: Web3Hud; fx: Fx;
  /** Spell themes in SERVER player order (index 0/1 = match_start.fighters[0/1]). */
  themes: [SpellTheme, SpellTheme];
  theme: StageTheme;
  /** Present only in the practice room. */
  training?: TrainingPanel;
}

const sm = new SceneManager(document.getElementById('game') as HTMLCanvasElement);
const input = new InputManager();
const chars = Object.values(CHARACTERS);
let game: Game | null = null;
let debug = params.has('debug');

/* ---------- signed-in identity (X login), captured from the OAuth redirect ---------- */
const boot = captureSession();
const profile = new Profile();
let lobby!: Lobby;                                   // assigned below; the preview callback needs it early
const preview = new LobbyPreview(sm.scene, (s) => lobby?.setPreviewState(s));
preview.show();
addEventListener('keydown', (e) => {
  if (e.code === 'F1') { e.preventDefault(); debug = !debug; if (game) { game.meH.debugMode = debug; game.oppH.debugMode = debug; } }
});

/* ---------- match lifecycle: cancel / retry / rematch / leave ---------- */
let session: { cancel: () => void } | null = null;
let lastChoice: LobbyChoice | null = null;
let menuOpen = false;

function teardown(g: Game) {
  g.net.dispose();
  g.hud.dispose();
  g.fx.dispose();
  g.training?.dispose();
  g.meH.dispose(sm.scene); g.oppH.dispose(sm.scene);
  g.me.root.removeFromParent(); g.opp.root.removeFromParent();
  input.flush();
  if (game === g) game = null;
}

function lobbyStage() {
  sm.applyTheme(affinityStage(lastChoice?.fighter ?? chars[0].id));
}

function backToLobby() {
  if (game) teardown(game);
  menuOpen = false;
  lobby.show();
  preview.show();
  if (lastChoice) preview.setFighter(lastChoice.fighter);
  lobbyStage();
}

function rematch(g: Game) {
  const choice = lastChoice;
  teardown(g);
  menuOpen = false;
  lobby.show(); preview.show();
  if (choice) preview.setFighter(choice.fighter);
  lobbyStage();
  if (!choice) return;
  void launch({ ...choice, room: undefined }).catch((e: Error) => lobby.status(e.message || 'Could not restart.', true));
}

/** Esc menu. Bot matches genuinely pause on the server; online matches only offer Leave. */
function toggleMenu() {
  if (!game) return;
  if (menuOpen) { closeMenu(); return; }
  menuOpen = true;
  game.net.setPaused(true);
  renderMenu();
}

function renderMenu() {
  if (!game) return;
  game.hud.showMenu({
    resume: () => closeMenu(),
    leave: () => backToLobby(),
    mute: () => { audio.setMuted(!audio.muted); renderMenu(); },
  }, { canPause: canPause(), muted: audio.muted });
}

function canPause() { return lastChoice?.mode === 'bot'; }
function closeMenu() {
  menuOpen = false;
  game?.hud.hideMenu();
  game?.net.setPaused(false);
}

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && !game.hud.isResultOpen) { e.preventDefault(); toggleMenu(); }
  if (e.code === 'Enter' && game?.hud.isResultOpen && lastChoice?.mode === 'bot') { e.preventDefault(); rematch(game); }
});

/* ---------- lobby + connect ---------- */
lobby = new Lobby(document.body, chars, (c) => { launch(c).catch((e: Error) => { lobby.status(e.message || 'Something went wrong.', true, { label: 'Retry', run: () => void launch(c) }); lobby.busy(false); }); }, {
  profile,
  server: SERVER,
  onFighterChange: (id) => {
    preview.setFighter(id);
    if (!game) sm.applyTheme(affinityStage(id));
  },
});
if (boot.authError === 'denied') lobby.status('X sign-in was cancelled.', true);
else if (boot.authError === 'failed') lobby.status('X sign-in failed — try again.', true);
else if (boot.session) {
  const s = boot.session;
  lobby.status(s.mock
    ? `Signed in as @${s.handle} · demo login (set X_CLIENT_ID for real X accounts)`
    : `Signed in as @${s.handle}`);
}

async function launch(c: LobbyChoice) {
  lastChoice = c;
  lobby.busy(true);
  lobby.status('Connecting…', false, { label: 'Cancel', run: () => session?.cancel() });

  const token = getSession()?.token;

  let cancelled = false;
  let netRef: NetcodeClient | null = null;
  let rejectCancel!: (e: Error) => void;
  const cancelPromise = new Promise<never>((_, rej) => (rejectCancel = rej));
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    netRef?.queueLeave();
    netRef?.dispose();
    rejectCancel(new Error('__cancelled__'));
  };
  session = { cancel };

  try {
    let matchId = c.room ?? Math.random().toString(36).slice(2, 8).toUpperCase();
    let wallet: typeof walletLogin | undefined;
    if (c.mode === 'bot') matchId = `bot-${matchId}`;
    if (c.mode === 'stake-create') {
      lobby.status('Confirm the $1 stake in your wallet…', false, { label: 'Cancel', run: cancel });
      matchId = await createMatch(); wallet = walletLogin;
      lobby.status(`Match ${matchId} created. Share this ID and wait for your opponent.`, false, { label: 'Cancel', run: cancel });
    } else if (c.mode === 'stake-join') {
      lobby.status('Confirm the $1 stake in your wallet…', false, { label: 'Cancel', run: cancel });
      await joinMatch(matchId); wallet = walletLogin;
    }
    if (cancelled) return;
    lobby.status('Connecting…', false, { label: 'Cancel', run: cancel });

    const early: ((g: Game) => void)[] = [];                          // events that arrive while models are still building
    const when = (fn: (g: Game) => void) => (game ? fn(game) : early.push(fn));
    let resolveStart!: (m: MatchStart) => void;
    const started = new Promise<MatchStart>((r) => (resolveStart = r));

    const handlers: NetHandlers = {
      onStatus: (t) => {
        if (game) game.hud.say(t);
        else lobby.status(t, false, { label: 'Cancel', run: cancel });
      },
      onMatchStart: (m) => resolveStart(m),
      onSnapshot: (s) => when((g) => applySnapshot(g, s)),

      /* ------------------------------ combat juice ------------------------------ */
      onHit: (e) => when((g) => {
        const defMe = isMe(g, e.defenderId);
        const def = fighterOf(g, e.defenderId), atk = fighterOf(g, e.attackerId);
        const theme = themeOf(g, e.attackerId);
        const heavy = e.damage >= 14 || e.knockdown;
        const dir: 1 | -1 = def.position.x >= atk.position.x ? 1 : -1;
        g.fx.impact(new THREE.Vector3(e.x, e.y, 0), theme.core, {
          heavy, dir, text: e.armored ? `ARMOR -${e.damage}` : `-${e.damage}`, kind: heavy ? 'heavy' : 'normal',
        });
        if (e.knockdown) g.fx.flash(1.1);
        audio.hit(e.move === 'Spell' ? 'spell' : heavy ? 'heavy' : 'light');
        if (heavy) g.fx.ghost(atk.root, theme.trail, 0.18);   // smear frame on the impact pose
        // High shots snap the head back, low shots fold the body: the reaction matches where it landed.
        animOf(g, e.defenderId).react(e.y);
        if (isMe(g, e.attackerId)) {
          g.hud.setCombo(0, e.combo);
          g.fx.combo(e.combo);
        } else {
          g.hud.setCombo(1, e.combo);
        }
        if (defMe) g.hud.setCombo(0, 0);
        g.training?.event(`<b>${e.damage} DMG</b> · ${e.hitstunFrames}f hitstun · combo ${e.combo}${e.armored ? ' · ARMOURED' : ''}${e.knockdown ? ' · KNOCKDOWN' : ''}`);
      }),
      onBlock: (e) => when((g) => {
        const def = fighterOf(g, e.defenderId), atk = fighterOf(g, e.attackerId);
        const dir: 1 | -1 = def.position.x >= atk.position.x ? 1 : -1;
        g.fx.impact(new THREE.Vector3(e.x, e.y, 0), 0x9ad7ff, {
          text: e.chip > 0 ? `-${e.chip}` : 'GUARD', kind: 'chip', dir,
        });
        audio.block();
        animOf(g, e.defenderId).syncState('BLOCKSTUN', null);
        if (typeof e.guard === 'number') g.hud.setGuard(serverIdx(g, e.defenderId), e.guard);
        g.training?.event(`BLOCKED · guard <b>${e.guard}</b> · ${e.blockstunFrames}f blockstun`);
      }),
      onGuardBreak: (e) => when((g) => {
        const def = fighterOf(g, e.defenderId), atk = fighterOf(g, e.attackerId);
        const dir: 1 | -1 = def.position.x >= atk.position.x ? 1 : -1;
        const at = new THREE.Vector3(e.x, e.y, 0);
        g.fx.impact(at, 0xffd166, { heavy: true, text: 'GUARD BREAK', kind: 'heavy', dir });
        g.fx.burst(at, 0xff3d5a, 22, 4.6, 0.08, 0.6);
        g.fx.flash(1.3);
        sm.shake(0.18, 0.22);
        audio.ko();
        const idx = serverIdx(g, e.defenderId);
        g.hud.guardBreak(idx);
        g.hud.setGuard(idx, 0);
        animOf(g, e.defenderId).syncState('GUARD_BREAK', null);
      }),
      onClash: () => when((g) => {
        const mid = midpoint(g);
        g.fx.impact(mid, 0xffffff, { heavy: true, text: 'CLASH', kind: 'chip' });
        g.fx.burst(mid, 0xffe27a, 16, 4, 0.07);
        audio.block();
      }),
      onMoveStart: (e) => when((g) => {
        animOf(g, e.playerId).startAttack(e.move, tick);
        if (e.move === 'HeavyPunch' || e.move === 'HeavyKick' || e.move === 'Sweep' || e.move === 'Grab' || e.move === 'Spell') {
          audio.whoosh();
        }
        if (e.move === 'HeavyPunch' || e.move === 'HeavyKick' || e.move === 'Sweep') {
          const f = fighterOf(g, e.playerId);
          g.fx.slash(new THREE.Vector3(f.position.x + f.facing * 0.55, 1.0, 0), 0xffffff, f.facing, 0.75);
        }
        if (e.move === 'Spell') {
          // Charge aura while the cast winds up; the release burst fires on `spell_cast`.
          const f = fighterOf(g, e.playerId), th = themeOf(g, e.playerId);
          const at = new THREE.Vector3(f.position.x, 0.95, 0);
          g.fx.ring(at, th.trail, 0.34, 0.42);
          g.fx.burst(at, th.core, 10, 1.3, 0.05, 0.55);
        }
      }),
      onSpellCast: (e) => when((g) => {
        const theme = themeOf(g, e.playerId);
        const f = fighterOf(g, e.playerId);
        const at = new THREE.Vector3(e.x + e.facing * 0.45, 1.05, 0);
        g.fx.spellName(e.ex ? `${theme.overdrive.name} · EX` : theme.name);
        g.fx.cast(f.spec.id, at, theme, e.facing);
        g.fx.flash(e.ex ? 1.4 : 1.05);
        if (e.ex) {
          g.fx.burst(at, theme.core, 26, 5.2, 0.085, 0.6);
          g.fx.ring(at, theme.trail, 0.8, 0.5);
          sm.shake(0.13, 0.24);
          audio.ko();
        } else sm.shake(0.07, 0.16);
        audio.spell();
      }),
      onSpellClash: (e) => when((g) => {
        const at = new THREE.Vector3(e.x, e.y, 0);
        g.fx.impact(at, 0xffffff, { heavy: true, text: 'SPELL CLASH', kind: 'chip' });
        g.fx.burst(at, 0x9ad7ff, 26, 5, 0.08, 0.55);
        g.fx.flash(1.3);
        audio.spell(); audio.block();
      }),
      onDash: (e) => when((g) => {
        const f = fighterOf(g, e.playerId);
        animOf(g, e.playerId).play('Dash', true);
        g.fx.ghost(f.root, themeOf(g, e.playerId).trail, 0.26);
        g.fx.burst(new THREE.Vector3(f.position.x, 0.12, 0), 0xffffff, 6, 1.8, 0.05, 0.3);
        audio.whoosh();
      }),
      onLand: (e) => when((g) => {
        const f = fighterOf(g, e.playerId);
        animOf(g, e.playerId).land();
        g.fx.burst(new THREE.Vector3(f.position.x, 0.06, 0), 0xffffff, 10, 2.2, 0.055, 0.34);
        g.fx.ring(new THREE.Vector3(f.position.x, 0.05, 0), 0xd9ff3f, 0.3, 0.26);
        sm.shake(0.03, 0.1);
      }),
      onNoMana: () => when((g) => {
        g.hud.denySpell(0);
        audio.beep(false);
        if (g.meA.state === 'Spell') g.meA.play('Idle', true);          // the server rejected the cast
      }),
      onNoOverdrive: () => when((g) => {
        g.hud.denySpell(0);
        audio.beep(false);
        if (g.meA.state === 'Overdrive') g.meA.play('Idle', true);
      }),
      onPerfectGuard: (e) => when((g) => {
        const def = fighterOf(g, e.defenderId), atk = fighterOf(g, e.attackerId);
        const dir: 1 | -1 = def.position.x >= atk.position.x ? 1 : -1;
        const at = new THREE.Vector3(e.x, e.y, 0);
        g.fx.impact(at, 0xd9ff3f, { text: 'PERFECT', kind: 'chip', dir });
        g.fx.ring(at, 0xffffff, 0.55, 0.32);
        g.fx.flash(1.2);
        sm.shake(0.05, 0.1);
        audio.block();
        g.hud.setGuard(serverIdx(g, e.defenderId), e.guard);
        animOf(g, e.defenderId).syncState('BLOCK', null);
        g.training?.event('<b>PERFECT GUARD</b> — 0 guard damage, free punish');
      }),
      onThrowTech: (e) => when((g) => {
        const at = new THREE.Vector3(e.x, e.y, 0);
        g.fx.impact(at, 0xffd166, { text: 'TECH', kind: 'chip' });
        g.fx.burst(at, 0xffffff, 16, 3.4, 0.06, 0.4);
        audio.block();
        g.training?.event('<b>THROW TECH</b> — both grabs cancelled');
      }),

      onRoundStart: (e) => when((g) => {
        g.meA.syncState('IDLE', null); g.oppA.syncState('IDLE', null);
        g.meA.setFrozen(false); g.oppA.setFrozen(false);
        g.hud.setRounds(...(g.myIdx === 0 ? [e.p1Rounds, e.p2Rounds] : [e.p2Rounds, e.p1Rounds]) as [number, number]);
        g.hud.setCombo(0, 0); g.hud.setCombo(1, 0);
        g.hud.showBanner(e.fight ? 'Fight' : `Round ${e.round}`, e.fight ? 700 : 2400);
        audio.beep(e.fight);
      }),
      onRoundOver: (e) => when((g) => {
        g.hud.setRounds(...(g.myIdx === 0 ? [e.p1Rounds, e.p2Rounds] : [e.p2Rounds, e.p1Rounds]) as [number, number]);
        if (e.winnerId) {
          const loserA = e.winnerId === g.net.playerId ? g.oppA : g.meA;
          const loser = e.winnerId === g.net.playerId ? g.opp : g.me;
          loserA.syncState('KNOCKDOWN', null);
          animOf(g, e.winnerId).victory();
          g.fx.burst(new THREE.Vector3(loser.position.x, 0.9, 0), 0xffffff, 18, 4.2, 0.07, 0.5);
        }
        if (e.reason === 'ko') { audio.ko(); g.fx.flash(1.25); }
        g.hud.showBanner(e.winnerId === null ? 'Draw' : e.reason === 'time' ? 'Time' : 'KO', 1800);
      }),
      onTimer: (s) => when((g) => g.hud.setTimer(s)),
      onSettled: (p) => when((g) => {
        const won = p.winner === g.net.playerId;
        profile.record(won);
        lobby.refreshProfile();
        g.hud.presentVictory(p, g.net.playerId);
        const mine = g.myIdx === 0 ? p.p1Rounds : p.p2Rounds;
        const theirs = g.myIdx === 0 ? p.p2Rounds : p.p1Rounds;
        // Ranked ladder line: exactly what this match did to the points and rank.
        const side = p.ranked?.sides?.[g.net.playerId];
        const extra = p.ranked?.cancelled
          ? 'Ranked: no contest — no points changed'
          : side
            ? `${side.pointsDelta >= 0 ? '+' : ''}${side.pointsDelta} LP · ${side.pointsAfter} LP total · ${side.tier} · rank #${side.rank}`
            : undefined;
        g.hud.presentResult(
          { won, score: `${mine} – ${theirs}`, reason: p.reason, canRematch: lastChoice?.mode === 'bot', extra },
          { rematch: () => rematch(g), lobby: () => backToLobby() },
        );
      }),

      /* ------------------------------ ranked queue ------------------------------ */
      onQueueJoined: (e) => lobby.status(`Searching for an opponent… 0s · ${e.size} in queue`, false, { label: 'Cancel', run: cancel }),
      onQueueState: (e) => lobby.status(
        `Searching for an opponent… ${Math.round(e.waitedMs / 1000)}s · ${e.size} player${e.size === 1 ? '' : 's'} in queue`,
        false, { label: 'Cancel', run: cancel },
      ),
      onQueueMatched: (e) => {
        lobby.status(`Opponent found: @${e.opponent.handle} · ${e.opponent.tier} · ${e.opponent.points} LP`, false, { label: 'Cancel', run: cancel });
        audio.beep(true);
      },
      onQueueTimeout: () => { lobby.status('No opponent found in time. Try again.', true, { label: 'Retry', run: () => void launch(c) }); cancel(); },
      onQueueError: (e) => {
        const text = e.reason === 'already-queued' ? 'You are already in the queue.'
          : e.reason === 'in-match' ? 'Finish your current match first.'
            : `Queue unavailable (${e.reason}).`;
        lobby.status(text, true, { label: 'Back', run: () => cancel() });
        cancel();
      },
    };

    const connectP = NetcodeClient.connect({
      url: SERVER, matchId, fighter: c.fighter, bot: c.mode === 'bot',
      difficulty: c.mode === 'bot' ? c.difficulty : undefined, training: c.training,
      session: token, queue: c.mode === 'ranked', wallet,
    }, handlers, (a, d) => sm.shake(a, d));
    connectP.then((n) => { if (cancelled) n.dispose(); }).catch(() => { /* surfaced by the race below */ });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('The server did not answer in 10 seconds.')), 10_000));
    const net = await Promise.race([connectP, cancelPromise, timeout]);
    netRef = net;
    if (cancelled) { net.dispose(); return; }

    if (c.mode === 'ranked') {
      net.queueJoin(c.fighter);
      lobby.status('Searching for an opponent…', false, { label: 'Cancel', run: cancel });
    } else if (c.mode !== 'bot') {
      lobby.status(`Room ${matchId} — waiting for an opponent. Share this code.`, false, { label: 'Cancel', run: cancel });
    } else {
      lobby.status('Building the arena…', false, { label: 'Cancel', run: cancel });
    }

    const ms = await Promise.race([started, cancelPromise]);
    if (cancelled) { net.dispose(); return; }

    const built = await buildGame(net, ms);
    if (cancelled) { teardown(built); return; }
    game = built;
    lobby.hide();
    preview.hide();
    lobby.clearStatus();
    early.splice(0).forEach((fn) => fn(game!));
  } catch (e) {
    if (cancelled) return;                                             // user hit Cancel: stay quiet
    throw e;
  } finally {
    if (session?.cancel === cancel) session = null;
    lobby.busy(false);
  }
}

/* ------------------------------ helpers ------------------------------ */
const isMe = (g: Game, id: string) => id === g.net.playerId;
const serverIdx = (g: Game, id: string): 0 | 1 => (isMe(g, id) ? g.myIdx : (1 - g.myIdx) as 0 | 1);
const themeOf = (g: Game, id: string) => g.themes[serverIdx(g, id)];
const fighterOf = (g: Game, id: string) => (isMe(g, id) ? g.me : g.opp);
const animOf = (g: Game, id: string) => (isMe(g, id) ? g.meA : g.oppA);
function midpoint(g: Game) {
  return new THREE.Vector3(
    (g.me.position.x + g.opp.position.x) / 2,
    (g.me.position.y + g.opp.position.y) / 2 + 1.0,
    0,
  );
}

async function buildGame(net: NetcodeClient, ms: MatchStart): Promise<Game> {
  const myIdx = (ms.players.indexOf(net.playerId) === 1 ? 1 : 0) as 0 | 1;
  // `?stage=<id>` pins an arena (handy for previewing stages without replaying matches).
  const forced = params.get('stage');
  const theme = (forced && THEMES[forced]) || pickStage(ms.matchId, ms.fighters);
  sm.applyTheme(theme);
  const themes: [SpellTheme, SpellTheme] = [spellFor(ms.fighters[0]), spellFor(ms.fighters[1])];

  const [me, opp] = await Promise.all([
    FighterModel.load(CHARACTERS[ms.fighters[myIdx]] ?? chars[0]),
    FighterModel.load(CHARACTERS[ms.fighters[1 - myIdx]] ?? chars[1]),
  ]);
  const mySide = myIdx === 0 ? -FIGHT.spawnX : FIGHT.spawnX;
  net.localPos.x = mySide; net.remoteTarget.x = -mySide;
  me.position.set(mySide, 0, 0); opp.position.set(-mySide, 0, 0);
  me.setFacing(mySide < 0 ? 1 : -1); opp.setFacing(mySide < 0 ? -1 : 1);
  sm.scene.add(me.root, opp.root);

  const meA = new AnimationController(me.model, me.clips), oppA = new AnimationController(opp.model, opp.clips);
  // Clip keys are authored on the server's frame data; this keeps them honest if data changes.
  ATTACK_NAMES.forEach((m) => {
    meA.fitClipToFrames(m, totalFrames(m, ms.fighters[myIdx]));
    oppA.fitClipToFrames(m, totalFrames(m, ms.fighters[1 - myIdx]));
  });
  const meH = new HitboxSystem(sm.scene, me, debug || !!ms.training), oppH = new HitboxSystem(sm.scene, opp, debug);

  const hud = new Web3Hud(document.body, [me.spec.name, opp.spec.name], [100, 100], ms.roundsToWin);
  hud.setRounds(ms.rounds[myIdx], ms.rounds[1 - myIdx]);
  hud.setSpell(0, themes[myIdx]); hud.setSpell(1, themes[1 - myIdx]);
  hud.setStage(ms.difficulty ? `${theme.name} · ${DIFFICULTY_INFO[ms.difficulty]?.label ?? ms.difficulty}` : theme.name);
  hud.setHealth(0, 100); hud.setHealth(1, 100);
  hud.setMana(0, net.localServer.mana); hud.setMana(1, net.remoteState.mana);
  hud.setGuard(0, net.localServer.guard); hud.setGuard(1, net.remoteState.guard);
  hud.setOverdrive(0, net.localServer.overdrive); hud.setOverdrive(1, net.remoteState.overdrive);

  const fx = new Fx(sm.scene, sm.camera, document.body);
  // Practice room: dummy controls, spawn reset, input history and frame data on screen.
  const training = ms.training
    ? new TrainingPanel(document.body, {
      onDummy: (d) => net.setTrainingDummy(d),
      onReset: () => net.resetTraining(),
      onHitbox: (on) => { meH.debugMode = on; oppH.debugMode = on; },
      hitboxOn: true,
    })
    : undefined;
  return { net, myIdx, me, opp, meA, oppA, meH, oppH, hud, fx, themes, theme, training };
}

/* ---------- snapshot -> visuals ---------- */

/** The local fighter's locomotion is input-driven, so only combat states are adopted from snapshots. */
function syncLocal(a: AnimationController, p: PlayerSnap, fighter: string) {
  if (p.state.startsWith('ATTACK')) {
    if (p.move && a.state !== p.move) a.startAttack(p.move, tick);
    return;
  }
  if (['HITSTUN', 'BLOCKSTUN', 'GUARD_BREAK', 'KNOCKDOWN', 'DASH', 'JUMP', 'CROUCH', 'BLOCK'].includes(p.state)) {
    a.syncState(p.state, p.move, 0, p.y);
    return;
  }
  // IDLE / WALK_*: recover from a clamped one-shot once it has run its full frame count.
  if (a.isAttacking) {
    if (a.attackFrame() >= totalFrames(a.state as MoveName, fighter) - 1) a.syncState(p.state, p.move);
    return;
  }
  if (['Dash', 'HitReact', 'HitReactHigh', 'HitReactLow', 'Knockout', 'GetUp', 'Victory',
    'Block', 'Crouch', 'Jump', 'JumpStart', 'JumpApex', 'Fall', 'Land'].includes(a.state)) {
    a.syncState(p.state, p.move);
  }
}

function applySnapshot(g: Game, s: Snapshot) {
  const mine = s.players[g.net.playerId];
  if (mine) {
    g.hud.setHealth(0, mine.hp);
    g.hud.setMana(0, mine.mana);
    g.hud.setGuard(0, mine.guard);
    g.hud.setOverdrive(0, mine.overdrive);
    syncLocal(g.meA, mine, g.me.spec.id);
  }
  for (const [id, p] of Object.entries(s.players)) {
    if (id === g.net.playerId) continue;
    g.hud.setHealth(1, p.hp);
    g.hud.setMana(1, p.mana);
    g.hud.setGuard(1, p.guard);
    g.hud.setOverdrive(1, p.overdrive);
    g.oppA.syncState(p.state, p.move, s.tick, p.y);
  }
  g.fx.syncBolts(s.projectiles, g.themes);
}

/* ---------- fixed 60 Hz client step ---------- */
let tick = 0, acc = 0, last = performance.now();
let pingAt = 0;

function fixedStep(g: Game) {
  const { net, meA, oppA, meH } = g;
  if (net.tickHitstop()) { meA.setFrozen(true); oppA.setFrozen(true); return; }   // mirrors the server's global hitstop
  meA.setFrozen(false); oppA.setFrozen(false);
  tick++;

  const held = input.poll(tick);
  g.training?.setInput(held);
  const fighting = net.phase === 'FIGHTING';
  const blocking = !!(held & Action.Block);
  const down = !!(held & Action.Down);
  const locked = ['HITSTUN', 'BLOCKSTUN', 'GUARD_BREAK', 'KNOCKDOWN'].includes(net.localServer.state);
  const airborne = net.localServer.y > 0.05;

  // Instant local startup animation on a buffered press (client-side prediction). The server stays authoritative
  // and `move_start` will correct us if it chose a different move (or rejected it).
  if (fighting && !locked && !meA.isBusy) {
    let predicted: MoveName | null = null;
    if (input.consume(Action.Spell, tick)) {
      if (!airborne && net.localServer.mana >= g.themes[g.myIdx].cost) predicted = 'Spell';
    } else if (input.consume(Action.Overdrive, tick)) {
      if (!airborne && net.localServer.overdrive >= OD_COST) predicted = 'Overdrive';
    } else if (input.consume(Action.Grab, tick)) {
      if (!airborne) predicted = 'Grab';
    } else if (input.consume(Action.HeavyPunch, tick)) {
      if (!airborne) predicted = 'HeavyPunch';
    } else if (input.consume(Action.HeavyKick, tick)) {
      if (!airborne) predicted = down ? 'Sweep' : 'HeavyKick';
    } else if (input.consume(Action.LightPunch, tick)) predicted = airborne ? 'AirPunch' : 'LightPunch';
    else if (input.consume(Action.LightKick, tick)) predicted = airborne ? 'AirKick' : 'LightKick';
    if (predicted) meA.startAttack(predicted, tick);
  }
  // Airborne fighters keep their momentum on the server, so never predict horizontal walking mid-jump.
  const predictedHeld = fighting && !locked && !meA.isBusy
    ? (airborne ? held & ~(Action.Left | Action.Right) : held)
    : 0;
  net.sendInput(tick, held, predictedHeld);

  if (fighting && !locked) {
    const dir = (((held & Action.Right) ? 1 : 0) - ((held & Action.Left) ? 1 : 0)) as -1 | 0 | 1;
    meA.setLocomotion(dir, g.me.facing, blocking, down, airborne);
  }

  // Open the red hitbox only on the move's active frames (debug view only; the server resolves real hits).
  if (meA.isAttacking) {
    const m = moveTiming(meA.state as MoveName, g.me.spec.id), f = meA.attackFrame();
    meH.setActiveHitbox(f >= m.startup && f < m.startup + m.active ? m.hitbox : null);
  } else meH.setActiveHitbox(null);
}

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (game) {
    const g = game;
    acc += dt; while (acc >= TICK) { fixedStep(g); acc -= TICK; }
    g.me.position.x = g.net.localPos.x;
    g.me.position.y += (g.net.localServer.y - g.me.position.y) * (1 - Math.exp(-25 * dt));
    g.net.smoothRemote(g.opp.position, dt);
    const f: 1 | -1 = g.opp.position.x >= g.me.position.x ? 1 : -1;           // always face the opponent
    g.me.setFacing(f); g.opp.setFacing((-f) as 1 | -1); g.net.setFacing(f);

    g.meA.update(dt); g.oppA.update(dt);
    g.fx.update(dt);
    if (now - pingAt > 500) { pingAt = now; g.hud.setPing(g.net.pingMs); }
    const rs = g.net.remoteState;
    g.oppH.setActiveHitbox(rs.state === 'ATTACK_ACTIVE' && rs.move ? MOVES[rs.move].hitbox : null);
    g.meH.update(); g.oppH.update();
    sm.updateCamera(g.me.position, g.opp.position, dt);
  } else {
    preview.update(dt);                                            // idle the lobby fighter
    sm.updateLobbyCamera(dt);
  }
  sm.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* QA hook: lets the browser console inspect the live scene without a bundler. */
(window as unknown as Record<string, unknown>).__vf = { sm, preview, input, get game() { return game; } };
