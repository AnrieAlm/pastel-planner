/**
 * Calyx Planner — Grocery list
 * The server draws the list from MongoDB. This file sends ticks and removals to the server
 * instantly, shows the Undo message, and adds items for Sinéad's suggestion on Today.
 */
const Grocery = {
  init() {
    this.initTicks();
    this.initRemove();
    this.initClear();
    this.initReadAloud();
  },

  // Small helper: send JSON to the server. Returns the reply, or null if it did not work.
  // A 401 (logged out) sends you to the login page.
  async post(url, data) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return null;
      }
      return response.ok ? await response.json() : null;
    } catch (error) {
      return null;
    }
  },

  // A gentle message on this page (uses Today's toast when it exists)
  say(message) {
    if (typeof Today !== 'undefined') Today.toast(message);
  },

  // ---- Ticking items off ----

  initTicks() {
    document.addEventListener('change', async (e) => {
      const box = e.target.closest('.grocery-row input[type="checkbox"]');
      if (!box) return;
      const row = box.closest('.grocery-row');
      const label = box.closest('.grocery-item');

      // Looks ticked straight away; goes back if the server says no
      label.classList.toggle('checked', box.checked);
      const result = await this.post('/api/grocery/' + encodeURIComponent(row.dataset.itemId) + '/check',
                                     { checked: box.checked });
      if (!result) {
        box.checked = !box.checked;
        label.classList.toggle('checked', box.checked);
        this.say('Couldn\u2019t save that. Please try again.');
      }
    });
  },

  // ---- Removing one item, and clearing the ticked ones (both can be undone) ----

  initRemove() {
    document.addEventListener('click', async (e) => {
      const button = e.target.closest('.grocery-remove');
      if (!button) return;
      const row = button.closest('.grocery-row');
      const name = row.querySelector('.grocery-item-name').textContent;

      const result = await this.post('/api/grocery/remove', { ids: [row.dataset.itemId] });
      if (!result || !result.count) {
        this.say('Couldn\u2019t remove that. Please try again.');
        return;
      }
      row.remove();
      this.syncEmpty();
      this.showUndo(result.batch, name + ' removed.');
    });
  },

  initClear() {
    document.getElementById('grocery-clear')?.addEventListener('click', async () => {
      const result = await this.post('/api/grocery/clear');
      if (!result) {
        this.say('Couldn\u2019t clear those. Please try again.');
        return;
      }
      if (!result.count) {
        this.say('Nothing ticked off yet.');
        return;
      }
      document.querySelectorAll('.grocery-item.checked').forEach(item => item.closest('.grocery-row').remove());
      this.syncEmpty();
      this.showUndo(result.batch, result.count + (result.count === 1 ? ' item cleared.' : ' items cleared.'));
    });
  },

  // Shows the friendly empty message when the list has nothing left
  syncEmpty() {
    const hasRows = document.querySelector('.grocery-row');
    document.querySelector('.grocery-empty')?.classList.toggle('hidden', Boolean(hasRows));
  },

  // "…removed. Undo": shown for 8 seconds; Undo brings the whole batch back
  showUndo(batch, message) {
    document.querySelector('.undo-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = '<span></span><button type="button">Undo</button>';
    toast.querySelector('span').textContent = message;
    document.body.appendChild(toast);

    const undoBtn = toast.querySelector('button');
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      const result = await this.post('/api/grocery/restore', { batch });
      if (result) {
        window.location.reload();
      } else {
        toast.querySelector('span').textContent = 'Couldn\u2019t bring it back \u2014 it may already be gone.';
        undoBtn.remove();
      }
    });
    setTimeout(() => toast.remove(), 8000);
  },

  // ---- Read the list aloud (real voice comes in the Sinéad stage) ----

  initReadAloud() {
    document.getElementById('grocery-read')?.addEventListener('click', () => {
      const items = [...document.querySelectorAll('.grocery-item:not(.checked) .grocery-item-name')]
        .map(item => item.textContent.trim());

      if (items.length === 0) {
        SineadAI.nudge('Your grocery list is empty right now.');
        return;
      }
      SineadAI.nudge('Reading your list: ' + items.join(', '));
    });
  },

  // ---- Used by Sinéad's suggestion on Today ("Add chicken to your list?") ----

  async addItem(name) {
    const result = await this.post('/api/grocery/add', { name });
    if (result) {
      this.say(result.added ? 'Added to your grocery list' : 'Already on your grocery list');
    } else {
      this.say('Couldn\u2019t add that. Please try again.');
    }
  }
};
