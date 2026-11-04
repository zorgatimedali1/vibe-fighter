import { installTheme } from './theme';
import { icon } from './icons';

/* ------------------------------------------------------------------ *
 * Local-only profile: handle, level/XP from wins, record + streak.
 * Persisted in localStorage because there is no account system yet;
 * every value is honest about living on "this device".
 * ------------------------------------------------------------------ */

export interface ProfileData {
  handle: string;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
  matches: number;
}

const KEY = 'vf-profile';
/** Wins per level-up. */
const LEVEL_LEN = 4;

function load(): ProfileData {
  const base: ProfileData = { handle: guestHandle(), wins: 0, losses: 0, streak: 0, bestStreak: 0, matches: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<ProfileData>;
    return { ...base, ...p, handle: String(p.handle ?? base.handle).slice(0, 16).toUpperCase() };
  } catch { return base; }
}

function guestHandle() {
  return `GUEST-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export const level = (wins: number) => 1 + Math.floor(wins / LEVEL_LEN);
export const xpPct = (wins: number) => Math.round(((wins % LEVEL_LEN) / LEVEL_LEN) * 100);

export class Profile {
  private data = load();

  get handle() { return this.data.handle; }
  get raw() { return this.data; }

  setHandle(name: string) {
    const clean = name.trim().slice(0, 16).toUpperCase() || this.data.handle;
    this.data.handle = clean; this.save(); return clean;
  }

  /** Call once per finished match. */
  record(win: boolean) {
    this.data.matches++;
    if (win) { this.data.wins++; this.data.streak++; this.data.bestStreak = Math.max(this.data.bestStreak, this.data.streak); }
    else { this.data.losses++; this.data.streak = 0; }
    this.save();
  }

  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ } }
}

/* ------------------------------------------------------------------ */
/* Profile card UI                                                     */
/* ------------------------------------------------------------------ */

const CARD_CSS = `
.vf-prof{display:flex;flex-direction:column;gap:12px;padding:14px;align-self:start;min-width:280px}
.vf-prof-hd{display:flex;gap:12px;align-items:center}
.vf-avatar{width:62px;height:62px;flex:none;border:var(--bd) solid var(--ink);border-radius:var(--r-sm);
  position:relative;background:var(--av-head,#5a2d1f);box-shadow:var(--shadow-flat);overflow:hidden}
.vf-avatar::before{content:'';position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);
  width:38px;height:30px;background:#14100e;border-radius:6px}
.vf-avatar::after{content:'';position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);
  width:22px;height:10px;background:var(--av-accent,#7dff6a);border-radius:4px;box-shadow:0 0 0 2px #14100e}
.vf-lv{position:absolute;left:-3px;bottom:6px;z-index:1;background:var(--ink);color:var(--lime);
  font-weight:800;font-size:11px;padding:3px 7px;border-radius:6px;letter-spacing:.05em}
.vf-prof-name{display:flex;align-items:center;gap:8px;min-width:0}
.vf-prof-name b{font-family:var(--font-display);font-weight:400;font-size:19px;line-height:1.1;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vf-prof-name input{font:inherit;font-size:14px;font-weight:800;min-width:0;width:100%;border:2.5px solid var(--ink);
  border-radius:7px;padding:5px 8px;text-transform:uppercase;background:#fff;color:var(--ink)}
.vf-name-edit{width:30px;height:30px;padding:0;border:2.5px solid var(--ink);border-radius:8px;background:#fff;
  cursor:pointer;display:grid;place-items:center;flex:none}
.vf-name-edit svg{width:14px;height:14px}
.vf-name-edit:hover{background:var(--paper-2)}
.vf-prof-rank{display:flex;align-items:center;gap:6px;margin:4px 0 0;font-size:12px;font-weight:800;color:#5c5348}
.vf-prof-rank svg{width:15px;height:15px}
.vf-xp{display:flex;flex-direction:column;gap:5px}
.vf-xp-track{height:13px;border:2.5px solid var(--ink);border-radius:999px;background:#fff;overflow:hidden}
.vf-xp-fill{height:100%;width:0;background:linear-gradient(90deg,var(--lime),var(--lime-2));
  border-right:2.5px solid rgba(20,16,14,.55)}
.vf-xp-lbl{display:flex;justify-content:space-between;font-size:11px;font-weight:800;color:#5c5348;letter-spacing:.06em}
.vf-prof-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vf-rec{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:12px;padding:5px 10px;
  border:2.5px solid var(--ink);border-radius:999px;background:#fff}
.vf-rec svg{width:14px;height:14px}
.vf-streak{display:inline-flex;align-items:center;gap:5px;font-weight:800;font-size:12px;padding:5px 10px;
  border-radius:999px;border:2.5px solid var(--ink);background:var(--orange);color:#fff}
.vf-streak svg{width:13px;height:13px}
.vf-streak.none{background:var(--paper-2);color:#8a7f70;border-style:dashed}
`;

export class ProfileCard {
  private el: HTMLElement;
  private xpFill: HTMLElement;
  private xpLbl: HTMLElement;
  private recEl: HTMLElement;
  private streakEl: HTMLElement;

  constructor(private profile: Profile) {
    installTheme();
    if (!document.getElementById('vf-prof-css')) {
      const s = document.createElement('style'); s.id = 'vf-prof-css'; s.textContent = CARD_CSS;
      document.head.appendChild(s);
    }
    this.el = document.createElement('div');
    this.el.className = 'vf-panel vf-prof';
    this.el.innerHTML = `
      <div class="vf-prof-hd">
        <div class="vf-avatar"><span class="vf-lv">LV ${level(profile.raw.wins)}</span></div>
        <div style="flex:1;min-width:0">
          <div class="vf-prof-name">
            <b class="vf-name-txt">${profile.handle}</b>
            <button class="vf-name-edit" aria-label="Edit name">${icon('edit', 14)}</button>
          </div>
          <p class="vf-prof-rank">${icon('user')} <span>Saved on this device</span></p>
        </div>
      </div>
      <div class="vf-xp">
        <div class="vf-xp-lbl">
          <span id="vf-xp-next">NEXT LEVEL</span><span class="vf-xp-num">0%</span>
        </div>
        <div class="vf-xp-track"><div class="vf-xp-fill"></div></div>
      </div>
      <div class="vf-prof-row">
        <span class="vf-rec">${icon('trophy')} <span class="vf-rec-txt">0 W · 0 L</span></span>
        <span class="vf-streak none">${icon('bolt')} <span class="vf-streak-txt">NO STREAK</span></span>
      </div>`;
    this.xpFill = this.el.querySelector('.vf-xp-fill')!;
    this.xpLbl = this.el.querySelector('.vf-xp-num')!;
    this.recEl = this.el.querySelector('.vf-rec-txt')!;
    this.streakEl = this.el.querySelector('.vf-streak')!;
    this.el.querySelector('.vf-lv')!.textContent = `LV ${level(profile.raw.wins)}`;

    this.render();
    const btn = this.el.querySelector<HTMLButtonElement>('.vf-name-edit')!;
    btn.addEventListener('click', () => this.editName());
  }

  private editName() {
    const holder = this.el.querySelector('.vf-prof-name')!;
    const b = holder.querySelector('.vf-name-txt')!;
    const input = document.createElement('input');
    input.value = this.profile.handle; input.maxLength = 16;
    input.setAttribute('aria-label', 'Your name');
    b.replaceWith(input); input.focus(); input.select();
    const commit = () => {
      const name = this.profile.setHandle(input.value);
      input.replaceWith(b); b.textContent = name;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') input.replaceWith(b);
      e.stopPropagation();                       // don't let the global lobby keys react
    });
    input.addEventListener('blur', commit);
  }

  /** Re-render numbers after a match finishes. */
  refresh() { this.render(); }

  private render() {
    const { wins, losses, streak } = this.profile.raw;
    this.el.querySelector('.vf-lv')!.textContent = `LV ${level(wins)}`;
    this.xpFill.style.width = `${xpPct(wins)}%`;
    this.xpLbl.textContent = `${xpPct(wins)}%`;
    this.el.querySelector('#vf-xp-next')!.textContent = `LV ${level(wins) + 1}`;
    this.recEl.textContent = `${wins} W · ${losses} L`;
    this.streakEl.classList.toggle('none', streak < 2);
    this.streakEl.querySelector('.vf-streak-txt')!.textContent = streak < 2 ? 'NO STREAK' : `STREAK ${streak}`;
  }

  /** Palette swap from the selected fighter. */
  setFighterColors(head: string, accent: string) {
    this.el.style.setProperty('--av-head', head);
    this.el.style.setProperty('--av-accent', accent);
  }

  get element() { return this.el; }
}
