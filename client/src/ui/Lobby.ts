import type { CharacterSpec } from '../characters';
import {
  ATTACK_NAMES, BOT_DIFFICULTIES, DIFFICULTY_INFO, MOVES, spellFor,
  type BotDifficulty, type MoveName,
} from '../moves';
import { affinityStage } from '../stage/Stages';
import { ESCROW_ADDRESS, STAKE_AMOUNT } from '../Web3Hud';
import { installTheme } from './theme';
import { icon } from './icons';
import { ProfileCard, type Profile } from './profile';
import { getSession, mockName, signInUrl } from '../session';
import { tierOf, tierProgress } from '../ranked';
import type { LeaderboardEntry } from '../NetcodeClient';

export interface LobbyChoice {
  mode: 'bot' | 'room' | 'ranked' | 'stake-create' | 'stake-join';
  fighter: string;
  room?: string;
  /** Practice-bot skill tier; only meaningful for `mode: 'bot'`. */
  difficulty?: BotDifficulty;
  /** Practice room instead of a real match. */
  training?: boolean;
}

type Mode = 'room' | 'bot' | 'ranked' | 'stake';
type Tab = 'play' | 'fighters' | 'how' | 'ladder' | 'stakes';

interface LobbyOptions {
  profile: Profile;
  /** Base URL of the game server (leaderboard + X login live there). */
  server: string;
  /** Notify the 3D lobby preview that the selected fighter changed. */
  onFighterChange?: (id: string) => void;
}

/** Cosmetic two-tone per fighter (head colour, eye/accent colour) — matches ProceduralFighter looks. */
const SWATCH: Record<string, [string, string]> = {
  ram: ['#5a2d1f', '#7dff6a'], cap: ['#1f4a3a', '#6fe8d8'], antenna: ['#a9adb3', '#f08a24'],
  mohawk: ['#c8402a', '#efe6d2'], prop: ['#23907e', '#a6f0a0'],
};

/** Vivid UI accent per fighter (Mohawk's eye cream is too quiet for bars and borders). */
const UI_ACCENT: Record<string, string> = {
  ram: '#7dff6a', cap: '#6fe8d8', antenna: '#f08a24', mohawk: '#ff5a3c', prop: '#a6f0a0',
};
const uiAccent = (id: string) => UI_ACCENT[id] ?? SWATCH[id]?.[1] ?? '#7dff6a';

/** One-line silhouette/playstyle blurb for the selected-fighter hero card. */
const BLURB: Record<string, string> = {
  ram: 'Horned bruiser with a wide body and heavy fists. Walks you down and makes every trade count.',
  cap: 'Goggle rushdown. Low stance, quick feet, and a game built on closing the gap before you can breathe.',
  antenna: 'Long-limbed zoner. Keeps you at the tip of the antenna, where your best buttons never reach.',
  mohawk: 'Oversized grappler. A huge head, heavier fists, and a grab that goes straight through guard.',
  prop: 'Propeller aerialist. Light frame, floaty jumps, and angles that are hard to pin down.',
};

/** Roster stat bars. Values are cosmetic (the server still uses one kit for everyone). */
const STAT_ROWS = [
  { key: 'heightM', label: 'Height', min: 1.4, max: 2.05, fmt: (v: number) => `${Math.round(v * 100)} cm` },
  { key: 'wingspanM', label: 'Wingspan', min: 1.2, max: 2.0, fmt: (v: number) => `${v.toFixed(2)} m` },
  { key: 'reachM', label: 'Reach', min: 0.35, max: 0.7, fmt: (v: number) => `${v.toFixed(2)} m` },
] as const;

const statPct = (v: number, min: number, max: number) =>
  Math.round(Math.max(8, Math.min(100, ((v - min) / (max - min)) * 100)));

const DOLLAR = `$${Number(STAKE_AMOUNT) / 1e6}`;                 // 1_000_000n @ 6 decimals → "$1"
const STAKES_CONFIGURED = !/0x0{40}|0xYour/i.test(ESCROW_ADDRESS);

