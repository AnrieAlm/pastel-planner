/**
 * Calyx Planner — Routine Page
 */
const Routine = {
  init() {
    document.querySelectorAll('[data-modal="new-routine"]').forEach(btn => {
      btn.addEventListener('click', () => Modals.open('new-routine'));
    });

    // Edit button on each routine card
    document.querySelectorAll('.routine-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.routine-card');
        const routineName = card?.querySelector('h3')?.textContent || '';
        Modals.open('edit-routine', { sourceEl: card, name: routineName });
      });
    });

    this.initModalActions();
  },

  // Save (edit-routine) writes the Name field back onto the card that
  // was opened. Delete removes the card entirely — unlike Habits,
  // Routine isn't a fixed-slot system, so there's nothing to preserve
  // a placeholder for. Create (new-routine) builds a new .routine-card
  // matching the same markup the existing cards use, with an empty
  // schedule (no blocks yet) since Sinéad's real block-parsing isn't
  // built — the textarea's raw text is kept as a note instead of being
  // silently discarded.
  initModalActions() {
    document.addEventListener('click', (e) => {
      const saveBtn = e.target.closest('#modal-content .btn-modal-primary');
      const deleteBtn = e.target.closest('#modal-content .btn-modal-danger');
      const createBtn = e.target.closest('#modal-content h3');
      if (!saveBtn && !deleteBtn) return;

      // edit-routine modal
      if (document.getElementById('edit-routine-name')) {
        const card = Modals.currentData?.sourceEl;
        if (!card) return;

        if (saveBtn) {
          const name = document.getElementById('edit-routine-name')?.value?.trim();
          const titleEl = card.querySelector('h3');
          if (titleEl && name) titleEl.textContent = name;
        } else if (deleteBtn) {
          card.remove();
        }
        Modals.close();
        return;
      }

      // new-routine modal
      if (saveBtn && document.getElementById('routine-name') && !document.getElementById('edit-routine-name')) {
        this.createRoutine();
        Modals.close();
      }
    });
  },

  createRoutine() {
    const name = document.getElementById('routine-name')?.value?.trim();
    if (!name) return; // nothing to add without at least a name

    const anchor = document.getElementById('routine-anchor')?.value;
    const activeDays = [...document.querySelectorAll('#modal-content .day-picker button.active')]
      .map(b => b.textContent.trim());
    const blocksText = document.getElementById('routine-blocks')?.value?.trim();

    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const daysHtml = dayLabels.map((label, i) => {
      // day-picker buttons don't carry which weekday they are beyond
      // position, so match by position among the 7 in order
      const isActive = activeDays[i] !== undefined;
      return `<span class="routine-day${isActive ? ' active' : ''}">${label}</span>`;
    }).join('\n    ');

    let anchorLabel = 'time not set';
    if (anchor) {
      const [h, m] = anchor.split(':');
      const hour12 = ((+h % 12) || 12);
      anchorLabel = `${hour12}:${m} ${+h < 12 ? 'am' : 'pm'} anchor`;
    }

    const card = document.createElement('div');
    card.className = 'routine-card';
    card.innerHTML = `
  <div class="routine-card-header">
    <h3>${name}</h3>
    <span class="routine-meta">${anchorLabel}</span>
  </div>
  <button class="routine-edit-btn">Edit</button>
  <div class="routine-days">
    ${daysHtml}
  </div>
  ${blocksText ? `<p class="routine-note">${blocksText}</p>` : '<p class="routine-note">No blocks added yet.</p>'}
    `;

    // Insert right after the header's subtitle, before the existing
    // cards, so new routines are easy to find rather than buried at
    // the bottom of the list
    const header = document.querySelector('.routine-header');
    const subtitle = header?.nextElementSibling;
    (subtitle || header)?.insertAdjacentElement('afterend', card);

    card.querySelector('.routine-edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      Modals.open('edit-routine', { sourceEl: card, name: card.querySelector('h3')?.textContent || '' });
    });
  }
};
