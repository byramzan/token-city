// Cartoon-style inline SVG icon set. All icons inherit currentColor unless
// they carry their own fill (coin / gem / star keep fixed game colors).

const S = (body, vb = '0 0 24 24') =>
  `<svg class="ic" viewBox="${vb}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const icons = {
  coin: S(`<circle cx="12" cy="12" r="9.5" fill="#ffd166" stroke="#b8860b" stroke-width="2"/>
    <circle cx="12" cy="12" r="5.4" fill="none" stroke="#b8860b" stroke-width="2"/>
    <path d="M8 8.2 L16 15.8 M8 15.8 L16 8.2" stroke="#b8860b" stroke-width="1.6" stroke-linecap="round"/>`),

  gem: S(`<path d="M7 3h10l4 5.5L12 21 3 8.5 7 3z" fill="#57d7c8" stroke="#0f7c70" stroke-width="2" stroke-linejoin="round"/>
    <path d="M3 8.5h18M9.5 8.5 12 21l2.5-12.5M7 3l2.5 5.5M17 3l-2.5 5.5" stroke="#0f7c70" stroke-width="1.4" stroke-linejoin="round"/>`),

  star: S(`<path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z"
    fill="#ffd166" stroke="#c98a12" stroke-width="1.8" stroke-linejoin="round"/>`),

  wallet: S(`<rect x="2.5" y="6" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <path d="M2.5 9.5V7.5c0-1.1.9-2 2-2h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="17" cy="13" r="1.6" fill="currentColor"/>`),

  home: S(`<path d="M3.5 11.5 12 4l8.5 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6 10.5V20h12v-9.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="10" y="14" width="4" height="6" fill="currentColor" rx="1"/>`),

  hammer: S(`<path d="M14.5 4.5 19 9l-2.2 2.2-4.5-4.5L14.5 4.5z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M12.8 7.2 4.5 15.5c-.8.8-.8 2 0 2.8l1.2 1.2c.8.8 2 .8 2.8 0l8.3-8.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),

  sound: S(`<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),

  mute: S(`<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M15.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),

  close: S(`<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>`),

  share: S(`<circle cx="6" cy="12" r="2.6" stroke="currentColor" stroke-width="2.2"/>
    <circle cx="17.5" cy="5.5" r="2.6" stroke="currentColor" stroke-width="2.2"/>
    <circle cx="17.5" cy="18.5" r="2.6" stroke="currentColor" stroke-width="2.2"/>
    <path d="M8.4 10.8l6.7-4M8.4 13.2l6.7 4" stroke="currentColor" stroke-width="2.2"/>`),

  eye: S(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
    stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="3" fill="currentColor"/>`),

  edit: S(`<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z"
    stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M14.5 6.5l3 3" stroke="currentColor" stroke-width="2.2"/>`),

  check: S(`<path d="M4.5 12.5l5 5L19.5 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`),

  left: S(`<path d="M14.5 5.5 8 12l6.5 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`),

  right: S(`<path d="M9.5 5.5 16 12l-6.5 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`),

  lock: S(`<rect x="5" y="10.5" width="14" height="9.5" rx="2.5" fill="currentColor"/>
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="2.4" fill="none"/>`),

  link: S(`<path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),

  trash: S(`<path d="M4.5 6.5h15M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M6.5 6.5 7.5 20a1.5 1.5 0 0 0 1.5 1.4h6A1.5 1.5 0 0 0 16.5 20l1-13.5" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M10 10.5v6.5M14 10.5v6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),

  sofa: S(`<path d="M4 10V8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5V10" stroke="currentColor" stroke-width="2.2"/>
    <path d="M3 13a2 2 0 0 1 4 0v1h10v-1a2 2 0 0 1 4 0v3.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V13z"
    fill="currentColor"/><path d="M6 19v1.5M18 19v1.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),

  ghost: S(`<path d="M12 3a7 7 0 0 0-7 7v10l2.3-2 2.4 2 2.3-2 2.3 2 2.4-2 2.3 2V10a7 7 0 0 0-7-7z"
    fill="currentColor"/><circle cx="9.5" cy="10" r="1.4" fill="#fff"/><circle cx="14.5" cy="10" r="1.4" fill="#fff"/>`),

  flask: S(`<path d="M9.5 3.5h5M10.5 3.5v5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18L13.5 8.5v-5"
    stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M7.2 14.5h9.6" stroke="currentColor" stroke-width="2.2"/>`),

  swap: S(`<path d="M4 8h13l-3-3M20 16H7l3 3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`),

  info: S(`<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="2.2"/>
    <path d="M12 11v6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="12" cy="7.5" r="1.5" fill="currentColor"/>`),

  sun: S(`<circle cx="12" cy="12" r="4.5" fill="#ffd166" stroke="#c98a12" stroke-width="2"/>
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"
    stroke="#c98a12" stroke-width="2.2" stroke-linecap="round"/>`),

  moon: S(`<path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 8.5 8.5 0 1 0 20 13.5z"
    fill="#7aa2f7" stroke="#3d5aa8" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="15" cy="9" r="1" fill="#3d5aa8"/><circle cx="17.5" cy="12.5" r="0.7" fill="#3d5aa8"/>`),

  graph: S(`<circle cx="6" cy="18" r="2.6" fill="currentColor"/>
    <circle cx="12" cy="6" r="2.6" fill="currentColor"/>
    <circle cx="18.5" cy="15" r="2.6" fill="currentColor"/>
    <path d="M7.3 16 10.8 8.2M13.8 7.6l3.4 5.6M8.6 17.6l7.3-1.6" stroke="currentColor" stroke-width="2"/>`),

  search: S(`<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2.6"/>
    <path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>`),
};

/** icon('coin') → svg string; icon('coin', 'big') adds a size class */
export function icon(name, cls = '') {
  const svg = icons[name] || '';
  return cls ? svg.replace('class="ic"', `class="ic ${cls}"`) : svg;
}
