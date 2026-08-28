/**
 * In-page feedback: a result toast, and an outline on every field written.
 *
 * Classic script sharing globalThis.JobFill — see collect.js for why.
 *
 * This exists because of the keyboard shortcut. Pressing Alt+Shift+F skips the
 * popup's preview entirely, so without something on the page the user has no
 * idea what just happened, or how to take it back. The toast answers both:
 * what was filled, and one click to undo it.
 *
 * Everything renders inside a shadow root. Job boards ship aggressive global
 * CSS, and a toast that inherits a site's `* { box-sizing }` and font stack
 * looks broken in a way that reflects on the extension, not the site.
 */

globalThis.JobFill = globalThis.JobFill || {};

(() => {
  const NS = globalThis.JobFill;

  const HOST_ID = "jobfill-overlay-host";
  const HIGHLIGHT_MS = 2600;
  const TOAST_MS = 9000;

  let host = null;
  let shadow = null;
  let dismissTimer = null;

  const STYLES = `
    :host { all: initial; }
    .toast {
      position: fixed; inset-block-end: 20px; inset-inline-end: 20px;
      z-index: 2147483647;
      display: grid; gap: 10px;
      inline-size: 300px; padding: 14px 16px;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #1b1b2b; background: #fff;
      border: 1px solid #e4e4ee; border-radius: 12px;
      box-shadow: 0 2px 6px rgb(27 27 43 / 8%), 0 12px 32px rgb(27 27 43 / 12%);
      animation: rise 160ms ease-out;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
    @media (prefers-color-scheme: dark) {
      .toast { color: #ececf4; background: #1a1a28; border-color: #2e2e40; }
    }
    .head { display: flex; align-items: center; gap: 8px; font-weight: 620; }
    .dot { inline-size: 8px; block-size: 8px; border-radius: 50%; background: #0f9d6e; flex: none; }
    .dot.warn { background: #b45309; }
    .detail { margin: 0; color: #55556b; font-size: 12px; }
    @media (prefers-color-scheme: dark) { .detail { color: #a8a8c0; } }
    .row { display: flex; gap: 8px; }
    button {
      font: inherit; font-weight: 570; padding: 5px 11px; cursor: pointer;
      color: inherit; background: transparent;
      border: 1px solid #cfcfe0; border-radius: 8px;
    }
    button:hover { border-color: #4f46e5; color: #4f46e5; }
    @media (prefers-color-scheme: dark) { button { border-color: #3f3f57; } }
    .close { margin-inline-start: auto; border: 0; padding: 2px 6px; opacity: .6; }
  `;

  /** Create the shadow host lazily, once per page. */
  function ensureHost() {
    if (host?.isConnected) return shadow;

    host = document.createElement("div");
    host.id = HOST_ID;
    // Fixed and non-interactive at the host level so it never intercepts
    // clicks meant for the form underneath; the toast itself re-enables them.
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    document.documentElement.append(host);

    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    shadow.append(style);
    return shadow;
  }

  /** Briefly outline a field that was just written. */
  function highlight(element) {
    if (!element?.style) return;
    // Stash whatever the site had, so clearing restores rather than blanks.
    if (element.dataset.jobfillPrevOutline === undefined) {
      element.dataset.jobfillPrevOutline = element.style.outline ?? "";
    }
    element.style.outline = "2px solid #0f9d6e";
    element.style.outlineOffset = "1px";
    setTimeout(() => clearHighlight(element), HIGHLIGHT_MS);
  }

  function clearHighlight(element) {
    if (!element?.style || element.dataset.jobfillPrevOutline === undefined) return;
    element.style.outline = element.dataset.jobfillPrevOutline;
    element.style.outlineOffset = "";
    delete element.dataset.jobfillPrevOutline;
  }

  /**
   * Show the result of a fill.
   *
   * @param {{filled: number, skipped: number, failed: number, onUndo: Function}} result
   */
  function showResult({ filled, skipped = 0, failed = 0, onUndo }) {
    const root = ensureHost();
    root.querySelector(".toast")?.remove();
    clearTimeout(dismissTimer);

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.style.pointerEvents = "auto";
    toast.setAttribute("role", "status");

    const head = document.createElement("div");
    head.className = "head";
    const dot = document.createElement("span");
    dot.className = filled ? "dot" : "dot warn";
    const title = document.createElement("span");
    title.textContent = filled
      ? `Filled ${filled} field${filled === 1 ? "" : "s"}`
      : "Nothing to fill here";
    head.append(dot, title);

    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", dismiss);
    head.append(close);
    toast.append(head);

    // Say what was left alone and why, rather than implying the form is done.
    const notes = [];
    if (skipped) notes.push(`${skipped} left alone`);
    if (failed) notes.push(`${failed} could not be filled`);
    if (!filled && !notes.length) notes.push("No fields on this page matched your profile.");
    if (notes.length) {
      const detail = document.createElement("p");
      detail.className = "detail";
      detail.textContent = `${notes.join(" · ")}. Check the form before submitting.`;
      toast.append(detail);
    }

    if (filled && onUndo) {
      const row = document.createElement("div");
      row.className = "row";
      const undo = document.createElement("button");
      undo.textContent = "Undo";
      undo.addEventListener("click", () => {
        const restored = onUndo();
        title.textContent = `Restored ${restored} field${restored === 1 ? "" : "s"}`;
        row.remove();
      });
      row.append(undo);
      toast.append(row);
    }

    root.append(toast);
    dismissTimer = setTimeout(dismiss, TOAST_MS);
  }

  /** Remove the toast. The host stays for reuse. */
  function dismiss() {
    clearTimeout(dismissTimer);
    shadow?.querySelector(".toast")?.remove();
  }

  NS.overlay = { showResult, dismiss, highlight, clearHighlight };
})();
