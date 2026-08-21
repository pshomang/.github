(() => {
  "use strict";

  const GROUP_ICONS = {
    "prompts": "📋",
    "frameworks": "🔬",
    "system-prompt-leaks": "🕵️",
    "prompt-engineering": "🧠",
    "context-engineering": "🔭",
    "agent-ecosystem": "🤖",
    "official-guides": "📖",
    "papers": "📄",
    "tools-libraries": "🛠",
  };

  const appEl = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const searchInput = document.getElementById("search-input");

  /** @type {any} */
  let DATA = null;
  /** groupSlug -> group, "groupSlug/subSlug" -> {group, sub} */
  const groupIndex = new Map();
  const subIndex = new Map();
  /** flat list for search: {item, group, sub} */
  let searchIndex = [];
  const promptTextCache = new Map();

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function plainText(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return div.textContent || "";
  }

  async function init() {
    try {
      const res = await fetch("data/index.json");
      DATA = await res.json();
    } catch (err) {
      appEl.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><p>Could not load prompt data. Make sure you're serving this folder over HTTP (not file://).</p></div>`;
      return;
    }

    for (const group of DATA.groups) {
      groupIndex.set(group.slug, group);
      for (const item of group.items) {
        searchIndex.push({ item, group, sub: null });
      }
      for (const sub of group.subcategories) {
        subIndex.set(`${group.slug}/${sub.slug}`, { group, sub });
        for (const item of sub.items) {
          searchIndex.push({ item, group, sub });
        }
      }
    }

    window.addEventListener("hashchange", route);
    route();

    let debounceTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = searchInput.value.trim();
        if (q) {
          location.hash = `#/search?q=${encodeURIComponent(q)}`;
        } else if (location.hash.startsWith("#/search")) {
          location.hash = "#/";
        }
      }, 120);
    });
  }

  function parseHash() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [pathPart, queryPart] = hash.split("?");
    const parts = pathPart.split("/").filter(Boolean);
    const query = new URLSearchParams(queryPart || "");
    return { parts, query };
  }

  function route() {
    const { parts, query } = parseHash();
    window.scrollTo({ top: 0 });

    if (parts[0] === "search") {
      searchInput.value = query.get("q") || "";
      renderSearch(query.get("q") || "");
      return;
    }

    if (searchInput.value && location.hash !== `#/search?q=${encodeURIComponent(searchInput.value)}`) {
      searchInput.value = "";
    }

    if (parts[0] === "group" && parts[1]) {
      const groupSlug = parts[1];
      if (parts[2] === "sub" && parts[3]) {
        const entry = subIndex.get(`${groupSlug}/${parts[3]}`);
        if (entry) return renderSubcategory(entry.group, entry.sub);
      } else {
        const group = groupIndex.get(groupSlug);
        if (group) return renderGroup(group);
      }
    }

    renderHome();
  }

  function crumbHtml(steps) {
    const parts = steps.map((s, i) =>
      i === steps.length - 1
        ? `<span class="current">${escapeHtml(s.label)}</span>`
        : `<a href="${s.href}">${escapeHtml(s.label)}</a>`
    );
    return `<nav class="breadcrumbs">${parts.join('<span class="sep">/</span>')}</nav>`;
  }

  // ---------------- HOME ----------------

  function renderHome() {
    const totalItems = DATA.groups.reduce(
      (n, g) => n + g.items.length + g.subcategories.reduce((m, s) => m + s.items.length, 0),
      0
    );
    const cards = DATA.groups
      .map((g) => {
        const icon = GROUP_ICONS[g.slug] || "✨";
        const count = g.itemCount ?? 0;
        return `
        <a class="group-card" href="#/group/${g.slug}">
          <span class="icon">${icon}</span>
          <h2>${escapeHtml(g.title)}</h2>
          <p>${escapeHtml(plainText(g.description) || "Browse this category.")}</p>
          <span class="card-count">${count} item${count === 1 ? "" : "s"}</span>
        </a>`;
      })
      .join("");

    appEl.innerHTML = `
      <div class="hero">
        <h1>Awesome Prompts, browsable 🪶</h1>
        <p>A searchable home for <strong>${totalItems.toLocaleString()}</strong> curated prompts, frameworks, and papers from
        <a href="https://github.com/ai-boost/awesome-prompts" target="_blank" rel="noopener noreferrer">ai-boost/awesome-prompts</a>.
        Pick a category below, or search for anything above.</p>
      </div>
      <div class="grid">${cards}</div>
    `;
  }

  // ---------------- GROUP ----------------

  function renderGroup(group) {
    appEl.innerHTML = crumbHtml([
      { label: "Home", href: "#/" },
      { label: group.title },
    ]);

    const header = `
      <div class="page-header">
        <h1>${GROUP_ICONS[group.slug] || "✨"} ${escapeHtml(group.title)} <span class="item-count">${group.itemCount} item${group.itemCount === 1 ? "" : "s"}</span></h1>
        ${group.description ? `<p>${group.description}</p>` : ""}
      </div>
    `;

    let body;
    if (group.subcategories.length > 0) {
      const cards = group.subcategories
        .map(
          (s) => `
        <a class="sub-card" href="#/group/${group.slug}/sub/${s.slug}">
          <h2>${escapeHtml(s.title)}</h2>
          ${s.description ? `<p>${escapeHtml(plainText(s.description))}</p>` : ""}
          <span class="card-count">${s.items.length} item${s.items.length === 1 ? "" : "s"}</span>
        </a>`
        )
        .join("");
      body = `<div class="grid">${cards}</div>`;
      if (group.items.length) {
        body = `<div class="items-grid">${group.items.map((it) => itemCardHtml(it)).join("")}</div>` + body;
      }
    } else {
      body = `<div class="items-grid">${group.items.map((it) => itemCardHtml(it)).join("")}</div>`;
    }

    appEl.insertAdjacentHTML("beforeend", header + body);
    wireItemActions();
  }

  // ---------------- SUBCATEGORY ----------------

  function renderSubcategory(group, sub) {
    appEl.innerHTML = crumbHtml([
      { label: "Home", href: "#/" },
      { label: group.title, href: `#/group/${group.slug}` },
      { label: sub.title },
    ]);

    const header = `
      <div class="page-header">
        <h1>${escapeHtml(sub.title)} <span class="item-count">${sub.items.length} item${sub.items.length === 1 ? "" : "s"}</span></h1>
        ${sub.description ? `<p>${sub.description}</p>` : ""}
      </div>
    `;
    const body = `<div class="items-grid">${sub.items.map((it) => itemCardHtml(it)).join("")}</div>`;
    appEl.insertAdjacentHTML("beforeend", header + body);
    wireItemActions();
  }

  // ---------------- SEARCH ----------------

  function renderSearch(q) {
    appEl.innerHTML = crumbHtml([{ label: "Home", href: "#/" }, { label: `Search: "${q}"` }]);

    if (!q) {
      appEl.insertAdjacentHTML(
        "beforeend",
        `<div class="empty-state"><div class="big">🔍</div><p>Type something above to search across all prompts, papers, and tools.</p></div>`
      );
      return;
    }

    const needle = q.toLowerCase();
    const scored = [];
    for (const entry of searchIndex) {
      const title = entry.item.title.toLowerCase();
      const desc = plainText(Object.values(entry.item.columns).join(" ")).toLowerCase();
      let score = -1;
      if (title.startsWith(needle)) score = 3;
      else if (title.includes(needle)) score = 2;
      else if (desc.includes(needle)) score = 1;
      if (score > 0) scored.push({ ...entry, score });
    }
    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));

    const header = `<div class="page-header"><h1>Search results <span class="item-count">${scored.length} match${scored.length === 1 ? "" : "es"}</span></h1></div>`;

    if (scored.length === 0) {
      appEl.insertAdjacentHTML(
        "beforeend",
        header + `<div class="empty-state"><div class="big">🫙</div><p>No matches for "${escapeHtml(q)}". Try a different term.</p></div>`
      );
      return;
    }

    const rows = scored
      .slice(0, 200)
      .map(({ item, group, sub }) => {
        const crumbHref = sub ? `#/group/${group.slug}/sub/${sub.slug}` : `#/group/${group.slug}`;
        const crumbLabel = sub ? `${group.title} · ${sub.title}` : group.title;
        return `
        <div class="result-row" data-item-id="${item.id}">
          <a class="crumb" href="${crumbHref}">${escapeHtml(crumbLabel)}</a>
          <h3>${item.emoji ? `<span class="item-emoji">${item.emoji}</span> ` : ""}${escapeHtml(item.title)}</h3>
          <p>${Object.values(item.columns)[0] || ""}</p>
          ${itemActionsHtml(item)}
        </div>`;
      })
      .join("");

    appEl.insertAdjacentHTML("beforeend", header + rows);
    wireItemActions();
  }

  // ---------------- ITEM CARD ----------------

  function itemCardHtml(item) {
    const entries = Object.entries(item.columns);
    const showLabels = entries.length > 1;
    const cols = entries
      .map(([label, html]) => `<div>${showLabels ? `<span class="col-label">${escapeHtml(label)}</span>` : ""}${html}</div>`)
      .join("");
    return `
      <article class="item-card" data-item-id="${item.id}">
        <h3>${item.emoji ? `<span class="item-emoji">${item.emoji}</span>` : ""}${item.titleUrl ? `<a href="${item.titleUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</h3>
        <div class="item-columns">${cols}</div>
        ${itemActionsHtml(item)}
      </article>`;
  }

  function itemActionsHtml(item) {
    if (item.promptFile) {
      return `<div class="item-actions"><button class="btn btn-primary" data-action="view-prompt">View prompt</button></div>`;
    }
    if (item.externalUrl) {
      return `<div class="item-actions"><a class="btn" href="${item.externalUrl}" target="_blank" rel="noopener noreferrer">Open ↗</a></div>`;
    }
    return "";
  }

  function findItemById(id) {
    for (const entry of searchIndex) {
      if (entry.item.id === id) return entry.item;
    }
    return null;
  }

  function wireItemActions() {
    appEl.querySelectorAll('[data-action="view-prompt"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-item-id]");
        const item = findItemById(card.getAttribute("data-item-id"));
        if (item) openPromptModal(item);
      });
    });
  }

  // ---------------- MODAL ----------------

  async function openPromptModal(item) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.title)}">
        <div class="modal-header">
          <div>
            <h2>${item.emoji ? `<span>${item.emoji}</span>` : ""}${escapeHtml(item.title)}</h2>
            ${Object.values(item.columns)[0] ? `<p class="modal-desc">${Object.values(item.columns)[0]}</p>` : ""}
          </div>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body"><p class="loading">Loading prompt…</p></div>
        <div class="modal-footer">
          <span class="source-note">${item.promptSourceUrl ? `<a href="${item.promptSourceUrl}" target="_blank" rel="noopener noreferrer">View source on GitHub ↗</a>` : "&nbsp;"}</span>
          <button class="btn btn-primary" data-action="copy" disabled>Copy to clipboard</button>
        </div>
      </div>
    `;
    modalRoot.appendChild(overlay);
    document.body.style.overflow = "hidden";

    const close = () => {
      overlay.remove();
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".modal-close").addEventListener("click", close);

    let text = promptTextCache.get(item.promptFile);
    if (!text) {
      try {
        const res = await fetch(item.promptFile);
        text = await res.text();
        promptTextCache.set(item.promptFile, text);
      } catch (err) {
        text = null;
      }
    }

    const body = overlay.querySelector(".modal-body");
    const copyBtn = overlay.querySelector('[data-action="copy"]');

    if (text == null) {
      body.innerHTML = `<p class="loading">Couldn't load this prompt. Try opening it on GitHub instead.</p>`;
      return;
    }

    body.innerHTML = `<pre></pre>`;
    body.querySelector("pre").textContent = text;
    copyBtn.disabled = false;
    copyBtn.addEventListener("click", async () => {
      const ok = await copyToClipboard(text);
      copyBtn.textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(() => {
        copyBtn.textContent = "Copy to clipboard";
      }, 1500);
    });
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      /* fall through to legacy path */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  init();
})();