const CSS = `
/* ---------- root layout ---------- */
.vf-root{position:fixed;inset:0;display:flex;flex-direction:column;gap:10px;
  padding:14px 18px 12px;pointer-events:none;color:var(--ink);font-family:var(--font-body);z-index:10}
.vf-root[hidden]{display:none}
.vf-root > *{min-height:0}
.vf-root .vf-panel{animation:vfPop .5s cubic-bezier(.2,1.3,.35,1) both}
.vf-panel.vf-prof{animation-delay:.06s}
.vf-panel.vf-mode{animation-delay:.14s}
@keyframes vfPop{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}

/* ---------- top bar ---------- */
.vf-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;pointer-events:auto;
  position:relative;z-index:3}
.vf-logo{display:flex;flex-direction:column;align-items:flex-start;line-height:0}
.vf-logo h1{margin:0;font-family:var(--font-display);font-weight:400;font-size:clamp(26px,3vw,36px);
  line-height:1.15;color:#fff;-webkit-text-stroke:8px var(--ink);paint-order:stroke fill;letter-spacing:.01em;
  display:flex;align-items:baseline;gap:.22em}
.vf-logo h1 .vibe{color:var(--lime)}
.vf-logo h1 .fighter{color:var(--paper)}
.vf-logo em{font-style:normal;background:var(--orange);color:#fff;border:3px solid var(--ink);border-radius:9px;
  padding:3px 12px;font-size:11px;font-weight:800;letter-spacing:.16em;transform:translateY(-6px);
  box-shadow:0 4px 0 rgba(20,16,14,.85)}
.vf-tabs{display:flex;gap:5px;padding:6px;border-radius:var(--r-lg);margin:0 auto}
.vf-tab{position:relative;display:inline-flex;align-items:center;gap:9px;border:0;background:transparent;
  font-family:var(--font-body);font-weight:800;font-size:14px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink);padding:9px 14px;border-radius:11px;cursor:pointer;transition:background .12s ease}
.vf-tab:hover{background:var(--paper-2)}
.vf-tab .vf-kc{display:inline-grid;place-items:center;min-width:23px;height:23px;padding:0 5px;border-radius:6px;
  background:var(--ink);color:#fff;font-size:11px;box-shadow:0 2px 0 rgba(20,16,14,.4)}
.vf-tab[aria-selected=true]{background:var(--lime);box-shadow:inset 0 0 0 3px var(--ink);color:var(--ink)}
.vf-tab[aria-selected=true] .vf-kc{background:#fff;color:var(--ink)}
.vf-tab:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-topright{display:flex;align-items:center;gap:9px;flex:none}

/* ---------- main pages ---------- */
/* The main area is the scroll viewport: it is clipped to the space between the header and the
   loadout bar, so a tall page can never paint over either of them. */
.vf-main{flex:1;display:grid;grid-template-rows:minmax(0,1fr);padding:4px 0;min-height:0;overflow:hidden;position:relative}
.vf-page{grid-area:1/1;min-height:0;height:100%}
.vf-page[data-page="play"]{pointer-events:none;display:grid;
  grid-template-columns:minmax(250px,300px) minmax(460px,500px);justify-content:space-between;
  gap:18px;align-items:center;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.vf-page[data-page="play"] .vf-panel,.vf-page[data-page="play"] .vf-changer,.vf-page[data-page="play"] .vf-lo,
.vf-page[data-page="play"] .vf-loadout{pointer-events:auto}
.vf-page:not([data-page="play"]){display:flex;flex-direction:column;gap:14px;justify-content:flex-start;align-items:stretch;
  pointer-events:auto;overflow-y:auto;overscroll-behavior:contain;padding:2px 6px 16px;scrollbar-gutter:stable}
/* Slim, paper-coloured scrollbar so the pages still read as one surface. */
.vf-page{scrollbar-width:thin;scrollbar-color:rgba(20,16,14,.38) transparent}
.vf-page::-webkit-scrollbar{width:11px}
.vf-page::-webkit-scrollbar-track{background:transparent}
.vf-page::-webkit-scrollbar-thumb{background:rgba(20,16,14,.34);border-radius:99px;border:3px solid transparent;background-clip:padding-box}
.vf-page::-webkit-scrollbar-thumb:hover{background:rgba(20,16,14,.55);border:3px solid transparent;background-clip:padding-box}
/* The display rules above beat the UA [hidden] rule, so pages would stack on top of each other.
   This MUST stay after them or the controls page covers the whole lobby. */
.vf-page[hidden]{display:none!important}
.vf-paper{width:min(1080px,100%);margin:0 auto}

/* left: profile */
.vf-prof-slot{align-self:start;justify-self:start;display:flex;flex-direction:column;gap:8px}
.vf-prof-signin{width:100%;justify-content:center;font-size:11px;background:var(--lime);color:var(--ink);
  border:2.5px solid var(--ink);box-shadow:0 3px 0 rgba(20,16,14,.5)}

/* center: under the 3D preview — anchored to the bottom so it never covers the fighter's torso */
.vf-stage{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);
  display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;text-align:center;
  width:max-content;max-width:min(760px,62vw)}
.vf-charname{margin:0;font-family:var(--font-display);font-weight:400;line-height:1;
  font-size:clamp(30px,4.6vw,56px);color:var(--paper);-webkit-text-stroke:10px var(--ink);paint-order:stroke fill}
.vf-charname.swap{animation:vfName .4s cubic-bezier(.2,1.5,.4,1) both}
@keyframes vfName{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
.vf-charsub{margin:10px 0 0;font-weight:800;font-size:12.5px;letter-spacing:.22em;text-transform:uppercase;
  color:var(--ink);-webkit-text-stroke:4px var(--paper);paint-order:stroke fill}
.vf-changer{display:flex;align-items:center;gap:8px;pointer-events:auto;margin-top:6px}
.vf-changer .vf-icon{width:40px;height:40px;flex:none}
.vf-change-btn{height:40px;background:#fff}
.vf-loadstate{display:inline-flex;align-items:center;gap:7px;margin-top:8px;padding:5px 11px;
  border:2.5px solid var(--ink);border-radius:999px;background:var(--lime);
  font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink)}
.vf-loadstate[hidden]{display:none}
.vf-loadstate::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--ink);
  animation:vfPulse .8s ease-in-out infinite}
.vf-loadstate.err{background:var(--orange);color:#fff}
@keyframes vfPulse{0%,100%{opacity:.25;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}

/* right: mode card */
.vf-mode{display:flex;flex-direction:column;gap:9px;padding:14px 16px;align-self:stretch;min-height:0;justify-content:flex-start}
.vf-mode h3{margin:0;font-family:var(--font-display);font-weight:400;font-size:26px;line-height:1;
  display:flex;align-items:center;justify-content:space-between;gap:8px}
.vf-modedesc{margin:0;font-size:13.5px;font-weight:600;color:#4a4238;line-height:1.45}
.vf-chips{display:flex;gap:7px;flex-wrap:wrap}
.vf-seg{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px;background:#fff;border:var(--bd) solid var(--ink);
  border-radius:var(--r-md);padding:5px;box-shadow:var(--shadow-flat)}
.vf-seg button{border:0;background:transparent;border-radius:9px;padding:9px 4px;cursor:pointer;color:#6b6154;
  font-family:var(--font-body);font-weight:800;font-size:11px;letter-spacing:.03em;text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.vf-seg button[aria-pressed=true]{background:var(--lime);color:var(--ink);box-shadow:inset 0 0 0 3px var(--ink)}
.vf-seg button:focus-visible,.vf-seg button:hover{color:var(--ink)}
.vf-seg button:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-diff{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.vf-diff button{border:2.5px solid var(--ink);border-radius:9px;padding:8px 4px;cursor:pointer;
  background:#fff;color:#6b6154;font-family:var(--font-body);font-weight:800;font-size:10.5px;
  letter-spacing:.05em;text-transform:uppercase;box-shadow:0 3px 0 rgba(20,16,14,.35)}
.vf-diff button:hover{color:var(--ink);background:var(--paper-2)}
.vf-diff button[aria-pressed=true]{background:var(--lime);color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink),0 3px 0 rgba(20,16,14,.35)}
.vf-diff button:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-diffdesc{margin:0;font-size:11.5px;font-weight:700;color:#6b6154;line-height:1.35;min-height:2.7em}
.vf-modeshow{min-height:70px;display:flex;flex-direction:column;gap:6px}
.vf-modeshow > div{display:flex;flex-direction:column;gap:8px}
.vf-modeshow [hidden]{display:none}
.vf-rk{display:flex;flex-direction:column;gap:7px}
.vf-rk-top{display:flex;align-items:center;gap:8px;min-height:24px}
.vf-rk-tier{font-family:var(--font-display);font-size:15px;letter-spacing:.02em;color:var(--ink)}
.vf-rk-pts{font-weight:800;font-size:13px;background:#fff;border:2.5px solid var(--ink);border-radius:999px;padding:2px 9px}
.vf-rk-rank{font-weight:800;font-size:11px;color:#6b6154;margin-left:auto;letter-spacing:.06em}
.vf-rk-bar{height:9px;border:2.5px solid var(--ink);border-radius:999px;background:#fff;overflow:hidden}
.vf-rk-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--lime),var(--orange));transition:width .3s ease}
.vf-rk button{width:100%}
.vf-ladder{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.vf-ladder-row{display:grid;grid-template-columns:42px 1fr 84px 74px 92px;gap:8px;align-items:center;
  padding:7px 10px;border:2.5px solid var(--ink);border-radius:9px;background:#fff}
.vf-ladder-row.head{background:var(--ink);color:var(--paper);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.vf-ladder-row.me{background:var(--lime)}
.vf-ladder-row .nm{display:flex;align-items:center;gap:7px;font-weight:800;min-width:0}
.vf-ladder-row .nm img{width:22px;height:22px;border-radius:50%;border:2px solid var(--ink)}
.vf-ladder-row .nm span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vf-ladder-row .num{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
.vf-ladder-row .tier{font-size:10px;font-weight:800;letter-spacing:.06em}
.vf-input{width:100%;font-family:var(--font-body);font-weight:800;font-size:15px;letter-spacing:.08em;
  text-transform:uppercase;padding:11px 12px;border:var(--bd) solid var(--ink);border-radius:var(--r-md);
  background:#fff;color:var(--ink)}
.vf-input:focus-visible{outline:4px solid var(--blue);outline-offset:1px}
.vf-hint{font-size:12px;font-weight:700;color:#6b6154;letter-spacing:.02em}
.vf-botinfo{display:flex;gap:10px;align-items:center;background:var(--paper-2);border:2.5px solid var(--ink);
  border-radius:var(--r-md);padding:10px;font-size:13px;font-weight:700;color:#4a4238}
.vf-botinfo svg{flex:none;width:20px;height:20px}
.vf-rules{background:var(--ink);color:var(--paper);border-radius:var(--r-md);padding:8px 11px;border:var(--bd) solid var(--ink)}
.vf-rules-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}
.vf-rules-hd b{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#cfc5b2}
.vf-rules ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;
  font-size:11.5px;font-weight:600;color:#eee6d4}
.vf-rules li{display:flex;gap:8px;align-items:baseline}
.vf-rules li::before{content:'▸';color:var(--lime);font-size:11px;flex:none;transform:translateY(-1px)}
.vf-rules-note{margin:9px 0 0;padding-top:9px;border-top:2px solid rgba(244,239,226,.22);
  font-size:12px;font-weight:700;color:#b8ad99}
.vf-actions{display:flex;gap:8px}
.vf-actions .vf-btn{flex:1}
.vf-roominfo{display:none;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;
  background:#fff;border:2.5px dashed var(--ink);border-radius:999px;padding:7px 8px 7px 14px}
.vf-roominfo.show{display:flex}
.vf-roominfo b{font-family:var(--font-display);font-weight:400;font-size:16px;letter-spacing:.06em}
.vf-roominfo span.l{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.1em}
.vf-roominfo .cp{width:34px;height:34px;flex:none;display:grid;place-items:center;background:var(--lime);
  border:2.5px solid var(--ink);border-radius:50%}
.vf-roominfo .cp svg{width:16px;height:16px}

/* big play button — pinned to the bottom of the (full-height) duel card, never floating/overlapping */
.vf-play{display:flex;align-items:stretch;width:100%;min-height:70px;margin-top:auto;padding:0;overflow:hidden;
  background:var(--lime);color:var(--ink);border:var(--bd) solid var(--ink);border-radius:var(--r-lg);
  cursor:pointer;box-shadow:var(--shadow-pop);transition:transform .07s ease,box-shadow .07s ease,background .12s ease}
.vf-play:hover{background:var(--lime-2)}
.vf-play:active{transform:translateY(5px);box-shadow:var(--shadow-press)}
.vf-play:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-play[disabled]{opacity:.55;cursor:default;transform:none}
.vf-play .t{flex:1;display:grid;place-items:center;font-family:var(--font-display);font-weight:400;
  font-size:clamp(30px,3vw,44px);letter-spacing:.02em;line-height:1;padding:10px 4px}
.vf-play .s{width:104px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
  border-left:var(--bd) solid var(--ink);background:rgba(20,16,14,.07)}
.vf-play .s b{font-size:11px;font-weight:800;letter-spacing:.12em;color:#2a241f}

/* ---------- bottom: loadout bar (single slim row: title + 8 moves + location) ---------- */
.vf-bottom{pointer-events:auto;position:relative;z-index:3}
.vf-loadbar{display:flex;align-items:center;gap:12px;width:100%;padding:5px 10px;
  background:var(--paper);border:var(--bd) solid var(--ink);border-radius:14px;
  box-shadow:0 5px 0 rgba(20,16,14,.7),0 14px 30px rgba(0,0,0,.32)}
.vf-lo-hd{display:flex;align-items:baseline;gap:9px;flex:none}
.vf-lo-title{font-family:var(--font-display);font-weight:400;font-size:14px;letter-spacing:.02em;color:var(--ink);white-space:nowrap}
.vf-lo-kicker{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6b6154;white-space:nowrap}
.vf-lo-cards{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px;flex:1;min-width:0;}
.vf-lo{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;
  background:#fff;border:2.5px solid var(--ink);border-radius:9px;padding:3px 7px;box-shadow:0 2px 0 rgba(20,16,14,.3)}
.vf-lo b{font-size:11px;font-weight:800;letter-spacing:.01em;line-height:1.15;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.vf-lo small{font-size:8.5px;font-weight:700;color:#6b6154;letter-spacing:.01em;line-height:1.25;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.vf-lo .vf-kbd{min-width:18px;height:18px;padding:0 4px;font-size:9.5px;border-radius:5px;box-shadow:0 2px 0 var(--ink)}
.vf-location{flex:none;margin-left:auto;font-weight:800;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#3f3a33;opacity:.75}

/* ---------- shared page content ---------- */
.vf-page h2{margin:0 0 10px;font-family:var(--font-display);font-weight:400;font-size:24px;
  color:var(--ink);display:flex;align-items:center;gap:10px}
/* the staged name is a display heading, not a page title — override the h2 defaults above */
.vf-stage .vf-charname{margin:0;line-height:1;font-size:clamp(30px,4.6vw,56px);
  color:var(--paper);-webkit-text-stroke:10px var(--ink);paint-order:stroke fill}
.vf-grid{padding:18px;display:grid;gap:12px}

/* fighters tab */
.vf-roster-panel{display:flex;flex-direction:column;gap:12px}
.vf-roster-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.vf-roster-hd h2{margin:0 0 4px}
.vf-roster-hd .vf-note{margin:0;max-width:62ch}
.vf-roster-layout{display:grid;grid-template-columns:minmax(264px,320px) minmax(0,1fr);gap:14px;align-items:start}

/* the selected fighter, rendered as a dark neon hero card against the paper roster */
.vf-hero{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:10px;padding:15px;
  color:var(--paper);border:var(--bd) solid var(--ink);border-radius:var(--r-lg);
  background:linear-gradient(168deg,#1d1536 0%,#100c1e 56%,#1a1030 100%);
  box-shadow:var(--shadow-flat),0 0 0 3px rgba(217,255,63,.16);
  --accent:#7dff6a;--head:#5a2d1f}
.vf-hero::before{content:'';position:absolute;right:-70px;top:-90px;width:250px;height:250px;border-radius:50%;
  background:radial-gradient(circle,color-mix(in srgb,var(--accent) 52%,transparent),transparent 68%);
  opacity:.6;pointer-events:none}
.vf-hero::after{content:'';position:absolute;left:0;right:0;bottom:0;height:3px;
  background:linear-gradient(90deg,var(--accent),transparent)}
.vf-hero > *{position:relative;z-index:1}
.vf-hero.swap{animation:vfHeroSwap .3s cubic-bezier(.2,1.3,.35,1) both}
@keyframes vfHeroSwap{from{opacity:.3;transform:translateY(6px)}to{opacity:1;transform:none}}
.vf-hero-top{display:flex;align-items:center;gap:12px}
.vf-hero-portrait{position:relative;flex:none;padding:6px;border-radius:22px;
  background:radial-gradient(circle at 50% 38%,color-mix(in srgb,var(--accent) 34%,transparent),transparent 70%);
  border:3px solid rgba(244,239,226,.2)}
.vf-hero-portrait .vf-face{--face-size:86px;border-width:4px;border-radius:16px;
  box-shadow:0 6px 0 rgba(0,0,0,.55),0 0 22px color-mix(in srgb,var(--accent) 52%,transparent)}
.vf-hero-id{display:flex;flex-direction:column;gap:5px;min-width:0}
.vf-hero-kicker{font-size:9.5px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#b9ae98}
.vf-hero-name{margin:0;font-family:var(--font-display);font-weight:400;line-height:.95;
  font-size:clamp(28px,3.1vw,38px);color:#fff;-webkit-text-stroke:7px var(--ink);paint-order:stroke fill}
.vf-hero-name.long{font-size:clamp(23px,2.5vw,30px)}
.vf-hero-arch{display:inline-flex;align-self:flex-start;padding:3px 9px;border-radius:999px;
  background:var(--accent);color:var(--ink);border:2px solid var(--ink);font-size:10px;font-weight:800;
  letter-spacing:.08em;text-transform:uppercase;box-shadow:0 2px 0 rgba(0,0,0,.5)}
.vf-hero-blurb{margin:0;font-size:12px;font-weight:600;line-height:1.45;color:#cfc5b2}

.vf-hero-stats{display:flex;flex-direction:column;gap:7px;padding:10px 11px;border-radius:12px;
  background:rgba(7,6,16,.5);border:2px solid rgba(244,239,226,.12)}
.vf-stat{display:grid;grid-template-columns:54px 1fr 52px;align-items:center;gap:8px;
  font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.vf-stat > span:first-child{color:#b9ae98}
.vf-stat b{font-family:var(--font-display);font-weight:400;font-size:13px;letter-spacing:.02em;
  text-align:right;color:#fff}
.vf-stat .track{height:8px;border-radius:99px;background:rgba(244,239,226,.12);overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(0,0,0,.4)}
.vf-stat .track i{display:block;height:100%;border-radius:99px;
  background:linear-gradient(90deg,var(--accent),#fff);
  box-shadow:0 0 8px color-mix(in srgb,var(--accent) 70%,transparent)}

.vf-hero-meta{display:grid;grid-template-columns:1fr;gap:7px}
.vf-hero-cell{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:10px;
  background:rgba(244,239,226,.07);border:2px solid rgba(244,239,226,.13)}
.vf-hero-cell .glyph{flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:8px;
  background:var(--accent);color:var(--ink);font-size:14px;font-weight:800;box-shadow:0 2px 0 rgba(0,0,0,.45)}
.vf-hero-cell .glyph svg{width:14px;height:14px}
.vf-hero-cell .txt{display:flex;flex-direction:column;gap:1px;min-width:0}
.vf-hero-cell .txt span{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#a99e88}
.vf-hero-cell .txt b{font-size:12.5px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vf-hero-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.vf-hero-foot .vf-chip{font-size:9.5px}
.vf-hero-cta{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;
  margin-top:auto;padding:9px 12px;border:2.5px solid var(--ink);border-radius:10px;
  background:var(--lime);color:var(--ink);font-family:var(--font-body);font-weight:800;font-size:11px;
  letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
  box-shadow:0 4px 0 rgba(0,0,0,.55);transition:transform .08s ease,box-shadow .08s ease,background .12s ease}
.vf-hero-cta:hover{background:var(--lime-2)}
.vf-hero-cta:active{transform:translateY(3px);box-shadow:0 1px 0 rgba(0,0,0,.55)}
.vf-hero-cta:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-hero-cta svg{width:14px;height:14px}

/* fighters tab: full-bleed stage + loadout panel (reference layout) */
.vf-page.vf-fighters{display:grid;grid-template-columns:minmax(0,1fr) minmax(380px,440px);gap:18px;
  height:100%;min-height:0;padding:2px 4px 8px;align-items:stretch}
.vf-fighter-stage{position:relative;min-height:0;display:flex;align-items:flex-end;justify-content:center;
  padding-bottom:10px;pointer-events:none}
.vf-fighter-caption{display:flex;flex-direction:column;align-items:center;gap:6px;max-width:660px;text-align:center}
.vf-page .vf-cap-name{margin:0;font-family:var(--font-display);font-weight:400;line-height:.95;color:var(--paper);
  font-size:clamp(34px,4.4vw,58px);-webkit-text-stroke:9px var(--ink);paint-order:stroke fill}
.vf-page .vf-cap-arch{margin:0;font-weight:800;font-size:12px;letter-spacing:.2em;text-transform:uppercase;
  color:var(--ink);-webkit-text-stroke:4px var(--paper);paint-order:stroke fill}
.vf-cap-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:2px}
.vf-cap-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border:2.5px solid var(--ink);
  border-radius:999px;background:#fff;color:var(--ink);font-weight:800;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase}
.vf-cap-hint{margin:0;max-width:min(560px,54vw);font-size:10.5px;font-weight:800;line-height:1.5;
  letter-spacing:.1em;text-transform:uppercase;color:rgba(247,242,234,.8);text-shadow:0 2px 0 rgba(0,0,0,.45)}
.vf-loadout{display:flex;flex-direction:column;gap:10px;min-height:0;height:100%;padding:16px;
  background:var(--paper);border:var(--bd) solid var(--ink);border-radius:16px;color:var(--ink);
  box-shadow:0 10px 0 rgba(20,16,14,.85),0 30px 60px rgba(0,0,0,.4)}
.vf-loadout-hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.vf-loadout-hd h2{margin:0;font-family:var(--font-display);font-weight:400;font-size:25px;line-height:1;color:var(--ink)}
.vf-loadout-count{font-weight:800;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6154}
.vf-ltabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:#fff;border:2.5px solid var(--ink);border-radius:10px}
.vf-ltabs button{border:0;border-radius:7px;padding:8px 6px;background:transparent;color:#6b6154;
  font-family:var(--font-body);font-weight:800;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer}
.vf-ltabs button[aria-pressed=true]{background:var(--lime);color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink)}
.vf-search{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border:2.5px solid var(--ink);border-radius:10px}
.vf-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-weight:700;font-size:13px;color:var(--ink)}
.vf-lgrid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;padding:2px;align-content:start;scrollbar-width:thin}
.vf-lgrid::-webkit-scrollbar{width:8px}
.vf-lgrid::-webkit-scrollbar-thumb{background:rgba(20,16,14,.3);border-radius:99px}
.vf-lcard{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;
  background:#fff;border:2.5px solid var(--ink);border-radius:12px;cursor:pointer;color:var(--ink);
  box-shadow:0 3px 0 rgba(20,16,14,.35);text-align:center;font-family:var(--font-body)}
.vf-lcard:hover{transform:translateY(-2px)}
.vf-lcard:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-lcard[aria-pressed=true]{background:linear-gradient(180deg,#f7ffd2,var(--lime));box-shadow:inset 0 0 0 2px var(--ink)}
.vf-lcard-face{width:56px;height:56px;border-radius:12px;border:2.5px solid var(--ink);position:relative;
  background:var(--head,#5a2d1f);box-shadow:inset 0 -9px 0 rgba(0,0,0,.18)}
.vf-lcard-face::after{content:'';position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);
  width:30px;height:12px;border-radius:5px;background:#14100e;box-shadow:inset 0 0 0 3px var(--eye,#7dff6a)}
.vf-lcard.spell .vf-lcard-face{display:grid;place-items:center;background:#fff;box-shadow:none;
  font-family:var(--font-display);font-size:22px;color:var(--ink)}
.vf-lcard-name{font-weight:800;font-size:12px;letter-spacing:.02em;line-height:1.1;max-width:100%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vf-lcard-tag{font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#6b6154;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vf-lcard-check{position:absolute;right:5px;top:5px;width:18px;height:18px;border-radius:50%;
  background:var(--ink);color:var(--lime);display:grid;place-items:center;font-size:10px;font-weight:800}
.vf-equipped{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;border-radius:10px;
  border:2.5px solid var(--ink);background:var(--ink);color:var(--lime);font-weight:800;font-size:12px;
  letter-spacing:.1em;text-transform:uppercase}
.vf-loadout-cta{width:100%;justify-content:center}

/* legacy roster card styles (kept for older markup) */
.vf-roster-col{display:flex;flex-direction:column;gap:9px;min-width:0}
.vf-roster{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;width:100%;max-width:620px;margin:0 auto}
.vf-fc{position:relative;overflow:hidden;flex:0 1 calc((100% - 20px)/3);max-width:200px;min-width:0;
  display:flex;flex-direction:column;gap:7px;align-items:stretch;
  padding:11px;text-align:left;background:linear-gradient(180deg,#fff,#f4eedf);
  border:var(--bd) solid var(--ink);border-radius:var(--r-md);box-shadow:var(--shadow-flat);
  cursor:pointer;font-family:var(--font-body);transition:transform .09s ease,box-shadow .09s ease,background .12s ease}
.vf-fc::before{content:'';position:absolute;left:0;right:0;top:0;height:4px;background:var(--accent)}
.vf-fc:hover{transform:translateY(-3px);
  box-shadow:var(--shadow-flat),0 0 0 3px color-mix(in srgb,var(--accent) 42%,transparent)}
.vf-fc[aria-pressed="true"]{background:linear-gradient(180deg,#f7ffd2,var(--lime));
  box-shadow:inset 0 0 0 3px var(--ink),var(--shadow-flat)}
.vf-fc:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-fc-top{display:flex;align-items:center;gap:9px;min-width:0}
.vf-fc .vf-face{--face-size:46px;border-radius:10px;flex:none}
.vf-fc-id{display:flex;flex-direction:column;gap:2px;min-width:0}
.vf-fc-id b{font-family:var(--font-display);font-weight:400;font-size:17px;line-height:1}
.vf-fc-id .vf-kicker{font-size:8.5px;letter-spacing:.08em;line-height:1.2;margin:0}
.vf-fc-bars{display:flex;flex-direction:column;gap:3px}
.vf-mini{display:grid;grid-template-columns:1fr auto;gap:5px;font-size:9px;font-weight:800;
  letter-spacing:.05em;text-transform:uppercase;color:#6b6154}
.vf-mini b{color:#14100e;font-size:10px;font-weight:800;letter-spacing:0}
.vf-mini .track{grid-column:1/-1;height:4px;border-radius:99px;background:rgba(20,16,14,.14);overflow:hidden}
.vf-mini .track i{display:block;height:100%;border-radius:99px;background:var(--accent)}
.vf-fc-spell{display:flex;align-items:center;gap:6px;margin-top:auto;padding-top:6px;
  border-top:2px dashed rgba(20,16,14,.16);font-size:9px;font-weight:800;letter-spacing:.05em;
  text-transform:uppercase;color:#4a4238;min-width:0}
.vf-fc-spell .g{display:grid;place-items:center;width:18px;height:18px;flex:none;border-radius:5px;
  background:var(--ink);color:var(--accent);font-size:11px}
.vf-fc-spell span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vf-fc-check{position:absolute;right:7px;top:8px;display:none;place-items:center;width:21px;height:21px;
  border-radius:50%;background:var(--ink);color:var(--lime)}
.vf-fc-check svg{width:12px;height:12px}
.vf-fc[aria-pressed="true"] .vf-fc-check{display:grid}
.vf-roster-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0;
  font-size:11px;font-weight:700;line-height:1.4;color:#6b6154}
.vf-roster-foot svg{width:14px;height:14px;flex:none}

/* shared fighter portrait (head block + visor + accent eye) */
.vf-face{display:block;width:var(--face-size,64px);height:var(--face-size,64px);position:relative;border:3px solid var(--ink);
  border-radius:12px;background:var(--head,#5a2d1f);box-shadow:0 4px 0 rgba(20,16,14,.75);overflow:hidden}
.vf-face::before{content:'';position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);
  width:60%;height:45%;background:#14100e;border-radius:14%}
.vf-face::after{content:'';position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);
  width:33%;height:14%;background:var(--eye,var(--accent,#7dff6a));border-radius:30%;box-shadow:0 0 0 2px #14100e}

/* how-to tab */
.vf-help{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;align-items:start;align-content:start}
.vf-krow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 2px;
  border-bottom:2px dashed rgba(20,16,14,.18);font-size:13px;font-weight:700}
.vf-krow:last-child{border-bottom:0}
.vf-krow .keys{display:flex;gap:5px}
.vf-mvrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 2px;
  border-bottom:2px dashed rgba(20,16,14,.18);font-size:13px;font-weight:700}
.vf-mvrow:last-child{border-bottom:0}
.vf-mvrow .fr{display:flex;gap:7px}
.vf-mvrow .fr span{padding:3px 7px;border:2px solid var(--ink);border-radius:7px;font-size:11px;font-weight:800;background:#fff}
.vf-mvrow .fr .hi{background:var(--orange);color:#fff}
.vf-note{font-size:12px;font-weight:700;color:#6b6154;line-height:1.5;margin:8px 0 0}

/* stakes tab */
.vf-stake-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:2px 0 4px}
.vf-step{display:flex;gap:10px;align-items:flex-start;background:#fff;border:2.5px solid var(--ink);
  border-radius:var(--r-md);padding:10px}
.vf-step .n{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:8px;
  background:var(--lime);border:2.5px solid var(--ink);font-weight:800;font-size:13px}
.vf-step p{margin:0;font-size:12.5px;font-weight:700;color:#4a4238;line-height:1.35}
.vf-warn{display:flex;gap:9px;align-items:flex-start;background:var(--red);color:#fff;border:3px solid var(--ink);
  border-radius:var(--r-md);padding:10px 12px;font-size:13px;font-weight:700}
.vf-warn svg{flex:none;width:18px;height:18px;margin-top:1px}
.vf-stake-cta{display:flex;gap:9px;flex-wrap:wrap;margin-top:4px}

/* ---------- responsive ---------- */
@media (max-width:1400px){
  .vf-page[data-page="play"]{grid-template-columns:minmax(230px,290px) minmax(420px,460px)}
}
@media (max-width:1240px){
  .vf-page[data-page="play"]{grid-template-columns:minmax(230px,270px) minmax(350px,420px);gap:12px}
  .vf-lo-kicker{display:none}
  .vf-location{display:none}
}
@media (max-width:1020px){
  .vf-top{flex-wrap:wrap}
  .vf-logo h1{font-size:24px;-webkit-text-stroke:6px var(--ink)}
  .vf-page[data-page="play"]{
    grid-template-columns:1fr;grid-template-rows:auto auto auto;gap:12px;align-items:stretch;overflow-y:auto}
  .vf-stage{order:0;align-self:center;transform:none;margin-top:2vh;position:static;max-width:min(760px,100%)}
  .vf-prof-slot{order:1;justify-self:center;width:min(420px,100%)}
  .vf-stage .vf-charsub{display:none}
  .vf-mode{order:2;align-self:center;width:min(460px,100%)}
  .vf-prof{flex-direction:row;align-items:center;flex-wrap:wrap}
  .vf-bottom{position:static}
  .vf-lo-cards{overflow-x:auto;grid-auto-columns:118px;padding-bottom:2px;scrollbar-width:none}
  .vf-lo-cards::-webkit-scrollbar{display:none}
  .vf-lo{min-width:0}
}
@media (max-width:900px){
  .vf-roster-layout{grid-template-columns:1fr}
  .vf-hero{max-width:560px}
}
@media (max-width:560px){
  .vf-fc{flex-basis:calc((100% - 10px)/2)}
}
/* Short viewports: compact the chrome and let the play page scroll from the top instead of
   centring (a centred grid clips its own overflow above the fold). */
@media (max-height:900px){
  .vf-page:not([data-page="play"]){gap:12px}
  .vf-page h2{font-size:21px;margin-bottom:7px}
  .vf-grid{padding:14px;gap:9px}
  .vf-krow,.vf-mvrow{padding:5px 2px;font-size:12.5px}
  .vf-note{font-size:11.5px;margin-top:6px;line-height:1.45}
  .vf-roster-layout{gap:10px}
  .vf-hero{padding:12px;gap:8px}
  .vf-hero-portrait .vf-face{--face-size:72px}
  .vf-hero-name{font-size:31px}
  .vf-hero-blurb{font-size:11.5px;line-height:1.4}
  .vf-hero-stats{gap:5px;padding:8px 9px}
  .vf-fc{padding:9px;gap:6px}
  .vf-fc .vf-face{--face-size:42px}
  .vf-fc-id b{font-size:16px}
  .vf-fc-bars{gap:2px}
  .vf-mini{font-size:8.5px}
  .vf-fc-spell{padding-top:5px}
}
@media (max-height:780px){
  .vf-hero-blurb{display:none}
  .vf-hero-portrait .vf-face{--face-size:64px}
}
@media (max-height:800px){
  .vf-page[data-page="play"]{align-items:start}
  .vf-page[data-page="play"] .vf-prof-slot,.vf-page[data-page="play"] .vf-mode{align-self:start}
}
@media (prefers-reduced-motion:reduce){
  .vf-root .vf-panel,.vf-charname.swap,.vf-hero.swap{animation:none}
}
`;

