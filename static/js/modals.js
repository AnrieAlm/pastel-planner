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
      if (!this.overlay || this.overlay.classList.contains('hidden')) return;
      if (e.key === 'Escape') {
        this.close();
        return;
      }
      // Trap Tab/Shift+Tab inside the modal so keyboard focus can never wander onto the
      // (invisible-to-sighted-users, but still focusable) page underneath — required by the
      // design system's "full keyboard navigation" rule, previously unimplemented
      if (e.key === 'Tab') this.trapTab(e);
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
            // The version number (set in base.html) changes on every deploy, so a phone never keeps
      // showing an old copy of a sheet
      const version = document.body.dataset.assetVersion || '';
      const res = await fetch(`/static/components/modal-${modalName}.html?v=${version}`);
      if (!res.ok) throw new Error(`Modal "${modalName}" returned ${res.status}`);

      this.content.innerHTML = await res.text();
      EmojiIcons.apply(this.content);
      NavIcons.apply(this.content);
      this.overlay.classList.remove('hidden');
      // Screen readers should not be able to read or navigate into the page behind the modal
      document.getElementById('app-shell')?.setAttribute('aria-hidden', 'true');

      // Focus the first VISIBLE input/select/textarea in the modal — required by the design
      // system's "Focus: inputs focused on modal open" rule, previously not implemented. Several
      // sheets open with `<input type="hidden" name="next">`-style plumbing before the real first
      // field; a plain `input` selector would silently try to focus that (impossible — hidden
      // inputs can never receive focus — so nothing was actually focused), so hidden inputs are
      // excluded here. If the sheet has no field at all (e.g. a confirm dialog), focus moves to
      // the dialog itself instead, so keyboard/screen-reader users land somewhere inside it rather
      // than being left on the page behind it.
      const firstField = this.content.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstField) {
        firstField.focus();
      } else {
        this.content.setAttribute('tabindex', '-1');
        this.content.focus();
      }

      this.currentData = data;
    } catch (err) {
      console.error(`Couldn't open modal "${modalName}":`, err);
      console.warn(
        `If this is edit-routine, bucket-item-edit, or more, that component ` +
        `file doesn't exist yet — flagged as missing in earlier files.`
      );
    }
  },

  // Every element inside the modal that Tab can land on, in document order
  focusableInModal() {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...this.content.querySelectorAll(selector)].filter(el => el.offsetParent !== null);
  },

  // Keeps Tab (and Shift+Tab) cycling within the modal: past the last field it wraps to the
  // first, and back past the first it wraps to the last — a standard "focus trap" for dialogs
  trapTab(e) {
    const items = this.focusableInModal();
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
    // Any other Tab press (moving between two fields in the middle) is left alone —
    // the browser's normal tab order already does the right thing
  },

  close() {
    this.overlay?.classList.add('hidden');
    if (this.content) this.content.innerHTML = '';
    document.getElementById('app-shell')?.removeAttribute('aria-hidden');
    // Return focus to whatever opened the modal, so keyboard users
    // aren't left stranded on a removed element
    this.lastFocused?.focus?.();
  }
};
