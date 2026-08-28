/**
 * Walks a page into FieldDescriptor objects.
 *
 * This is a classic script, not an ES module: chrome.scripting.executeScript
 * injects classic scripts, and a top-level `import` would throw. Files under
 * src/content share the globalThis.JobFill namespace instead. See
 * docs/ARCHITECTURE.md for why the content layer is kept deliberately dumb.
 *
 * Nothing here scores or decides. It produces plain JSON — no element
 * references — which the service worker hands to the matcher. That boundary is
 * what lets the matcher be tested against saved form HTML with no browser.
 */

globalThis.JobFill = globalThis.JobFill || {};

(() => {
  const NS = globalThis.JobFill;

  /** Input types that are controls rather than data entry. */
  const IGNORED_TYPES = new Set(["submit", "button", "reset", "image", "hidden", "search"]);

  /** How far up the tree to look for a label or heading before giving up. */
  const ANCESTOR_LIMIT = 6;

  /**
   * Elements the user can type into or choose from.
   *
   * `[role=combobox]` and `[aria-haspopup=listbox]` catch the custom widgets
   * that Workday, Ashby and anything built on react-select use instead of a
   * native `<select>` — those are the fields a naive collector misses entirely,
   * and they are most of the form on the sites that matter most.
   */
  const SELECTOR = [
    "input", "select", "textarea",
    "[contenteditable='true']",
    "[role='combobox']", "[role='radiogroup']",
    "button[aria-haspopup='listbox']",
  ].join(",");

  /**
   * Whether a control is actually presented to the user.
   *
   * Judged purely from computed style, deliberately not from element size.
   * Plenty of fillable controls measure zero by design: file inputs behind a
   * styled label, and the real checkbox under every custom-drawn one. Excluding
   * anything zero-sized would skip exactly the fields that need the most help,
   * and would also make a multi-step wizard's inactive steps indistinguishable
   * from its active one — which computed style already handles, since those are
   * hidden with `display: none`.
   */
  function isHidden(element) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;

    const style = element.ownerDocument.defaultView?.getComputedStyle?.(element);
    if (!style) return false;
    return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
  }

  /** Collapse whitespace and drop the asterisks forms use to mean "required". */
  function cleanText(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .replace(/[*✱]|\(required\)|\(optional\)/gi, "")
      .trim();
  }

  /**
   * Text of an element, excluding nested form controls.
   *
   * A wrapping `<label>` often contains the input itself plus help text; naive
   * textContent would pull in an option list or a placeholder.
   */
  function visibleText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    for (const node of clone.querySelectorAll("input, select, textarea, option, script, style")) {
      node.remove();
    }
    return cleanText(clone.textContent);
  }

  /**
   * Resolve the label for a control, in the order browsers and screen readers
   * would: explicit association first, then structure, then proximity.
   */
  function labelFor(element) {
    // The element's own root, not the document: inside a shadow root the
    // labels live there too, and searching the document would find none of
    // them and report the whole form as unlabelled.
    const doc = element.getRootNode?.() ?? element.ownerDocument;

    // aria-labelledby wins: it is an explicit authored association.
    const labelledBy = element.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => visibleText(doc.getElementById(id)))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    const ariaLabel = cleanText(element.getAttribute?.("aria-label"));
    if (ariaLabel) return ariaLabel;

    // <label for="...">
    //
    // Found by iterating rather than by building an attribute selector. Ids on
    // application forms contain brackets and dots often enough that escaping
    // them is a real risk, and a thrown selector error here would abort the
    // entire scan rather than skipping one field.
    if (element.id) {
      // querySelectorAll rather than getElementsByTagName, because a ShadowRoot
      // is a DocumentFragment and has no getElementsByTagName.
      for (const candidate of doc.querySelectorAll("label")) {
        if (candidate.getAttribute("for") !== element.id) continue;
        const text = visibleText(candidate);
        if (text) return text;
        break;
      }
    }

    // A wrapping <label>.
    const wrapping = element.closest?.("label");
    if (wrapping) {
      const text = visibleText(wrapping);
      if (text) return text;
    }

    // Workday and similar render a label as a sibling <div> with no association
    // at all, so fall back to the nearest preceding text within a few levels.
    let node = element;
    for (let depth = 0; depth < ANCESTOR_LIMIT && node?.parentElement; depth += 1) {
      node = node.parentElement;
      for (const child of node.children) {
        if (child === element || child.contains?.(element)) break;
        if (/^(label|span|div|p|legend|dt)$/i.test(child.tagName)) {
          const text = visibleText(child);
          // Long paragraphs are prose, not labels.
          if (text && text.length <= 120) return text;
        }
      }
    }

    return "";
  }

  /**
   * The question a radio or checkbox group is asking.
   *
   * Each option in a group carries its own label ("Yes", "No"), so reading the
   * label of the first radio yields an answer rather than a question. The
   * question lives on the surrounding fieldset or radiogroup.
   */
  function groupQuestionFor(element) {
    const radiogroup = element.closest?.("[role='radiogroup']");
    if (radiogroup) {
      const labelled = radiogroup.getAttribute("aria-label");
      if (labelled) return cleanText(labelled);
      const labelledBy = radiogroup.getAttribute("aria-labelledby");
      const root = element.getRootNode?.() ?? element.ownerDocument;
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map((id) => visibleText(root.getElementById(id))).join(" ");
        if (cleanText(text)) return cleanText(text);
      }
    }

    const legend = element.closest?.("fieldset")?.querySelector("legend");
    return legend ? visibleText(legend) : "";
  }

  /**
   * The heading or legend a field sits under, and which repeat of it this is.
   *
   * This is what tells an "Employment history" block apart from an "Education"
   * block when both contain a field labelled "Start date" — often the only
   * difference between them.
   */
  function sectionContextFor(element, doc) {
    const fieldset = element.closest?.("fieldset");
    const legend = fieldset?.querySelector("legend");
    const headings = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,[role='heading']")];

    let text = legend ? visibleText(legend) : "";
    if (!text) {
      // The nearest heading that appears before this element in document order.
      let nearest = null;
      for (const heading of headings) {
        if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) nearest = heading;
        else break;
      }
      text = visibleText(nearest);
    }
    if (!text) return { sectionText: "", sectionIndex: 0 };

    // How many earlier sections carry the same heading. Two "Employment"
    // blocks mean the second one's fields belong to work entry 1.
    const same = headings.filter((h) => visibleText(h) === text);
    const container = element.closest("fieldset, section, [data-section], li") ?? null;
    let sectionIndex = 0;
    if (same.length > 1) {
      const owning = same.findLast?.(
        (h) => h.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      sectionIndex = Math.max(0, same.indexOf(owning));
    } else if (container) {
      // Repeated blocks under a single heading, which is how "Add another" UIs
      // are built. Counting stops at the previous heading: two employment
      // blocks followed by an education block are all siblings, and counting
      // across the heading would make the education block entry 2.
      let position = 0;
      for (let sibling = container.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (/^(H[1-6]|LEGEND)$/.test(sibling.tagName)) break;
        if (sibling.tagName === container.tagName) position += 1;
      }
      sectionIndex = position;
    }

    return { sectionText: text, sectionIndex };
  }

  /** Option labels offered by a select, or by a group of radios/checkboxes. */
  function optionsFor(element, doc) {
    if (element.tagName === "SELECT") {
      return [...element.options].map((o) => cleanText(o.label || o.textContent)).filter(Boolean);
    }

    if (element.type === "radio" || element.type === "checkbox") {
      if (!element.name) return [];
      // Same reasoning as labelFor: names like "job_application[urls][LinkedIn]"
      // make attribute selectors fragile, so compare properties instead.
      const group = [...doc.getElementsByTagName("input")].filter(
        (input) => input.type === element.type && input.name === element.name
      );
      return group.map((input) => labelFor(input) || cleanText(input.value)).filter(Boolean);
    }

    // ARIA listboxes rendered inline. A closed custom combobox has no options
    // in the DOM yet; those are discovered at fill time by opening it.
    const listboxId = element.getAttribute?.("aria-controls") || element.getAttribute?.("aria-owns");
    const listbox = listboxId ? doc.getElementById(listboxId) : null;
    if (listbox) {
      return [...listbox.querySelectorAll("[role='option']")].map(visibleText).filter(Boolean);
    }

    return [];
  }

  /** Whether the control already holds a value the user would not want replaced. */
  function hasValue(element) {
    if (element.type === "checkbox" || element.type === "radio") return element.checked;
    if (element.type === "file") return element.files?.length > 0;
    if (element.isContentEditable) return cleanText(element.textContent).length > 0;
    return String(element.value ?? "").trim().length > 0;
  }

  /**
   * Query across shadow roots as well as the light DOM.
   *
   * Some applicant tracking systems render their form inside web components.
   * A plain querySelectorAll returns nothing at all on those pages.
   */
  function deepQueryAll(root, selector, found = []) {
    for (const element of root.querySelectorAll(selector)) found.push(element);
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) deepQueryAll(element.shadowRoot, selector, found);
    }
    return found;
  }

  /**
   * Collect every fillable field on the page.
   *
   * @param {Document} [doc]
   * @returns {{descriptors: object[], elements: Map<string, Element>}}
   *   The descriptors are plain JSON for the matcher; the element map stays in
   *   the content script so a fill instruction can be resolved back to a node.
   */
  function collect(doc = document) {
    const elements = new Map();
    const descriptors = [];
    const seenRadioGroups = new Set();
    let counter = 0;

    for (const element of deepQueryAll(doc, SELECTOR)) {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      // A <button> reports type "submit" by default. When it owns a listbox it
      // is really a dropdown, and calling it that is what lets the fill step
      // pick the right strategy for it.
      const isCustomDropdown =
        role === "combobox" || element.getAttribute("aria-haspopup") === "listbox";
      const type = isCustomDropdown
        ? "combobox"
        : (element.type || role || tag).toLowerCase();

      if (tag === "input" && IGNORED_TYPES.has(element.type)) continue;
      if (isHidden(element)) continue;

      // A radio group is one question, not one field per option. Collapsing it
      // here means the matcher scores the question once and the fill step picks
      // the right option, rather than the matcher having to understand groups.
      if (element.type === "radio" && element.name) {
        if (seenRadioGroups.has(element.name)) continue;
        seenRadioGroups.add(element.name);
      }

      const fieldId = `jf${counter++}`;
      elements.set(fieldId, element);

      // For a grouped control the question outranks the individual option's
      // label, which would otherwise be an answer like "Yes".
      const label = (element.type === "radio" || element.type === "checkbox")
        ? groupQuestionFor(element) || labelFor(element)
        : labelFor(element);
      const { sectionText, sectionIndex } = sectionContextFor(element, doc);

      descriptors.push({
        fieldId,
        tag,
        type,
        name: element.name || "",
        id: element.id || "",
        autocomplete: element.getAttribute("autocomplete") || "",
        // Vendor-stable naming. Workday's data-automation-id in particular
        // outlives the visible label, which is localised and re-worded between
        // tenants — so adapters key on this rather than on text.
        automationId:
          element.getAttribute("data-automation-id") ||
          element.getAttribute("data-testid") ||
          element.getAttribute("data-qa") ||
          "",
        label,
        placeholder: element.getAttribute("placeholder") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        sectionText,
        sectionIndex,
        options: optionsFor(element, doc),
        maxLength: element.maxLength > 0 ? element.maxLength : undefined,
        pattern: element.getAttribute("pattern") || "",
        required: element.required || element.getAttribute("aria-required") === "true",
        hasValue: hasValue(element),
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true" || element.readOnly),
      });
    }

    return { descriptors, elements };
  }

  NS.collect = collect;
  // Exported for the fill step and for tests, which exercise them directly.
  NS.collectInternals = { labelFor, sectionContextFor, optionsFor, cleanText, visibleText, deepQueryAll };
})();
