/**
 * Action-log DOM inspector — paste into the browser console on the poker table.
 *
 * What it does:
 *   1. Installs a MutationObserver on document.body.
 *   2. On every new text node, checks whether it matches a poker action pattern
 *      ("raises", "calls", "folds", "checks", "bets" + optional amount).
 *   3. Walks up the ancestor chain and records each element's CSS selector + depth.
 *   4. After REPORT_INTERVAL ms, prints a ranked summary: which selectors appeared
 *      most often, their example text, and how deep the text node sits inside them.
 *   5. Also does a one-shot scan of the current DOM for any pre-existing text that
 *      matches (useful if actions already appeared before you pasted this script).
 *
 * Usage:
 *   1. Open DevTools on the poker tab (F12).
 *   2. Paste this entire script into the Console and hit Enter.
 *   3. Play through a few actions (or wait for opponents to act).
 *   4. After 30 seconds a ranked table is printed automatically.
 *      You can also call `window.__pokerInspect.report()` at any time.
 *   5. The top-ranked selector is the one to use in scrapeOpponentActions().
 *
 * To stop: call `window.__pokerInspect.stop()`
 */

(function () {
  "use strict";

  const REPORT_INTERVAL = 30_000; // auto-report after 30s

  // ── Action pattern ─────────────────────────────────────────────────────────
  // Matches: "raises to €0.12", "calls €1.50", "folds", "checks", "bets €0.05"
  const ACTION_RE = /\b(raises?(?:\s+to)?|calls?|folds?|checks?|bets?)\b/i;
  const AMOUNT_RE = /[€$£]([\d,.]+)/;

  // ── Selector builder ───────────────────────────────────────────────────────
  // Generates a short CSS selector for an element, using id > data-* > class > tag.
  function selectorFor(el) {
    if (!el || el === document.body) return "body";
    if (el.id) return `#${el.id}`;

    const dataKeys = Array.from(el.attributes)
      .filter((a) => a.name.startsWith("data-"))
      .map((a) => `[${a.name}="${a.value}"]`);
    if (dataKeys.length) return el.tagName.toLowerCase() + dataKeys[0];

    const classes = Array.from(el.classList)
      .filter((c) => !/^\d/.test(c)) // skip purely numeric classes
      .slice(0, 3)
      .join(".");
    return el.tagName.toLowerCase() + (classes ? "." + classes : "");
  }

  // Returns the ancestor chain as an array of { el, selector, depth } from the
  // direct parent (depth 1) up to depth MAX_DEPTH.
  const MAX_DEPTH = 8;
  function ancestorChain(textNode) {
    const chain = [];
    let el = textNode.parentElement;
    let depth = 1;
    while (el && el !== document.body && depth <= MAX_DEPTH) {
      chain.push({ el, selector: selectorFor(el), depth });
      el = el.parentElement;
      depth++;
    }
    return chain;
  }

  // ── Hit registry ───────────────────────────────────────────────────────────
  // Maps selector → { count, examples[], minDepth }
  const hits = new Map();

  function recordHit(textContent, chain) {
    for (const { selector, depth } of chain) {
      if (!hits.has(selector)) {
        hits.set(selector, { count: 0, examples: [], minDepth: depth });
      }
      const entry = hits.get(selector);
      entry.count += 1;
      entry.minDepth = Math.min(entry.minDepth, depth);
      if (entry.examples.length < 5) {
        entry.examples.push(textContent.trim().slice(0, 80));
      }
    }
  }

  // ── Text node processor ────────────────────────────────────────────────────
  function processTextNode(node) {
    const text = node.textContent || "";
    if (!ACTION_RE.test(text)) return;
    const chain = ancestorChain(node);
    if (chain.length === 0) return;
    recordHit(text, chain);
  }

  // ── One-shot scan ──────────────────────────────────────────────────────────
  // Walk the current DOM for pre-existing action text.
  function scanExisting() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let found = 0;
    while ((node = walker.nextNode())) {
      processTextNode(node);
      found++;
    }
    console.log(`[ActionInspector] Initial scan: checked ${found} text nodes.`);
  }

  // ── MutationObserver ───────────────────────────────────────────────────────
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      // New child nodes added
      for (const node of mut.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          processTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          // Walk text nodes inside the added subtree
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) processTextNode(n);
        }
      }
      // Character data changes (text node edited in place)
      if (mut.type === "characterData" && mut.target.nodeType === Node.TEXT_NODE) {
        processTextNode(mut.target);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // ── Reporter ───────────────────────────────────────────────────────────────
  function report() {
    if (hits.size === 0) {
      console.warn("[ActionInspector] No poker action text detected yet. Wait for opponents to act.");
      return;
    }

    // Sort by: count desc, then minDepth asc (closest to text = most specific)
    const sorted = Array.from(hits.entries())
      .map(([sel, data]) => ({ sel, ...data }))
      .sort((a, b) => b.count - a.count || a.minDepth - b.minDepth);

    console.group("[ActionInspector] Ranked selector candidates");
    console.log("Rank | Selector | Hits | Min depth (1=direct parent) | Example");
    sorted.slice(0, 15).forEach(({ sel, count, minDepth, examples }, i) => {
      console.log(
        `#${i + 1}`.padEnd(5),
        sel.padEnd(50),
        String(count).padEnd(6),
        String(minDepth).padEnd(5),
        examples[0] || "",
      );
    });
    console.groupEnd();

    const best = sorted[0];
    console.log(
      `%c[ActionInspector] Best candidate: "${best.sel}" (${best.count} hits, depth ${best.minDepth})`,
      "color: #4ade80; font-weight: bold",
    );
    console.log(
      `%cUse this in scrapeOpponentActions():\n  document.querySelectorAll("${best.sel}")`,
      "color: #60a5fa",
    );

    // Also log the full examples for the top-3 candidates
    console.group("[ActionInspector] Top-3 example texts");
    sorted.slice(0, 3).forEach(({ sel, examples }) => {
      console.log(`${sel}:`, examples);
    });
    console.groupEnd();

    return sorted;
  }

  // ── Auto-report timer ──────────────────────────────────────────────────────
  const timer = setTimeout(() => {
    console.log("[ActionInspector] Auto-report triggered after 30s.");
    report();
  }, REPORT_INTERVAL);

  // ── Public API ─────────────────────────────────────────────────────────────
  window.__pokerInspect = {
    /** Print report immediately */
    report,
    /** Stop observing */
    stop() {
      observer.disconnect();
      clearTimeout(timer);
      console.log("[ActionInspector] Stopped.");
    },
    /** Raw hit map for manual inspection */
    get hits() {
      return hits;
    },
  };

  // Run initial scan
  scanExisting();

  console.log(
    "%c[ActionInspector] Running. Waiting for poker actions…",
    "color: #a78bfa; font-weight: bold",
  );
  console.log(
    "  window.__pokerInspect.report()  — print results now\n" +
    "  window.__pokerInspect.stop()   — stop observing",
  );
})();
