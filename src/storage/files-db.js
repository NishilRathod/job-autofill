/**
 * Local storage for resumes, cover letters and other uploads.
 *
 * These live in IndexedDB rather than chrome.storage.local for two reasons:
 * chrome.storage has a practical size ceiling that a few PDFs would breach, and
 * IndexedDB can hold a Blob directly instead of forcing a base64 round-trip
 * that inflates every file by a third.
 *
 * The blobs never leave this database except to become a `File` attached to an
 * upload input on a page the user opened. Nothing here touches the network.
 */

const DB_NAME = "jobfill-documents";
const DB_VERSION = 1;
const STORE = "documents";

/** Reject a stored document above this size, in bytes. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * File types worth storing. Anything else is refused, since an application form
 * will not accept it anyway and we would rather fail at upload time, in the
 * options page, than silently at fill time.
 */
export const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".png", ".jpg", ".jpeg"];

/** Open (and if needed create) the database. */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by the schema path of the document slot — "documents.resume",
        // "documents.coverLetterFile" — so each slot holds exactly one file and
        // replacing it is a plain put().
        db.createObjectStore(STORE, { keyPath: "slot" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run `work` inside a transaction and resolve with its request's result. */
async function withStore(mode, work) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        tx.oncomplete = () => resolve(undefined);
      }
    });
  } finally {
    db.close();
  }
}

/**
 * Validate a file before storing it.
 * @returns {string | null} An error message, or null if the file is acceptable.
 */
export function validateFile(file) {
  if (!file) return "No file selected.";

  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return `Files of type ${extension || "unknown"} are not accepted. Use one of: ${ALLOWED_EXTENSIONS.join(", ")}.`;
  }

  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `That file is ${mb} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB, and most application forms reject anything larger anyway.`;
  }

  if (file.size === 0) return "That file is empty.";

  return null;
}

/**
 * Store a file in a document slot, replacing whatever was there.
 *
 * @param {string} slot Schema path, e.g. "documents.resume".
 * @param {File} file
 * @returns {Promise<{name: string, size: number, type: string, savedAt: string}>}
 *   Metadata for the options page to display. The blob itself stays here.
 */
export async function putDocument(slot, file) {
  const problem = validateFile(file);
  if (problem) throw new Error(problem);

  const record = {
    slot,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    savedAt: new Date().toISOString(),
    // Stored as a Blob. Reconstructed into a File on the way out, because
    // structured clone does not preserve the File subtype in every browser.
    blob: file.slice(0, file.size, file.type),
  };

  await withStore("readwrite", (store) => store.put(record));
  const { blob, ...metadata } = record;
  return metadata;
}

/**
 * Retrieve a stored document as a `File`, ready to attach to an upload input.
 * @returns {Promise<File | null>}
 */
export async function getDocumentFile(slot) {
  const record = await withStore("readonly", (store) => store.get(slot));
  if (!record?.blob) return null;
  return new File([record.blob], record.name, {
    type: record.type,
    lastModified: Date.parse(record.savedAt) || Date.now(),
  });
}

/**
 * Metadata for every stored document, without loading any blobs.
 * @returns {Promise<Record<string, {name: string, size: number, type: string, savedAt: string}>>}
 */
export async function listDocuments() {
  const records = await withStore("readonly", (store) => store.getAll());
  const out = {};
  for (const { blob, ...metadata } of records ?? []) {
    out[metadata.slot] = metadata;
  }
  return out;
}

/** Remove a stored document. */
export async function deleteDocument(slot) {
  await withStore("readwrite", (store) => store.delete(slot));
}

/** Remove every stored document. Called by the options page's reset button. */
export async function clearDocuments() {
  await withStore("readwrite", (store) => store.clear());
}

/** Human-readable file size, for the options page. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
