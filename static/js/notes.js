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
    this.initDoneSlider();
    this.showUndoIfNeeded();
   
  },

  // The prev/next arrows on the "Done" strip - same idea as the Bucket List's own slider
  // (see bucketlist.js's initSliders), scrolling by roughly one card-width at a time
  initDoneSlider() {
    const wrap = document.querySelector('.notes-done-scroll');
    const grid = wrap?.querySelector('.notes-done-grid');
    const prevBtn = wrap?.querySelector('.notes-done-nav.prev');
    const nextBtn = wrap?.querySelector('.notes-done-nav.next');
    if (!wrap || !grid || !prevBtn || !nextBtn) return;

    const stepDistance = () => {
      const cards = grid.querySelectorAll('.postit-mini');
      if (cards.length < 1) return grid.clientWidth * 0.9;
      const first = cards[0].getBoundingClientRect();
      if (cards.length < 2) return first.width;
      const second = cards[1].getBoundingClientRect();
      return Math.abs(second.left - first.left) || first.width;
    };

    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); grid.scrollBy({ left: -stepDistance(), behavior: 'smooth' }); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); grid.scrollBy({ left: stepDistance(), behavior: 'smooth' }); });

    const updateArrows = () => {
      const atStart = grid.scrollLeft <= 2;
      const atEnd = grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 2;
      prevBtn.style.display = atStart ? 'none' : 'flex';
      nextBtn.style.display = atEnd ? 'none' : 'flex';
    };
    grid.addEventListener('scroll', updateArrows, { passive: true });
    updateArrows();
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
    document.getElementById('note-remind').value = note.reminder || '';
    this.syncFinishBy(form);
    
    

    const dot = form.querySelector('.colour-dot.colour-' + note.color);
    if (dot) Modals.selectColourDot(dot);

    // Mark done / Delete are submit buttons that post to their own address
    const doneBtn = document.getElementById('note-done-btn');
    doneBtn.setAttribute('formaction', '/toggle-done/' + note.noteId);
    doneBtn.textContent = note.done === 'true' ? 'Mark not done' : 'Mark done';
    document.getElementById('note-delete-btn').setAttribute('formaction', '/delete-note/' + note.noteId);
    
    // Calendar links are made by the server from the saved note. They only make sense once
    // the note has a date or a deadline.
    const hasWhen = Boolean(note.date || note.deadline);
    document.getElementById('note-calendar-actions').classList.toggle('hidden', !hasWhen);
    document.getElementById('note-calendar-hint').classList.toggle('hidden', hasWhen);
    document.getElementById('note-gcal').setAttribute('href', '/notes/' + note.noteId + '/gcal');
    document.getElementById('note-ics').setAttribute('href', '/notes/' + note.noteId + '/ics');
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
  }
};
  
