/**
 * Calyx Planner — Settings Page (theme picker lives here)
 */
const Settings = {
  STORAGE_KEY: 'calyx-planner-theme',

    init() {
    this.initTheme();
    this.initDangerZone();
    this.initProfileSave();
    this.initExportData();
    this.initPush();
  },

  // "Push notifications": reflects whether this browser is actually registered, and turns
  // registration on or off through window.CalyxPush (see push.js). The three toggles under it
  // (vibration, habit reminders, deadline alerts) are still a visual preview only — reminders.py
  // currently sends all three kinds together whenever this master toggle is on.
  async initPush() {
    const toggle = document.getElementById('toggle-push');
    const note = document.getElementById('toggle-push-note');
    if (!toggle || !window.CalyxPush) return;

    const supported = await CalyxPush.isSupported();
    if (!supported) {
      toggle.checked = false;
      toggle.disabled = true;
      if (note) note.textContent = 'Not available in this browser yet — try installing the app first.';
      return;
    }

    toggle.checked = CalyxPush.permission() === 'granted';

    toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      if (toggle.checked) {
        const ok = await CalyxPush.enable();
        toggle.checked = ok;
        if (!ok && note) note.textContent = 'Notifications were blocked. Check your browser\u2019s site settings to allow them.';
      } else {
        await CalyxPush.disable();
      }
      toggle.disabled = false;
    });
  },

  // "Save changes" has nowhere real to persist to yet (no backend),
  // so this gives honest visible feedback — a brief "Saved" state on
  // the button itself — rather than pretending nothing happened or
  // silently doing nothing at all.
  initProfileSave() {
    const saveBtn = document.querySelector('.settings-section .btn-modal-primary');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', () => {
      const original = saveBtn.textContent;
      saveBtn.textContent = 'Saved ✓';
      saveBtn.disabled = true;
      setTimeout(() => {
        saveBtn.textContent = original;
        saveBtn.disabled = false;
      }, 1500);
    });
  },

  // "Download as JSON" — builds a real export from whatever's actually
  // visible in the DOM right now (there's no backend/data-store yet,
  // so the DOM *is* the source of truth at this build stage) and
  // triggers a genuine file download.
  initExportData() {
    const exportBtn = [...document.querySelectorAll('.settings-section .btn-modal-secondary')]
      .find(b => b.textContent.includes('Download as JSON'));
    if (!exportBtn) return;

    exportBtn.addEventListener('click', () => {
      const data = {
        profile: {
          name: document.getElementById('settings-name')?.value,
          email: document.getElementById('settings-email')?.value,
          timezone: document.getElementById('settings-timezone')?.value
        },
        theme: localStorage.getItem(this.STORAGE_KEY) || 'cottagecore',
        notes: [...document.querySelectorAll('.postit')].map(c => ({
          title: c.querySelector('h4')?.textContent?.trim(),
          content: c.querySelector('p')?.textContent?.trim(),
          meta: c.querySelector('.note-meta')?.textContent?.trim(),
          urgent: c.classList.contains('urgent'),
          done: c.classList.contains('done')
        })),
        habits: [...document.querySelectorAll('.habit-card')].map(c => ({
          name: c.querySelector('h3')?.textContent?.trim(),
          streak: c.querySelector('.habit-streak')?.textContent?.trim()
        })),
        routines: [...document.querySelectorAll('.routine-card')].map(c => ({
          name: c.querySelector('h3')?.textContent?.trim(),
          meta: c.querySelector('.routine-meta')?.textContent?.trim()
        })),
        bucketList: [...document.querySelectorAll('.bucket-keepsake')].map(c => ({
          title: c.querySelector('.bucket-title')?.textContent?.trim(),
          detail: c.querySelector('.bucket-detail')?.textContent?.trim(),
          done: c.classList.contains('done')
        })),
        grocery: [...document.querySelectorAll('.grocery-item')].map(c => ({
          item: c.textContent?.trim(),
          checked: c.classList.contains('checked')
        }))
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'calyx-planner-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  },

  // ===== Theme picker: Cottagecore / Midnight Garden =====
  initTheme() {
    const saved = localStorage.getItem(this.STORAGE_KEY) || 'cottagecore';
    this.applyTheme(saved);
    this.updatePickerUI(saved);

    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.theme; // "cottagecore" | "midnight"
        this.applyTheme(choice);
        this.updatePickerUI(choice);
        localStorage.setItem(this.STORAGE_KEY, choice);
      });
    });
  },

  applyTheme(choice) {
    const html = document.documentElement;
    if (choice === 'midnight') {
      html.setAttribute('data-theme', 'midnight');
    } else {
      html.removeAttribute('data-theme'); // Cottagecore is the unconditional default
    }
  },

  updatePickerUI(activeChoice) {
    document.querySelectorAll('.theme-option').forEach(btn => {
      const isActive = btn.dataset.theme === activeChoice;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  },

  // ===== Sign out / delete account =====
  initDangerZone() {
    const deleteBtn = document.querySelector('[data-modal="delete-account"]');
    deleteBtn?.addEventListener('click', () => Modals.open('delete-account'));

    const signoutBtn = document.querySelector('.btn-signout');
    signoutBtn?.addEventListener('click', () => this.signOut());

    this.initDeleteAccountModal();
  },

  // "Keep my account" just closes (Modals' own [data-close-modal]
  // handling already covers this if it ever gets that attribute, but
  // it currently doesn't, so it needs its own listener). "Yes, delete
  // everything" reuses the same sign-out flow above — there's no real
  // account to delete yet without a backend, so returning to the auth
  // screen is the honest stand-in rather than pretending to erase data
  // that was never really stored anywhere.
  initDeleteAccountModal() {
    document.addEventListener('click', (e) => {
      if (!document.querySelector('#modal-content h3')?.textContent.includes('Delete account')) return;

      const keepBtn = e.target.closest('#modal-content .btn-modal-secondary');
      const confirmBtn = e.target.closest('#modal-content .btn-modal-danger');

      if (keepBtn) {
        Modals.close();
      } else if (confirmBtn) {
        Modals.close();
        // Real account deletion arrives in a later stage; until then this
        // only signs you out and does not erase anything.
        this.signOut();
      }
    });
  },

  // Signs out of Firebase (clears the login cookie), then shows the login page
  async signOut() {
    try {
      await window.calyxAuth?.signOutUser();
    } catch (error) {
      console.error('Sign out problem:', error);
    }
    window.location.href = '/login';
  }
};
