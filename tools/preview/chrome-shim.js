/**
 * A minimal `chrome.*` stand-in, for previewing the extension's pages in an
 * ordinary browser tab.
 *
 * Development tool only — it is served by tools/dev-server.mjs and is never
 * part of the packaged extension. Loading the options page through the dev
 * server means you can iterate on layout with normal devtools and a normal
 * reload, instead of rebuilding an unpacked extension for every CSS tweak.
 *
 * Storage is backed by localStorage so a preview session keeps its data across
 * reloads, exactly as chrome.storage.local would.
 */

(() => {
  const KEY = "jobfill-preview-storage";

  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      return {};
    }
  };
  const write = (data) => localStorage.setItem(KEY, JSON.stringify(data));

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const data = read();
          if (keys == null) return structuredClone(data);
          const out = {};
          for (const key of [].concat(keys)) if (key in data) out[key] = structuredClone(data[key]);
          return out;
        },
        async set(patch) {
          write({ ...read(), ...patch });
        },
        async remove(keys) {
          const data = read();
          for (const key of [].concat(keys)) delete data[key];
          write(data);
        },
      },
    },

    runtime: {
      openOptionsPage: () => location.assign("/src/ui/options/options.html"),
      getURL: (path) => new URL(path, location.origin).href,
      sendMessage: async () => ({ preview: true }),
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      OnInstalledReason: { INSTALL: "install" },
    },

    commands: { onCommand: { addListener() {} } },
    tabs: { query: async () => [{ id: 1, url: "https://example.com/apply" }] },
    scripting: { executeScript: async () => [] },
  };

  // A visible reminder, so a screenshot of the preview is never mistaken for a
  // screenshot of the real extension.
  addEventListener("DOMContentLoaded", () => {
    const badge = document.createElement("div");
    badge.textContent = "preview";
    badge.style.cssText =
      "position:fixed;bottom:10px;right:10px;z-index:999;padding:3px 8px;border-radius:6px;" +
      "font:11px ui-monospace,monospace;background:#b45309;color:#fff;opacity:.85;pointer-events:none";
    document.body.append(badge);
  });
})();
