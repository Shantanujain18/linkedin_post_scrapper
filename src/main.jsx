import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { fetchQuota, fetchRequiredExtensionVersion } from "./api.js";
import { getStoredSession, signIn, signOut } from "./auth.js";
import { API_BASE_URL, IS_PRODUCTION_API } from "./config.js";
import { getExtensionVersion } from "./version.js";
import "./styles.css";

const PHASES = [
  { id: "scraping", label: "Scraping" },
  { id: "uploading", label: "Uploading" },
  { id: "writing", label: "Writing emails" },
  { id: "done", label: "Done" }
];

function phaseIndex(phase) {
  const idx = PHASES.findIndex((item) => item.id === phase);
  return idx >= 0 ? idx : -1;
}

function UpdateRequired({ versionInfo }) {
  const required = versionInfo?.required_version || "latest";
  const installed = versionInfo?.installed_version || getExtensionVersion();
  const updateUrl = versionInfo?.update_url || "";
  const message =
    versionInfo?.message ||
    `ReachPod ${required} is required. You have ${installed || "an older build"}.`;

  return (
    <section className="update-banner" role="alert">
      <strong>Update required</strong>
      <p>{message}</p>
      <p className="hint">
        Installed <code>{installed || "unknown"}</code> · Required <code>{required}</code>
      </p>
      {updateUrl ? (
        <a className="update-link" href={updateUrl} target="_blank" rel="noreferrer">
          Install updated version
        </a>
      ) : (
        <p className="hint">Ask your ReachPod admin for the latest extension install link.</p>
      )}
    </section>
  );
}

