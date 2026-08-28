/**
 * Persistence for the profile, settings, snippets and learned mappings.
 *
 * Everything lives in `chrome.storage.local`. Deliberately never
 * `chrome.storage.sync`: sync would replicate a user's home address, phone
 * number and employment history through their Google account, which is exactly
 * what this extension exists to avoid. A test enforces that.
 *
 * The store is created through a factory that takes the storage area, so tests
 * can pass a plain in-memory object instead of standing up a browser.
 */

import { SCHEMA_VERSION, defaultState, emptyProfile, defaultSettings } from "../core/defaults.js";
import { SECTIONS, parsePath } from "../core/schema.js";

/** Top-level keys held in storage. */
const KEYS = ["schemaVersion", "profile", "settings", "snippets", "mappings"];

/**
 * Migrations from one schema version to the next, applied in order.
 *
 * Each entry is keyed by the version it upgrades *from* and returns the new
 * state. There are none yet — version 1 is the first release — but the runner
 * below is in place so the first real migration does not have to invent the
 * mechanism under pressure.
 *
 * @type {Record<number, (state: object) => object>}
 */
const MIGRATIONS = {};

/**
 * Bring stored state up to the current schema version.
 *
 * Unknown-but-newer state is left alone rather than mangled: that happens when
 * a user downgrades the extension, and destroying their profile would be a far
 * worse outcome than a few fields not filling.
 */
export function migrate(state) {
  let current = { ...state };
  let version = Number(current.schemaVersion) || 0;

  while (version < SCHEMA_VERSION && MIGRATIONS[version]) {
    current = MIGRATIONS[version](current);
    version += 1;
    current.schemaVersion = version;
  }

  return current;
}

/**
 * Fill in anything missing from stored state.
 *
 * Called on every read, because a profile saved before a field was added to the
 * schema will simply not have that key. Rather than making every consumer
 * defend against undefined, we normalise once here.
 */
export function withDefaults(state) {
  const base = defaultState();
  const profile = { ...base.profile };

  for (const section of SECTIONS) {
    const stored = state.profile?.[section.id];
    if (section.repeating) {
      // Merge each stored entry over a blank one so new fields appear, and keep
      // at least one entry so the editor always has a row to show.
      const entries = Array.isArray(stored) && stored.length ? stored : base.profile[section.id];
      profile[section.id] = entries.map((entry) => ({ ...base.profile[section.id][0], ...entry }));
    } else {
      profile[section.id] = { ...base.profile[section.id], ...(stored ?? {}) };
    }
  }

  return {
    schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
    profile,
    settings: { ...base.settings, ...(state.settings ?? {}) },
    snippets: Array.isArray(state.snippets) ? state.snippets : [],
    mappings: state.mappings && typeof state.mappings === "object" ? state.mappings : {},
  };
}

/**
 * Reduce a URL to the key under which learned mappings are stored.
 *
 * Uses the full hostname rather than the registrable domain. Job boards are
 * routinely per-tenant subdomains (`acme.myworkdayjobs.com`), and those tenants
 * genuinely have different form layouts, so collapsing them would make learned
 * mappings less accurate, not more.
 *
 * @param {string} url
 * @returns {string} hostname, or "" if the URL is not parseable
 */
