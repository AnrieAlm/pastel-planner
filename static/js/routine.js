/**
 * Calyx Planner — Routine Page
 * Each routine's "Edit" turns the whole card into a form, in place (no popup). Before saving,
 * the server is asked whether the new times collide with any other active routine; if so, a
 * warning appears with the choice to save anyway, merge into the other routine, or go back.
 */
const Routine = {
  init() {
    this.initEditToggle();
    this.initBlockRows();
    this.initSaveWithOverlapCheck();
    this.initNewRoutine();
  },

  // "Edit" swaps a card's display view for its edit form. "Cancel" reloads the page — the
  // simplest way to guarantee every in-progress change (added/removed rows, typed text) is
  // thrown away cleanly, rather than trying to manually undo each one.
  initEditToggle() {
    document.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-routine]');
      if (editBtn) {
        const card = editBtn.closest('.routine-card');
        card.querySelector('.routine-display').classList.add('hidden');
        card.querySelector('.routine-edit-form').classList.remove('hidden');
        card.querySelector('.routine-edit-form input, .routine-edit-form select')?.focus();
        return;
      }
      if (e.target.closest('.routine-cancel-btn:not(.routine-discard-new)')) {
        window.location.reload();
      }
    });
  },

  // "+ Add block" clones the empty row template; the × on a row removes it
  initBlockRows() {
    document.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.routine-add-block');
      if (addBtn) {
        const template = document.getElementById('routine-block-row-template');
        const rows = addBtn.closest('.routine-edit-form').querySelector('.routine-block-rows');
        const row = template.content.cloneNode(true);
        rows.appendChild(row);
        rows.lastElementChild.querySelector('input[name="times"]')?.focus();
        return;
      }
      const removeBtn = e.target.closest('.routine-block-remove');
      if (removeBtn) {
        removeBtn.closest('.routine-block-row').remove();
      }
    });
  },

  // Reads one form's current rows into the shape /api/routines/check-overlap expects
  collectBlocks(form) {
    return {
      times: [...form.querySelectorAll('input[name="times"]')].map(el => el.value),
      names: [...form.querySelectorAll('input[name="names"]')].map(el => el.value),
      durations: [...form.querySelectorAll('input[name="durations"]')].map(el => el.value),
    };
  },

  // Reads which day buttons are lit up right now, and writes that into the form's hidden "days"
  // field (the one the server actually reads). Deliberately done HERE, at save time, rather than
  // inside the day button's own click handler — Modals.js toggles each button's "active" class
  // on the same click event, and relying on handler registration order to run after it would be
  // fragile. By save time every earlier click has long since finished, so this is always correct.
  syncDaysField(form) {
    const chosen = [...form.querySelectorAll('.day-picker button.active')].map(b => b.dataset.day);
    const daysField = form.querySelector('.routine-days-value');
    if (daysField) daysField.value = chosen.join(',');
    return chosen;
  },

  // Before a routine actually saves, ask the server whether it collides with anything else.
  // A clean check submits right away; a conflict shows a warning instead of saving, with
  // choices to save anyway, merge, or go back and adjust.
  initSaveWithOverlapCheck() {
    document.addEventListener('submit', async (e) => {
      const form = e.target.closest('.routine-edit-form');
      // Only the Save button (not Delete, which has its own formaction) goes through this
      if (!form || e.submitter?.classList.contains('btn-modal-danger')) return;

      e.preventDefault();
      form.querySelector('.routine-overlap-warning')?.classList.add('hidden');
      const card = form.closest('.routine-card');
      const routineId = card?.dataset.routineId || '';
      const { times, names, durations } = this.collectBlocks(form);
      const days = this.syncDaysField(form);

      let conflicts = [];
      try {
        const response = await fetch('/api/routines/check-overlap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routine_id: routineId, days, times, names, durations }),
        });
        if (response.ok) conflicts = (await response.json()).conflicts;
      } catch (error) {
        // Could not reach the server to check — fall through and just save; the save itself
        // will fail on its own if something is actually wrong
      }

      if (conflicts.length === 0) {
        form.submit();
        return;
      }
      this.showOverlapWarning(form, conflicts);
    });
  },

  showOverlapWarning(form, conflicts) {
    const box = form.querySelector('.routine-overlap-warning');
    if (!box) { form.submit(); return; }

    const lines = conflicts.map(c =>
      `<li>${c.dayLabel}: <strong>${this.escape(c.blockName)}</strong> (${c.blockTime}) overlaps with ` +
      `"${this.escape(c.withRoutine)}" — <strong>${this.escape(c.withBlock)}</strong> (${c.withTime})</li>`
    ).join('');

    // "Merge" only makes sense when editing a routine that already exists (it needs a real id
    // to merge FROM), and only when every conflict is against the same other routine — merging
    // three different routines into one in a single click would be a confusing, hard-to-undo leap
    const card = form.closest('.routine-card');
    const thisRoutineId = card?.dataset.routineId || '';
    const otherIds = new Set(conflicts.map(c => c.routine_id));
    const canMerge = thisRoutineId && otherIds.size === 1;
    const otherId = canMerge ? [...otherIds][0] : null;
    const otherName = canMerge ? conflicts[0].withRoutine : '';

    box.innerHTML = `
      <p>This overlaps with another active routine:</p>
      <ul>${lines}</ul>
      <div class="modal-actions">
        <button type="button" class="btn-modal-secondary routine-save-anyway">Save anyway</button>
        ${canMerge ? `<button type="button" class="btn-modal-secondary routine-merge-btn">Merge into "${this.escape(otherName)}"</button>` : ''}
        <button type="button" class="btn-modal-secondary routine-go-back">Go back and edit</button>
      </div>`;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    box.querySelector('.routine-save-anyway').addEventListener('click', () => form.submit(), { once: true });
    box.querySelector('.routine-go-back').addEventListener('click', () => box.classList.add('hidden'), { once: true });
    box.querySelector('.routine-merge-btn')?.addEventListener('click', () => {
      // The routine being edited merges INTO the other one (its own in-progress, unsaved edits
      // are discarded — only what was already saved gets combined), then the page reloads
      // to show the single, merged result
      const mergeForm = document.createElement('form');
      mergeForm.method = 'post';
      mergeForm.action = `/merge-routines/${encodeURIComponent(otherId)}/${encodeURIComponent(thisRoutineId)}`;
      mergeForm.style.display = 'none';
      mergeForm.innerHTML = '<input type="hidden" name="next" value="/routine" />';
      document.body.appendChild(mergeForm);
      mergeForm.submit();
    }, { once: true });
  },

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // "+ New routine" clones a blank, already-editable card onto the top of the list
  initNewRoutine() {
    document.getElementById('routine-new-btn')?.addEventListener('click', () => {
      const template = document.getElementById('routine-new-card-template');
      const list = document.getElementById('routine-list');
      document.getElementById('routine-empty-note')?.remove();
      list.insertBefore(template.content.cloneNode(true), list.firstChild);
      list.querySelector('.routine-new-form input[name="name"]')?.focus();
    });

    // Cancelling a never-saved card just removes it — there is nothing to reload or discard
    document.addEventListener('click', (e) => {
      if (e.target.closest('.routine-discard-new')) {
        e.target.closest('.routine-card').remove();
      }
    });
  }
};
