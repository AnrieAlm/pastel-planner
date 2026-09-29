/**
 * Calyx Planner — Notes Page
 */
const Notes = {
  init() {
    this.initFilters();
    this.initNoteCards();
    this.initModalActions();

    document.querySelectorAll('[data-modal="new-note"]').forEach(btn => {
      btn.addEventListener('click', () => Modals.open('new-note'));
    });
  },

  initFilters() {
    document.querySelectorAll('.notes-filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.notes-filters button').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        // TODO: once notes come from real data, filter the list here
        // based on btn.textContent (All / Undated / Dated / Urgent / Done)
      });
    });
  },

  // Notes were restyled from .note-card to .postit at some point and
  // this selector never got updated — it was a silent no-op (the
  // generic [data-modal] delegation in Modals.js still opened the
  // modal, just with no data), which is why nothing looked broken.
  // Fixed to the real class, and now passes sourceEl so Save/Delete
  // can act on the exact card that was opened.
  initNoteCards() {
    document.querySelectorAll('.postit[data-modal="edit-note"]').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        Modals.open('edit-note', { sourceEl: card });
      });
    });
  },

  initModalActions() {
    document.addEventListener('click', (e) => {
      const gcalBtn = e.target.closest('#modal-content .btn-modal-secondary');
      const saveBtn = e.target.closest('#modal-content .btn-modal-primary');
      const deleteBtn = e.target.closest('#modal-content .btn-modal-danger');

      // Google Calendar / download .ics — only meaningful inside
      // edit-note, identified by note-title existing in the modal
      if (gcalBtn && document.getElementById('note-title')) {
        if (gcalBtn.textContent.includes('Google Calendar')) {
          this.openGoogleCalendarLink();
        } else if (gcalBtn.textContent.includes('.ics')) {
          this.downloadIcs();
        }
        return; // secondary actions don't close the modal
      }

      if (!saveBtn && !deleteBtn) return;

      // edit-note modal
      if (document.getElementById('note-title') && document.getElementById('note-content')) {
        const card = Modals.currentData?.sourceEl;
        if (!card) return;

        if (saveBtn) {
          this.applyNoteFieldsToCard(card, {
            title: document.getElementById('note-title')?.value,
            content: document.getElementById('note-content')?.value,
            urgent: document.getElementById('note-urgent')?.checked,
            colourBtn: document.querySelector('#modal-content .colour-dot.selected')
          });
        } else if (deleteBtn) {
          card.remove();
        }
        Modals.close();
        return;
      }

      // new-note modal
      if (saveBtn && document.getElementById('new-note-title')) {
        this.createNote();
        Modals.close();
      }
    });
  },

  // Shared by Save (edit-note) and Add (new-note) — writes form values
  // onto a .postit card's h4/p/note-meta/urgent/colour-N.
  applyNoteFieldsToCard(card, { title, content, urgent, colourBtn, dateStr }) {
    const titleEl = card.querySelector('h4');
    const contentEl = card.querySelector('p');
    const metaEl = card.querySelector('.note-meta');

    if (titleEl && title?.trim()) titleEl.textContent = (urgent ? '⚑ ' : '') + title.trim();
    if (contentEl && content !== undefined) contentEl.textContent = content?.trim() || '';
    if (metaEl && dateStr) metaEl.textContent = dateStr;

    card.classList.toggle('urgent', !!urgent);

    if (colourBtn) {
      card.className = card.className.replace(/colour-\d/, '').trim();
      const colourMatch = colourBtn.className.match(/colour-\d/);
      if (colourMatch) card.classList.add(colourMatch[0]);
    }
  },

  createNote() {
    const title = document.getElementById('new-note-title')?.value?.trim();
    if (!title) return; // nothing to add without at least a title

    const content = document.getElementById('new-note-content')?.value?.trim() || '';
    const urgent = document.getElementById('new-note-urgent')?.checked;
    const datetime = document.getElementById('new-note-datetime')?.value;
    const colourBtn = document.querySelector('#modal-content .colour-dot.selected');
    const colourClass = colourBtn?.className.match(/colour-\d/)?.[0] || 'colour-1';

    let dateStr = 'Undated';
    if (datetime) {
      const d = new Date(datetime);
      dateStr = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
        ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `postit ${colourClass}${urgent ? ' urgent' : ''}`;
    card.setAttribute('data-modal', 'edit-note');
    card.innerHTML = `
      <h4>${urgent ? '⚑ ' : ''}${title}</h4>
      <p>${content}</p>
      <span class="note-meta">${dateStr}</span>
    `;

    document.querySelector('.postit-board')?.prepend(card);
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      Modals.open('edit-note', { sourceEl: card });
    });
  },

  // Builds a real, working Google Calendar "quick add event" link from
  // the currently-open edit-note modal's title/date fields and opens
  // it in a new tab — no backend needed, Google Calendar accepts this
  // URL format directly.
  openGoogleCalendarLink() {
    const title = document.getElementById('note-title')?.value?.trim() || 'Note';
    const datetime = document.getElementById('note-datetime')?.value;
    const details = document.getElementById('note-content')?.value?.trim() || '';

    let datesParam = '';
    if (datetime) {
      const start = new Date(datetime);
      const end = new Date(start.getTime() + 30 * 60000); // default 30 min
      const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      datesParam = `&dates=${fmt(start)}/${fmt(end)}`;
    }

    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}${datesParam}&details=${encodeURIComponent(details)}`;
    window.open(url, '_blank');
  },

  // Builds a minimal, valid .ics file client-side and triggers a real
  // download — no backend needed, this is a plain text format.
  downloadIcs() {
    const title = document.getElementById('note-title')?.value?.trim() || 'Note';
    const datetime = document.getElementById('note-datetime')?.value;
    const details = document.getElementById('note-content')?.value?.trim() || '';

    const start = datetime ? new Date(datetime) : new Date();
    const end = new Date(start.getTime() + 30 * 60000);
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Calyx Planner//EN',
      'BEGIN:VEVENT',
      `UID:${Date.now()}@petalplanner`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${details.replace(/\n/g, '\\n')}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\w\-]+/g, '_') || 'note'}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
};
