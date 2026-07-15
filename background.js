const SEARCH_PREFIX = "https://www.linkedin.com/search/results/content/";

function searchUrl(keywords) {
  const params = new URLSearchParams({
    keywords,
    origin: "FACETED_SEARCH",
    // LinkedIn expects a JSON array string: ["past-24h"]
    datePosted: '["past-24h"]'
  });
  return `${SEARCH_PREFIX}?${params.toString()}`;
}

function sameSearchUrl(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.origin === b.origin && a.pathname === b.pathname && a.searchParams.toString() === b.searchParams.toString();
  } catch {
    return false;
  }
}

async function publishStatus(message, running) {
  const scrapeStatus = { message, running, updatedAt: Date.now() };
  await chrome.storage.local.set({ scrapeStatus });
  await chrome.action.setBadgeText({ text: running ? "…" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0a66c2" });
  chrome.runtime.sendMessage({ type: "STATUS", message, running }).catch(() => {});
}

async function beginScrape(tabId, job) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "SCRAPE",
      keywords: job.keywords,
      limit: job.limit
    });
    if (!response?.ok) throw new Error(response?.error || "The page rejected the scrape request.");
  } catch (error) {
    await publishStatus(`Error: ${error.message}`, false);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active Chrome tab was found.");

      const job = { tabId: tab.id, keywords: message.keywords, limit: message.limit };
      await chrome.storage.local.set({
        pendingJob: job,
        keywords: message.keywords,
        limit: message.limit
      });
      await publishStatus("Opening LinkedIn search (Past 24 hours)…", true);
      const destination = searchUrl(message.keywords);
      if (sameSearchUrl(tab.url || "", destination)) {
        // Avoid relying on tabs.onUpdated when the requested search URL is
        // already open; Chrome may not emit an update for an identical URL.
        await beginScrape(tab.id, job);
      } else {
        await chrome.tabs.update(tab.id, { url: destination });
      }
      sendResponse({ ok: true });
    })().catch(async (error) => {
      await publishStatus(`Error: ${error.message}`, false);
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "STOP") {
    (async () => {
      const { pendingJob } = await chrome.storage.local.get("pendingJob");
      if (pendingJob?.tabId) {
        chrome.tabs.sendMessage(pendingJob.tabId, { type: "STOP_SCRAPE" }).catch(() => {});
      }
      await chrome.storage.local.remove("pendingJob");
      await publishStatus("Stopped", false);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "SCRAPE_PROGRESS") {
    publishStatus(message.message, message.running).catch(() => {});
    if (!message.running) chrome.storage.local.remove("pendingJob");
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url?.startsWith(SEARCH_PREFIX)) return;
  const { pendingJob } = await chrome.storage.local.get("pendingJob");
  if (!pendingJob || pendingJob.tabId !== tabId) return;
  await publishStatus("LinkedIn loaded; reading past-24h posts…", true);
  await beginScrape(tabId, pendingJob);
});
