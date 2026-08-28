/**
 * Content script entry point: the message handler the service worker talks to.
 *
 * Classic script sharing globalThis.JobFill — see collect.js for why. Loaded
 * last, after collect / widgets / files / fill / overlay have registered
 * themselves on the namespace.
 *
 * This file holds no logic of its own beyond routing. Everything it does is
 * driven by a message from the service worker, which is the only component
 * that decides anything — see docs/ARCHITECTURE.md.
 */

globalThis.JobFill = globalThis.JobFill || {};

(() => {
  const NS = globalThis.JobFill;

  // The service worker re-injects on every invocation, since activeTab access
  // is granted per gesture. Guard so a second injection does not stack another
  // message listener on top of the first and answer every message twice.
  if (NS.installed) return;
  NS.installed = true;

  /**
   * Elements from the most recent scan, keyed by the fieldId in the plan.
   *
   * Held here rather than sent anywhere: an element reference cannot cross a
   * message boundary, and keeping the page's DOM out of the rest of the
   * extension is the whole point of the split.
   */
  let elements = new Map();

  /** Scan the page and return plain descriptors. */
  function handleCollect() {
    const result = NS.collect(document);
    elements = result.elements;
    return { descriptors: result.descriptors, url: location.href, title: document.title };
  }

  /** Carry out a fill plan produced by the matcher. */
  async function handleApply(message) {
    // A plan can arrive after a single-page-app navigation has replaced the
    // form. Rescanning makes the ids valid again rather than failing every
    // field with "no longer on the page".
    if (!elements.size) handleCollect();

    const { filled, failed } = await NS.fill.applyPlan(message.plan, elements, {
      highlight: message.highlight !== false,
    });

    if (message.showToast) {
      NS.overlay.showResult({
        filled: filled.length,
        skipped: message.skippedCount ?? 0,
        failed: failed.length,
        onUndo: () => NS.fill.undo(),
      });
    }

    return { filled, failed };
  }

  /** Put back whatever the last fill changed. */
  function handleUndo() {
    const restored = NS.fill.undo();
    NS.overlay.dismiss();
    return { restored };
  }

  /** Scroll to a field and outline it, so a preview row can point at the page. */
  function handleReveal(message) {
    const element = elements.get(message.fieldId);
    if (!element?.isConnected) return { ok: false };
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    NS.overlay.highlight(element);
    return { ok: true };
  }

  const HANDLERS = {
    PING: () => ({ ready: true }),
    COLLECT: handleCollect,
    APPLY: handleApply,
    UNDO: handleUndo,
    REVEAL: handleReveal,
    CAN_UNDO: () => ({ canUndo: NS.fill.canUndo() }),
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = HANDLERS[message?.type];
    if (!handler) return false;

    // Errors are returned rather than thrown. An uncaught throw here surfaces
    // as an opaque "message port closed" in the popup, which tells the user
    // nothing about what actually went wrong.
    Promise.resolve()
      .then(() => handler(message))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));

    return true; // keep the port open for the async reply
  });
})();
