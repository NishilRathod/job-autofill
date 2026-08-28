/**
 * JobFill service worker.
 *
 * This is where all orchestration lives. Both entry points into a fill — the
 * popup's Fill button and the Alt+Shift+F shortcut — route through here, so the
 * two paths cannot drift apart. See docs/ARCHITECTURE.md for the message flow.
 *
 * Scaffold stage: the fill pipeline itself lands in phase 4/5. What is wired up
 * today is the lifecycle plumbing that has to exist for the extension to load
 * and behave sensibly on first install.
 */

/**
 * Open the options page the first time JobFill is installed.
 *
 * An empty profile fills nothing, so an extension that installs silently looks
 * broken. Sending people straight to the editor makes the required next step
 * obvious. Deliberately scoped to `install` — nobody wants a tab opened at them
 * every time the extension updates.
 */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.runtime.openOptionsPage();
  }
});

/**
 * Keyboard shortcuts declared in manifest.json.
 *
 * Chrome delivers the command here, and — importantly — invoking a command is
 * one of the gestures that grants `activeTab`. That is what lets us inject into
 * the current page without holding a standing host permission.
 */
chrome.commands.onCommand.addListener((command) => {
  // Handlers arrive with the fill pipeline. Until then, log rather than fail
  // silently, so a user pressing the shortcut early can see why nothing moved.
  console.info(`[JobFill] Received "${command}". The fill pipeline is not wired up yet.`);
});
