import { getStoredSession, getValidAccessToken } from "./auth.js";
import { refundQuota, reserveQuota } from "./api.js";

const SEARCH_PREFIX = "https://www.linkedin.com/search/results/content/";

function searchUrl(keywords) {
  const params = new URLSearchParams({
    keywords,
    origin: "FACETED_SEARCH",
    datePosted: '["past-24h"]'
  });
  return `${SEARCH_PREFIX}?${params.toString()}`;
}

function sameSearchUrl(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return (
      a.origin === b.origin &&
      a.pathname === b.pathname &&
      a.searchParams.toString() === b.searchParams.toString()
    );
  } catch {
    return false;
  }
}

async function publishStatus(message, running, extra = {}) {
  const scrapeStatus = { message, running, updatedAt: Date.now(), ...extra };
  await chrome.storage.local.set({ scrapeStatus });
  await chrome.action.setBadgeText({ text: running ? "…" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0a66c2" });
  chrome.runtime.sendMessage({ type: "STATUS", message, running, ...extra }).catch(() => {});
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
    if (job.reserved) {
      await refundQuota(job.reserved).catch(() => {});
    }
    await publishStatus(`Error: ${error.message}`, false);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START") {
    (async () => {
      const token = await getValidAccessToken();
      if (!token) throw new Error("Sign in to ReachPod before scraping.");

      const session = await getStoredSession();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active Chrome tab was found.");

      const requested = Math.max(1, Math.min(500, Number(message.limit) || 50));
      await publishStatus("Checking daily post quota…", true);
      const reservation = await reserveQuota(requested);
      const allowed = Number(reservation.allowed) || 0;
      if (!allowed) {
        throw new Error(
          reservation.error ||
            `Daily limit reached (${reservation.daily_post_limit || 0} posts/day).`
        );
      }

      const job = {
        tabId: tab.id,
        keywords: message.keywords,
        limit: allowed,
        reserved: allowed,
        userId: session?.user?.id || null
      };
      await chrome.storage.local.set({
        pendingJob: job,
        keywords: message.keywords,
        limit: allowed
      });
      await publishStatus(
        `Quota OK — fetching up to ${allowed} posts (Past 24 hours)…`,
        true,
        { quota: reservation }
      );

      const destination = searchUrl(message.keywords);
      if (sameSearchUrl(tab.url || "", destination)) {
        await beginScrape(tab.id, job);
      } else {
        await chrome.tabs.update(tab.id, { url: destination });
      }
      sendResponse({ ok: true, allowed, quota: reservation });
    })().catch(async (error) => {
      const message = error.message || "Could not start scrape.";
      await publishStatus(
        error.code === "EXTENSION_VERSION_MISMATCH" || error.code === "EXTENSION_VERSION_REQUIRED"
          ? message
          : `Error: ${message}`,
        false
      );
      sendResponse({
        ok: false,
        error: message,
        code: error.code,
        update_url: error.update_url,
        required_version: error.required_version,
        body: error.body
      });
    });
    return true;
  }

  if (message.type === "STOP") {
    (async () => {
      const { pendingJob } = await chrome.storage.local.get("pendingJob");
      if (pendingJob?.tabId) {
        try {
          await chrome.tabs.sendMessage(pendingJob.tabId, { type: "STOP_SCRAPE" });
          await publishStatus("Stopping…", true);
        } catch {
          // Content script not running yet (search page still loading).
          if (pendingJob.reserved) await refundQuota(pendingJob.reserved).catch(() => {});
          await chrome.storage.local.remove("pendingJob");
          await publishStatus("Stopped", false);
        }
      } else {
        await publishStatus("Stopped", false);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "SCRAPE_PROGRESS") {
    (async () => {
      const { pendingJob } = await chrome.storage.local.get("pendingJob");
      const postsCollected = Number(message.postsCollected);
      if (!message.running && pendingJob?.reserved) {
        const used = Number.isFinite(postsCollected) ? postsCollected : pendingJob.reserved;
        const unused = Math.max(0, pendingJob.reserved - used);
        if (unused > 0) {
          await refundQuota(unused).catch(() => {});
        }
        await chrome.storage.local.remove("pendingJob");
      } else if (!message.running) {
        await chrome.storage.local.remove("pendingJob");
      }
      await publishStatus(message.message, message.running, {
        postsCollected: Number.isFinite(postsCollected) ? postsCollected : undefined
      });
    })().catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url?.startsWith(SEARCH_PREFIX)) return;
  const { pendingJob } = await chrome.storage.local.get("pendingJob");
  if (!pendingJob || pendingJob.tabId !== tabId) return;
  await publishStatus("LinkedIn loaded; reading past-24h posts…", true);
  await beginScrape(tabId, pendingJob);
});