export function domainKeyFor(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Create a store backed by the given storage area.
 *
 * @param {{get: Function, set: Function, remove?: Function}} area
 *   A `chrome.storage.StorageArea`, or anything with the same promise-based
 *   shape. Passing a fake is how the tests run without a browser.
 */
export function createStore(area) {
  if (!area) {
    throw new Error("createStore needs a storage area (chrome.storage.local)");
  }

  /** Read, migrate and normalise the whole state. */
  async function read() {
    const raw = await area.get(KEYS);
    return withDefaults(migrate(raw ?? {}));
  }

  return {
    read,

    async getProfile() {
      return (await read()).profile;
    },

    async getSettings() {
      return (await read()).settings;
    },

    async getSnippets() {
      return (await read()).snippets;
    },

    async saveProfile(profile) {
      await area.set({ profile, schemaVersion: SCHEMA_VERSION });
      return profile;
    },

    async saveSettings(patch) {
      const settings = { ...(await read()).settings, ...patch };
      await area.set({ settings });
      return settings;
    },

    async saveSnippets(snippets) {
      await area.set({ snippets });
      return snippets;
    },

    /**
     * Write a single value by canonical path, e.g. "identity.email" or
     * "work.1.company". Used by the options editor on every keystroke-debounced
     * change, so it reads and writes only what it must.
     */
    async setValue(path, value) {
      const { sectionId, index, key } = parsePath(path);
      const state = await read();
      const profile = state.profile;

      if (index === null) {
        profile[sectionId] = { ...profile[sectionId], [key]: value };
      } else {
        const entries = [...profile[sectionId]];
        // Grow the array if the editor added a row we have not stored yet.
        while (entries.length <= index) entries.push({ ...emptyProfile()[sectionId][0] });
        entries[index] = { ...entries[index], [key]: value };
        profile[sectionId] = entries;
      }

      await area.set({ profile, schemaVersion: SCHEMA_VERSION });
      return profile;
    },

    // --- Learned mappings --------------------------------------------------

    /**
     * Mappings the user has taught JobFill for one site.
     * @returns {Promise<Record<string, string>>} signature -> canonical path
     */
    async getMappingsFor(url) {
      const domain = domainKeyFor(url);
      return (await read()).mappings[domain] ?? {};
    },

    /**
     * Remember that a field with `signature` on `url` means `path`.
     * Passing a null path forgets the mapping instead.
     */
    async learnMapping(url, signature, path) {
      const domain = domainKeyFor(url);
      if (!domain || !signature) return;

      const { mappings } = await read();
      const forDomain = { ...(mappings[domain] ?? {}) };

      if (path) forDomain[signature] = path;
      else delete forDomain[signature];

      if (Object.keys(forDomain).length) mappings[domain] = forDomain;
      else delete mappings[domain];

      await area.set({ mappings });
      return mappings;
    },

    // --- Backup ------------------------------------------------------------

    /**
     * The whole state as a plain object, for the "Export" button.
     *
     * Document blobs are not included — they live in IndexedDB and can be
     * megabytes each. The export notes which documents were configured so an
     * import can tell the user what to re-attach.
     */
    async exportState() {
      const state = await read();
      return {
        _format: "jobfill-profile",
        _version: SCHEMA_VERSION,
        _exportedAt: new Date().toISOString(),
        _note:
          "This file contains your personal details in plain text. Keep it somewhere private " +
          "and do not commit it to a repository.",
        ...state,
      };
    },

    /**
     * Replace stored state from an exported file.
     *
     * Validates the marker before overwriting, because the alternative — the
     * user picking the wrong JSON file and silently destroying their profile —
     * is unrecoverable.
     */
    async importState(incoming) {
      if (!incoming || incoming._format !== "jobfill-profile") {
        throw new Error("That does not look like a JobFill export file.");
      }

      const state = withDefaults(migrate(incoming));
      await area.set({
        schemaVersion: SCHEMA_VERSION,
        profile: state.profile,
        settings: state.settings,
        snippets: state.snippets,
        mappings: state.mappings,
      });
      return state;
    },

    /** Wipe everything. The options page confirms before calling this. */
    async clearAll() {
      await area.set({
        schemaVersion: SCHEMA_VERSION,
        profile: emptyProfile(),
        settings: defaultSettings(),
        snippets: [],
        mappings: {},
      });
    },
  };
}

/**
 * The store used by the extension itself.
 *
 * Constructed lazily so that importing this module in a test, or in any context
 * without the chrome APIs, does not throw.
 */
let defaultStore = null;
export function getStore() {
  if (!defaultStore) {
    defaultStore = createStore(globalThis.chrome?.storage?.local);
  }
  return defaultStore;
}