const TAB_DEFS: { id: Tab; label: string; chip: string }[] = [
  { id: 'play', label: 'Play', chip: '1' },
  { id: 'fighters', label: 'Fighters', chip: '2' },
  { id: 'ladder', label: 'Ladder', chip: '3' },
  { id: 'how', label: 'How to play', chip: '4' },
  { id: 'stakes', label: 'Stakes', chip: '5' },
];

/* Remember the last mode + fighter so reloading does not reset your setup. */
const PREF_KEY = 'vf-lobby-prefs';
interface Prefs { mode?: Mode; fighter?: string; difficulty?: BotDifficulty }
function loadPrefs(): Prefs {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Prefs; } catch { return {}; }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPrefs(), ...p })); } catch { /* private mode */ }
}

const CONTROLS: { name: string; keys: string[]; extra?: string }[] = [
  { name: 'Move', keys: ['A', 'D'], extra: '← →' },
  { name: 'Jump', keys: ['W'], extra: '↑' },
  { name: 'Crouch', keys: ['S'], extra: '↓' },
  { name: 'Jab', keys: ['J'] },
  { name: 'Quick kick', keys: ['K'] },
  { name: 'Haymaker', keys: ['I'] },
  { name: 'Low kick', keys: ['U'] },
  { name: 'Sweep', keys: ['S', 'U'] },
  { name: 'Block', keys: ['L'] },
  { name: 'Spell', keys: ['Q'] },
  { name: 'Overdrive (EX)', keys: ['E'] },
  { name: 'Grab', keys: ['H'] },
  { name: 'Dash', keys: ['Shift'] },
];

