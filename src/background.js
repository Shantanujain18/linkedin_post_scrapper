import { getStoredSession, getValidAccessToken } from "./auth.js";
import { generateDrafts, pushScrapedPosts, refundQuota, reserveQuota } from "./api.js";

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

async function refundUnused(job, used) {
  if (!job?.reserved) return;
  const collected = Math.max(0, Math.floor(Number(used) || 0));
  const unused = Math.max(0, job.reserved - collected);
  if (unused > 0) await refundQuota(unused).catch(() => {});
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
    await refundUnused(job, 0);
    await chrome.storage.local.remove("pendingJob");
    await publishStatus(`Error: ${error.message}`, false, { phase: "error" });
  }
}

async function runPostScrapePipeline(posts, note) {
  const { pendingJob } = await chrome.storage.local.get("pendingJob");
  const scrapeLimit = Number(pendingJob?.limit) || posts.length;
  const postsCollected = posts.length;

  try {
    await publishStatus(note || `Uploading ${postsCollected} posts…`, true, {
      phase: "uploading",
      postsCollected,
      scrapeLimit
    });

    const upload = await pushScrapedPosts(posts);
    await refundUnused(pendingJob, postsCollected);
    await chrome.storage.local.remove("pendingJob");

    await publishStatus(
      `Uploaded ${upload.imported || postsCollected} posts (${upload.withEmails || 0} with email). Writing emails…`,
      true,
      {
        phase: "writing",
        postsCollected,
        scrapeLimit,
        imported: upload.imported,
        withEmails: upload.withEmails
      }
    );

    let drafts;
    try {
      drafts = await generateDrafts();
    } catch (draftError) {
      const msg = draftError?.message || "Could not write emails.";
      await publishStatus(
        /email/i.test(msg)
          ? `Uploaded ${upload.imported || postsCollected} posts, but none had emails to draft. Open ReachPod to review.`
          : `Uploaded posts, but writing emails failed: ${msg}`,
        false,
        {
          phase: "done",
          postsCollected,
          scrapeLimit,
          imported: upload.imported,
          withEmails: upload.withEmails,
          draftsCreated: 0
        }
      );
      return;
    }
    const created = Number(drafts.created) || 0;
    const skipped = Number(drafts.skipped) || 0;
    const pending = Number(drafts.pending) || 0;

    await publishStatus(
      created
        ? `Ready — ${created} draft${created === 1 ? "" : "s"} prepared. Open Send emails in ReachPod.`
        : `Done — no new drafts (${skipped} skipped${pending ? `, ${pending} still pending` : ""}). Check your resume/skills or open ReachPod.`,
      false,
      {
        phase: "done",
        postsCollected,
        scrapeLimit,
        imported: upload.imported,
        withEmails: upload.withEmails,
        draftsCreated: created,
        draftsSkipped: skipped,
        draftsPending: pending
      }
    );
  } catch (error) {
    const stillPending = await chrome.storage.local.get("pendingJob");
    if (stillPending.pendingJob) {
      await refundUnused(stillPending.pendingJob, postsCollected);
      await chrome.storage.local.remove("pendingJob");
    }
    await publishStatus(`Error: ${error.message || "Pipeline failed."}`, false, {
      phase: "error",
      postsCollected,
      scrapeLimit
    });
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
      await publishStatus("Checking daily post quota…", true, { phase: "scraping" });
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
        { quota: reservation, phase: "scraping", scrapeLimit: allowed, postsCollected: 0 }
      );

      const destination = searchUrl(message.keywords);
      if (sameSearchUrl(tab.url || "", destination)) {
        await beginScrape(tab.id, job);
      } else {
        await chrome.tabs.update(tab.id, { url: destination });
      }
      sendResponse({ ok: true, allowed, quota: reservation });
    })().catch(async (error) => {
      const text = error.message || "Could not start scrape.";
      await publishStatus(
        error.code === "EXTENSION_VERSION_MISMATCH" || error.code === "EXTENSION_VERSION_REQUIRED"
          ? text
          : `Error: ${text}`,
        false,
        { phase: "error" }
      );
      sendResponse({
        ok: false,
        error: text,
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
          await publishStatus("Stopping…", true, { phase: "scraping" });
        } catch {
          await refundUnused(pendingJob, 0);
          await chrome.storage.local.remove("pendingJob");
          await publishStatus("Stopped", false, { phase: "idle" });
        }
      } else {
        await publishStatus("Stopped", false, { phase: "idle" });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "SCRAPE_PROGRESS") {
    (async () => {
      const postsCollected = Number(message.postsCollected);
      if (!message.running) {
        const { pendingJob } = await chrome.storage.local.get("pendingJob");
        await refundUnused(pendingJob, Number.isFinite(postsCollected) ? postsCollected : 0);
        await chrome.storage.local.remove("pendingJob");
      }
      await publishStatus(message.message, message.running, {
        phase: message.phase || (message.running ? "scraping" : "error"),
        postsCollected: Number.isFinite(postsCollected) ? postsCollected : undefined,
        scrapeLimit: message.scrapeLimit
      });
    })().catch(() => {});
  }

  if (message.type === "SCRAPE_COMPLETE") {
    const posts = Array.isArray(message.posts) ? message.posts : [];
    runPostScrapePipeline(posts, message.message).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url?.startsWith(SEARCH_PREFIX)) return;
  const { pendingJob } = await chrome.storage.local.get("pendingJob");
  if (!pendingJob || pendingJob.tabId !== tabId) return;
  await publishStatus("LinkedIn loaded; reading past-24h posts…", true, {
    phase: "scraping",
    scrapeLimit: pendingJob.limit,
    postsCollected: 0
  });
  await beginScrape(tabId, pendingJob);
});
