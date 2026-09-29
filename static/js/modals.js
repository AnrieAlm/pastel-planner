/**
 * Calyx Planner — Modal System
 */
const Modals = {
  overlay: null,
  content: null,
  lastFocused: null,

  init() {
    this.overlay = document.getElementById('modal-overlay');
    this.content = document.getElementById('modal-content');

    // Close on overlay click (clicking the dark backdrop, not the sheet itself)
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Escape closes the modal — required by the original design system
    // spec ("Keyboard: Escape closes modal") but never implemented
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.classList.contains('hidden')) {
        this.close();
      }
    });

    // One delegated click listener handles everything that can happen
    // inside a modal or trigger it to open — colour-dot selection,
    // the close (✕) button, and any [data-modal] open trigger anywhere
    // in the app. Checked in this order because a click can only ever
    // match one of these at a time; each returns early once handled.
    document.addEventListener('click', (e) => {
      const dot = e.target.closest('.colour-dot');
      if (dot) {
        this.selectColourDot(dot);
        return;
      }

      // Day-picker toggle (M/T/W/T/F/S/S buttons) — identical behaviour
      // needed in modal-edit-habit, modal-edit-routine and
      // modal-new-routine, so it lives here once instead of being
      // duplicated across three page-specific JS files.
      const dayBtn = e.target.closest('.day-picker button');
      if (dayBtn) {
        const isActive = dayBtn.classList.toggle('active');
        dayBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        return;
      }

      // "Set date" inside modal-pick-date is opened from more than one
      // page (Today's carry-over items, Bucket List's "Plan it"), so
      // rather than this file needing to know what each caller means
      // by "a date was picked," it just dispatches an event with the
      // date and whatever sourceEl the opener passed — each page wires
      // its own listener for what to actually do with it.
      const setDateBtn = e.target.closest('#modal-content .btn-modal-primary');
      if (setDateBtn && document.getElementById('pick-date-input')) {
        const date = document.getElementById('pick-date-input')?.value;
        document.dispatchEvent(new CustomEvent('calyx:date-picked', {
          detail: { date, sourceEl: this.currentData?.sourceEl }
        }));
        this.close();
        return;
      }

      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        this.close();
        return;
      }

      const openTrigger = e.target.closest('[data-modal]');
      if (openTrigger) {
        this.open(openTrigger.dataset.modal);
        return;
      }
    });
  },

  // Colour-dot selection — works inside whichever modal is currently
  // open, since .colour-options only exists once a modal has loaded
  selectColourDot(dot) {
    const group = dot.closest('.colour-options');
    group?.querySelectorAll('.colour-dot').forEach(d => {
      d.classList.remove('selected');
      d.setAttribute('aria-pressed', 'false');
    });
    dot.classList.add('selected');
    dot.setAttribute('aria-pressed', 'true');
  },

  // data is optional — e.g. Modals.open('edit-routine', { name: 'Morning weekday' })
  // lets the caller pass context the modal template can use once it's
  // wired to real data. For now it's accepted but not yet consumed.
  async open(modalName, data = null) {
    this.lastFocused = document.activeElement;

    try {
      const res = await fetch(`/static/components/modal-${modalName}.html`);
      if (!res.ok) throw new Error(`Modal "${modalName}" returned ${res.status}`);

      this.content.innerHTML = await res.text();
      EmojiIcons.apply(this.content);
      NavIcons.apply(this.content);
      this.overlay.classList.remove('hidden');

      // Focus the first input/select/textarea in the modal — required
      // by the design system's "Focus: inputs focused on modal open"
      // rule, previously not implemented
      const firstField = this.content.querySelector('input, select, textarea');
      firstField?.focus();

      this.currentData = data;
    } catch (err) {
      console.error(`Couldn't open modal "${modalName}":`, err);
      console.warn(
        `If this is edit-routine, bucket-item-edit, or more, that component ` +
        `file doesn't exist yet — flagged as missing in earlier files.`
      );
    }
  },

  close() {
    this.overlay?.classList.add('hidden');
    if (this.content) this.content.innerHTML = '';
    // Return focus to whatever opened the modal, so keyboard users
    // aren't left stranded on a removed element
    this.lastFocused?.focus?.();
  }
};