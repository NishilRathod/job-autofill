/**
 * Static server for previewing the extension's pages in a normal browser tab.
 *
 * Development tool only; nothing here ships. It serves the repository root and
 * injects tools/preview/chrome-shim.js into any extension page, so the options
 * page and popup render outside Chrome's extension host. That turns a CSS tweak
 * into a browser reload rather than a rebuild-and-reload-unpacked cycle.
 *
 * Run with `npm run dev`, then open http://localhost:5173/src/ui/options/options.html
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname, normalize, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 5173);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** The shim must run before any module script on the page. */
const SHIM_TAG = '<script src="/tools/preview/chrome-shim.js"></script>';

const server = createServer(async (request, response) => {
  const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const target = join(ROOT, normalize(requested).replace(/^([/\\])+/, ""));

  // Refuse anything that escapes the repository, even though this only ever
  // listens on localhost.
  if (!target.startsWith(ROOT + sep) && target !== ROOT) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      response.writeHead(404).end("Not found");
      return;
    }

    const extension = extname(target);
    let body = await readFile(target);

    if (extension === ".html") {
      // Inject the shim as the first script in <head>, so chrome.* exists
      // before the page's own modules evaluate.
      body = Buffer.from(String(body).replace("</head>", `  ${SHIM_TAG}\n  </head>`));
    }

    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      // Always revalidate: the whole point is seeing edits immediately.
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end(`Not found: ${requested}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`JobFill preview server: http://localhost:${PORT}`);
  console.log(`  options page  http://localhost:${PORT}/src/ui/options/options.html`);
  console.log(`  popup         http://localhost:${PORT}/src/ui/popup/popup.html`);
});
