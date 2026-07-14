import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  const [keywords, setKeywords] = useState("hiring python");
  const [limit, setLimit] = useState(50);
  const [status, setStatus] = useState("Ready");
  const [running, setRunning] = useState(false);

  useEffect(() => {
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
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function start() {
    const normalizedKeywords = keywords.trim();
    const normalizedLimit = Number(limit);
    if (!normalizedKeywords) return setStatus("Enter at least one search keyword.");
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 500) {
      return setStatus("Post limit must be between 1 and 500.");
    }
    setRunning(true);
    setStatus("Opening LinkedIn search…");
    const response = await chrome.runtime.sendMessage({
      type: "START",
      keywords: normalizedKeywords,
      limit: normalizedLimit
    });
    if (!response?.ok) {
      setRunning(false);
      setStatus(response?.error || "Could not start the scraper.");
    }
  }

  async function stop() {
    setStatus("Stopping…");
    await chrome.runtime.sendMessage({ type: "STOP" });
  }

  return (
    <main>
      <h1>LinkedIn Post Scraper</h1>
      <label htmlFor="keywords">Search keywords</label>
      <input
        id="keywords"
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        autoComplete="off"
      />
      <label htmlFor="limit">Maximum posts</label>
      <input
        id="limit"
        type="number"
        value={limit}
        min="1"
        max="500"
        onChange={(event) => setLimit(Number(event.target.value))}
      />
      <div className="buttons">
        <button type="button" onClick={start} disabled={running}>Search and export</button>
        <button type="button" className="secondary" onClick={stop} disabled={!running}>Stop</button>
      </div>
      <p id="status" role="status">{status}</p>
      <p className="hint">Keep the LinkedIn tab open while the extension scrolls.</p>
    </main>
  );
}

createRoot(document.querySelector("#root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
