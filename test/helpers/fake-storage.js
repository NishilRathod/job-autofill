/**
 * An in-memory stand-in for a `chrome.storage.StorageArea`.
 *
 * Only the promise-based `get`/`set`/`remove` surface that store.js actually
 * uses is implemented. Values are deep-cloned on the way in and out, which
 * matters: chrome.storage serialises everything, so a test that accidentally
 * mutates a shared object reference would pass here and fail in the browser.
 */

export function createFakeStorageArea(initial = {}) {
  let data = structuredClone(initial);

  return {
    /** Number of set() calls, so tests can assert we are not over-writing. */
    writes: 0,

    async get(keys) {
      if (keys == null) return structuredClone(data);
      const wanted = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of wanted) {
        if (key in data) out[key] = structuredClone(data[key]);
      }
      return out;
    },

    async set(patch) {
      this.writes += 1;
      data = { ...data, ...structuredClone(patch) };
    },

    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },

    /** Test-only: peek at raw contents without going through the store. */
    _raw() {
      return structuredClone(data);
    },
  };
}