/** Frame-data rows for the HOW TO PLAY page, straight from the shared move registry. */
const MOVE_ROWS = ATTACK_NAMES.map((m: MoveName) => {
  const mv = MOVES[m];
  return `<div class="vf-mvrow"><span>${mv.label}</span><span class="fr">
    <span class="hi">${mv.startup} SU</span><span>${mv.active} AC</span><span>${mv.recovery} RE</span>
    <span>${mv.input}</span></span></div>`;
}).join('');

export class Lobby {
  private el: HTMLElement;
  private st: HTMLElement;
  private stTxt!: HTMLElement;
  private stAct!: HTMLButtonElement;
  private roomInput!: HTMLInputElement;
  private stakeInput: HTMLInputElement | null = null;
  private roomInfo!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private playLbl!: HTMLElement;
  private nameEl!: HTMLElement;
  private subEl!: HTMLElement;
  private loadEl!: HTMLElement;
  private locEl!: HTMLElement;
  private heroEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private ltab: 'fighters' | 'spells' = 'fighters';
  private search = '';
  private prof: ProfileCard;
  private busyTargets: HTMLButtonElement[] = [];

  private fighter = '';
  private mode: Mode = 'bot';
  /** Selected practice-bot tier. Persisted, and sent with the match request. */
  private difficulty: BotDifficulty = 'normal';
  private tab: Tab = 'play';
  private scrollPos: Record<string, number> = {};
  private tabs: Tab[] = [];
  private visible = true;
  private lastRoom = '';
  private charsList: CharacterSpec[];

