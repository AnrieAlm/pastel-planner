/**
 * Calyx Planner — Settings Page (theme picker lives here)
 */
const Settings = {
  STORAGE_KEY: 'calyx-planner-theme',

    init() {
    this.initTheme();
    this.initDangerZone();
    this.initPush();
    this.initFollowups();
  },

  // "Follow-up questions" switch: saved on the server straight away. If saving fails the switch
  // goes back to how it was, so what you see is always what is really saved.
  initFollowups() {
    const toggle = document.getElementById('toggle-followups');
    const note = document.getElementById('toggle-followups-note');
    if (!toggle) return;
    const original = note ? note.textContent : '';

    toggle.addEventListener('change', async () => {
      const wanted = toggle.checked;
      toggle.disabled = true;
      try {
        const response = await fetch('/api/followups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: wanted })
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (!response.ok) throw new Error('save failed');
        if (note) note.textContent = original;
      } catch (error) {
        toggle.checked = !wanted;
        if (note) note.textContent = 'Couldn\u2019t save that. Please try again.';
      } finally {
        toggle.disabled = false;
      }
    });
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

    toggle.checked = CalyxPush.isEnabled();

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

  // "Keep my account" just closes. "Yes, delete everything" deletes this person's data on the
  // server, then their Firebase login, then sends them to the login page.
  initDeleteAccountModal() {
    document.addEventListener('click', (e) => {
      if (!document.querySelector('#modal-content h3')?.textContent.includes('Delete account')) return;

      const keepBtn = e.target.closest('#modal-content .btn-modal-secondary');
      const confirmBtn = e.target.closest('#modal-content .btn-modal-danger');

      if (keepBtn) {
        Modals.close();
      } else if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting\u2026';
        this.deleteAccount();
      }
    });
  },

  async deleteAccount() {
    try {
      // Stop push messages first (this needs the login cookie, so it comes before anything else)
      await window.CalyxPush?.disable();
      const response = await fetch('/api/delete-account', { method: 'POST' });
      if (!response.ok) throw new Error('delete failed');
    } catch (error) {
      console.error('Could not delete account data:', error);
      Modals.close();
      if (typeof Today !== 'undefined') Today.toast('Couldn\u2019t delete your account. Please try again.');
      return;
    }
    // The data is gone. Now remove the login itself (Firebase may ask for a recent sign-in;
    // if so we just sign out, and the empty account can be deleted from the Firebase console).
    try {
      await window.calyxAuth?.deleteAccountUser();
    } catch (error) {
      console.warn('Could not delete the Firebase login:', error);
    }
    window.location.href = '/login';
  },

  // Signs out of Firebase (clears the login cookie), then shows the login page.
  // This browser stops receiving this person's reminders first.
  async signOut() {
    try {
      await window.CalyxPush?.disable();
    } catch (error) {
      // Not fatal - carry on signing out
    }
    try {
      await window.calyxAuth?.signOutUser();
    } catch (error) {
      console.error('Sign out problem:', error);
    }
    window.location.href = '/login';
  }
};
