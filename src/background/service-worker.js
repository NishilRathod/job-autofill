/**
 * JobFill service worker: the only component that decides anything.
 *
 * Both routes into a fill — the popup's button and the Alt+Shift+F shortcut —
 * go through `buildPlan` and `applyPlan` here, so the two cannot drift apart.
 * See docs/ARCHITECTURE.md for the full message flow.
 */

import { match } from "../core/matcher.js";
import { formatForField } from "../core/value-format.js";
import { getStore } from "../storage/store.js";
import { getDocumentAsBase64 } from "../storage/files-db.js";
import { adapterFor } from "../adapters/index.js";

const store = getStore();

/** Content scripts, in the order they must be injected. */
const CONTENT_SCRIPTS = [
  "src/content/collect.js",
  "src/content/widgets.js",
  "src/content/files.js",
  "src/content/fill.js",
  "src/content/overlay.js",
  "src/content/content.js",
];

/**
 * Open the options page the first time JobFill is installed.
 *
 * An empty profile fills nothing, so a silent install looks broken. Scoped to
 * `install` — nobody wants a tab opened at them on every update.
 */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.runtime.openOptionsPage();
  }
});

/** Send a message to a tab, resolving to null instead of throwing. */
function askTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

/**
 * Ensure the content scripts are present in a tab.
 *
 * Injected on demand rather than declared in the manifest, because JobFill
 * holds no host permissions — `activeTab` grants access only for the gesture
 * that invoked it. That is what keeps the install prompt free of "read and
 * change all your data on all websites".
 */
async function ensureInjected(tabId) {
  const alive = await askTab(tabId, { type: "PING" });
  if (alive?.ready) return true;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
    return true;
  } catch (error) {
    // Chrome refuses injection on its own pages and on the Web Store. Saying so
    // beats a silent no-op the user cannot explain.
    throw new Error(
      /cannot be scripted|extensions gallery|chrome:\/\//i.test(error.message)
        ? "Chrome does not allow extensions to run on this page."
        : error.message
    );
  }
}

/** The tab the user is looking at. */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab;
}

/**
 * Scan a tab and work out what to fill.
 *
 * Returns everything the popup needs to render a preview: what will be filled,
 * what was deliberately left alone and why, and what could not be placed.
 */
async function buildPlan(tab) {
  await ensureInjected(tab.id);

  const page = await askTab(tab.id, { type: "COLLECT" });
  if (!page) throw new Error("Could not read this page. Try reloading it.");

  const [state, learned] = await Promise.all([store.read(), store.getMappingsFor(tab.url)]);
  const adapter = adapterFor(tab.url);

  const result = match({
    descriptors: page.descriptors,
    profile: state.profile,
    settings: state.settings,
    learned,
    adapterHints: adapter?.hintsFor(page.descriptors) ?? {},
  });

  // Turn each match into a concrete instruction for the control it targets.
  // A field whose value cannot be expressed in its control is moved to
  // `skipped` rather than filled with something approximate.
  const byId = new Map(page.descriptors.map((d) => [d.fieldId, d]));
  const plan = [];
  const skipped = [...result.skipped];

  for (const fill of result.fills) {
    const descriptor = byId.get(fill.fieldId);
    const instruction = formatForField({ value: fill.value, path: fill.path, descriptor });

    if (!instruction) {
      skipped.push({
        fieldId: fill.fieldId,
        label: fill.label,
        reason: descriptor?.options?.length
          ? "None of this dropdown's options match your saved answer"
          : "Your saved value does not fit this field",
      });
      continue;
    }

    plan.push({
      fieldId: fill.fieldId,
      path: fill.path,
      label: fill.label,
      reason: fill.reason,
      score: fill.score,
      instruction,
      // What the preview shows. For a file it is the document's name.
      preview: instruction.kind === "file" ? state.profile.documents?.[fill.path.split(".")[1]]?.name ?? "your document" : String(instruction.value),
    });
  }

  return {
    url: page.url,
    title: page.title,
    adapter: adapter?.name ?? null,
    plan,
    skipped,
    unmatched: result.unmatched,
    settings: state.settings,
  };
}

/**
 * Attach document bytes to the file instructions in a plan.
 *
 * Done here, at the last moment, and only for documents actually being used.
 * A content script's IndexedDB belongs to the page rather than the extension,
 * so it cannot read the document store itself, and chrome.runtime messages are
 * JSON and will not carry a Blob — hence base64.
 */
async function withDocuments(plan) {
  return Promise.all(
    plan.map(async (item) => {
      if (item.instruction.kind !== "file") return item;
      const document = await getDocumentAsBase64(item.instruction.value);
      return { ...item, instruction: { ...item.instruction, file: document } };
    })
  );
}

/** Carry out a plan in a tab. */
async function applyPlan(tab, { plan, skippedCount = 0, showToast = false, settings }) {
  await ensureInjected(tab.id);
  const withFiles = await withDocuments(plan);

  const result = await askTab(tab.id, {
    type: "APPLY",
    plan: withFiles,
    skippedCount,
    showToast,
    highlight: settings?.highlightFilled !== false,
  });

  return result ?? { filled: [], failed: [] };
}

/**
 * The keyboard shortcut path: scan, fill and report, with no preview.
 *
 * Deliberately the same two functions the popup uses.
 */
async function fillNow() {
  const tab = await activeTab();
  const { plan, skipped, settings } = await buildPlan(tab);

  // Documents are dropped when the setting is off, rather than filtered
  // earlier, so the popup can still show them as available.
  const toApply = settings.attachDocuments ? plan : plan.filter((i) => i.instruction.kind !== "file");

  await applyPlan(tab, { plan: toApply, skippedCount: skipped.length, showToast: true, settings });
}

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "fill-now") {
      await fillNow();
    } else if (command === "undo-fill") {
      const tab = await activeTab();
      await askTab(tab.id, { type: "UNDO" });
    }
  } catch (error) {
    // The shortcut has no UI of its own, so a badge is the only way to report
    // a failure the user would otherwise experience as nothing happening.
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setTitle({ title: `JobFill: ${error.message}` });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "JobFill — fill this application" });
    }, 6000);
  }
});

/** Messages from the popup. */
const HANDLERS = {
  async SCAN() {
    return buildPlan(await activeTab());
  },

  async APPLY(message) {
    const tab = await activeTab();
    return applyPlan(tab, { ...message, showToast: false });
  },

  async UNDO() {
    const tab = await activeTab();
    return (await askTab(tab.id, { type: "UNDO" })) ?? { restored: 0 };
  },

  async REVEAL(message) {
    const tab = await activeTab();
    return askTab(tab.id, { type: "REVEAL", fieldId: message.fieldId });
  },

  /** Learn mode: remember that this field on this site means this path. */
  async LEARN(message) {
    const tab = await activeTab();
    await store.learnMapping(tab.url, message.signature, message.path);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  // Errors are returned rather than thrown, so the popup can show what went
  // wrong instead of an opaque "message port closed".
  Promise.resolve()
    .then(() => handler(message))
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});