  constructor(parent: HTMLElement, chars: CharacterSpec[], private onPlay: (c: LobbyChoice) => void, private opts: LobbyOptions) {
    installTheme();
    this.charsList = chars;
    if (!document.getElementById('vf-lo-css')) {
      const s = document.createElement('style'); s.id = 'vf-lo-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    this.fighter = chars[0].id;
    const hasWallet = !!(window as unknown as { ethereum?: unknown }).ethereum;
    const TABS = TAB_DEFS.filter((t) => t.id !== 'stakes' || hasWallet);
    this.tabs = TABS.map((t) => t.id);
    const prefs = loadPrefs();
    const savedFighter = chars.find((c) => c.id === prefs.fighter)?.id;
    if (savedFighter) this.fighter = savedFighter;
    const savedMode = prefs.mode && (prefs.mode !== 'stake' || hasWallet) ? prefs.mode : undefined;
    const savedDiff = prefs.difficulty && BOT_DIFFICULTIES.includes(prefs.difficulty) ? prefs.difficulty : undefined;
    if (savedDiff) this.difficulty = savedDiff;
    const initMode: Mode = savedMode ?? (hasWallet ? 'room' : 'bot');
    this.mode = initMode;
    this.prof = new ProfileCard(opts.profile);

    const reg = opts.profile.raw;

    this.el = document.createElement('div');
    this.el.className = 'vf-root';
    this.el.innerHTML = `
      <header class="vf-top">
        <div class="vf-logo">
          <h1><span class="vibe">VIBE</span><span class="fighter">FIGHTER</span></h1><em>1V1 · BEST OF 3</em>
        </div>
        <nav class="vf-tabs vf-panel" role="tablist" aria-label="Lobby pages">
          ${TABS.map((t) => `<button class="vf-tab" role="tab" id="vf-tab-${t.id}" aria-controls="vf-page-${t.id}" data-tab="${t.id}" aria-selected="${t.id === 'play'}">${t.label}<span class="vf-kc">${t.chip}</span></button>`).join('')}
        </nav>
        <div class="vf-topright">
          <span class="vf-pill" id="vf-pill"><span class="dot"></span><span id="vf-pill-txt"></span></span>
          <button class="vf-icon" data-act="help" aria-label="How to play">${icon('question')}</button>
          <button class="vf-icon" data-act="fs" aria-label="Fullscreen">${icon('expand')}</button>
        </div>
      </header>

      <main class="vf-main">
        <section class="vf-page" id="vf-page-play" role="tabpanel" aria-labelledby="vf-tab-play" data-page="play" aria-label="Play">
          <div class="vf-prof-slot"></div>
          <div class="vf-stage">
            <h2 class="vf-charname" id="vf-charname">${this.fighter.toUpperCase()}</h2>
            <p class="vf-charsub" id="vf-charsub"></p>
            <div class="vf-changer">
              <button class="vf-icon" data-act="prev" aria-label="Previous fighter">${icon('chevL')}</button>
              <button class="vf-btn vf-change-btn" data-act="roster">${icon('shuffle')} Change fighter</button>
              <button class="vf-icon" data-act="next" aria-label="Next fighter">${icon('chevR')}</button>
            </div>
            <span class="vf-loadstate" id="vf-loadstate" hidden>Loading fighter…</span>
          </div>
          <aside class="vf-panel vf-mode">
            <h3><span>1V1 DUEL</span><span class="vf-chip orange" title="Server-authoritative, 60 Hz">LIVE</span></h3>
            <p class="vf-modedesc"><b>Best of three.</b> Pick a fighter below, choose how to play, then take the stage. ${DOLLAR} per side when staking.</p>
            <div class="vf-chips">
              <span class="vf-chip lime">${icon('scale', 14)} UNIQUE SPELLS</span>
              <span class="vf-chip">${icon('trophy', 14)} BEST OF 3</span>
            </div>
            <div class="vf-seg" role="group" aria-label="Match mode">
              <button data-mode="room" aria-pressed="${this.mode === 'room'}">Room</button>
              <button data-mode="bot" aria-pressed="${this.mode === 'bot'}">Bots</button>
              <button data-mode="ranked" aria-pressed="${this.mode === 'ranked'}">Ranked</button>
              ${hasWallet ? `<button data-mode="stake" aria-pressed="${(initMode as Mode) === 'stake'}">${DOLLAR}</button>` : ''}
            </div>
            <div class="vf-modeshow">
              <div data-mshow="room" ${this.mode === 'room' ? '' : 'hidden'}>
                <input class="vf-input" id="vf-room" placeholder="ROOM CODE" maxlength="12" aria-label="Room code" autocomplete="off" spellcheck="false" />
                <p class="vf-hint">Share the code, or leave it empty to generate one.</p>
              </div>
              <div data-mshow="bot" ${this.mode === 'bot' ? '' : 'hidden'}>
                <div class="vf-botinfo">${icon('gamepad')}<span>A server-side sparring bot joins instantly. Free, no wallet, same frame data as humans.</span></div>
                <div class="vf-diff" role="group" aria-label="Bot difficulty">
                  ${BOT_DIFFICULTIES.map((d) => `<button type="button" data-diff="${d}" aria-pressed="${d === this.difficulty}">${DIFFICULTY_INFO[d].label}</button>`).join('')}
                </div>
                <p class="vf-diffdesc" id="vf-diffdesc">${DIFFICULTY_INFO[this.difficulty].blurb}</p>
                <button class="vf-btn ghost" data-act="training" style="width:100%;margin-top:8px">${icon('bolt', 14)} TRAINING LAB · INFINITE METER</button>
              </div>
              <div data-mshow="ranked" ${this.mode === 'ranked' ? '' : 'hidden'}>
                <div class="vf-rk">
                  <div class="vf-rk-top">
                    <span class="vf-rk-tier" id="vf-rk-tier">BRONZE</span>
                    <span class="vf-rk-pts" id="vf-rk-pts">— LP</span>
                    <span class="vf-rk-rank" id="vf-rk-rank"></span>
                  </div>
                  <div class="vf-rk-bar"><i id="vf-rk-fill"></i></div>
                  <p class="vf-hint" id="vf-rk-note">Queue up against a player near your rating. Winners take the points.</p>
                  <button class="vf-btn ghost" data-act="signin" id="vf-rk-signin">SIGN IN WITH X</button>
                </div>
              </div>
              <div data-mshow="stake" ${(initMode as Mode) === 'stake' ? '' : 'hidden'}>
                <input class="vf-input" id="vf-stake" placeholder="MATCH ID" maxlength="80" aria-label="Match ID" autocomplete="off" spellcheck="false" />
                <p class="vf-hint">Empty creates a staked match; an ID joins one. Each side stakes ${DOLLAR}.</p>
              </div>
            </div>
            <div class="vf-rules">
              <div class="vf-rules-hd"><b>Match rules</b><span class="vf-chip lime" style="font-size:10px">FAIR</span></div>
              <ul>
                <li>99-second rounds, best of three</li>
                <li>Guard blocks all damage — it drains your guard meter</li>
                <li>One signature spell + one EX spell per fighter</li>
                <li>Perfect-guard a hit for a free punish</li>
              </ul>
              <p class="vf-rules-note" id="vf-lifenote">Ladder notes go here</p>
            </div>
            <span class="vf-roominfo" id="vf-roominfo" role="button" tabindex="0" aria-label="Copy room code">
              <span class="l">${icon('copy', 14)}<span>ROOM</span><b id="vf-roomcode">----</b></span>
              <span class="cp">${icon('copy', 16)}</span>
            </span>
            <div class="vf-actions">
              <button class="vf-btn ghost primary" data-act="howto">How to play</button>
            </div>
            <button class="vf-play" data-act="play" aria-label="Play">
              <span class="t" id="vf-playlbl">PLAY</span>
              <span class="s"><b>ENTER</b><span class="vf-kbd dark">↵</span></span>
            </button>
            <div class="vf-status" role="status" aria-live="polite">
              <span class="vf-status-txt"></span>
              <button class="vf-status-act" type="button" hidden></button>
            </div>
          </aside>
        </section>

        <section class="vf-page vf-fighters" id="vf-page-fighters" role="tabpanel" aria-labelledby="vf-tab-fighters" data-page="fighters" hidden aria-label="Fighter roster">
          <div class="vf-fighter-stage">
            <div class="vf-fighter-caption" id="vf-hero" aria-live="polite"></div>
          </div>
          <aside class="vf-loadout">
            <header class="vf-loadout-hd">
              <h2>YOUR FIGHTER</h2>
              <span class="vf-loadout-count">${chars.length} FIGHTERS</span>
            </header>
            <div class="vf-ltabs" role="tablist" aria-label="Loadout view">
              <button type="button" data-ltab="fighters" aria-pressed="true">Fighters</button>
              <button type="button" data-ltab="spells" aria-pressed="false">Spells</button>
            </div>
            <label class="vf-search">
              <span aria-hidden="true">${icon('question', 14)}</span>
              <input id="vf-search" placeholder="Find a fighter" autocomplete="off" spellcheck="false" aria-label="Find a fighter" />
            </label>
            <div class="vf-lgrid" id="vf-lgrid" role="list"></div>
            <div class="vf-equipped" id="vf-equipped" aria-live="polite">✓ EQUIPPED · RAM</div>
            <button class="vf-btn primary vf-loadout-cta" data-act="play-fighter">FIGHT AS RAM</button>
          </aside>
        </section>

        <section class="vf-page" id="vf-page-ladder" role="tabpanel" aria-labelledby="vf-tab-ladder" data-page="ladder" hidden aria-label="Ranked ladder">
          <div class="vf-panel vf-paper vf-grid">
            <div class="vf-roster-hd">
              <div>
                <h2>${icon('trophy', 22)} RANKED LADDER</h2>
                <p class="vf-note">Queue up, fight, climb. A win is worth more than a loss costs, so playing the ladder always moves you up eventually.</p>
              </div>
              <span class="vf-chip lime" id="vf-ladder-total">— PLAYERS</span>
            </div>
            <div class="vf-ladder" id="vf-ladder"><p class="vf-note">Loading…</p></div>
            <div class="vf-actions">
              <button class="vf-btn ghost" data-act="ladder-refresh">REFRESH</button>
              <button class="vf-btn ghost" data-act="signin">SIGN IN WITH X</button>
            </div>
            <p class="vf-note">Top 50 by ladder points. Points are awarded on the server from a settled match, never from the client.</p>
          </div>
        </section>

        <section class="vf-page" id="vf-page-how" role="tabpanel" aria-labelledby="vf-tab-how" data-page="how" hidden aria-label="How to play">
          <div class="vf-help vf-paper">
            <div class="vf-panel vf-grid">
              <h2>CONTROLS</h2>
              ${CONTROLS.map((r) => `<div class="vf-krow"><span>${r.name}</span><span class="keys">${r.keys.map((k) => `<span class="vf-kbd">${k}</span>`).join('')}${r.extra ? `<span class="vf-kbd">${r.extra}</span>` : ''}</span></div>`).join('')}
              <div class="vf-krow"><span>Gamepad</span><span class="keys">${icon('gamepad', 18)}</span></div>
              <div class="vf-krow"><span>Hitbox debug</span><span class="keys"><span class="vf-kbd dark">F1</span></span></div>
            </div>
            <div class="vf-panel vf-grid">
              <h2>FRAMES &amp; RULES</h2>
              ${MOVE_ROWS}
              <div class="vf-mvrow"><span>${icon('scale', 16)} Clash</span><span style="font-size:12px">identical moves cancel out</span></div>
              <p class="vf-note">SU = startup · AC = active · RE = recovery, at 60 Hz. J/K in the air are overheads (one per jump). H grabs through guard. Shift dashes, and the tail of a dash can be cancelled into a normal.</p>
              <p class="vf-note"><b>Guard blocks everything.</b> Hold L and incoming strikes, spells and projectiles deal <b>zero</b> damage — only a grab gets through. Guarding is not free: every blocked hit drains your <b>guard meter</b> (the blue bar). Empty it and the guard breaks, leaving you stunned and wide open. Blocking pressure is good; turtling forever is not.</p>
              <p class="vf-note"><b>Mana 0–100.</b> You start at 30, gain +6/s, +6 per hit and +3 per block. Each fighter has <b>one signature spell only they can cast</b>, each with its own cost (32–55), frames and behaviour: Ram's rolling low wave, Cap's two-hit crescent, Antenna's duckable lance, Mohawk's armoured reversal, Prop's self-recoiling vortex. Light normals chain into heavies, and anything that connects can cancel into the spell.</p>
              <p class="vf-note"><b>Overdrive (EX).</b> The gold bar fills as you deal <i>and</i> take damage. A full bar buys that fighter's EX spell on <span class="vf-kbd dark">E</span> — Ram's armoured double wave, Cap's three-crescent barrage, Antenna's full-height lance, Mohawk's 30-damage reversal, Prop's double vortex. It is a comeback tool, not a free hit: every EX is slow to recover.</p>
              <p class="vf-note"><b>Defence.</b> Guard blocks everything for free but drains the blue guard meter — empty it and your guard breaks. Tap <span class="vf-kbd dark">L</span> just before a hit (3 frames) for a <b>perfect guard</b>: no guard damage and no blockstun, so you can punish immediately. Two grabs that meet cancel into a <b>throw tech</b>.</p>
              <p class="vf-note">Two players: open a second tab or share the room code with a friend. Round timer <b>99 → 0</b>, then whoever has more health takes the round. Every match seeds a fresh arena from the match ID and the fighter pair.</p>
            </div>
          </div>
        </section>

        ${hasWallet ? `<section class="vf-page" id="vf-page-stakes" role="tabpanel" aria-labelledby="vf-tab-stakes" data-page="stakes" hidden aria-label="Staked matches">
          <div class="vf-panel vf-paper vf-grid">
            <h2>${icon('wallet', 22)} STAKED MATCHES <span class="vf-chip">${DOLLAR} EACH SIDE</span></h2>
            <div class="vf-stake-steps">
              <div class="vf-step"><span class="n">1</span><p>Create or join a match and approve the ${DOLLAR} USDC stake in the escrow contract.</p></div>
              <div class="vf-step"><span class="n">2</span><p>Fight the best of three. The server signs the result with an EIP-712 key.</p></div>
              <div class="vf-step"><span class="n">3</span><p>The winner claims the full pot on-chain using the signed victory.</p></div>
            </div>
            <div class="vf-stake-cta">
              <button class="vf-btn primary" data-act="stake-create">${icon('play', 16)} CREATE ${DOLLAR} MATCH</button>
              <button class="vf-btn" data-act="stake-join">JOIN WITH MATCH ID</button>
            </div>
            ${STAKES_CONFIGURED ? '' : `<div class="vf-warn">${icon('question', 18)}<span>Escrow contract addresses are placeholders, so staking is in demo mode. Wire up ESCROW_ADDRESS and STAKE_TOKEN before going live with real money.</span></div>`}
            <p class="vf-note">Claims stay valid for 24 hours. Matches that never settle are refundable on-chain.</p>
          </div>
        </section>` : ''}
      </main>

      <div class="vf-bottom">
        <div class="vf-loadbar">
          <div class="vf-lo-hd">
            <span class="vf-lo-title">LOADOUT</span>
            <span class="vf-lo-kicker">SAME KIT · NOTHING CARRIED IN</span>
          </div>
          <div class="vf-lo-cards">
            ${[
              ['J', 'Jab', `${MOVES.LightPunch.startup}f`],
              ['K', 'Quick kick', `${MOVES.LightKick.startup}f`],
              ['I', 'Haymaker', `${MOVES.HeavyPunch.startup}f`],
              ['Q', 'Spell', '32–55 mana'],
              ['E', 'Overdrive', 'full meter'],
              ['H', 'Grab', 'beats guard'],
              ['⇧', 'Dash', '2.2 m'],
              ['S+U', 'Sweep', 'knockdown'],
            ].map(([k, n, d]) => `<div class="vf-lo"><span class="vf-kbd">${k}</span><b>${n}</b><small>${d}</small></div>`).join('')}
          </div>
          <span class="vf-location" id="vf-location">Neon Foundry · Home turf · 60 Hz</span>
        </div>
      </div>`;

    // mount profile card + wire up
    this.el.querySelector('.vf-prof-slot')!.appendChild(this.prof.element);
    // Sign-in lives next to the identity it changes, not only inside the ranked panel.
    const signBtn = document.createElement('button');
    signBtn.type = 'button';
    signBtn.className = 'vf-btn vf-prof-signin';
    signBtn.dataset.act = 'signin';
    const signed = getSession();
    signBtn.textContent = signed
      ? `SIGNED IN AS @${signed.handle.toUpperCase()}${signed.mock ? ' · DEMO' : ''}`
      : 'SIGN IN WITH X';
    this.el.querySelector('.vf-prof-slot')!.appendChild(signBtn);
    PILLS(this.el.querySelector('#vf-pill-txt')!, hasWallet);
    if (signed) this.el.querySelector('#vf-pill-txt')!.textContent = `@${signed.handle.toUpperCase()}`;
    this.el.querySelector('#vf-lifenote')!.textContent =
      reg.wins + reg.losses > 0
        ? `@${opts.profile.handle} · ${reg.wins}W ${reg.losses}L · best streak ${reg.bestStreak} · local stats`
        : `First match of the day? The bot is warmed up. · local stats`;

    const roomInput = this.el.querySelector<HTMLInputElement>('#vf-room')!;
    this.roomInput = roomInput;
    this.stakeInput = this.el.querySelector<HTMLInputElement>('#vf-stake') ?? null; // absent without wallet
    this.st = this.el.querySelector('.vf-status')!;
    this.stTxt = this.el.querySelector('.vf-status-txt')!;
    this.stAct = this.el.querySelector('.vf-status-act')!;
    this.roomInfo = this.el.querySelector('#vf-roominfo')!;
    this.nameEl = this.el.querySelector('#vf-charname')!;
    this.subEl = this.el.querySelector('#vf-charsub')!;
    this.loadEl = this.el.querySelector('#vf-loadstate')!;
    this.locEl = this.el.querySelector('#vf-location')!;
    this.playBtn = this.el.querySelector('[data-act="play"]')!;
    this.playLbl = this.el.querySelector('#vf-playlbl')!;
    this.busyTargets = [...this.el.querySelectorAll<HTMLButtonElement>('[data-act="play"], [data-act="howto"], .vf-seg button, .vf-stake-cta .vf-btn')];

    // Fighters tab: the loadout grid on the right, the 3D preview + caption on the left.
    this.heroEl = this.el.querySelector('#vf-hero')!;
    this.gridEl = this.el.querySelector('#vf-lgrid')!;
    this.searchEl = this.el.querySelector<HTMLInputElement>('#vf-search')!;
    this.searchEl.addEventListener('input', () => {
      this.search = this.searchEl.value.trim().toLowerCase();
      this.renderLoadout();
    });
    this.el.querySelectorAll<HTMLElement>('[data-ltab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.ltab = (b.dataset.ltab === 'spells' ? 'spells' : 'fighters');
        this.el.querySelectorAll<HTMLElement>('[data-ltab]').forEach((x) =>
          x.setAttribute('aria-pressed', String(x.dataset.ltab === this.ltab)));
        this.renderLoadout();
      });
    });
    this.renderHero(this.fighter);
    this.renderLoadout();

    // events
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-act],[data-mode],[data-diff],[data-id],#vf-roominfo');
      if (!t) return;
      if (t.dataset.tab) this.setTab(t.dataset.tab as Tab);
      else if (t.dataset.mode) this.setMode(t.dataset.mode as Mode);
      else if (t.dataset.diff) this.setDifficulty(t.dataset.diff as BotDifficulty);
      else if (t.dataset.id) this.selectFighter(t.dataset.id);
      else if (t.id === 'vf-roominfo') this.copyRoom();
      else if (t.dataset.act === 'play') this.play();
      else if (t.dataset.act === 'training') this.play(true);
      else if (t.dataset.act === 'signin') this.signIn();
      else if (t.dataset.act === 'ladder-refresh') void this.loadLadder();
      else if (t.dataset.act === 'play-fighter') this.play();
      else if (t.dataset.act === 'howto') this.setTab('how');
      else if (t.dataset.act === 'roster') this.setTab('fighters');
      else if (t.dataset.act === 'to-play') this.setTab('play');
      else if (t.dataset.act === 'prev') this.cycleFighter(-1);
      else if (t.dataset.act === 'next') this.cycleFighter(1);
      else if (t.dataset.act === 'stake-create') { this.setMode('stake'); this.setTab('play'); this.play(); }
      else if (t.dataset.act === 'stake-join') { this.setMode('stake'); this.setTab('play'); this.stakeInput?.focus(); }
      else if (t.dataset.act === 'help') this.setTab('how');
      else if (t.dataset.act === 'fs') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const t = (e.target as HTMLElement).closest<HTMLElement>('#vf-roominfo');
        if (t) { e.preventDefault(); this.copyRoom(); }
      }
    });

    this.setMode(this.mode);
    this.selectFighter(this.fighter, true);
    parent.appendChild(this.el);
    addEventListener('keydown', this.onKey);
  }

  /* ------------------------------ selection ------------------------------ */

  private selectFighter(id: string, init = false) {
    this.fighter = id;
    this.nameEl.textContent = (this.charsList.find((c) => c.id === id)?.name ?? id).toUpperCase();
    this.nameEl.classList.remove('swap');
    if (!init) {
      void this.nameEl.offsetWidth;                 // restart the swap animation
      this.nameEl.classList.add('swap');
    }
    const spec = this.charsList.find((c) => c.id === id);
    if (spec) this.subEl.textContent = `Your fighter · ${spec.archetype}`;
    this.locEl.textContent = `${affinityStage(id).name} · Home turf · 60 Hz`;
    const [head, accent] = SWATCH[id] ?? ['#888', '#fff'];
    this.prof.setFighterColors(head, accent);
    this.el.querySelectorAll<HTMLButtonElement>('.vf-fc').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    this.renderHero(id);
    this.renderLoadout();
    this.opts.onFighterChange?.(id);
    if (!init) savePrefs({ fighter: id });
    this.setPreviewState('loading');
  }

  /** Caption under the 3D preview on the FIGHTERS tab (name, archetype, kit). */
  private renderHero(id: string) {
    const c = this.charsList.find((x) => x.id === id) ?? this.charsList[0];
    if (!c || !this.heroEl) return;
    const spell = spellFor(c.id);
    const stage = affinityStage(c.id);
    this.heroEl.innerHTML = `
      <h2 class="vf-cap-name">${c.name.toUpperCase()}</h2>
      <p class="vf-cap-arch">${c.archetype}</p>
      <div class="vf-cap-meta">
        <span class="vf-cap-chip">${c.heightM.toFixed(2)} m</span>
        <span class="vf-cap-chip">${spell.glyph} ${spell.name}</span>
        <span class="vf-cap-chip">EX ${spell.overdrive.name}</span>
        <span class="vf-cap-chip">${icon('pin', 12)} ${stage.name}</span>
      </div>
      <p class="vf-cap-hint">${BLURB[c.id] ?? 'A fair-kit fighter with a silhouette of their own.'}</p>`;
  }

  /** Right-hand loadout grid: fighters, or their spells. Filtered by the search box. */
  private renderLoadout() {
    if (!this.gridEl) return;
    const q = this.search;
    const match = (c: (typeof this.charsList)[number]) => {
      if (!q) return true;
      const s = spellFor(c.id);
      return c.name.toLowerCase().includes(q) || c.archetype.toLowerCase().includes(q)
        || s.name.toLowerCase().includes(q) || s.overdrive.name.toLowerCase().includes(q);
    };
    const list = this.charsList.filter(match);

    if (this.ltab === 'spells') {
      this.gridEl.innerHTML = list.map((c) => {
        const s = spellFor(c.id);
        return `<button type="button" class="vf-lcard spell" data-id="${c.id}" aria-pressed="${c.id === this.fighter}"
            aria-label="${s.name}, ${c.name}'s signature spell, ${s.cost} mana">
          ${c.id === this.fighter ? '<span class="vf-lcard-check">✓</span>' : ''}
          <span class="vf-lcard-face">${s.glyph}</span>
          <span class="vf-lcard-name">${s.name}</span>
          <span class="vf-lcard-tag">${c.name.toUpperCase()} · ${s.cost} MANA</span>
          <span class="vf-lcard-tag">EX ${s.overdrive.name}</span>
        </button>`;
      }).join('');
    } else {
      this.gridEl.innerHTML = list.map((c) => {
        const [head, accent] = SWATCH[c.id] ?? ['#888', '#fff'];
        return `<button type="button" class="vf-lcard" data-id="${c.id}" aria-pressed="${c.id === this.fighter}"
            aria-label="Select ${c.name}, ${c.archetype}" style="--head:${head};--eye:${accent}">
          ${c.id === this.fighter ? '<span class="vf-lcard-check">✓</span>' : ''}
          <span class="vf-lcard-face"></span>
          <span class="vf-lcard-name">${c.name}</span>
          <span class="vf-lcard-tag">${c.archetype}</span>
        </button>`;
      }).join('');
    }
    if (!list.length) this.gridEl.innerHTML = '<p class="vf-note" style="grid-column:1/-1">No fighter matches that search.</p>';

    const name = (this.charsList.find((c) => c.id === this.fighter)?.name ?? this.fighter).toUpperCase();
    const eq = this.el.querySelector<HTMLElement>('#vf-equipped');
    if (eq) eq.textContent = `✓ EQUIPPED · ${name}`;
    const cta = this.el.querySelector<HTMLElement>('[data-act="play-fighter"]');
    if (cta) cta.textContent = `FIGHT AS ${name}`;
  }

  /** Drives the shimmer chip under the fighter name while the 3D model builds. */
  setPreviewState(state: 'loading' | 'ready' | 'error') {
    if (!this.loadEl) return;
    this.loadEl.hidden = state === 'ready';
    this.loadEl.textContent = state === 'error' ? 'Preview unavailable' : 'Loading fighter…';
    this.loadEl.classList.toggle('err', state === 'error');
  }

  private cycleFighter(dir: -1 | 1) {
    const ids = this.charsList.map((c) => c.id);
    const i = (ids.indexOf(this.fighter) + dir + ids.length) % ids.length;
    this.selectFighter(ids[i]);
  }

  /* ------------------------------ state ------------------------------ */

  private setMode(m: Mode) {
    this.mode = m;
    this.el.querySelectorAll<HTMLButtonElement>('.vf-seg button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    ['room', 'bot', 'ranked', 'stake'].forEach((k) => {
      const el = this.el.querySelector<HTMLElement>(`[data-mshow="${k}"]`);
      if (el) el.hidden = k !== m;
    });
    this.playLbl.textContent = m === 'bot' ? 'FIGHT BOT' : m === 'stake' ? `STAKE ${DOLLAR}` : m === 'ranked' ? 'FIND MATCH' : 'PLAY';
    savePrefs({ mode: m });
    if (m === 'ranked') void this.refreshRanked();
  }

  /**
   * Bot difficulty: rendered as a six-tier picker, persisted across reloads and sent with the
   * match. (Previously the buttons were decorative — the value was never stored or transmitted.)
   */
  private setDifficulty(d: BotDifficulty) {
    this.difficulty = d;
    this.el.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.diff === d)));
    const desc = this.el.querySelector<HTMLElement>('#vf-diffdesc');
    if (desc) desc.textContent = DIFFICULTY_INFO[d].blurb;
    savePrefs({ difficulty: d });
  }

  private setTab(t: Tab) {
    if (t === this.tab) return;
    // Remember where each page was scrolled to, so switching tabs does not lose your place.
    const cur = this.el.querySelector<HTMLElement>(`.vf-page[data-page="${this.tab}"]`);
    if (cur) this.scrollPos[this.tab] = cur.scrollTop;
    this.tab = t;
    this.el.querySelectorAll<HTMLButtonElement>('.vf-tab').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    this.el.querySelectorAll<HTMLElement>('.vf-page').forEach((p) => {
      p.hidden = p.dataset.page !== t;
    });
    const next = this.el.querySelector<HTMLElement>(`.vf-page[data-page="${t}"]`);
    if (next) next.scrollTop = this.scrollPos[t] ?? 0;
    if (t === 'ladder') void this.loadLadder();
  }

  /** Send the browser to the server's X OAuth start (the token never touches JS). */
  private signIn() {
    // The `as` hint is a no-op unless the server is running its mock login (no X credentials).
    location.href = signInUrl(this.opts.server, mockName());
  }

  /** Fetch the ladder and render it. Safe to call repeatedly; failures keep the old rows. */
  private async loadLadder() {
    const box = this.el.querySelector<HTMLElement>('#vf-ladder');
    if (!box) return;
    try {
      const res = await fetch(`${this.opts.server}/api/leaderboard?limit=50`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { players: LeaderboardEntry[]; total: number };
      this.el.querySelector('#vf-ladder-total')!.textContent = `${data.total} PLAYERS`;
      if (!data.players.length) {
        box.innerHTML = '<p class="vf-note">No ranked matches yet — queue up and be the first name on the board.</p>';
        return;
      }
      const me = getSession()?.pid;
      box.innerHTML = `
        <div class="vf-ladder-row head"><span>#</span><span>Player</span><span class="num">LP</span><span class="num">W/L</span><span>Tier</span></div>
        ${data.players.map((p) => `<div class="vf-ladder-row${p.pid === me ? ' me' : ''}">
          <span class="num">${p.rank}</span>
          <span class="nm">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}<span>@${esc(p.handle)}</span></span>
          <span class="num">${p.points}</span>
          <span class="num">${p.wins}/${p.losses}</span>
          <span class="tier">${esc(p.tier)}</span>
        </div>`).join('')}`;
    } catch {
      box.innerHTML = '<p class="vf-note">Could not load the ladder. Is the server running?</p>';
    }
  }

  /** Refresh the ranked panel: tier, points, rank and the sign-in state. */
  private async refreshRanked() {
    const tierEl = this.el.querySelector<HTMLElement>('#vf-rk-tier');
    const ptsEl = this.el.querySelector<HTMLElement>('#vf-rk-pts');
    const rankEl = this.el.querySelector<HTMLElement>('#vf-rk-rank');
    const fill = this.el.querySelector<HTMLElement>('#vf-rk-fill');
    const note = this.el.querySelector<HTMLElement>('#vf-rk-note');
    const btn = this.el.querySelector<HTMLButtonElement>('#vf-rk-signin');
    if (!tierEl || !ptsEl || !rankEl || !fill || !note || !btn) return;

    const session = getSession();
    if (!session) {
      tierEl.textContent = 'GUEST';
      ptsEl.textContent = '— LP';
      rankEl.textContent = 'SIGN-IN ONLY';
      fill.style.width = '0%';
      note.textContent = 'Ranked is account-only: sign in with X to queue, earn points and appear on the ladder.';
      btn.hidden = false;
      btn.textContent = 'SIGN IN WITH X TO PLAY RANKED';
      this.el.querySelectorAll<HTMLElement>('[data-act="signin"]').forEach((b) => { b.textContent = 'SIGN IN WITH X'; });
      if (this.mode === 'ranked') this.playLbl.textContent = 'SIGN IN TO PLAY';
      return;
    }

    btn.textContent = `SIGNED IN AS @${session.handle.toUpperCase()}${session.mock ? ' · DEMO' : ''}`;
    btn.hidden = false;
    this.el.querySelectorAll<HTMLElement>('[data-act="signin"]').forEach((b) => {
      b.textContent = `SIGNED IN AS @${session.handle.toUpperCase()}${session.mock ? ' · DEMO' : ''}`;
    });
    if (this.mode === 'ranked') this.playLbl.textContent = 'FIND MATCH';
    try {
      const res = await fetch(`${this.opts.server}/api/me`, { headers: { authorization: `Bearer ${session.token}` } });
      if (!res.ok) throw new Error(String(res.status));
      const p = await res.json() as { handle: string; points: number; rating: number; wins: number; losses: number; rank: number; tier: string };
      tierEl.textContent = p.tier.toUpperCase();
      ptsEl.textContent = `${p.points} LP`;
      rankEl.textContent = `RANK #${p.rank}`;
      fill.style.width = `${Math.round(tierProgress(p.points) * 100)}%`;
      note.textContent = `${p.wins}W ${p.losses}L · matchmaking rating ${p.rating} · winner takes the points${session.mock ? ' · demo account (no X credentials on the server)' : ''}`;
      void tierOf(p.points);
    } catch {
      note.textContent = 'Signed in, but the ladder service did not answer.';
    }
  }

  private showRoom(code: string) {
    this.lastRoom = code;
    const chip = this.roomInfo;
    chip.classList.add('show');
    chip.querySelector('#vf-roomcode')!.textContent = code;
  }

  private async copyRoom() {
    if (!this.lastRoom) return;
    try {
      await navigator.clipboard.writeText(this.lastRoom);
      const cp = this.roomInfo.querySelector('.cp')!;
      cp.innerHTML = icon('check', 16);
      setTimeout(() => (cp.innerHTML = icon('copy', 16)), 1200);
    } catch { this.status(`Room code: ${this.lastRoom}`); }
  }

  /* ------------------------------ play ------------------------------ */

  private play(training = false) {
    let mode: LobbyChoice['mode'] = 'bot';
    let room: string | undefined;
    if (training) {
      mode = 'bot';
    } else if (this.mode === 'ranked') {
      // Ranked is account-only: the play button becomes the sign-in button when logged out.
      if (!getSession()) { this.signIn(); return; }
      mode = 'ranked';
    } else if (this.mode === 'bot') mode = 'bot';
    else if (this.mode === 'room') {
      mode = 'room';
      room = this.roomInput.value.trim().toUpperCase() ||
        Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 6).toUpperCase();
      this.roomInput.value = room;
      this.showRoom(room);
      this.status(`Room ${room} — waiting for an opponent…`);
    } else {
      const id = this.stakeInput?.value.trim() ?? '';
      if (!id) { mode = 'stake-create'; this.status(`Confirm the ${DOLLAR} stake in your wallet…`); }
      else { mode = 'stake-join'; room = id; this.status(`Joining match ${id}…`); }
    }
    this.onPlay({
      mode, fighter: this.fighter, room,
      difficulty: mode === 'bot' ? this.difficulty : undefined,
      training: training || undefined,
    });
  }

  /* ------------------------------ public API ------------------------------ */

  /**
   * Status line with an optional action button (Cancel / Retry). Every waiting state gets an escape
   * hatch so the lobby can never trap the player again.
   */
  status(text: string, error = false, action?: { label: string; run: () => void }) {
    this.stTxt.textContent = text;
    this.st.classList.toggle('err', error);
    this.st.classList.toggle('on', !!text);
    this.stAct.hidden = !action;
    this.stAct.textContent = action?.label ?? '';
    this.stAct.onclick = action ? () => action.run() : null;
  }

  clearStatus() { this.status(''); }

  busy(v: boolean) {
    this.busyTargets.forEach((b) => (b.disabled = v));
  }

  /** Re-render the profile card after local stats change (match settled). */
  refreshProfile() {
    this.prof.refresh();
    void this.refreshRanked();
    const reg = this.opts.profile.raw;
    this.el.querySelector('#vf-lifenote')!.textContent = reg.wins + reg.losses > 0
      ? `@${this.opts.profile.handle} · ${reg.wins}W ${reg.losses}L · best streak ${reg.bestStreak} · local stats`
      : `First match of the day? The bot is warmed up. · local stats`;
  }

  hide() { this.el.hidden = true; this.visible = false; }
  show() { this.el.hidden = false; this.visible = true; this.busy(false); this.clearStatus(); void this.refreshRanked(); }

  /* ------------------------------ global keys ------------------------------ */

  private onKey = (e: KeyboardEvent) => {
    if (!this.visible) return;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.veil.show')) return;      // a match dialog owns the keyboard
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    // Only a real digit is a tab shortcut: Number('') is 0 and Number(' ') is 0, which used to
    // swallow Space and stray key events.
    if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key);
      if (n <= this.tabs.length) { e.preventDefault(); this.setTab(this.tabs[n - 1]); return; }
    }
    if (this.tab !== 'play') return;
    if (e.key === 'Enter') {
      if (el && el.tagName === 'BUTTON') return;      // ENTER on a focused button is normal activation
      this.play(); return;
    }
    if (e.key === 'ArrowLeft') this.cycleFighter(-1);
    else if (e.key === 'ArrowRight') this.cycleFighter(1);
  };
}

/** Top-right mode pill content. */
/** Escape untrusted display names/URLs before they touch innerHTML. */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function PILLS(el: HTMLElement, hasWallet: boolean) {
  el.textContent = hasWallet ? 'WALLET READY' : 'FREE PRACTICE';
  el.closest('.vf-pill')?.classList.toggle('dev', !hasWallet);
}