function PipelineProgress({ phase, postsCollected, scrapeLimit, running }) {
  if (!phase || phase === "idle" || phase === "error") return null;
  const active = phaseIndex(phase);
  const limit = Math.max(1, Number(scrapeLimit) || 1);
  const collected = Math.max(0, Number(postsCollected) || 0);
  const scrapePct =
    phase === "scraping" ? Math.min(100, Math.round((collected / limit) * 100)) : phase === "done" || active > 0 ? 100 : 0;

  return (
    <section className="pipeline" aria-live="polite">
      <ol className="pipeline-steps">
        {PHASES.map((item, index) => {
          let state = "todo";
          if (phase === "done" || index < active) state = "done";
          else if (index === active && running) state = "active";
          else if (index === active && phase === "done") state = "done";
          return (
            <li key={item.id} className={`pipeline-step ${state}`}>
              <span className="pipeline-dot" aria-hidden="true" />
              <span>{item.label}</span>
            </li>
          );
        })}
      </ol>
      {(phase === "scraping" || collected > 0) && phase !== "done" ? (
        <div className="scrape-progress">
          <div className="scrape-progress-row">
            <span>Posts</span>
            <strong>
              {collected}
              {phase === "scraping" ? ` / ${limit}` : ""}
            </strong>
          </div>
          <div className="quota-bar">
            <div className="quota-fill" style={{ width: `${scrapePct}%` }} />
          </div>
        </div>
      ) : null}
      {phase === "uploading" || phase === "writing" ? (
        <div className="quota-bar indeterminate" aria-hidden="true">
          <div className="quota-fill" />
        </div>
      ) : null}
    </section>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [keywords, setKeywords] = useState("hiring python");
  const [limit, setLimit] = useState(50);
  const [status, setStatus] = useState("Ready");
  const [running, setRunning] = useState(false);
  const [quota, setQuota] = useState(null);
  const [quotaError, setQuotaError] = useState("");
  const [versionInfo, setVersionInfo] = useState(null);
  const [versionBlocked, setVersionBlocked] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [postsCollected, setPostsCollected] = useState(0);
  const [scrapeLimit, setScrapeLimit] = useState(0);
  const [draftsCreated, setDraftsCreated] = useState(null);

  async function checkVersion() {
    try {
      const data = await fetchRequiredExtensionVersion();
      setVersionInfo(data);
      setVersionBlocked(!data.up_to_date);
      return data;
    } catch (error) {
      setVersionInfo({
        installed_version: getExtensionVersion(),
        required_version: "",
        update_url: "",
        message: error.message,
        up_to_date: true
      });
      setVersionBlocked(false);
      return null;
    }
  }

  async function loadQuota() {
    setQuotaError("");
    try {
      const data = await fetchQuota();
      setQuota(data);
      setVersionBlocked(false);
      setLimit((current) => {
        const remaining = Number(data.remaining) || 0;
        if (!remaining) return 0;
        return Math.min(Math.max(1, current || remaining), remaining, 500);
      });
    } catch (error) {
      setQuota(null);
      if (error.code === "EXTENSION_VERSION_MISMATCH" || error.code === "EXTENSION_VERSION_REQUIRED") {
        setVersionBlocked(true);
        setVersionInfo({
          installed_version: error.installed_version || getExtensionVersion(),
          required_version: error.required_version || "",
          update_url: error.update_url || "",
          message: error.message,
          up_to_date: false
        });
        setQuotaError("");
      } else {
        setQuotaError(error.message || "Could not load quota.");
      }
    }
  }

  useEffect(() => {
    (async () => {
      await checkVersion();
      const stored = await getStoredSession();
      setSession(stored);
      setAuthReady(true);
      if (stored) await loadQuota();
    })();

    chrome.storage.local.get(["keywords", "limit", "scrapeStatus"]).then((state) => {
      if (state.keywords) setKeywords(state.keywords);
      if (state.limit) setLimit(state.limit);
      if (state.scrapeStatus) {
        setStatus(state.scrapeStatus.message || "Ready");
        setRunning(Boolean(state.scrapeStatus.running));
        if (state.scrapeStatus.phase) setPhase(state.scrapeStatus.phase);
        if (Number.isFinite(state.scrapeStatus.postsCollected)) {
          setPostsCollected(state.scrapeStatus.postsCollected);
        }
        if (Number.isFinite(state.scrapeStatus.scrapeLimit)) {
          setScrapeLimit(state.scrapeStatus.scrapeLimit);
        }
        if (Number.isFinite(state.scrapeStatus.draftsCreated)) {
          setDraftsCreated(state.scrapeStatus.draftsCreated);
        }
      }
    });

    const listener = (message) => {
      if (message.type !== "STATUS") return;
      setStatus(message.message);
      setRunning(Boolean(message.running));
      if (message.phase) setPhase(message.phase);
      if (Number.isFinite(message.postsCollected)) setPostsCollected(message.postsCollected);
      if (Number.isFinite(message.scrapeLimit)) setScrapeLimit(message.scrapeLimit);
      if (Number.isFinite(message.draftsCreated)) setDraftsCreated(message.draftsCreated);
      if (message.quota) setQuota((prev) => ({ ...(prev || {}), ...message.quota }));
      if (!message.running) loadQuota().catch(() => {});
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function onSignIn(event) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const next = await signIn(email, password);
      setSession(await getStoredSession());
      setPassword("");
      await checkVersion();
      await loadQuota();
      setStatus(`Signed in as ${next.user?.email || "ReachPod user"}`);
    } catch (error) {
      setAuthError(error.message || "Sign in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function onSignOut() {
    setAuthBusy(true);
    try {
      await signOut();
      setSession(null);
      setQuota(null);
      setStatus("Signed out");
      setPhase("idle");
    } finally {
      setAuthBusy(false);
    }
  }

  async function start() {
    const normalizedKeywords = keywords.trim();
    const normalizedLimit = Number(limit);
    if (versionBlocked) return setStatus("Update the ReachPod extension to continue.");
    if (!session) return setStatus("Sign in to ReachPod first.");
    if (!quota?.ready?.has_resume) return setStatus("Upload your resume in ReachPod before scraping.");
    if (!normalizedKeywords) return setStatus("Enter at least one search keyword.");
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 500) {
      return setStatus("Post limit must be between 1 and 500.");
    }
    if (quota && quota.remaining <= 0) {
      return setStatus(`Daily limit reached (${quota.daily_post_limit} posts/day).`);
    }

    setRunning(true);
    setPhase("scraping");
    setPostsCollected(0);
    setDraftsCreated(null);
    setScrapeLimit(Math.min(normalizedLimit, quota?.remaining || normalizedLimit));
    setStatus("Reserving daily quota…");
    const response = await chrome.runtime.sendMessage({
      type: "START",
      keywords: normalizedKeywords,
      limit: Math.min(normalizedLimit, quota?.remaining || normalizedLimit)
    });
    if (!response?.ok) {
      setRunning(false);
      setPhase("error");
      setStatus(response?.error || "Could not start the scraper.");
      if (/update|version/i.test(response?.error || "")) {
        await checkVersion();
        setVersionBlocked(true);
      }
      await loadQuota();
    }
  }

  async function stop() {
    setStatus("Stopping…");
    await chrome.runtime.sendMessage({ type: "STOP" });
  }

  function openPortal(page) {
    const url = `${API_BASE_URL}/dashboard?page=${page}`;
    chrome.tabs.create({ url });
  }

  const envHint = (
    <p className="hint muted-version">
      Extension v{getExtensionVersion()} · {IS_PRODUCTION_API ? "Production" : "Local"} · {API_BASE_URL}
    </p>
  );

  if (!authReady) {
    return (
      <main>
        <h1>ReachPod</h1>
        <p className="hint">Loading…</p>
      </main>
    );
  }

  if (versionBlocked) {
    return (
      <main>
        <h1>ReachPod</h1>
        <p className="subtitle">v{getExtensionVersion()}</p>
        <UpdateRequired versionInfo={versionInfo} />
        {session ? (
          <div className="buttons single">
            <button type="button" className="secondary" onClick={onSignOut} disabled={authBusy}>
              Sign out
            </button>
          </div>
        ) : null}
        {envHint}
      </main>
    );
  }

  if (!session) {
    return (
      <main>
        <h1>ReachPod</h1>
        <p className="subtitle">Sign in with your ReachPod account to scrape LinkedIn posts.</p>
        <form onSubmit={onSignIn}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {authError ? <p className="error">{authError}</p> : null}
          <div className="buttons single">
            <button type="submit" disabled={authBusy}>
              {authBusy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
        <p className="hint">
          Use the same email/password as the ReachPod web app. Create an account there if you do not
          have one yet.
        </p>
        {envHint}
      </main>
    );
  }

  const remaining = quota ? Number(quota.remaining) : null;
  const used = quota ? Number(quota.posts_fetched_today) : null;
  const dailyLimit = quota ? Number(quota.daily_post_limit) : null;
  const hasResume = Boolean(quota?.ready?.has_resume);
  const pipelineDone = phase === "done" && !running;
  const canStart = hasResume && remaining !== 0 && !running;

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>ReachPod</h1>
          <p className="account">{session.user?.email || "Signed in"}</p>
        </div>
        <button type="button" className="secondary compact" onClick={onSignOut} disabled={authBusy || running}>
          Sign out
        </button>
      </header>

      <section className="quota" aria-live="polite">
        {quotaError ? (
          <p className="error">{quotaError}</p>
        ) : quota ? (
          <>
            <div className="quota-row">
              <span>Today&apos;s posts</span>
              <strong>
                {used} / {dailyLimit}
              </strong>
            </div>
            <div className="quota-bar">
              <div
                className="quota-fill"
                style={{
                  width: `${dailyLimit ? Math.min(100, (used / dailyLimit) * 100) : 0}%`
                }}
              />
            </div>
            <p className="hint">
              {remaining === 0
                ? "Daily free-plan limit reached. Ask an admin to raise your limit if you upgraded."
                : `${remaining} remaining on the ${quota.plan || "free"} plan.`}
            </p>
          </>
        ) : (
          <p className="hint">Loading quota…</p>
        )}
      </section>

      {!hasResume && quota ? (
        <section className="prereq-banner" role="alert">
          <p>Upload your resume in ReachPod before scraping — we need it to write emails.</p>
          <button type="button" className="secondary compact" onClick={() => openPortal("profile")}>
            Open Your profile
          </button>
        </section>
      ) : null}

      <label htmlFor="keywords">Search keywords</label>
      <input
        id="keywords"
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        autoComplete="off"
        disabled={!canStart}
      />
      <label htmlFor="limit">Maximum posts</label>
      <input
        id="limit"
        type="number"
        value={limit}
        min="1"
        max={remaining != null ? Math.max(1, remaining) : 500}
        onChange={(event) => setLimit(Number(event.target.value))}
        disabled={!canStart}
      />
      <div className="buttons">
        <button type="button" onClick={start} disabled={!canStart}>
          Search and prepare emails
        </button>
        <button type="button" className="secondary" onClick={stop} disabled={!running || phase !== "scraping"}>
          Stop
        </button>
      </div>

      <PipelineProgress
        phase={phase}
        postsCollected={postsCollected}
        scrapeLimit={scrapeLimit || limit}
        running={running}
      />

      <p id="status" role="status">
        {status}
      </p>

      {pipelineDone ? (
        <div className="buttons single">
          <button type="button" onClick={() => openPortal("send")}>
            Open Send emails
            {draftsCreated != null ? ` (${draftsCreated})` : ""}
          </button>
        </div>
      ) : null}

      <p className="hint">
        Searches LinkedIn Posts from the past 24 hours, saves them to ReachPod, and writes drafts.
        Keep the LinkedIn tab open while scraping.
      </p>
      {envHint}
    </main>
  );
}

createRoot(document.querySelector("#root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
