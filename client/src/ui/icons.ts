/** Tiny inline SVG icon set (stroke icons, currentColor). No external dependency. */

const P: Record<string, string> = {
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>',
  shuffle: '<path d="M16 4h4v4"/><path d="M4 20 20 4"/><path d="M16 20h4v-4"/><path d="M4 4l5 5"/><path d="M15 15l5 5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  check: '<path d="M4 12.5 10 18 20 6"/>',
  expand: '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/><path d="M15 20h5v-5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2A2.6 2.6 0 0 1 14.6 10c0 1.6-2.4 2-2.4 3.6"/><path d="M12 17.2h.01"/>',
  chevL: '<path d="M14.5 5 8 12l6.5 7"/>',
  chevR: '<path d="M9.5 5 16 12l-6.5 7"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9"/><path d="M14.7 9.3c-.6-.8-1.6-1.3-2.7-1.3-1.5 0-2.7.9-2.7 2s.9 1.7 2.7 2c1.8.3 2.7.9 2.7 2s-1.2 2-2.7 2c-1.1 0-2.1-.5-2.7-1.3"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5.5a2.5 2.5 0 0 0 2.7 4"/><path d="M16 5h2.5a2.5 2.5 0 0 1-2.7 4"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 20c0-1.6.9-2.3 2-2.3s2 .7 2 2.3"/>',
  bolt: '<path d="M13 3 5 13.5h5L11 21l8-10.5h-5z"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  play: '<path d="M7 4.8v14.4L19 12z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.4 4-5 7.5-5s6.3 1.6 7.5 5"/>',
  gamepad: '<path d="M6 9h4"/><path d="M8 7v4"/><circle cx="16" cy="8.6" r="1"/><circle cx="18.6" cy="11.2" r="1"/><rect x="2.8" y="5.8" width="18.4" height="12.4" rx="4"/>',
  swords: '<path d="M3.5 17.5 14 7l3-3.5 3.5 0 0 3.5L17 10 6.5 20.5"/><path d="M3.5 17.5 6.5 20.5"/><path d="M20.5 17.5 10 7 7 3.5 3.5 3.5l0 3.5L7 10l10.5 10.5"/><path d="M17.5 20.5 20.5 17.5"/>',
  scale: '<path d="M12 4v16"/><path d="M6 7h12"/><path d="M6 7 3.5 13a2.7 2.7 0 0 0 5 0z"/><path d="M18 7l-2.5 6a2.7 2.7 0 0 0 5 0z"/><path d="M8.5 20h7"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h.01"/><path d="M3 9.5h18" />',
  pin: '<path d="M12 21s6.5-6.2 6.5-11a6.5 6.5 0 0 0-13 0C5.5 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/>',
};

/** Returns an SVG string. `size` in px (CSS can override). */
export function icon(name: keyof typeof P | string, size = 22): string {
  const paths = P[name] ?? P.question;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
