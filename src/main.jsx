import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { fetchQuota, fetchRequiredExtensionVersion } from "./api.js";
import { getStoredSession, signIn, signOut } from "./auth.js";
import { API_BASE_URL, IS_PRODUCTION_API } from "./config.js";
import { getExtensionVersion } from "./version.js";
import "./styles.css";

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
      }
    });

    const listener = (message) => {
      if (message.type !== "STATUS") return;
      setStatus(message.message);
      setRunning(Boolean(message.running));
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
    } finally {
      setAuthBusy(false);
    }
  }

  async function start() {
    const normalizedKeywords = keywords.trim();
    const normalizedLimit = Number(limit);
    if (versionBlocked) return setStatus("Update the ReachPod extension to continue.");
    if (!session) return setStatus("Sign in to ReachPod first.");
    if (!normalizedKeywords) return setStatus("Enter at least one search keyword.");
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 500) {
      return setStatus("Post limit must be between 1 and 500.");
    }
    if (quota && quota.remaining <= 0) {
      return setStatus(`Daily limit reached (${quota.daily_post_limit} posts/day).`);
    }

    setRunning(true);
    setStatus("Reserving daily quota…");
    const response = await chrome.runtime.sendMessage({
      type: "START",
      keywords: normalizedKeywords,
      limit: Math.min(normalizedLimit, quota?.remaining || normalizedLimit)
    });
    if (!response?.ok) {
      setRunning(false);
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

      <label htmlFor="keywords">Search keywords</label>
      <input
        id="keywords"
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        autoComplete="off"
        disabled={running || remaining === 0}
      />
      <label htmlFor="limit">Maximum posts</label>
      <input
        id="limit"
        type="number"
        value={limit}
        min="1"
        max={remaining != null ? Math.max(1, remaining) : 500}
        onChange={(event) => setLimit(Number(event.target.value))}
        disabled={running || remaining === 0}
      />
      <div className="buttons">
        <button type="button" onClick={start} disabled={running || remaining === 0}>
          Search and export
        </button>
        <button type="button" className="secondary" onClick={stop} disabled={!running}>
          Stop
        </button>
      </div>
      <p id="status" role="status">
        {status}
      </p>
      <p className="hint">
        Searches LinkedIn Posts from the past 24 hours only. Keep the LinkedIn tab open while the
        extension scrolls.
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
