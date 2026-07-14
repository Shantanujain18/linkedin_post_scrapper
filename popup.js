const keywordsInput = document.querySelector("#keywords");
const limitInput = document.querySelector("#limit");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const statusNode = document.querySelector("#status");

function setStatus(message, running = false) {
  statusNode.textContent = message;
  startButton.disabled = running;
  stopButton.disabled = !running;
}

async function restoreState() {
  const state = await chrome.storage.local.get(["keywords", "limit", "scrapeStatus"]);
  if (state.keywords) keywordsInput.value = state.keywords;
  if (state.limit) limitInput.value = state.limit;
  const current = state.scrapeStatus;
  if (current?.running) {
    setStatus(current.message || "Scraping…", true);
  } else {
    setStatus(current?.message || "Ready", false);
  }
}

startButton.addEventListener("click", async () => {
  const keywords = keywordsInput.value.trim();
  const limit = Number.parseInt(limitInput.value, 10);
  if (!keywords) {
    setStatus("Enter at least one search keyword.");
    return;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    setStatus("Post limit must be between 1 and 500.");
    return;
  }

  setStatus("Opening LinkedIn search…", true);
  const response = await chrome.runtime.sendMessage({ type: "START", keywords, limit });
  if (!response?.ok) setStatus(response?.error || "Could not start the scraper.");
});

stopButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "STOP" });
  setStatus("Stopping…", true);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "STATUS") return;
  setStatus(message.message, Boolean(message.running));
});

restoreState().catch((error) => setStatus(error.message));
