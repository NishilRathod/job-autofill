/**
 * Popup controller.
 *
 * Phase 5 turns this into the scan/preview/fill interface. Today it does the
 * one thing the popup can usefully do before the pipeline exists: get people to
 * the profile editor.
 */

document.getElementById("open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  // The popup is dismissed automatically once focus moves to the new tab, but
  // closing explicitly avoids a flash of the popup on slower machines.
  window.close();
});
