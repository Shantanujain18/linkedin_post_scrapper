export function getExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version || "";
  } catch {
    return "";
  }
}
