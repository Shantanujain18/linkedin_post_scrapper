(() => {
  if (globalThis.__linkedinCsvScraperInstalled) return;
  globalThis.__linkedinCsvScraperInstalled = true;
  globalThis.__linkedinCsvScraperStop = false;

  const CARD_SELECTORS = [
    "div.feed-shared-update-v2",
    "div[data-view-name='feed-full-update']",
    "[data-urn*='urn:li:activity']",
    "[data-id*='urn:li:activity']",
    "[data-chameleon-result-urn*='urn:li:activity']",
    "main [role='listitem']",
    "li.reusable-search__result-container"
  ];

  const CARD_SELECTOR = CARD_SELECTORS.join(",");

  const CONTENT_SELECTORS = [
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".feed-shared-text",
    "div[data-view-name='feed-commentary']",
    "[data-view-name='feed-commentary']",
    ".feed-shared-text-view",
    ".update-components-text-view",
    ".break-words",
    "[data-view-name='feed-commentary'] p",
    ".update-components-text p",
    "p > span",
    "p"
  ];

  const AUTHOR_LINK_SELECTORS = [
    "a.update-components-actor__meta-link",
    "a.update-components-actor__container-link",
    "a.feed-shared-actor__container-link",
    "a[data-view-name='feed-actor-image']"
  ];

  const AUTHOR_NAME_SELECTORS = [
    ".update-components-actor__name span[aria-hidden='true']",
    ".update-components-actor__name",
    ".feed-shared-actor__name span[aria-hidden='true']",
    ".feed-shared-actor__name"
  ];

  const DATE_SELECTORS = [
    ".update-components-actor__sub-description span[aria-hidden='true']",
    ".feed-shared-actor__sub-description span[aria-hidden='true']",
    "time"
  ];

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function cleanText(value) {
    return (value || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function firstElement(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const text = cleanText(element?.innerText || element?.textContent);
      if (text) return text;
    }
    return "";
  }

  function bestContentText(card, authorName) {
    const candidates = [];
    const exactBody = xpathElement(card, "./p/span") || xpathElement(card, "./p");
    if (exactBody) candidates.push(cleanText(exactBody.innerText || exactBody.textContent));

    for (const selector of CONTENT_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const text = cleanText(element.innerText || element.textContent);
        if (text) candidates.push(text);
      }
    }

    const unique = [...new Set(candidates)].filter((text) => {
      if (!text) return false;
      if (authorName && text === authorName) return false;
      // Do not select a pure author/header fragment as the post body.
      return !/^feed\s+post\s+[^\n•]+\s+•/i.test(text);
    });
    unique.sort((left, right) => right.length - left.length);
    return unique[0] || "";
  }

  function xpathElement(root, expression) {
    try {
      const result = document.evaluate(
        expression,
        root,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (_) {
      return null;
    }
  }

  function findCards() {
    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    const contentNodes = document.querySelectorAll(CONTENT_SELECTORS.join(","));
    for (const contentNode of contentNodes) {
      const card = contentNode.closest(
        "[data-urn], [data-id], [data-chameleon-result-urn], article, li, [role='listitem']"
      );
      if (card) cards.push(card);
    }

    // This fallback matches the current search-result layout where the first
    // card is rendered as a plain div and its body is a <p> containing More.
    const moreButtons = [...document.querySelectorAll("main button")].filter((button) => {
      const text = cleanText(button.innerText || button.textContent);
      const label = button.getAttribute("aria-label") || "";
      return /(?:…|\.\.\.)?\s*(?:see\s+)?more\s*$/i.test(`${text} ${label}`);
    });
    for (const button of moreButtons) {
      // In the current LinkedIn DOM: card > p > span > button.
      // This is the stable relationship represented by the supplied XPath.
      const paragraphCard = button.closest("p")?.parentElement;
      if (paragraphCard) cards.push(paragraphCard);

      let candidate = button;
      for (let level = 0; candidate && level < 12; level += 1, candidate = candidate.parentElement) {
        const text = cleanText(candidate.innerText || candidate.textContent);
        if (text.length >= 120 && text.length <= 15_000 && /feed post/i.test(text)) {
          cards.push(candidate);
          break;
        }
      }
    }

    // Keep the supplied DOM path as a last-resort anchor for the first card.
    const suppliedPath = "/html/body/div/div[2]/div[2]/div[2]/main/div/div/div/section/div/div[1]/div/div[1]/div/div/div/div[1]/div";
    try {
      const result = document.evaluate(suppliedPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (result.singleNodeValue) cards.push(result.singleNodeValue);
    } catch (_) {
      // LinkedIn can change wrapper depth; CSS and ancestor fallbacks remain active.
    }

    return [...new Set(cards)].filter((card) => firstText(card, CONTENT_SELECTORS));
  }

  function normalizeProfileUrl(href) {
    if (!href) return "";
    const url = new URL(href, location.origin);
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function postUrl(card) {
    const link = firstElement(card, [
      "a.update-components-actor__sub-description-link",
      "a.feed-shared-actor__sub-description-link",
      "a[href*='/feed/update/urn:li:activity:']",
      "a[href*='/posts/']"
    ]);
    if (link?.href) return link.href;
    const activity = (card.dataset.urn || "").match(/urn:li:activity:\d+/)?.[0];
    return activity ? `https://www.linkedin.com/feed/update/${activity}/` : "";
  }

  function authorLink(card) {
    const standard = firstElement(card, AUTHOR_LINK_SELECTORS);
    if (standard) return standard;

    // Relative form of the supplied author URL XPath:
    // card/div[1]/div/div/div[1]/div/a
    return xpathElement(card, "./div[1]/div/div/div[1]/div/a") ||
      firstElement(card, [
        "a[href*='/in/']",
        "a[href*='/company/']"
      ]);
  }

  function postedDate(card) {
    const time = card.querySelector("time");
    for (const attribute of ["datetime", "title", "aria-label"]) {
      const value = time?.getAttribute(attribute);
      if (value) return cleanText(value);
    }
    const timestampLink = firstElement(card, [
      "a.update-components-actor__sub-description-link",
      "a.feed-shared-actor__sub-description-link"
    ]);
    for (const attribute of ["aria-label", "title"]) {
      const value = timestampLink?.getAttribute(attribute);
      if (value) return cleanText(value);
    }
    const visibleDate = firstText(card, DATE_SELECTORS);
    if (visibleDate) return visibleDate;
    const cardText = cleanText(card.innerText || card.textContent);
    return cardText.match(/\b\d+\s*(?:m|h|d|w|mo|y)\b/i)?.[0] || "";
  }

  async function expandPost(card) {
    const candidates = [...card.querySelectorAll("button, span[role='button']")];
    const morePattern = /(?:…|\.\.\.)?\s*(?:see\s+)?more\s*$/i;
    const button = candidates.find((candidate) => {
      const text = cleanText(candidate.innerText || candidate.textContent);
      const label = candidate.getAttribute("aria-label") || "";
      const context = `${text} ${label}`.toLowerCase();
      return morePattern.test(text) && !/(comment|reply|reaction)/.test(context);
    });
    if (button) {
      button.click();
      await delay(150);
    }
  }

  async function extractPost(card) {
    await expandPost(card);
    const authorLinkNode = authorLink(card);
    let authorName = firstText(card, AUTHOR_NAME_SELECTORS);
    if (!authorName) authorName = cleanText(authorLinkNode?.innerText).split("\n")[0] || "";
    if (!authorName) {
      const header = cleanText(card.innerText || card.textContent);
      authorName = header.match(/feed\s+post\s+(.+?)\s+•/i)?.[1] || "";
    }
    const content = bestContentText(card, authorName);
    if (!content) return null;
    return {
      posted_by: authorName,
      posted_by_url: normalizeProfileUrl(authorLinkNode?.href),
      posted_date: postedDate(card),
      posted_content: content,
      post_url: postUrl(card),
      scraped_at: new Date().toISOString()
    };
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function downloadCsv(posts, keywords) {
    const fields = [
      "posted_by",
      "posted_by_url",
      "posted_date",
      "posted_content",
      "post_url",
      "scraped_at"
    ];
    const rows = [fields.join(",")];
    for (const post of posts) rows.push(fields.map((field) => csvCell(post[field])).join(","));
    const blob = new Blob(["\uFEFF", rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const safeKeywords = keywords.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `linkedin_${safeKeywords || "posts"}_${timestamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  async function progress(message, running = true, postsCollected) {
    await chrome.runtime.sendMessage({
      type: "SCRAPE_PROGRESS",
      message,
      running,
      postsCollected
    });
  }

  async function waitForCards(timeoutMs = 30_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (findCards().length) return;
      if (globalThis.__linkedinCsvScraperStop) throw new Error("Stopped");
      await delay(500);
    }
    const mainText = cleanText(document.querySelector("main")?.innerText).slice(0, 120);
    throw new Error(
      `No post cards found at ${location.pathname}. Page says: ${mainText || "no visible results"}`
    );
  }

  async function scrape(keywords, limit) {
    globalThis.__linkedinCsvScraperStop = false;
    await waitForCards();
    const posts = [];
    const seen = new Set();
    let stagnantScrolls = 0;
    const maxScrolls = 40;

    try {
      for (let scroll = 0; scroll <= maxScrolls && posts.length < limit; scroll += 1) {
        if (globalThis.__linkedinCsvScraperStop) throw new Error("Stopped");
        const before = posts.length;
        const cards = findCards();

        for (const card of cards) {
          if (posts.length >= limit || globalThis.__linkedinCsvScraperStop) break;
          const post = await extractPost(card);
          if (!post) continue;
          const identity = post.post_url || `${post.posted_by}|${post.posted_content.slice(0, 180)}`;
          if (seen.has(identity)) continue;
          seen.add(identity);
          posts.push(post);
          await progress(`Collected ${posts.length}/${limit}: ${post.posted_by || "Unknown author"}`, true, posts.length);
        }

        stagnantScrolls = posts.length === before ? stagnantScrolls + 1 : 0;
        if (stagnantScrolls >= 4) break;
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        await delay(2200);
      }

      if (!posts.length) throw new Error("No readable posts were found.");
      downloadCsv(posts, keywords);
      await progress(`Done — downloaded ${posts.length} posts as CSV.`, false, posts.length);
    } catch (error) {
      if (posts.length) {
        downloadCsv(posts, keywords);
        await progress(
          `${error.message} — saved ${posts.length} posts collected so far.`,
          false,
          posts.length
        );
      } else {
        await progress(`Error: ${error.message}`, false, 0);
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "STOP_SCRAPE") {
      globalThis.__linkedinCsvScraperStop = true;
      sendResponse({ ok: true });
      return;
    }
    if (message.type !== "SCRAPE") return;
    scrape(message.keywords, message.limit);
    sendResponse({ ok: true });
  });
})();
