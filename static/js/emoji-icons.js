/**
 * Calyx Planner — Emoji → Icon Lookup
 *
 * Converts emoji found in static page content into inline SVG icons,
 * matching the same visual style as sidebar/bottom-nav (stroke-linecap:
 * square, stroke-width: 1.5).
 *
 * LIMITATION — read before extending: this only replaces emoji that are
 * still literally present in the HTML. It does NOT choose an icon based
 * on meaning — "Pilates" won't match "yoga" below, "Make tea" won't
 * match "coffee". This works because today's content is fixed mock data
 * written once. Once real user-generated notes/habits/routines exist
 * (Section 8's pipeline), picking an appropriate icon for arbitrary
 * user text is a job for the AI (Groq/Sinéad), not this dictionary —
 * don't try to grow this into a general-purpose classifier.
 */
const EmojiIcons = {
  // Each entry: the exact emoji as it appears in the HTML, mapped to
  // an SVG string. Using the emoji itself as the key (not a keyword)
  // keeps this a direct swap, not a guess.
  map: {
    '🧠': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8v1.4A3 3 0 0 0 6 15v1a3 3 0 0 0 3 3h1V4H9z" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8v1.4A3 3 0 0 1 18 15v1a3 3 0 0 1-3 3h-1V4h1z" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '☀️': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><circle cx="12" cy="12" r="4" stroke-width="1.5"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '🚿': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><path d="M6 9h12M8 9V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3" stroke-width="1.5" stroke-linecap="square"/><path d="M8 13v.01M12 13v.01M16 13v.01M8 17v.01M12 17v.01M16 17v.01" stroke-width="2" stroke-linecap="round"/></svg>',
    '☕': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z" stroke-width="1.5" stroke-linecap="square"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" stroke-width="1.5"/><path d="M8 5c0 1-1 1-1 2M12 5c0 1-1 1-1 2" stroke-width="1.5" stroke-linecap="round"/></svg>',
    '🧘': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><circle cx="12" cy="6" r="2" stroke-width="1.5"/><path d="M12 8v4M6 20c1-3 3-4.5 6-4.5S17 17 18 20M8 11.5L4 15M16 11.5l4 3.5" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '🍳': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><circle cx="10" cy="13" r="6" stroke-width="1.5"/><circle cx="10" cy="13" r="2" stroke-width="1.5"/><path d="M16 8l4-4" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '⚡': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M13 3L5 13h5l-1 8 8-10h-5l1-8z" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '🚶': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><circle cx="13" cy="5" r="2" stroke-width="1.5"/><path d="M10 9l2 3-1 3 3 6M12 12l4 1-1 5M8 13l2-2" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '⚑': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M6 3v18M6 4h11l-2.5 3.5L17 11H6" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '📅': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><rect x="3" y="5" width="18" height="16" rx="1" stroke-width="1.5" stroke-linecap="square"/><path d="M3 10h18M8 3v4M16 3v4" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '🎬': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><rect x="3" y="7" width="18" height="13" rx="1" stroke-width="1.5" stroke-linecap="square"/><path d="M3 7l2.5-4h3L6 7M10 7l2.5-4h3L13 7M17 7l2.5-4h1.5v4" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '📖': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><path d="M12 6c-1.5-1.5-4-2-7-2v14c3 0 5.5.5 7 2 1.5-1.5 4-2 7-2V4c-3 0-5.5.5-7 2z" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 6v14" stroke-width="1.5"/></svg>',
    '📓': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18"><rect x="4" y="3" width="16" height="18" rx="1" stroke-width="1.5" stroke-linecap="square"/><path d="M4 7h16M8 3v4" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '📍': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M12 21s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.2" stroke-width="1.5"/></svg>',
    '📦': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M3 8l9-5 9 5-9 5-9-5z" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 8v9l9 5 9-5V8M12 13v9" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '✨': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '🔊': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M4 9v6h4l5 4V5L8 9H4z" stroke-width="1.5" stroke-linejoin="round"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11" stroke-width="1.5" stroke-linecap="round"/></svg>',
    '🏷️': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9z" stroke-width="1.5" stroke-linejoin="round"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
    '\u2713': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M5 12.5l4.5 4.5L19 7" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="round"/></svg>',
    '\u2197': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><path d="M7 17L17 7M9 7h8v8" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/></svg>',
    '📱': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><rect x="6" y="2" width="12" height="20" rx="2" stroke-width="1.5" stroke-linecap="square"/><path d="M10 19h4" stroke-width="1.5" stroke-linecap="round"/></svg>',
    '🪥': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M4 20l8-8M9 15l-2-2 7-7a2.8 2.8 0 0 1 4 4l-7 7-2-2z" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/></svg>',
    '👗': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M9 4h6l1 3-2 1v12H10V8L8 7l1-3z" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '🧴': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><rect x="7" y="8" width="10" height="13" rx="1" stroke-width="1.5" stroke-linecap="square"/><path d="M10 8V5h4v3" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '💤': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><path d="M13 3a7 7 0 1 0 8 8 7 7 0 0 1-8-8z" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    '🔗': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><path d="M10 14a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-2 2a4 4 0 0 0 5.7 5.7l1-1" stroke-width="1.5" stroke-linecap="square"/></svg>',
    '📳': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><rect x="7" y="2" width="10" height="20" rx="2" stroke-width="1.5" stroke-linecap="square"/><path d="M3 8l-1 2 1 2M21 8l1 2-1 2" stroke-width="1.5" stroke-linecap="round"/></svg>'
  },

  // Replaces every mapped emoji inside a given container with its icon.
  // Wraps each SVG in a span so it can be styled/aligned consistently.
  apply(root = document) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodesToFix = [];
    let node;
    while ((node = walker.nextNode())) {
      for (const emoji of Object.keys(this.map)) {
        if (node.textContent.includes(emoji)) {
          nodesToFix.push(node);
          break;
        }
      }
    }

    nodesToFix.forEach(textNode => {
      const frag = document.createDocumentFragment();
      let remaining = textNode.textContent;

      while (remaining.length) {
        let matched = false;
        for (const [emoji, svg] of Object.entries(this.map)) {
          if (remaining.startsWith(emoji)) {
            const span = document.createElement('span');
            span.className = 'content-icon';
            span.setAttribute('aria-hidden', 'true');
            span.innerHTML = svg;
            frag.appendChild(span);
            remaining = remaining.slice(emoji.length);
            matched = true;
            break;
          }
        }
        if (!matched) {
          // Copy one plain character across, then keep scanning
          const textPart = document.createTextNode(remaining[0]);
          frag.appendChild(textPart);
          remaining = remaining.slice(1);
        }
      }

      textNode.parentNode.replaceChild(frag, textNode);
    });
  }
};