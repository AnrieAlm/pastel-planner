/**
 * Calyx Planner — Notes Page
 * The server draws the notes from MongoDB and saves changes through forms.
 * This file only does the small things a form can't: fill the edit sheet,
 * switch filters, show the Undo message, and build calendar links.
 */
const Notes = {
  init() {
    this.initFilters();
    this.initNoteCards();
    this.initForms();
    this.initFinishBy();
    this.showUndoIfNeeded();
    this.initCalendarButtons();
  },

  // Filter chips reload the page with ?filter=... (the server does the filtering)
  initFilters() {
    document.querySelectorAll('.notes-filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        window.location.href = filter === 'all' ? '/notes' : '/notes?filter=' + filter;
      });
    });
  },

  // Clicking a note (a post-it here, or a row on the Today page) opens the edit sheet,
  // then fills it with that note's details
  initNoteCards() {
    document.querySelectorAll('[data-modal="edit-note"][data-note-id]').forEach(card => {
      card.addEventListener('click', async (e) => {
        e.stopPropagation();
        await Modals.open('edit-note', { sourceEl: card });
        this.fillEditForm(card);
      });
    });
  },

  // Puts the note's details into the edit sheet and points its buttons at this note
  fillEditForm(card) {
    const form = document.getElementById('edit-note-form');
    if (!form) return;
    const note = card.dataset;

    form.setAttribute('action', '/update-note/' + note.noteId);
    document.getElementById('note-title').value = note.title;
    document.getElementById('note-content').value = note.content;
    document.getElementById('note-urgent').checked = note.urgent === 'true';
    document.getElementById('note-date').value = note.date;
    document.getElementById('note-time').value = note.time;
    document.getElementById('note-deadline').value = note.deadline;
    document.getElementById('note-finish-by').value = note.finishBy || '';
    this.syncFinishBy(form);
    
    const bucketSelect = document.getElementById('note-bucket');
    if (bucketSelect) bucketSelect.value = note.bucket || '';

    const dot = form.querySelector('.colour-dot.colour-' + note.color);
    if (dot) Modals.selectColourDot(dot);

    // Mark done / Delete are submit buttons that post to their own address
    const doneBtn = document.getElementById('note-done-btn');
    doneBtn.setAttribute('formaction', '/toggle-done/' + note.noteId);
    doneBtn.textContent = note.done === 'true' ? 'Mark not done' : 'Mark done';
    document.getElementById('note-delete-btn').setAttribute('formaction', '/delete-note/' + note.noteId);
  },

  // The "When do you want to have it done?" block only shows once a deadline is set
  syncFinishBy(form) {
    const deadline = form.querySelector('input[name="deadline"]');
    const block = form.querySelector('.finish-by-block');
    if (!deadline || !block) return;
    block.hidden = !deadline.value;
    const finishBy = form.querySelector('input[name="finish_by"]');
    finishBy.max = deadline.value || '';
    if (!deadline.value) finishBy.value = '';
  },

  // Chips: 1 day / 3 days / 1 week before the deadline, or type your own date
  initFinishBy() {
    document.addEventListener('input', (e) => {
      if (e.target.matches('input[name="deadline"]')) {
        this.syncFinishBy(e.target.closest('form'));
      }
    });

    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.finish-chip');
      if (!chip) return;
      const form = chip.closest('form');
      const deadline = form.querySelector('input[name="deadline"]').value;
      const finishBy = form.querySelector('input[name="finish_by"]');

      if (chip.dataset.days === 'custom') {
        finishBy.focus();
        return;
      }
      if (!deadline) return;

      // Count back from the deadline, but never earlier than today
      const [y, m, d] = deadline.split('-').map(Number);
      const picked = new Date(y, m - 1, d - Number(chip.dataset.days));
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const result = picked < todayStart ? todayStart : picked;
      const pad = (n) => String(n).padStart(2, '0');
      finishBy.value = `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}`;

      form.querySelectorAll('.finish-chip').forEach(c => c.classList.toggle('selected', c === chip));
    });
  },

  // Just before a note form is sent, copy in the chosen colour and the page to come back to
  initForms() {
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('#edit-note-form, #new-note-form');
      if (!form) return;

      const chosen = form.querySelector('.colour-dot.selected');
      const colour = chosen?.className.match(/colour-(\d)/)?.[1] || '1';
      form.querySelector('input[name="color"]').value = colour;

      // Come back to the same page and filter (without an old ?deleted=... in it)
      const params = new URLSearchParams(window.location.search);
      params.delete('deleted');
      const query = params.toString();
      form.querySelector('input[name="next"]').value =
        window.location.pathname + (query ? '?' + query : '');
    });
  },

  // After a delete the server redirects with ?deleted=<id>. Show the Undo message once.
  showUndoIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get('deleted');
    if (!noteId) return;

    params.delete('deleted');
    const query = params.toString();
    history.replaceState(null, '', window.location.pathname + (query ? '?' + query : ''));
    this.showUndoToast(noteId);
  },

  showUndoToast(noteId) {
    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = '<span>Note deleted.</span><button type="button">Undo</button>';
    document.body.appendChild(toast);

    const undoBtn = toast.querySelector('button');
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      try {
        const res = await fetch('/api/undo-delete/' + encodeURIComponent(noteId), { method: 'POST' });
        if (!res.ok) throw new Error('undo failed');
        window.location.reload();
      } catch (err) {
        toast.querySelector('span').textContent = 'Couldn\u2019t bring it back \u2014 it may already be gone.';
        undoBtn.remove();
      }
    });

    setTimeout(() => toast.remove(), 8000);
  },

  // The two calendar buttons inside the edit sheet
  initCalendarButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#edit-note-form [data-note-action]');
      if (!btn) return;
      if (btn.dataset.noteAction === 'gcal') this.openGoogleCalendarLink();
      if (btn.dataset.noteAction === 'ics') this.downloadIcs();
    });
  },

  // Reads the date/time boxes in the edit sheet. With a time it is a 30-minute event,
  // with only a date it is an all-day event.
  getEventTimes() {
    const date = document.getElementById('note-date')?.value;
    const time = document.getElementById('note-time')?.value;
    if (!date) return null;

    if (!time) {
      const [y, m, d] = date.split('-').map(Number);
      const next = new Date(y, m - 1, d + 1);
      const pad = (n) => String(n).padStart(2, '0');
      return {
        allDay: true,
        start: date.replaceAll('-', ''),
        end: `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`
      };
    }

    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + 30 * 60000);
    const fmt = (dt) => dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    return { allDay: false, start: fmt(start), end: fmt(end) };
  },

  // Google Calendar "quick add" link, opened in a new tab
  openGoogleCalendarLink() {
    const title = document.getElementById('note-title')?.value?.trim() || 'Note';
    const details = document.getElementById('note-content')?.value?.trim() || '';
    const times = this.getEventTimes();
    const datesParam = times ? `&dates=${times.start}/${times.end}` : '';

    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}${datesParam}&details=${encodeURIComponent(details)}`;
    window.open(url, '_blank');
  },

  // A plain-text .ics calendar file with a 15-minute reminder, downloaded straight away
  downloadIcs() {
    const title = document.getElementById('note-title')?.value?.trim() || 'Note';
    const details = document.getElementById('note-content')?.value?.trim() || '';
    const times = this.getEventTimes();
    const escapeText = (text) => text.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const startLine = !times ? `DTSTART;VALUE=DATE:${stamp.slice(0, 8)}`
      : times.allDay ? `DTSTART;VALUE=DATE:${times.start}` : `DTSTART:${times.start}`;
    const endLine = !times ? null
      : times.allDay ? `DTEND;VALUE=DATE:${times.end}` : `DTEND:${times.end}`;

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Calyx Planner//EN',
      'BEGIN:VEVENT',
      `UID:${Date.now()}@calyxplanner`,
      `DTSTAMP:${stamp}`,
      startLine,
      ...(endLine ? [endLine] : []),
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(details)}`,
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
