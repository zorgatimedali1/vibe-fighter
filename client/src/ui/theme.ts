/** Shared design tokens + base classes for the lobby shell and the match HUD. Injected once. */

const CSS = `
/* Hallmark · pre-emit critique: P5 H4 E5 S4 R5 V5
 * Neon Dusk Arcade — paper stickers lit by a neon night. Ink is indigo-black, the accent stays
 * lime so the brand survives, and magenta/cyan/violet exist only as light (never as large fills).
 */
:root{
  --ink:#100c1e;
  --paper:#f7f2ea; --paper-2:#e7e0d4; --paper-3:#d5cbbd;
  --lime:#d9ff3f; --lime-2:#b9e520;
  --orange:#ff6b2c; --blue:#5b7cff; --red:#ff3d5a; --green:#7dff6a;
  --magenta:#ff3d9a; --violet:#7a5cff; --cyan:#2ad4ff; --amber:#ffb347;
  --dusk-900:#07061a; --dusk-800:#0f0a26; --dusk-700:#1a1040; --dusk-600:#2a1758;
  --sky:#0b0820;
  --r-lg:16px; --r-md:12px; --r-sm:9px;
  --bd:3px;
  --shadow-pop:0 6px 0 rgba(16,12,30,.92), 0 22px 44px rgba(7,6,26,.5), 0 0 0 1px rgba(217,255,63,.06);
  --shadow-press:0 4px 0 rgba(16,12,30,.92), 0 14px 26px rgba(7,6,26,.42);
  --shadow-flat:0 5px 0 rgba(16,12,30,.92);
  --shadow-neon:0 0 0 3px rgba(217,255,63,.16), 0 0 24px rgba(217,255,63,.28);
  --font-display:'Bungee', 'Impact', system-ui, sans-serif;
  --font-body:'Archivo', 'Inter', system-ui, sans-serif;
}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;font-family:var(--font-body);color:var(--ink);
  background:radial-gradient(1200px 720px at 50% 112%,var(--dusk-600) 0%,var(--dusk-800) 55%,var(--dusk-900) 100%)}
canvas{display:block;width:100%;height:100%}

/* -------- panels -------- */
.vf-panel{
  background:linear-gradient(180deg,#fbf7f0 0%,var(--paper) 52%,var(--paper-2) 100%);
  border:var(--bd) solid var(--ink);border-radius:var(--r-lg);
  box-shadow:var(--shadow-pop);color:var(--ink);
}
.vf-panel-pad{padding:16px}

/* -------- chips / tags / pills -------- */
.vf-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:2.5px solid var(--ink);
  border-radius:999px;background:#fff;font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
.vf-chip.lime{background:var(--lime)}
.vf-chip.orange{background:var(--orange);color:#fff}
.vf-chip.blue{background:#dbe8ff}
.vf-chip.flat{background:transparent;border-style:solid}
.vf-pill{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border:var(--bd) solid var(--ink);
  border-radius:999px;background:#fff;font-weight:800;font-size:13px;letter-spacing:.05em;box-shadow:var(--shadow-press);white-space:nowrap}
.vf-pill .dot{width:9px;height:9px;border-radius:50%;background:var(--lime-2);box-shadow:0 0 0 2.5px rgba(20,16,14,.25) inset}
.vf-pill.dev{background:var(--lime)}
.vf-pill .sub{font-weight:700;font-size:11px;color:#5c5348}

/* -------- buttons -------- */
.vf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font-family:var(--font-body);font-weight:800;font-size:14px;letter-spacing:.03em;text-transform:uppercase;
  color:var(--ink);background:#fff;border:var(--bd) solid var(--ink);border-radius:var(--r-md);
  padding:11px 16px;cursor:pointer;box-shadow:var(--shadow-flat);
  transition:transform .07s ease, box-shadow .07s ease, background .12s ease}
.vf-btn:hover{background:var(--paper-2)}
.vf-btn:active{transform:translateY(4px);box-shadow:0 1px 0 rgba(20,16,14,.92)}
.vf-btn:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-btn[disabled]{opacity:.45;cursor:default;transform:none;box-shadow:var(--shadow-flat)}
.vf-btn.primary{background:var(--lime)}
.vf-btn.primary:hover{background:var(--lime-2)}
.vf-btn.ghost{background:transparent}
.vf-btn.sm{padding:7px 11px;font-size:12px;border-width:2.5px;border-radius:var(--r-sm)}

/* square icon button (topbar) */
.vf-icon{width:46px;height:46px;flex:none;display:grid;place-items:center;background:#fff;color:var(--ink);
  border:var(--bd) solid var(--ink);border-radius:var(--r-md);cursor:pointer;box-shadow:var(--shadow-flat);
  transition:transform .07s ease, box-shadow .07s ease}
.vf-icon:active{transform:translateY(4px);box-shadow:0 1px 0 rgba(20,16,14,.92)}
.vf-icon:focus-visible{outline:4px solid var(--blue);outline-offset:2px}
.vf-icon svg{width:22px;height:22px}
.vf-icon.lime{background:var(--lime)}

/* keyboard keycap */
.vf-kbd{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 7px;
  border:2.5px solid var(--ink);border-radius:7px;background:#fff;
  font-weight:800;font-size:12px;box-shadow:0 3px 0 var(--ink);color:var(--ink)}
.vf-kbd.dark{background:var(--ink);color:var(--paper);box-shadow:0 3px 0 rgba(20,16,14,.35)}

/* -------- headings -------- */
.vf-title{font-family:var(--font-display);font-weight:400;letter-spacing:.01em;line-height:1}
.vf-kicker{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7a6f60}

/* status line inside a panel */
.vf-status{display:none;margin-top:10px;font-weight:800;font-size:13px;text-align:center;
  background:var(--ink);color:var(--paper);border-radius:var(--r-sm);padding:8px 10px;line-height:1.35;
  align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}
.vf-status.on{display:flex}
.vf-status.err{background:var(--red);color:#fff}
.vf-status-txt{min-width:0;overflow-wrap:anywhere}
.vf-status-act{flex:none;font-family:var(--font-body);font-weight:800;font-size:11px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink);background:var(--paper);border:2.5px solid var(--paper);
  border-radius:7px;padding:5px 10px;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.35)}
.vf-status-act:hover{background:#fff}
.vf-status-act:active{transform:translateY(2px);box-shadow:none}
.vf-status-act:focus-visible{outline:3px solid var(--lime);outline-offset:2px}
.vf-status.err .vf-status-act{background:#fff;border-color:#fff;color:var(--red)}

@media (prefers-reduced-motion:reduce){
  .vf-btn,.vf-icon{transition:none}
}
`;

export function installTheme() {
  if (!document.getElementById('vf-theme')) {
    const s = document.createElement('style');
    s.id = 'vf-theme'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (!document.getElementById('vf-font')) {
    const pre = document.createElement('link'); pre.id = 'vf-font-pre';
    pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = '';
    const l = document.createElement('link'); l.id = 'vf-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Bungee&family=Archivo:wght@400;600;700;800&display=swap';
    document.head.append(pre, l);
  }
}
