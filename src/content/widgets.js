/**
 * Choosing an option in whatever kind of control the site decided to build.
 *
 * Classic script sharing globalThis.JobFill — see collect.js for why.
 *
 * A native `<select>` is three lines. Everything else on this page exists
 * because the sites where autofill matters most — Workday, Ashby, anything on
 * react-select — do not use one. Those render a button that opens a floating
 * listbox, and the only way in is to behave like a user: click, wait for the
 * options to appear, click the right one.
 *
 * Every path here has a timeout and gives up cleanly. Leaving a dropdown
 * untouched is a fine outcome; leaving one stuck open over the form is not.
 */

globalThis.JobFill = globalThis.JobFill || {};

(() => {
  const NS = globalThis.JobFill;

  /** How long to wait for a custom dropdown to render its options. */
  const OPEN_TIMEOUT_MS = 1200;
  const POLL_INTERVAL_MS = 50;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Compare option text the way the matcher does: case and punctuation blind. */
  const normalize = (text) =>
    String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /** Text of an element, with nested controls removed. */
  function textOf(element) {
    return String(element?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  /** Poll until `check` returns something truthy, or give up. */
  async function waitFor(check, timeout = OPEN_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = check();
      if (result) return result;
      await sleep(POLL_INTERVAL_MS);
    }
    return null;
  }

  // --- Native controls -----------------------------------------------------

  function selectNative(element, wanted) {
    const target = normalize(wanted);
    const option = [...element.options].find(
      (o) => normalize(o.label || o.textContent) === target || normalize(o.value) === target
    );
    if (!option) return { ok: false, note: `No option matching "${wanted}"` };

    element.value = option.value;
    NS.fill.notify(element);
    return { ok: true };
  }

  function selectRadio(element, wanted) {
    const target = normalize(wanted);
    const doc = element.ownerDocument;
    const group = [...doc.getElementsByTagName("input")].filter(
      (input) => input.type === element.type && input.name === element.name
    );

    const match = group.find((input) => {
      const label = NS.collectInternals.labelFor(input);
      return normalize(label) === target || normalize(input.value) === target;
    });
    if (!match) return { ok: false, note: `No option matching "${wanted}"` };

    // Click rather than set `checked`: custom-drawn radios bind to the click,
    // and assigning the property alone leaves their visual state stale.
    match.click();
    return match.checked ? { ok: true } : { ok: false, note: "The option would not stay selected" };
  }

  // --- Custom dropdowns ----------------------------------------------------

  /** Every currently visible option in any open listbox on the page. */
  function visibleOptions(doc) {
    return [...doc.querySelectorAll("[role='option'], li[data-value], .select__option")].filter(
      (node) => {
        const style = doc.defaultView?.getComputedStyle?.(node);
        return !style || (style.display !== "none" && style.visibility !== "hidden");
      }
    );
  }

  /**
   * Open a custom dropdown and click the option matching `wanted`.
   *
   * Restores the page on every failure path — an abandoned open dropdown
   * covering the next three fields is worse than an unfilled one.
   */
  async function selectCustom(element, wanted) {
    const doc = element.ownerDocument;
    const target = normalize(wanted);

    element.click();

    // Some widgets filter as you type, and a long country list may only render
    // the matching entries once text is entered.
    const searchBox = doc.querySelector("input[role='combobox'], [role='listbox'] input, .select__input");
    if (searchBox && searchBox !== element) {
      NS.fill.setNativeValue(searchBox, wanted);
      searchBox.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const option = await waitFor(() => {
      const options = visibleOptions(doc);
      if (!options.length) return null;
      return (
        options.find((node) => normalize(textOf(node)) === target) ??
        options.find((node) => normalize(textOf(node)).startsWith(target)) ??
        null
      );
    });

    if (!option) {
      // Close what we opened before giving up.
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      element.blur?.();
      return { ok: false, note: `Could not find "${wanted}" in the dropdown` };
    }

    option.click();

    // Confirm it took. Some widgets swallow a click that lands mid-render, and
    // reporting a fill that did not happen is worse than reporting a failure.
    const settled = await waitFor(
      () => normalize(textOf(element)).includes(target) ||
            normalize(element.value ?? "").includes(target) ||
            element.getAttribute("aria-expanded") === "false",
      400
    );
    return settled ? { ok: true } : { ok: false, note: "The dropdown did not accept that option" };
  }

  // --- Entry point ---------------------------------------------------------

  /**
   * Select `wanted` in whatever kind of control `element` is.
   * @returns {Promise<{ok: boolean, note?: string}>}
   */
  async function selectOption(element, wanted) {
    if (element.tagName === "SELECT") return selectNative(element, wanted);
    if (element.type === "radio" || element.type === "checkbox") return selectRadio(element, wanted);
    return selectCustom(element, wanted);
  }

  NS.widgets = { selectOption, selectNative, selectRadio, selectCustom, waitFor };
})();
