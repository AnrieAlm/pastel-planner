/**
 * Calyx Planner — Shared Nav Icon Registry
 *
 * Fixes #8: the same nav icons (Today, Routine, Notes, Calendar, Habits,
 * Grocery, Bucket List, Settings) plus Close/More/Add were hand-copied
 * into sidebar.html, bottom-nav.html and modal-more.html — three places
 * to keep in sync by hand, which is exactly how markup quietly drifts.
 * This file is the one source of truth. Each location gets a small
 * placeholder instead:
 *   <span class="nav-icon" data-nav-icon="today"></span>
 * and apply() swaps it for the real <svg>.
 *
 * Sizing/stroke-width for Today/Routine/Notes/Calendar/Habits/Grocery/
 * Bucket List/Settings/Add/More stays in CSS (.sidebar-nav a svg,
 * .bottom-nav-item svg), exactly as before — these SVG strings carry no
 * outer width/height so nothing about the sidebar or bottom nav changes
 * visually. The "More" sheet's icons previously had NO css backing them
 * up at all (they depended entirely on inline width="20" height="20",
 * which this file removes) — see the matching .more-sheet-link svg rule
 * added to css/modals.css so they don't fall back to default SVG sizing.
 */
const NavIcons = {
  map: {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="1" stroke-width="1.5" stroke-linecap="square"/><path d="M3 10h18M8 3v4M16 3v4" stroke-width="1.5" stroke-linecap="square"/><path d="M8 14l2 2 4-4" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/></svg>',
    routine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-width="1.5"/><path d="M12 7v5l4 2" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 3h9l4 4v14H6z" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 3v4h4M9 11h7M9 15h7M9 19h4" stroke-width="1.5" stroke-linecap="square"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="1" stroke-width="1.5" stroke-linecap="square"/><path d="M3 10h18M8 3v4M16 3v4" stroke-width="1.5" stroke-linecap="square"/><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1" fill="currentColor" stroke="none"/></svg>',
    habits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3L20 8" stroke-width="1.5" stroke-linecap="square"/><path d="M20 4v4h-4" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/><path d="M20 12a8 8 0 0 1-14 5.3L4 16" stroke-width="1.5" stroke-linecap="square"/><path d="M4 20v-4h4" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/></svg>',
    grocery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 4h2l2.4 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/><circle cx="9" cy="21" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="21" r="1" fill="currentColor" stroke="none"/></svg>',
    bucketlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M5 8h14l-1.5 11a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 8z" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 8h16M9 8V6a3 3 0 0 1 6 0v2" stroke-width="1.5" stroke-linecap="square"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke-width="1.5"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" stroke-width="1.2"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-width="1.5" stroke-linecap="square"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="square"/></svg>',
    'panel-collapse': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.5"/><path d="M9 4v16" stroke-width="1.5"/><path d="M14 9l-3 3 3 3" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-width="1.5"/><path d="M10 8.5v7l5.5-3.5z" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-width="1.5"/><rect x="9" y="9" width="6" height="6" rx="1" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke-width="1.5"/><path d="M5 11a7 7 0 0 0 14 0" stroke-width="1.5" stroke-linecap="square"/><path d="M12 18v3M9 21h6" stroke-width="1.5" stroke-linecap="square"/></svg>'
  },

  // Finds every placeholder inside root and swaps it for its real <svg>.
  // outerHTML replacement (not innerHTML) keeps the DOM shape identical
  // to the old hand-written markup — no extra wrapping span left behind
  // for CSS selectors like ".sidebar-nav a svg" to trip over.
  apply(root = document) {
    root.querySelectorAll('[data-nav-icon]').forEach(placeholder => {
      const svg = this.map[placeholder.dataset.navIcon];
      if (svg) placeholder.outerHTML = svg;
    });
  }
};
