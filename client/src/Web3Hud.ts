import { BrowserProvider, Contract, type Eip1193Provider } from 'ethers';
import { GUARD_MAX, MAX_MANA, OD_MAX, SPELL_COST, type SpellTheme } from './moves';

/* ---------------------------------------------------------------
 * Contract assumptions (adjust to your deployed ABI):
 *  - $1 stake is paid in a 6-decimal stablecoin (USDC): approve(escrow, 1e6) then createMatch()/joinMatch().
 *  - createMatch() emits MatchCreated(uint256 indexed matchId, address indexed creator).
 *  - claimVictory is verified on-chain against the match server's EIP-712 / ECDSA signature.
 * The ABI below is `as const` so it can be passed directly to wagmi's writeContract / useWriteContract.
 * --------------------------------------------------------------- */
export const ESCROW_ADDRESS = '0xYourEscrowContract' as const;
export const STAKE_TOKEN = '0xYourUSDC' as const;
export const STAKE_AMOUNT = 1_000_000n; // $1.00 @ 6 decimals

export const ESCROW_ABI = [
  { type: 'function', name: 'createMatch', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: 'matchId', type: 'uint256' }] },
  { type: 'function', name: 'joinMatch', stateMutability: 'nonpayable', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claimVictory', stateMutability: 'nonpayable', outputs: [], inputs: [
    { name: 'matchId', type: 'uint256' }, { name: 'winner', type: 'address' },
    { name: 'p1Rounds', type: 'uint8' }, { name: 'p2Rounds', type: 'uint8' },
    { name: 'deadline', type: 'uint256' }, { name: 'signature', type: 'bytes' } ] },
  { type: 'event', name: 'MatchCreated', inputs: [
    { name: 'matchId', type: 'uint256', indexed: true }, { name: 'creator', type: 'address', indexed: true } ] },
] as const;
const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'];

async function signerAndContracts() {
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!eth) throw new Error('No wallet found. Install a browser wallet to stake.');
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  return {
    signer,
    escrow: new Contract(ESCROW_ADDRESS, ESCROW_ABI, signer),
    token: new Contract(STAKE_TOKEN, ERC20_ABI, signer),
  };
}

async function ensureAllowance(token: Contract, owner: string) {
  const current: bigint = await token.allowance(owner, ESCROW_ADDRESS);
  if (current >= STAKE_AMOUNT) return;
  await (await token.approve(ESCROW_ADDRESS, STAKE_AMOUNT)).wait();
}

/** Wallet login for the socket handshake: signs the server's session nonce message. */
export async function walletLogin(message: string): Promise<{ address: string; signature: string }> {
  const { signer } = await signerAndContracts();
  return { address: await signer.getAddress(), signature: await signer.signMessage(message) };
}

