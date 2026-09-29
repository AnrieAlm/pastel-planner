/**
 * Calyx Planner — Bucket List Page
 */
const CATEGORY_SHAPE = { movies: 'ticket', places: 'postcard', things: 'tag', experiences: 'polaroid' };

const Bucketlist = {
  init() {
    this.initCategoryTabs();
    this.initItems();
    this.initDoneToggle();
    this.initRevealAnimation();
    this.initSliders();
    this.initModalActions();
    this.initDatePicked();

    document.querySelectorAll('[data-modal="bucket-item"]').forEach(btn => {
      btn.addEventListener('click', () => Modals.open('bucket-item'));
    });
  },

  // Tabs filter which .bucket-section is visible. All sections show by
  // default (matches the current mock HTML, which lists all four in a
  // row) — clicking a tab scrolls to and highlights that section, since
  // this is a single scrollable page rather than separate tab panels.
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

  // Each keepsake opens the edit modal on click, carrying sourceEl so
  // Mark done / Plan it / Remove can all act on the exact card that
  // was opened rather than searching for it again by title text.
  initItems() {
    document.querySelectorAll('.bucket-keepsake').forEach(item => {
      item.addEventListener('click', () => {
        Modals.open('bucket-item-edit', {
          sourceEl: item,
          title: item.querySelector('.bucket-title')?.textContent
        });
      });
    });
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
  },

  // Handles every button across bucket-item (Add) and bucket-item-edit
  // (Mark done / Plan it / Remove). One delegated listener, branching
  // on which modal is actually open (detected by a field that only
  // exists in that modal), same pattern used on the other pages.
  initModalActions() {
    document.addEventListener('click', (e) => {
      const markDoneBtn = e.target.closest('[data-action="mark-done"]');
      const planItBtn = e.target.closest('#modal-content .btn-modal-secondary');
      const primaryBtn = e.target.closest('#modal-content .btn-modal-primary');
      const removeBtn = e.target.closest('#modal-content .btn-modal-danger');

      // bucket-item-edit modal
      if (document.getElementById('edit-bucket-title')) {
        const item = Modals.currentData?.sourceEl;
        if (!item) return;

        if (markDoneBtn) {
          this.markKeepsakeDone(item);
          Modals.close();
        } else if (planItBtn) {
          // Hand off to the date picker, carrying the same item forward
          // so it can be updated once a date's actually chosen
          Modals.open('pick-date', { sourceEl: item });
        } else if (removeBtn) {
          this.removeKeepsake(item);
          Modals.close();
        }
        return;
      }

      // bucket-item modal (Add new item) — only has one primary button
      if (primaryBtn && document.getElementById('bucket-title') && !document.getElementById('edit-bucket-title')) {
        this.createKeepsake();
        Modals.close();
      }
    });
  },

  // Fired by Modals when "Set date" is clicked inside modal-pick-date.
  // Only acts when the modal was opened via this page's "Plan it"
  // button (see initModalActions above).
  initDatePicked() {
    document.addEventListener('calyx:date-picked', (e) => {
      const { date, sourceEl } = e.detail;
      if (!date || !sourceEl?.classList.contains('bucket-keepsake')) return;
      const detailEl = sourceEl.querySelector('.bucket-detail');
      if (detailEl) {
        const d = new Date(date + 'T00:00:00');
        detailEl.textContent = 'Planned for ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      }
    });
  },

  // Stamps a keepsake as done, moves it into the Done shelf (matching
  // how "Poor Things" already lives there — done items sit together
  // regardless of category, each keeping its own shape), and keeps
  // both counters in sync.
  markKeepsakeDone(item) {
    const sourceSection = item.closest('.bucket-section[id^="section-"]');
    const shape = item.querySelector('.bucket-ticket, .bucket-postcard, .bucket-tag, .bucket-polaroid');
    if (shape && !shape.querySelector('.bucket-done-stamp')) {
      const stamp = document.createElement('div');
      stamp.className = 'bucket-done-stamp';
      const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      stamp.innerHTML = `Done<span class="bucket-done-stamp-date">${dateStr}</span>`;
      shape.prepend(stamp);
    }

    item.classList.add('done');

    const doneRow = document.querySelector('.bucket-done-toggle')?.nextElementSibling?.querySelector('.bucket-keepsake-row');
    doneRow?.appendChild(item);

    if (sourceSection) this.adjustCategoryCount(sourceSection.id.replace('section-', ''), -1);
    this.syncDoneCount();
    this.expandDoneShelf();
  },

  // Removing an item (from either a live category or the Done shelf)
  // needs to know which counter to adjust — the category tab if it
  // was still active, or the Done count if it had already been
  // marked done.
  removeKeepsake(item) {
    const sourceSection = item.closest('.bucket-section[id^="section-"]');
    const wasDone = item.classList.contains('done');
    item.remove();

    if (wasDone) {
      this.syncDoneCount();
    } else if (sourceSection?.id?.startsWith('section-')) {
      this.adjustCategoryCount(sourceSection.id.replace('section-', ''), -1);
    }
  },

  adjustCategoryCount(categoryId, delta) {
    const tabCount = document.querySelector(`.bucket-cat[data-category="${categoryId}"] strong`);
    if (tabCount) tabCount.textContent = Math.max(0, parseInt(tabCount.textContent, 10) + delta);
  },

  syncDoneCount() {
    const doneCount = document.querySelector('.bucket-done-count');
    const doneRow = document.querySelector('.bucket-done-toggle')?.nextElementSibling?.querySelector('.bucket-keepsake-row');
    if (doneCount && doneRow) doneCount.textContent = doneRow.querySelectorAll('.bucket-keepsake').length;
  },

  expandDoneShelf() {
    const toggle = document.querySelector('.bucket-done-toggle');
    const shelf = toggle?.nextElementSibling;
    if (toggle && shelf && !toggle.classList.contains('expanded')) {
      toggle.classList.add('expanded');
      toggle.setAttribute('aria-expanded', 'true');
      shelf.classList.remove('hidden');
    }
  },

  // Builds a new keepsake in whichever shape matches the chosen
  // category (ticket/postcard/tag/polaroid), matching the exact
  // markup each shape already uses elsewhere on the page, and inserts
  // it into that category's slider row.
  createKeepsake() {
    const title = document.getElementById('bucket-title')?.value?.trim();
    if (!title) return; // nothing to add without at least a title

    const category = document.getElementById('bucket-category')?.value || 'movies';
    const shape = CATEGORY_SHAPE[category];
    const row = document.querySelector(`#section-${category} .bucket-keepsake-row`);
    if (!row) return;

    const item = document.createElement('div');
    item.className = 'bucket-keepsake revealed';

    const labelText = category.charAt(0).toUpperCase() + category.slice(1);

    if (shape === 'ticket') {
      item.innerHTML = `
        <div class="bucket-ticket">
          <div class="bucket-ticket-main">
            <div class="bucket-keepsake-label">${labelText}</div>
            <div class="bucket-title">${title}</div>
            <div class="bucket-detail"></div>
            <div class="bucket-barcode"></div>
            <div class="bucket-barcode-num">0 4 2 &nbsp;1 1 &nbsp;A D M I T</div>
          </div>
          <div class="bucket-ticket-perf"></div>
          <div class="bucket-ticket-stub">ADMIT ONE</div>
        </div>`;
    } else if (shape === 'postcard') {
      item.innerHTML = `
        <div class="bucket-postcard">
          <div class="bucket-postal-perf"></div>
          <div class="bucket-postal-seal"><span class="bucket-postal-seal-mark">&#9992;</span></div>
          <div class="bucket-keepsake-label">${labelText}</div>
          <div class="bucket-title">${title}</div>
          <div class="bucket-detail"></div>
          <div class="bucket-postcard-divider"></div>
        </div>`;
    } else if (shape === 'tag') {
      item.innerHTML = `
        <div class="bucket-tag-wrap">
          <div class="bucket-tag-string"></div>
          <div class="bucket-tag">
            <div class="bucket-tag-hole"></div>
            <div class="bucket-keepsake-label">${labelText}</div>
            <div class="bucket-title">${title}</div>
            <div class="bucket-detail"></div>
          </div>
        </div>`;
    } else {
      item.innerHTML = `
        <div class="bucket-polaroid">
          <div class="bucket-tape"></div>
          <div class="bucket-polaroid-photo">&#10022;</div>
          <div class="bucket-polaroid-caption">${title}</div>
        </div>`;
    }

    row.appendChild(item);
    item.addEventListener('click', () => {
      Modals.open('bucket-item-edit', { sourceEl: item, title });
    });

    this.adjustCategoryCount(category, 1);
  }
};
