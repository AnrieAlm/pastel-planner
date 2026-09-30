/**
 * Calyx Planner — Bucket List Page
 * The server draws every card from MongoDB and saves changes through forms.
 * This file handles the tabs, opening and filling the edit sheet, the Done shelf,
 * the reveal animation and the sliders.
 */
const Bucketlist = {
  init() {
    this.initCategoryTabs();
    this.initItems();
    this.initDoneToggle();
    this.initRevealAnimation();
    this.initSliders();
  },

  // Tabs scroll to their category. All four sit on one scrollable page.
  initCategoryTabs() {
    document.querySelectorAll('.bucket-cat').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.bucket-cat').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        const targetId = 'section-' + tab.dataset.category;
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  },

  // A card opens the edit sheet (by click, or Enter/Space from the keyboard),
  // then the sheet is filled in with that card's details
  initItems() {
    document.querySelectorAll('.bucket-keepsake[data-note-id]').forEach(item => {
      const open = async () => {
        await Modals.open('bucket-item-edit', { sourceEl: item });
        this.fillEditForm(item);
      };
      item.addEventListener('click', open);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  },

  // Puts the card's details into the sheet and points each button at this note
  fillEditForm(item) {
    const form = document.getElementById('edit-bucket-form');
    if (!form) return;
    const note = item.dataset;
    const id = note.noteId;

    form.setAttribute('action', '/set-bucket/' + id);
    document.getElementById('edit-bucket-title').value = note.title;
    document.getElementById('edit-bucket-category').value = note.bucket;
    document.getElementById('edit-bucket-link').value = note.link;
    document.getElementById('edit-bucket-date').value = note.date;

    // "Open link" only shows when the item has a link
    const openLink = document.getElementById('edit-bucket-open-link');
    if (note.link) {
      openLink.href = note.link;
      openLink.hidden = false;
    } else {
      openLink.hidden = true;
    }

    // Each extra button posts to its own address
    document.getElementById('edit-bucket-plan').setAttribute('formaction', '/set-date/' + id);
    const doneBtn = document.getElementById('edit-bucket-done');
    doneBtn.setAttribute('formaction', '/toggle-done/' + id);
    doneBtn.textContent = note.done === 'true' ? 'Put back on the list' : 'Mark done';
    document.getElementById('edit-bucket-remove').setAttribute('formaction', '/delete-note/' + id);
  },

  initDoneToggle() {
    document.querySelectorAll('.bucket-done-toggle').forEach(toggle => {
      toggle.setAttribute('aria-expanded', 'false');
      const shelf = toggle.nextElementSibling;
      shelf?.classList.add('hidden');

      toggle.addEventListener('click', () => {
        const expanded = toggle.classList.toggle('expanded');
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        shelf?.classList.toggle('hidden', !expanded);
      });
    });
  },

  initRevealAnimation() {
    const items = document.querySelectorAll('.bucket-keepsake');
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    items.forEach((item, i) => {
      if (prefersReduced || item.classList.contains('no-animate')) {
        item.classList.add('revealed');
        return;
      }
      setTimeout(() => item.classList.add('revealed'), 120 * i + 100);
    });
  },

  initSliders() {
    document.querySelectorAll('.bucket-keepsake-scroll').forEach((wrap) => {
      const row = wrap.querySelector('.bucket-keepsake-row');
      const prevBtn = wrap.querySelector('.bucket-slider-nav.prev');
      const nextBtn = wrap.querySelector('.bucket-slider-nav.next');
      if (!row || !prevBtn || !nextBtn) return;

      function stepDistance() {
        const items = row.querySelectorAll('.bucket-keepsake');
        if (items.length < 1) return row.clientWidth * 0.9;
        const first = items[0].getBoundingClientRect();
        if (items.length < 2) return first.width;
        const second = items[1].getBoundingClientRect();
        return second.left - first.left;
      }

      function scrollByStep(direction) {
        row.scrollBy({ left: direction * stepDistance(), behavior: 'smooth' });
      }

      prevBtn.addEventListener('click', (e) => { e.stopPropagation(); scrollByStep(-1); });
      nextBtn.addEventListener('click', (e) => { e.stopPropagation(); scrollByStep(1); });

      function updateArrowVisibility() {
        const atStart = row.scrollLeft <= 2;
        const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 2;
        prevBtn.style.display = atStart ? 'none' : 'flex';
        nextBtn.style.display = atEnd ? 'none' : 'flex';
      }

      row.addEventListener('scroll', updateArrowVisibility);
      window.addEventListener('resize', updateArrowVisibility);
      updateArrowVisibility();
    });
  }
};
