/**
 * Calyx Planner — Page Navigation
 */

// Per-page config for the mobile bottom-nav's centre button. Pages not
// listed here (Habits, Settings) fall back to the default defined in
// updateNavAddButton() below — same "+" it's always had, no override.
// Page name -> URL. Must match the routes in main.py
const PAGE_URLS = {
  today: '/', routine: '/routine', notes: '/notes', calendar: '/calendar',
  habits: '/habits', grocery: '/grocery', bucketlist: '/bucket', settings: '/settings'
};

const NAV_ADD_CONFIG = {
  today:      { mode: 'play', color: 'var(--accent-primary)' },
  notes:      { mode: 'add',  color: 'var(--accent-tertiary)',   modal: 'new-note',    label: 'New note' },
  calendar:   { mode: 'add',  color: 'var(--accent-secondary)',  modal: 'new-note',    label: 'Add event' },
  routine:    { mode: 'add',  color: 'var(--accent-primary)',    modal: 'new-routine', label: 'New routine' },
  grocery:    { mode: 'add',  color: 'var(--accent-quaternary)', modal: 'grocery-item',label: 'Add grocery item' },
  bucketlist: { mode: 'add',  color: 'var(--accent-quaternary)', modal: 'bucket-item', label: 'Add bucket item' }
};

const Navigation = {
  init() {
    // Delegated on document, not bound per-element at startup — this is
    // required because [data-page] links inside components loaded later
    // (like the "More" sheet, fetched on demand) don't exist in the DOM
    // yet when init() runs, so a per-element listener would miss them.
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-page]');
      if (link) {
        e.preventDefault();
        // Go to the real page (the server sends it)
        window.location.href = PAGE_URLS[link.dataset.page] || '/';
      }
    });

    // The bottom-nav-add button's click target changes per page (see
    // updateNavAddButton), so its behaviour lives in one delegated
    // listener here rather than being rebound every time the page
    // changes — simpler than juggling addEventListener/removeEventListener
    // pairs on the same element.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.bottom-nav-add');
      if (!btn) return;
      if (btn.dataset.navAddMode === 'play') {
        e.preventDefault();
        SineadAI.playBriefing();
      }
      // mode === 'add' needs no special handling here — the button's
      // own data-modal attribute (kept in sync by updateNavAddButton)
      // is already picked up by Modals.js's generic [data-modal] listener
    });

    // Set the correct state for whichever page is active on first load
    const current = document.body.dataset.section || 'today';
    this.markActive(current);
    this.updateNavAddButton(current);

    this.initSidebarCollapse();
  },

  // Sidebar collapse (desktop) — Claude.ai-style icon-only rail.
  // Persisted in localStorage so it stays collapsed across page loads,
  // same pattern Settings.js already uses for the theme choice.
  initSidebarCollapse() {
    const STORAGE_KEY = 'calyx-planner-sidebar-collapsed';
    const shell = document.getElementById('app-shell');
    const toggle = document.getElementById('sidebar-collapse-toggle');
    if (!shell || !toggle) return;

    const setCollapsed = (collapsed) => {
      shell.classList.toggle('sidebar-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    };

    setCollapsed(localStorage.getItem(STORAGE_KEY) === 'true');

    toggle.addEventListener('click', () => {
      const collapsed = !shell.classList.contains('sidebar-collapsed');
      setCollapsed(collapsed);
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    });
  },

  // Highlights the current page's link in the sidebar and bottom nav
  markActive(pageName) {
    document.querySelectorAll('[data-page]').forEach(link => {
      const isActive = link.dataset.page === pageName;
      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  },

  // Reshapes the mobile bottom-nav's centre button to match whichever
  // page is now active: a Play button (Sage) on Today, or a "+" tinted
  // that page's own colour everywhere it has an add-modal. Pages with
  // no listed config (Habits, Settings) get the original, unconditional
  // default — "+", Sage, opens New note — since neither has an add
  // action of its own to route to.
  updateNavAddButton(pageName) {
    const btn = document.querySelector('.bottom-nav-add');
    if (!btn) return;

    const config = NAV_ADD_CONFIG[pageName] || { mode: 'add', color: 'var(--accent-primary)', modal: 'new-note', label: 'New note' };

    btn.style.background = config.color;
    btn.dataset.navAddMode = config.mode;
    btn.setAttribute('aria-label', config.mode === 'play' ? 'Play morning briefing' : config.label);

    if (config.mode === 'play') {
      btn.removeAttribute('data-modal');
      btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">play_circle</span>';
    } else {
      btn.setAttribute('data-modal', config.modal);
      btn.innerHTML = '<span class="nav-icon" data-nav-icon="add"></span>';
      NavIcons.apply(btn);
    }
  }
};