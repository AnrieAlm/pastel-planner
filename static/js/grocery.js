/**
 * Calyx Planner — Grocery Page
 */
const Grocery = {
  init() {
  document.querySelectorAll('[data-modal="grocery-item"]').forEach(btn => {
    btn.addEventListener('click', () => Modals.open('grocery-item'));
  });

  document.querySelectorAll('.grocery-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.grocery-item').classList.toggle('checked', cb.checked);
    });
  });

  this.initActions();
  this.initModalAdd();

  // Sinéad's proactive nudge dismiss button
  document.querySelector('[data-close-nudge]')?.addEventListener('click', (e) => {
    e.target.closest('.grocery-nudge')?.remove();
  });
},

  // Wires modal-grocery-item's "Add item" button — the modal only has
  // one field, so unlike the other modals this doesn't need to check
  // which modal is open first.
  initModalAdd() {
    document.addEventListener('click', (e) => {
      const addBtn = e.target.closest('#modal-content .btn-modal-primary');
      if (!addBtn || !document.getElementById('grocery-item-name')) return;

      const name = document.getElementById('grocery-item-name')?.value?.trim();
      if (name) this.addItem(name);
      Modals.close();
    });
  },

  initActions() {
    const [clearBtn, readBtn] = document.querySelectorAll('.grocery-actions button');

    clearBtn?.addEventListener('click', () => {
      document.querySelectorAll('.grocery-item.checked').forEach(item => item.remove());
    });

    readBtn?.addEventListener('click', () => {
      const items = [...document.querySelectorAll('.grocery-item:not(.checked)')]
        .map(item => item.textContent.trim());

      if (items.length === 0) {
        SineadAI.nudge('Your grocery list is empty right now.');
        return;
      }
      // Real TTS (ElevenLabs, per Settings' "Irish voice for readbacks"
      // toggle) plugs in here later — for now this hands the list to
      // Sinéad's stub so the button does something visible
      SineadAI.nudge('Reading your list: ' + items.join(', '));
    });
  },

  addItem(name) {
    const list = document.querySelector('.grocery-list');
    if (!list) return;
    const label = document.createElement('label');
    label.className = 'grocery-item';
    label.innerHTML = `<input type="checkbox" /> ${name}`;
    list.appendChild(label);

    // Wire the change listener on the new item too, since it was added
    // after init() already ran
    label.querySelector('input').addEventListener('change', (e) => {
      label.classList.toggle('checked', e.target.checked);
    });
  }
};