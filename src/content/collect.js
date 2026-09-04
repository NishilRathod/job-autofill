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

  /**
   * Input types that are controls rather than data entry.
   *
   * `search` is deliberately absent. It reads like a page-search box, but on an
   * application form it is usually the typeahead for a country, a location or a
   * skill picker — exactly the fields that need the most help.
   *
   * `password` is here rather than merely unmatched. Workday and the rest gate
   * their apply flows behind an account, so a password box genuinely appears
   * mid-application. Nothing in the schema could fill one, but collecting it
   * offers it in the "Not recognised" list where the user can teach a mapping
   * onto it — and this extension has no business anywhere near a credential.
   */
  const IGNORED_TYPES = new Set(["submit", "button", "reset", "image", "hidden", "password"]);

  /**
   * How far up the tree to look for a label before giving up.
   *
   * Eight rather than a smaller number because component frameworks stack
   * wrappers between a field and its label: Zoho Recruit puts six elements
   * between a phone input and the `<label>` that names it.
   */
  const ANCESTOR_LIMIT = 8;

  /** Longest text accepted as a label from a bare container. Beyond this it is prose. */
  const PROSE_LIMIT = 120;

  /**
   * Longest text accepted from something that announces itself as a label.
   *
   * Real application questions run long — "Are you willing to take on additional
   * responsibilities and allow your role to evolve based on your skillset…" is
   * over two hundred characters — and truncating them to the prose limit throws
   * away the only signal those fields have.
   */
  const LABEL_LIMIT = 400;

  /** Elements whose text can stand in for a label. */
  const CANDIDATE_TAGS = /^(label|span|div|p|legend|dt|th)$/i;
  const CANDIDATE_TAGS_SELECTOR = "label,span,div,p,legend,dt,th";

  /** Wrappers whose contents are a control's own chrome rather than its label. */
  const INTERACTIVE = /^(a|button)$/i;

  /** Class and data-attribute values that mark a node as naming a field. */
  const LABELISH = /(^|[\s_-])(label|question|prompt|caption)([\s_-]|$)/i;

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
  function isHidden(element, style) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;
    if (!style) return false;
    return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
  }

  /**
   * Controls that are in the page but deliberately not on the screen.
   *
   * These are honeypots, and filling one is worse than filling nothing: it
   * marks the submission as a bot, and the application is discarded without
   * anybody reading it. Workday ships one on every apply flow —
   *
   *   <input name="website" data-automation-id="beecatcher" type="text">
   *   <label>Enter website. This input is for robots only, do not enter if
   *          you're human.</label>
   *
   * — collapsed with `clip`, `clip-path` and a 1px box rather than with
   * `display: none`, precisely so that a script still finds it. Our matcher
   * scored that field 65 on `name="website"` and filled it.
   *
   * Kept separate from `isHidden` because the two need different exemptions.
   * `isHidden` is right that plenty of real controls measure zero: a file input
   * behind a styled label, and the real checkbox under every custom-drawn one.
   * But those are file, checkbox and radio inputs. A *text* box clipped to a
   * single pixel is never something a person is meant to type into.
   */
  const COLLAPSE_EXEMPT = new Set(["file", "checkbox", "radio"]);

  /** A pixel value small enough that nothing can be typed into it. */
  const TINY = /^([01](\.\d+)?)px$/;

  /** `clip: rect(1px, 1px, 1px, 1px)` and friends — a rectangle enclosing nothing. */
  function hasEmptyClip(clip) {
    const parts = /^rect\(\s*(-?[\d.]+)px[,\s]+(-?[\d.]+)px[,\s]+(-?[\d.]+)px[,\s]+(-?[\d.]+)px\s*\)$/
      .exec(String(clip ?? "").trim());
    if (!parts) return false;
    const [, top, right, bottom, left] = parts.map(Number);
    return right - left <= 1 || bottom - top <= 1;
  }

  /** A clip-path that encloses no area. */
  function hasEmptyClipPath(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text || text === "none") return false;
    // Every coordinate zero, so the polygon has no area.
    if (text.startsWith("polygon(") && !/[1-9]/.test(text)) return true;
    const inset = /^inset\(\s*([\d.]+)%/.exec(text);
    return inset ? Number(inset[1]) >= 50 : false;
  }

  /** Parked far outside the viewport, the other classic way to hide a trap. */
  function isParkedOffscreen(style) {
    if (style.position !== "absolute" && style.position !== "fixed") return false;
    return parseFloat(style.left) <= -1000 || parseFloat(style.top) <= -1000;
  }

  function isCollapsed(element, style) {
    if (COLLAPSE_EXEMPT.has(element.type)) return false;
    if (!style) return false;

    return (
      hasEmptyClip(style.clip) ||
      hasEmptyClipPath(style.clipPath) ||
      (TINY.test(style.width ?? "") && TINY.test(style.height ?? "")) ||
      isParkedOffscreen(style)
    );
  }

  /**
   * A field whose own label admits it is a trap.
   *
   * Belt and braces for honeypots hidden by means the style check cannot see —
   * an off-screen parent, a zero-height ancestor, a stylesheet that failed to
   * load. Honeypot labels are written for screen readers, so they say plainly
   * what the field is for, and that text is the most reliable signal there is.
   */
  const DECOY_LABEL =
    /robots?\s+only|do not (enter|fill|use)|if you.{0,3}re human|leave (this|it)\b.{0,12}\b(blank|empty)/i;

  function isDecoyLabel(text) {
    return DECOY_LABEL.test(String(text ?? ""));
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
   * Whether a candidate is too thin to be anybody's question.
   *
   * Component libraries park a currency symbol, a dial code or a lone unit next
   * to the input, nearer than the real label. Taking one of those hides the
   * question completely — and worse, two fields that both resolve to the same
   * symbol then share a learned-mapping signature, so teaching one teaches both.
   *
   * Counting letters rather than characters keeps this working for scripts
   * without a Latin alphabet.
   */
  function isJunkLabel(text) {
    return (String(text).match(/\p{L}/gu) ?? []).length < 2;
  }

  /** Whether a node announces itself as naming a field, by tag or by class. */
  function looksLikeLabelContainer(node) {
    if (/^(label|legend|dt|th)$/i.test(node.tagName)) return true;
    if (LABELISH.test(node.getAttribute?.("class") ?? "")) return true;
    for (const attribute of node.attributes ?? []) {
      if (attribute.name.startsWith("data-") && LABELISH.test(attribute.value)) return true;
    }
    return false;
  }

  /**
   * An index of ids that appear more than once on the page.
   *
   * Duplicate ids are invalid HTML and also common: Zoho Recruit ships four
   * separate typeahead inputs all carrying the same id. A `label[for]` lookup
   * against one of those binds an arbitrary field to somebody else's label, so
   * the strategy has to be skipped rather than trusted.
   *
   * Rebuilt whenever the root changes, and forced stale by `collect`, because a
   * single-page application adds fields between scans.
   */
  let idIndex = { root: null, duplicates: new Set() };

  function idIsAmbiguous(root, id) {
    if (idIndex.root !== root) {
      const seen = new Set();
      const duplicates = new Set();
      for (const node of root.querySelectorAll("[id]")) {
        const value = node.getAttribute("id");
        if (seen.has(value)) duplicates.add(value);
        else seen.add(value);
      }
      idIndex = { root, duplicates };
    }
    return idIndex.duplicates.has(id);
  }

  /**
   * Walk up from `start` looking for a preceding sibling that names it.
   *
   * Run twice, and the two passes are the whole point. The first accepts only
   * nodes that announce themselves as labels, so a `<label>` five levels up
   * beats a decorative `<span>` sitting right beside the input. Only if that
   * finds nothing does the second pass accept ordinary containers.
   *
   * Within one level the *nearest* preceding sibling wins, which is the one a
   * reader would take the field to be labelled by.
   *
   * @param {Element} start
   * @param {{labelishOnly: boolean}} options
   */
  function scanAncestors(start, { labelishOnly }) {
    let node = start;

    for (let depth = 0; depth < ANCESTOR_LIMIT && node?.parentElement; depth += 1) {
      node = node.parentElement;

      // Text inside a link or a button beside the control is that control's
      // own chrome, not the question. Lever dresses each file input in
      // <a><span class="default-label">Upload file</span><input></a>, and the
      // class is label-shaped enough to win against the real question two
      // levels further up.
      if (INTERACTIVE.test(node.tagName) || node.getAttribute?.("role") === "button") continue;

      let nearest = "";

      for (const child of node.children) {
        // Everything from here on sits after the field, so it cannot label it.
        if (child === start || child.contains?.(start)) break;
        if (!CANDIDATE_TAGS.test(child.tagName)) continue;

        const labelish = looksLikeLabelContainer(child);
        if (labelishOnly && !labelish) continue;

        const text = visibleText(child);
        if (!text || isJunkLabel(text)) continue;
        if (text.length > (labelish ? LABEL_LIMIT : PROSE_LIMIT)) continue;

        nearest = text;
      }

      if (nearest) return nearest;
    }

    return "";
  }

  /** The `<th>` heading a table cell sits under, for the table-based forms. */
  function tableHeadingFor(element) {
    const cell = element.closest?.("td");
    const row = cell?.parentElement;
    if (!cell || !row) return "";

    // A row-header cell in the same row, which is how these forms are built.
    const rowHeader = row.querySelector?.(":scope > th");
    if (rowHeader) return visibleText(rowHeader);

    // Otherwise the column heading in the same position.
    const index = [...row.children].indexOf(cell);
    const table = cell.closest("table");
    const headers = table?.querySelectorAll?.("thead th, tr:first-child th");
    return headers?.[index] ? visibleText(headers[index]) : "";
  }

  /**
   * Resolve the label for a control, in the order browsers and screen readers
   * would: explicit association first, then structure, then proximity.
   *
   * @returns {{text: string, source: string}} `source` names the winning
   *   strategy, which is what makes a mis-labelled field debuggable.
   */
  function resolveLabel(element) {
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
      if (text) return { text, source: "aria-labelledby" };
    }

    const ariaLabel = cleanText(element.getAttribute?.("aria-label"));
    if (ariaLabel) return { text: ariaLabel, source: "aria-label" };

    // <label for="...">
    //
    // Found by iterating rather than by building an attribute selector. Ids on
    // application forms contain brackets and dots often enough that escaping
    // them is a real risk, and a thrown selector error here would abort the
    // entire scan rather than skipping one field.
    if (element.id && !idIsAmbiguous(doc, element.id)) {
      // querySelectorAll rather than getElementsByTagName, because a ShadowRoot
      // is a DocumentFragment and has no getElementsByTagName.
      for (const candidate of doc.querySelectorAll("label")) {
        if (candidate.getAttribute("for") !== element.id) continue;
        const text = visibleText(candidate);
        if (text) return { text, source: "for" };
        break;
      }
    }

    // A wrapping <label>.
    //
    // Its full text is often not the question. Lever wraps the label, the
    // control and the control's chrome together, so reading the lot yields
    // "Resume/CV ATTACH RESUME/CV Analyzing resume... Success!". When the
    // wrapper holds something that announces itself as the label, that is the
    // question and the rest is furniture.
    const wrapping = element.closest?.("label");
    if (wrapping) {
      for (const inner of wrapping.querySelectorAll(CANDIDATE_TAGS_SELECTOR)) {
        if (inner.contains(element) || !looksLikeLabelContainer(inner)) continue;
        const text = visibleText(inner);
        if (text && !isJunkLabel(text) && text.length <= LABEL_LIMIT) {
          return { text, source: "wrapping-label" };
        }
      }

      const text = visibleText(wrapping);
      if (text) return { text, source: "wrapping" };
    }

    // Workday, Lever and Zoho all render the label as a neighbouring element
    // with no association at all, so fall back to the nearest preceding text.
    const labelled = scanAncestors(element, { labelishOnly: true });
    if (labelled) return { text: labelled, source: "sibling-label" };

    const sibling = scanAncestors(element, { labelishOnly: false });
    if (sibling) return { text: sibling, source: "sibling" };

    const heading = tableHeadingFor(element);
    if (heading) return { text: heading, source: "table-header" };

    const title = cleanText(element.getAttribute?.("title"));
    if (title) return { text: title, source: "title" };

    return { text: "", source: "none" };
  }

  /** The resolved label text alone. Used by the fill step and by tests. */
  function labelFor(element) {
    return resolveLabel(element).text;
  }

  /** Help text associated through aria-describedby, which often names the field. */
  function describedByText(element) {
    const ids = element.getAttribute?.("aria-describedby");
    if (!ids) return "";
    const doc = element.getRootNode?.() ?? element.ownerDocument;
    return cleanText(
      ids.split(/\s+/).map((id) => visibleText(doc.getElementById?.(id))).join(" ")
    );
  }

  /** Every control sharing this one's type and name — the group it belongs to. */
  function peersOf(element, doc) {
    if (!element.name) return [];
    // Same reasoning as resolveLabel: names like "job_application[urls][LinkedIn]"
    // make attribute selectors fragile, so compare properties instead.
    return [...doc.querySelectorAll("input")].filter(
      (input) => input.type === element.type && input.name === element.name
    );
  }

  /**
   * The smallest element containing every option in a group.
   *
   * A radio group's question is not near any one radio — it is near the block
   * that holds all of them, which is where the search for it has to start.
   */
  function groupContainerFor(element, doc) {
    const peers = peersOf(element, doc);
    if (peers.length < 2) return null;

    let container = element;
    while (container.parentElement && !peers.every((peer) => container.contains(peer))) {
      container = container.parentElement;
    }
    return container === element ? null : container;
  }

  /**
   * The question a radio or checkbox group is asking.
   *
   * Each option in a group carries its own label ("Yes", "No"), so reading the
   * label of the first radio yields an answer rather than a question. The
   * question lives on the surrounding fieldset, radiogroup, or — on the many
   * forms that use neither — beside the block holding all the options.
   */
  function groupQuestionFor(element, doc = element.ownerDocument) {
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
    if (legend) {
      const text = visibleText(legend);
      if (text) return text;
    }

    // Neither association present, which is the common case: Lever wraps each
    // option in its own <label> and puts the question in a sibling of the list.
    // Reading the option's own label here would answer "Yes" to every question.
    const container = groupContainerFor(element, doc);
    if (!container) return "";

    return (
      scanAncestors(container, { labelishOnly: true }) ||
      scanAncestors(container, { labelishOnly: false })
    );
  }

  /**
   * A key identifying which field this is, ignoring its position.
   *
   * Digits are collapsed so that `education_1_school` and `education_2_school`
   * share a key: that is exactly what makes them repeats of one another rather
   * than two different fields.
   */
  function repeatKeyFor(element) {
    return (
      element.getAttribute?.("data-automation-id") ||
      String(element.getAttribute?.("name") ?? "").replace(/\d+/g, "#")
    );
  }

  /** Whether a sibling block contains this same field, making it an earlier entry. */
  function repeatsField(block, key) {
    for (const control of block.querySelectorAll("input, select, textarea, [role='combobox']")) {
      if (repeatKeyFor(control) === key) return true;
    }
    return false;
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
      //
      // Only siblings that repeat *this* field count. Lever puts every question
      // in its own <li>, so counting siblings by tag alone made the sixth
      // question on the form the sixth employment entry, and the value was then
      // looked up in a profile slot that does not exist.
      const key = repeatKeyFor(element);
      let position = 0;
      for (let sibling = container.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (/^(H[1-6]|LEGEND)$/.test(sibling.tagName)) break;
        if (sibling.tagName !== container.tagName) continue;
        if (key && repeatsField(sibling, key)) position += 1;
      }
      sectionIndex = position;
    }

    return { sectionText: text, sectionIndex };
  }

  /**
   * Vendor-stable ids from the field's ancestors.
   *
   * The single most valuable signal on a component-framework form, because the
   * specific name is usually on a wrapper rather than on the control. Workday
   * puts a generic id on the input and the meaningful `formField-…` one on the
   * div around it; Lever names a block `structured-contact-location-question`
   * and the input inside it nothing at all. Reading only the field's own
   * attributes throws all of that away.
   */
  function ancestorIdsFor(element) {
    const ids = [];
    let node = element;

    for (let depth = 0; depth < ANCESTOR_LIMIT && node?.parentElement; depth += 1) {
      node = node.parentElement;
      const id =
        node.getAttribute?.("data-automation-id") ||
        node.getAttribute?.("data-testid") ||
        node.getAttribute?.("data-qa") ||
        node.getAttribute?.("id") ||
        "";
      if (id) ids.push(id);
    }

    return ids;
  }

  /** Option labels offered by a select, or by a group of radios/checkboxes. */
  function optionsFor(element, doc) {
    if (element.tagName === "SELECT") {
      return [...element.options].map((o) => cleanText(o.label || o.textContent)).filter(Boolean);
    }

    if (element.type === "radio" || element.type === "checkbox") {
      // The option's own label, which for a grouped control is the answer text.
      return peersOf(element, doc)
        .map((input) => resolveLabel(input).text || cleanText(input.value))
        .filter(Boolean);
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
    // Force the duplicate-id index stale: a single-page application may have
    // added or removed fields since the last scan.
    idIndex = { root: null, duplicates: new Set() };

    const elements = new Map();
    const descriptors = [];
    const seenGroups = new Set();
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

      const style = element.ownerDocument.defaultView?.getComputedStyle?.(element) ?? null;

      if (tag === "input" && IGNORED_TYPES.has(element.type)) continue;
      if (isHidden(element, style)) continue;
      if (isCollapsed(element, style)) continue;

      const isGrouped = element.type === "radio" || element.type === "checkbox";

      // A group of options is one question, not one field per option.
      // Collapsing it here means the matcher scores the question once and the
      // fill step picks the right option.
      //
      // Radios always form a group. Checkboxes only do when more than one
      // shares the name — a lone consent tickbox is a question in its own
      // right, and folding it into a group would lose it.
      if (isGrouped && element.name) {
        const key = `${element.type}:${element.name}`;
        if (seenGroups.has(key)) continue;
        if (element.type === "radio" || peersOf(element, doc).length > 1) {
          seenGroups.add(key);
        }
      }

      // For a grouped control the question outranks the individual option's
      // label, which would otherwise be an answer like "Yes".
      const question = isGrouped ? groupQuestionFor(element, doc) : "";
      const resolved = question ? { text: question, source: "group-question" } : resolveLabel(element);

      // Resolved before the id is issued, because a honeypot's own label is
      // often the only thing that gives it away.
      if (isDecoyLabel(resolved.text)) continue;

      const fieldId = `jf${counter++}`;
      elements.set(fieldId, element);

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
        ancestorIds: ancestorIdsFor(element),
        label: resolved.text,
        labelSource: resolved.source,
        placeholder: element.getAttribute("placeholder") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        titleAttr: element.getAttribute("title") || "",
        describedBy: describedByText(element),
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
  NS.collectInternals = {
    labelFor, resolveLabel, groupQuestionFor, groupContainerFor, sectionContextFor,
    optionsFor, ancestorIdsFor, cleanText, visibleText, deepQueryAll,
    isJunkLabel, looksLikeLabelContainer, scanAncestors,
  };
})();