export async function createMatch(): Promise<string> {
  const { signer, escrow, token } = await signerAndContracts();
  await ensureAllowance(token, await signer.getAddress());
  const receipt = await (await escrow.createMatch()).wait();
  const log = receipt.logs.map((l: any) => { try { return escrow.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === 'MatchCreated');
  if (!log) throw new Error('Match created, but no MatchCreated event was found.');
  return (log.args.matchId as bigint).toString();
}

export async function joinMatch(matchId: string) {
  const { signer, escrow, token } = await signerAndContracts();
  await ensureAllowance(token, await signer.getAddress());
  await (await escrow.joinMatch(BigInt(matchId))).wait();
}

export interface VictoryPayload { matchId: string; winner: string; p1Rounds: number; p2Rounds: number; deadline: number; signature: string; dev?: boolean }

export async function claimVictory(p: VictoryPayload) {
  if (Date.now() / 1000 > p.deadline) throw new Error('The claim window has expired.');
  const { escrow } = await signerAndContracts();
  const tx = await escrow.claimVictory(BigInt(p.matchId), p.winner, p.p1Rounds, p.p2Rounds, BigInt(p.deadline), p.signature);
  return (await tx.wait()).hash as string;
}

/* ------------------------------ HUD overlay ------------------------------ */

const CSS = `
.hud{position:fixed;inset:0;pointer-events:none;font-family:'Bungee','Impact',system-ui,sans-serif;color:#fff;
  --ink:#100c1e;--paper:#f7f2ea;--hp:#d9ff3f;--drain:#ff3d5a;--cyan:#2ad4ff;--violet:#7a5cff;
  --glass:rgba(7,6,26,.74);--edge:rgba(247,242,234,.9);--font-body:'Archivo',system-ui,sans-serif}
.hud *{box-sizing:border-box}
.hud-top{position:absolute;top:max(12px,env(safe-area-inset-top));left:0;right:0;display:grid;grid-template-columns:1fr 112px 1fr;gap:10px;padding:0 14px;align-items:start}
.bar{height:32px;background:var(--glass);border:3px solid var(--edge);border-radius:10px;position:relative;overflow:hidden;
  box-shadow:0 5px 0 rgba(7,6,26,.7),0 16px 30px rgba(7,6,26,.35),inset 0 0 0 2px rgba(7,6,26,.35);backdrop-filter:blur(6px)}
.bar .drain,.bar .fill{position:absolute;inset:0;transform-origin:left center}
.bar .drain{background:var(--drain);transition:transform .7s cubic-bezier(.3,0,.2,1) .45s}
.bar .fill{background:linear-gradient(180deg,var(--hp),#b9e520);transition:transform .08s linear;box-shadow:0 0 18px rgba(217,255,63,.35)}
.p2 .bar .drain,.p2 .bar .fill{transform-origin:right center}
.mana{height:12px;margin-top:6px;background:var(--glass);border:2.5px solid var(--edge);border-radius:6px;position:relative;overflow:hidden}
.mana .fill{position:absolute;inset:0;transform-origin:left center;transition:transform .12s linear;
  background:linear-gradient(90deg,var(--cyan),var(--violet) 62%,#d17aff);box-shadow:0 0 12px rgba(42,212,255,.5)}
.p2 .mana .fill{transform-origin:right center}
.guard{height:10px;margin-top:5px;background:var(--glass);border:2.5px solid var(--edge);border-radius:6px;position:relative;overflow:hidden}
.guard .fill{position:absolute;inset:0;transform-origin:left center;transition:transform .1s linear;
  background:linear-gradient(90deg,#9ad7ff,#5f8fff);box-shadow:0 0 10px rgba(154,215,255,.55)}
.p2 .guard .fill{transform-origin:right center}
.guard.low .fill{background:linear-gradient(90deg,var(--drain),#ff9d3d);box-shadow:0 0 12px rgba(255,61,90,.6)}
.guard.broken{animation:vfGuardBreak .5s ease-out}
@keyframes vfGuardBreak{0%,100%{transform:none}15%{transform:translateX(-4px) rotate(-1deg)}35%{transform:translateX(4px) rotate(1deg)}55%{transform:translateX(-3px)}75%{transform:translateX(2px)}}
.od{height:9px;margin-top:5px;background:var(--glass);border:2.5px solid var(--edge);border-radius:6px;position:relative;overflow:hidden}
.od .fill{position:absolute;inset:0;transform-origin:left center;transition:transform .1s linear;
  background:linear-gradient(90deg,#ffd166,#ff8a3d);box-shadow:0 0 10px rgba(255,209,102,.6)}
.p2 .od .fill{transform-origin:right center}
.od .tag{position:absolute;right:4px;top:-2px;font-family:var(--font-body);font-size:8px;font-weight:800;
  letter-spacing:.1em;color:rgba(247,242,234,.4)}
.p2 .od .tag{right:auto;left:4px}
.od.full{border-color:#ffd166;box-shadow:0 0 0 2px rgba(255,209,102,.35),0 0 18px rgba(255,138,61,.55)}
.od.full .tag{color:#100c1e;background:#ffd166;border-radius:4px;padding:0 3px;top:0}
.ping{display:block;width:max-content;margin:2px auto 0;padding:1px 6px;border-radius:6px;
  font-family:var(--font-body);font-size:10px;font-weight:800;letter-spacing:.08em;
  color:rgba(247,242,234,.65);background:rgba(7,6,26,.6);text-transform:uppercase}
.ping.bad{color:#ff9d3d}
.center{display:flex;flex-direction:column;align-items:center;gap:1px}
.meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}
.p2 .meta{flex-direction:row-reverse}
.name{font-size:13px;letter-spacing:.06em;color:#fff;-webkit-text-stroke:4px var(--ink);paint-order:stroke fill}
.spell{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:2.5px solid var(--edge);border-radius:999px;
  background:var(--glass);backdrop-filter:blur(6px);font-family:var(--font-body);font-weight:800;font-size:10px;
  letter-spacing:.07em;text-transform:uppercase;color:var(--paper);opacity:.72;
  transition:background .15s ease,opacity .15s ease,box-shadow .15s ease,color .15s ease;white-space:nowrap}
.spell .glyph{font-size:12px;line-height:1;color:var(--cyan)}
.spell .cost{background:rgba(247,242,234,.16);color:var(--paper);border-radius:5px;padding:0 4px;font-size:9px}
.spell.ready{opacity:1;background:var(--hp);color:var(--ink);border-color:var(--ink);
  box-shadow:0 0 0 3px rgba(217,255,63,.28),0 0 18px rgba(217,255,63,.65);animation:vfSpellPulse 1.4s ease-in-out infinite}
.spell.ready .glyph,.spell.ready .cost{color:var(--ink);background:rgba(16,12,30,.14)}
.spell.deny{animation:vfSpellDeny .42s ease-out}
@keyframes vfSpellPulse{0%,100%{box-shadow:0 0 0 3px rgba(217,255,63,.22),0 0 10px rgba(217,255,63,.45)}50%{box-shadow:0 0 0 3px rgba(217,255,63,.5),0 0 22px rgba(217,255,63,.85)}}
@keyframes vfSpellDeny{0%,100%{transform:none;background:var(--glass)}20%,60%{transform:translateX(-3px);background:var(--drain);color:#fff}40%,80%{transform:translateX(3px)}}
.combo{display:block;height:20px;margin-top:4px;font-family:'Bungee','Impact',system-ui,sans-serif;font-size:16px;
  line-height:1;letter-spacing:.04em;color:var(--hp);-webkit-text-stroke:4px var(--ink);paint-order:stroke fill;opacity:0}
.p2 .combo{text-align:right}
.combo.on{animation:vfComboPulse .5s cubic-bezier(.2,1.6,.4,1) both}
@keyframes vfComboPulse{0%{opacity:0;transform:scale(.5)}55%{opacity:1;transform:scale(1.18)}100%{opacity:1;transform:scale(1)}}
.stage-tag{position:absolute;left:16px;bottom:max(14px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:7px;
  padding:6px 11px;border:2.5px solid rgba(247,242,234,.55);border-radius:999px;background:rgba(7,6,26,.82);
  color:var(--paper);backdrop-filter:blur(6px);
  font-family:var(--font-body);font-weight:800;font-size:10px;letter-spacing:.14em;text-transform:uppercase}
.stage-tag i{width:7px;height:7px;border-radius:50%;background:var(--hp);box-shadow:0 0 8px var(--hp)}
.p2{text-align:right}
.timer{background:var(--glass);border:3px solid var(--edge);border-radius:12px;color:var(--hp);text-align:center;
  font-size:40px;line-height:1.35;box-shadow:0 5px 0 rgba(7,6,26,.7),0 0 26px rgba(217,255,63,.18);
  font-variant-numeric:tabular-nums;backdrop-filter:blur(6px);text-shadow:0 0 16px rgba(217,255,63,.45)}
.timer.low{color:var(--drain);text-shadow:0 0 16px rgba(255,61,90,.5)}
.pips{display:flex;gap:6px;margin-top:7px}.p2 .pips{justify-content:flex-end}
.pip{width:16px;height:16px;border:3px solid var(--edge);border-radius:6px;background:rgba(7,6,26,.55);opacity:.7}
.pip.won{background:var(--hp);border-color:var(--ink);opacity:1;box-shadow:0 0 12px rgba(217,255,63,.6)}
.banner{position:absolute;left:0;right:0;top:36%;text-align:center;font-size:clamp(40px,10vw,120px);color:var(--paper);-webkit-text-stroke:6px var(--ink);paint-order:stroke fill;opacity:0;transform:scale(.9)}
.banner.show{opacity:1;transform:scale(1);transition:transform .18s cubic-bezier(.2,1.6,.4,1),opacity .1s}
.status{position:absolute;bottom:max(16px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);pointer-events:auto;display:flex;gap:10px;align-items:center}
.btn{font-family:var(--font-body);font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.05em;background:var(--hp);color:var(--ink);border:3px solid var(--ink);padding:10px 18px;cursor:pointer;box-shadow:0 5px 0 var(--ink);border-radius:10px}
.btn:active{transform:translate(2px,2px);box-shadow:0 1px 0 var(--ink)}
.btn:focus-visible{outline:4px solid #2b6fff;outline-offset:2px}
.btn[disabled]{opacity:.5;cursor:default}
.msg{background:var(--ink);color:var(--paper);padding:8px 12px;font-size:12px;font-weight:700;max-width:60vw;border-radius:10px;font-family:var(--font-body);letter-spacing:.03em}

/* ---------- end-of-match + menu overlays ---------- */
.veil{position:absolute;inset:0;display:none;place-items:center;pointer-events:auto;
  background:radial-gradient(60% 60% at 50% 45%,rgba(42,23,88,.55),rgba(7,6,26,.82));backdrop-filter:blur(4px);z-index:5}
.veil.on{display:grid}
.vf-card{width:min(460px,92vw);background:var(--paper);border:4px solid var(--ink);border-radius:18px;
  box-shadow:0 10px 0 rgba(20,16,14,.9),0 30px 60px rgba(0,0,0,.45);padding:22px;text-align:center;
  animation:vfCardIn .32s cubic-bezier(.2,1.4,.35,1) both;font-family:var(--font-body);color:var(--ink)}
@keyframes vfCardIn{from{opacity:0;transform:translateY(18px) scale(.94)}to{opacity:1;transform:none}}
.vf-card .big{font-family:'Bungee','Impact',system-ui,sans-serif;font-weight:400;line-height:1;
  font-size:clamp(34px,6vw,52px);letter-spacing:.01em}
.vf-card .big.win{color:#5f8f00}
.vf-card .big.lose{color:var(--drain)}
.vf-card .sub{font-weight:800;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#5c5348;margin-top:8px}
.vf-card .extra{margin-top:10px;padding:8px 10px;border-radius:9px;background:#14100e;color:#d9ff3f;
  font-weight:800;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.vf-card .rows{display:flex;flex-direction:column;gap:9px;margin-top:20px}
.vf-card .btn{width:100%;justify-content:center}
.vf-card .btn.ghost{background:#fff;color:var(--ink)}
.vf-card .kbdhint{margin-top:12px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#7a6f60}
.vf-menu-rows{display:flex;flex-direction:column;gap:9px;margin-top:20px}
.vf-menu-rows .btn{width:100%}
@media (prefers-reduced-motion:reduce){.bar .drain,.bar .fill,.mana .fill,.banner.show{transition:none}
  .spell.ready,.combo.on,.spell.deny{animation:none}}
@media (max-width:560px){.hud-top{grid-template-columns:1fr 84px 1fr}.timer{font-size:32px}}
`;

export class Web3Hud {
  private el: HTMLElement;
  private fills: HTMLElement[] = [];
  private drains: HTMLElement[] = [];
  private manaFills: HTMLElement[] = [];
  private guardFills: HTMLElement[] = [];
  private guardBars: HTMLElement[] = [];
  private odFills: HTMLElement[] = [];
  private odBars: HTMLElement[] = [];
  private pingEl!: HTMLElement;
  /** Spell cost per player: every fighter's spell costs something different now. */
  private spellCost = [SPELL_COST, SPELL_COST];
  private spellChips: HTMLElement[] = [];
  private combos: HTMLElement[] = [];
  private comboTimers: number[] = [0, 0];
  private stageTag!: HTMLElement;
  private pips: HTMLElement[][] = [[], []];
  private timerEl!: HTMLElement;
  private banner!: HTMLElement;
  private msg!: HTMLElement;
  private claimBtn!: HTMLButtonElement;
  private maxHp = [1, 1];
  private payload: VictoryPayload | null = null;
  private resultEl!: HTMLElement;
  private resultTitle!: HTMLElement;
  private resultSub!: HTMLElement;
  private resultExtra!: HTMLElement;
  private resultRematch!: HTMLButtonElement;
  private resultLobby!: HTMLButtonElement;
  private resultClaim!: HTMLButtonElement;
  private menuEl!: HTMLElement;
  private menuPauseNote!: HTMLElement;
  private menuMute!: HTMLButtonElement;
  private menuOpen = false;

  constructor(parent: HTMLElement, names: [string, string], maxHp: [number, number], roundsToWin = 2) {
    if (!document.getElementById('vf-hud-css')) {
      const style = document.createElement('style'); style.id = 'vf-hud-css'; style.textContent = CSS;
      document.head.appendChild(style);
    }
    if (!document.getElementById('vf-hud-font')) {
      const font = document.createElement('link'); font.id = 'vf-hud-font'; font.rel = 'stylesheet';
      font.href = 'https://fonts.googleapis.com/css2?family=Bungee&family=Archivo:wght@400;700;800&display=swap'; document.head.appendChild(font);
    }

    this.maxHp = [...maxHp];
    this.el = document.createElement('div'); this.el.className = 'hud';
    const side = (i: number) => `
      <div class="${i ? 'p2' : 'p1'}">
        <div class="bar" role="progressbar" aria-label="${names[i]} health"><div class="drain"></div><div class="fill"></div></div>
        <div class="mana" role="progressbar" aria-label="${names[i]} mana"><div class="fill"></div></div>
        <div class="guard" role="progressbar" aria-label="${names[i]} guard"><div class="fill"></div></div>
        <div class="od" role="progressbar" aria-label="${names[i]} overdrive"><div class="fill"></div><span class="tag">EX</span></div>
        <div class="meta"><span class="name">${names[i]}</span>
          <span class="spell"><span class="glyph">◈</span><span class="spell-name">Spell</span><span class="cost">50</span></span></div>
        <div class="pips">${Array.from({ length: roundsToWin }, () => '<span class="pip"></span>').join('')}</div>
        <span class="combo" aria-live="polite"></span>
      </div>`;
    this.el.innerHTML = `
      <div class="hud-top">${side(0)}<div class="center"><div class="timer" aria-live="off">99</div><span class="ping">-- ms</span></div>${side(1)}</div>
      <div class="banner"></div>
      <div class="stage-tag" aria-hidden="true"><i></i><span>Neon Foundry</span></div>
      <div class="status"><span class="msg" role="status" hidden></span>
        <button class="btn" hidden>Claim winnings</button></div>

      <div class="veil result" role="dialog" aria-modal="true" aria-label="Match result">
        <div class="vf-card">
          <div class="big"></div>
          <div class="sub"></div>
          <div class="extra" hidden></div>
          <div class="rows">
            <button class="btn result-rematch" type="button">Rematch</button>
            <button class="btn ghost result-lobby" type="button">Back to lobby</button>
            <button class="btn result-claim" type="button" hidden>Claim winnings</button>
          </div>
          <div class="kbdhint">Enter · rematch &nbsp; Esc · lobby</div>
        </div>
      </div>

      <div class="veil menu" role="dialog" aria-modal="true" aria-label="Menu">
        <div class="vf-card">
          <div class="big">MENU</div>
          <div class="sub">Vibe Fighter</div>
          <div class="vf-menu-rows">
            <button class="btn menu-resume" type="button">Resume</button>
            <button class="btn ghost menu-mute" type="button">Sound: on</button>
            <button class="btn ghost menu-leave" type="button">Leave match</button>
          </div>
          <div class="kbdhint menu-note"></div>
        </div>
      </div>`;
    parent.appendChild(this.el);

    const pick = (sel: string) => [0, 1].map((i) => this.el.querySelector<HTMLElement>(i ? `.p2 ${sel}` : `.p1 ${sel}`)!);
    this.fills = pick('.bar .fill');
    this.drains = pick('.bar .drain');
    this.manaFills = pick('.mana .fill');
    this.guardFills = pick('.guard .fill');
    this.guardBars = pick('.guard');
    this.odFills = pick('.od .fill');
    this.odBars = pick('.od');
    this.pingEl = this.el.querySelector('.ping')!;
    this.spellChips = pick('.spell');
    this.combos = pick('.combo');
    this.pips = [0, 1].map((i) => [...this.el.querySelectorAll<HTMLElement>(i ? '.p2 .pip' : '.p1 .pip')]);
    this.timerEl = this.el.querySelector('.timer')!;
    this.banner = this.el.querySelector('.banner')!;
    this.msg = this.el.querySelector('.msg')!;
    this.stageTag = this.el.querySelector('.stage-tag')!;
    this.claimBtn = this.el.querySelector('.status .btn')!;
    this.claimBtn.addEventListener('click', () => this.runClaim());

    this.resultEl = this.el.querySelector('.result')!;
    this.resultTitle = this.resultEl.querySelector('.big')!;
    this.resultSub = this.resultEl.querySelector('.sub')!;
    this.resultExtra = this.resultEl.querySelector('.extra')!;
    this.resultRematch = this.resultEl.querySelector('.result-rematch')!;
    this.resultLobby = this.resultEl.querySelector('.result-lobby')!;
    this.resultClaim = this.resultEl.querySelector('.result-claim')!;
    this.resultClaim.addEventListener('click', () => void this.runClaim());

    this.menuEl = this.el.querySelector('.menu')!;
    this.menuPauseNote = this.menuEl.querySelector('.menu-note')!;
    this.menuMute = this.menuEl.querySelector('.menu-mute')!;
  }

  /** Front bar snaps; the red drain bar lags behind via CSS delay, giving the classic damage trail. */
  setHealth(player: 0 | 1, hp: number) {
    const r = Math.max(0, Math.min(1, hp / this.maxHp[player]));
    this.fills[player].style.transform = `scaleX(${r})`;
    this.drains[player].style.transform = `scaleX(${r})`;
  }

  /** 0–100 mana meter. The spell chip lights up the moment *this fighter's* spell is affordable. */
  setMana(player: 0 | 1, mana: number) {
    const r = Math.max(0, Math.min(1, mana / MAX_MANA));
    this.manaFills[player].style.transform = `scaleX(${r})`;
    this.spellChips[player].classList.toggle('ready', mana >= this.spellCost[player]);
  }

  /** Guard meter (0–GUARD_MAX). Blocked hits cost no health but drain this; empty = guard break. */
  setGuard(player: 0 | 1, guard: number) {
    const r = Math.max(0, Math.min(1, guard / GUARD_MAX));
    this.guardFills[player].style.transform = `scaleX(${r})`;
    this.guardBars[player].classList.toggle('low', r < 0.3);
  }

  /** Shake the guard bar when it shatters. */
  guardBreak(player: 0 | 1) {
    const el = this.guardBars[player];
    el.classList.remove('broken');
    void el.offsetWidth;
    el.classList.add('broken');
  }

  /** Overdrive (0–100). The bar glows and shows EX when a full metered spell is available. */
  setOverdrive(player: 0 | 1, od: number) {
    const r = Math.max(0, Math.min(1, od / OD_MAX));
    this.odFills[player].style.transform = `scaleX(${r})`;
    this.odBars[player].classList.toggle('full', r >= 1);
  }

  /** Round-trip time in ms (from the server's probe); warns above 120 ms. */
  setPing(ms: number) {
    const v = Math.round(ms);
    this.pingEl.textContent = `${v} ms`;
    this.pingEl.classList.toggle('bad', v > 120);
  }

  /** Name, glyph and cost of this fighter's signature spell — every fighter is different now. */
  setSpell(player: 0 | 1, theme: SpellTheme) {
    const el = this.spellChips[player];
    const glyph = el.querySelector<HTMLElement>('.glyph');
    const name = el.querySelector<HTMLElement>('.spell-name');
    const cost = el.querySelector<HTMLElement>('.cost');
    if (glyph) glyph.textContent = theme.glyph;
    if (name) name.textContent = theme.name;
    if (cost) cost.textContent = String(theme.cost);
    el.title = `${theme.name} — ${theme.tagline}`;
    this.spellCost[player] = theme.cost;
  }

  /** Combo badge under the name; auto-clears after the combo window closes. */
  setCombo(player: 0 | 1, n: number) {
    const el = this.combos[player];
    clearTimeout(this.comboTimers[player]);
    if (n < 2) { el.classList.remove('on'); el.textContent = ''; return; }
    el.textContent = `${n} HIT COMBO`;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    this.comboTimers[player] = window.setTimeout(() => { el.classList.remove('on'); el.textContent = ''; }, 1600);
  }

  /** Shake the spell chip red when the spell was pressed without enough mana. */
  denySpell(player: 0 | 1) {
    const el = this.spellChips[player];
    el.classList.remove('deny');
    void el.offsetWidth;
    el.classList.add('deny');
  }

  setStage(name: string) {
    const span = this.stageTag.querySelector('span');
    if (span) span.textContent = name;
  }

  setTimer(seconds: number) {
    const s = Math.max(0, Math.min(99, Math.ceil(seconds)));
    this.timerEl.textContent = String(s).padStart(2, '0');
    this.timerEl.classList.toggle('low', s <= 10);
  }

  setRounds(p1: number, p2: number) {
    [p1, p2].forEach((n, i) => this.pips[i].forEach((pip, j) => pip.classList.toggle('won', j < n)));
  }

  showBanner(text: string, ms = 1400) {
    this.banner.textContent = text; this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  say(text: string) { this.msg.hidden = !text; this.msg.textContent = text; }

  /** Pre-fight stake flow. Returns the matchId. */
  async stakeCreate(): Promise<string> {
    this.say('Confirm the $1 stake in your wallet…');
    try { const id = await createMatch(); this.say(`Match ${id} created. Waiting for an opponent.`); return id; }
    catch (e) { this.say(this.errText(e)); throw e; }
  }
  async stakeJoin(matchId: string) {
    this.say('Confirm the $1 stake in your wallet…');
    try { await joinMatch(matchId); this.say('Stake locked. Fight!'); }
    catch (e) { this.say(this.errText(e)); throw e; }
  }

  /** Call with the server's final payload; the button appears only for the winner. */
  presentVictory(payload: VictoryPayload, myAddress: string) {
    this.payload = payload;
    const won = payload.winner.toLowerCase() === myAddress.toLowerCase();
    this.showBanner(won ? 'You win' : 'You lose', 2500);
    this.claimBtn.hidden = !won || !!payload.dev;               // practice matches have nothing to claim
    this.say(payload.dev ? 'Practice match. Nothing to claim.' : won ? 'Claim before the window closes.' : '');
  }

  /**
   * End-of-match card with real exits. `score` is shown as "2 – 1", `reason` as KO/TIME/FORFEIT.
   * The lobby is reachable without reloading the page.
   */
  presentResult(
    opts: { won: boolean; score: string; reason: string; canRematch: boolean; extra?: string },
    handlers: { rematch: () => void; lobby: () => void },
  ) {
    this.resultTitle.textContent = opts.won ? 'YOU WIN' : 'YOU LOSE';
    this.resultTitle.classList.toggle('win', opts.won);
    this.resultTitle.classList.toggle('lose', !opts.won);
    this.resultSub.textContent = `${opts.score} · ${opts.reason.toUpperCase()}`;
    this.resultExtra.textContent = opts.extra ?? '';
    this.resultExtra.hidden = !opts.extra;
    this.resultRematch.hidden = !opts.canRematch;
    this.resultRematch.onclick = () => handlers.rematch();
    this.resultLobby.onclick = () => handlers.lobby();
    this.resultClaim.hidden = this.claimBtn.hidden;
    this.resultEl.classList.add('on');
  }

  hideResult() { this.resultEl.classList.remove('on'); }

  get isResultOpen() { return this.resultEl.classList.contains('on'); }

  get isMenuOpen() { return this.menuOpen; }

  showMenu(handlers: { resume: () => void; leave: () => void; mute: () => void }, opts: { canPause: boolean; muted: boolean }) {
    this.menuOpen = true;
    this.menuPauseNote.textContent = opts.canPause
      ? 'Paused — take your time.'
      : 'Online match: the timer keeps running.';
    this.menuMute.textContent = `Sound: ${opts.muted ? 'off' : 'on'}`;
    (this.menuEl.querySelector('.menu-resume') as HTMLButtonElement).onclick = () => handlers.resume();
    (this.menuEl.querySelector('.menu-leave') as HTMLButtonElement).onclick = () => handlers.leave();
    this.menuMute.onclick = () => handlers.mute();
    this.menuEl.classList.add('on');
    (this.menuEl.querySelector('.menu-resume') as HTMLButtonElement).focus();
  }

  hideMenu() { this.menuOpen = false; this.menuEl.classList.remove('on'); }

  /** Remove every DOM node this HUD owns (used when returning to the lobby / rematching). */
  dispose() {
    this.hideResult(); this.hideMenu();
    this.comboTimers.forEach((t) => clearTimeout(t));
    this.el.remove();
  }

  private async runClaim() {
    if (!this.payload) return;
    this.claimBtn.disabled = true; this.say('Waiting for wallet confirmation…');
    try { const hash = await claimVictory(this.payload); this.say(`Claimed. Tx ${hash.slice(0, 10)}…`); this.claimBtn.hidden = true; }
    catch (e) { this.say(this.errText(e)); this.claimBtn.disabled = false; }
  }

  private errText(e: unknown) {
    const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'Unknown error';
    return /reject|denied/i.test(m) ? 'Transaction cancelled in wallet.' : m;
  }
}
