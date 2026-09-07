import { assessBook, isDuplicate, TOPICS } from "./scripts/quality-gate.js";

const REPO = "leelening/computer_science_books";
const OL_SEARCH = "https://openlibrary.org/search.json";
const OL_FIELDS = "key,title,author_name,first_publish_year,edition_count,publisher,subject,ratings_average,ratings_count,readinglog_count,want_to_read_count,number_of_pages_median,cover_i,isbn";

// One colour pair per topic — used for the generated cover tiles and topic labels.
const PALETTE = {
  "Algorithms & Theory":     ["#5b4bd6", "#2c2380", "#5b4bd6"],
  "Programming Languages":   ["#d97a1f", "#7a3d05", "#b8621a"],
  "Software Engineering":    ["#0e8a7d", "#0a4f48", "#0e8a7d"],
  "Systems":                 ["#5c6b7a", "#2c3640", "#5c6b7a"],
  "AI & Machine Learning":   ["#c23a8c", "#6d1a4c", "#c23a8c"],
  "Robotics":                ["#1f6feb", "#0b3a80", "#1f6feb"],
  "Control & Optimization":  ["#b0341e", "#5e1a0c", "#b0341e"],
  "Mathematics":             ["#7a8a12", "#3d4508", "#6d7b10"],
};

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = { books: [], topic: "All", q: "", onlineTimer: null, onlineAbort: null };

// ---------- boot ----------
async function boot() {
  const data = await (await fetch("books.json", { cache: "no-cache" })).json();
  state.books = data.books;

  const params = new URLSearchParams(location.search);
  state.q = params.get("q") || "";
  state.topic = TOPICS.includes(params.get("topic")) ? params.get("topic") : "All";
  $("#q").value = state.q;

  renderChips();
  render();

  $("#q").addEventListener("input", (e) => { state.q = e.target.value; syncUrl(); render(); });
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; state.q = ""; syncUrl(); render(); } });
  if (!state.q) $("#q").focus({ preventScroll: true });
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.topic !== "All") p.set("topic", state.topic);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

// ---------- topic chips ----------
function renderChips() {
  const box = $("#chips"); box.innerHTML = "";
  const counts = Object.fromEntries(TOPICS.map((t) => [t, 0]));
  for (const b of state.books) counts[b.topic] = (counts[b.topic] || 0) + 1;
  const mk = (label, n) => {
    const c = el("button", "chip"); c.type = "button"; c.setAttribute("role", "tab");
    c.append(label, Object.assign(el("span", "n", n), {}));
    c.setAttribute("aria-selected", String(state.topic === label));
    c.onclick = () => { state.topic = label; syncUrl(); renderChips(); render(); };
    return c;
  };
  box.append(mk("All", state.books.length));
  for (const t of TOPICS) if (counts[t]) box.append(mk(t, counts[t]));
}

// ---------- local search ----------
function tokens(q) { return q.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 1); }

function score(book, toks) {
  if (!toks.length) return 1;
  const title = book.title.toLowerCase();
  const authors = book.authors.join(" ").toLowerCase();
  const tags = (book.tags || []).join(" ").toLowerCase();
  const why = (book.why || "").toLowerCase();
  const topic = book.topic.toLowerCase();
  let s = 0;
  for (const t of toks) {
    if (title.includes(t)) s += title.startsWith(t) ? 6 : 4;
    else if (authors.includes(t)) s += 4;
    else if (tags.includes(t)) s += 3;
    else if (topic.includes(t)) s += 2;
    else if (why.includes(t)) s += 1;
    else return 0; // every token must hit somewhere
  }
  return s;
}

function highlight(text, toks) {
  if (!toks.length) return esc(text);
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return esc(text).replace(re, "<mark>$1</mark>");
}

function render() {
  const toks = tokens(state.q);
  const pool = state.topic === "All" ? state.books : state.books.filter((b) => b.topic === state.topic);
  const hits = pool.map((b) => [score(b, toks), b]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || a[1].year - b[1].year);

  const out = $("#results"); out.innerHTML = "";
  $("#count").textContent = toks.length ? `${hits.length} of ${pool.length}` : `${pool.length} books`;

  if (!hits.length) {
    const e = el("div", "empty");
    e.innerHTML = `Nothing in the library matches <strong>${esc(state.q)}</strong>${state.topic !== "All" ? ` under ${esc(state.topic)}` : ""}.`;
    out.append(e);
    scheduleOnline(state.q.trim());
    return;
  }
  hideOnline();

  if (!toks.length) {
    // Browsing: group by topic in canonical order, chronological within a topic.
    for (const t of TOPICS) {
      const group = hits.filter(([, b]) => b.topic === t).map(([, b]) => b).sort((a, b) => a.year - b.year);
      if (!group.length) continue;
      out.append(el("h2", "group-title", t));
      const g = el("div", "grid grouped"); for (const b of group) g.append(card(b, toks)); out.append(g);
    }
  } else {
    const g = el("div", "grid"); for (const [, b] of hits) g.append(card(b, toks)); out.append(g);
  }
}

function card(b, toks) {
  const node = $("#card-tpl").content.firstElementChild.cloneNode(true);
  const [c1, c2, tc] = PALETTE[b.topic] || ["#555", "#222", "#555"];
  node.style.setProperty("--c1", c1); node.style.setProperty("--c2", c2); node.style.setProperty("--tc", tc);

  const cover = $(".cover", node);
  cover.textContent = shortTitle(b.title);
  if (b.cover) { const img = new Image(); img.src = `https://covers.openlibrary.org/b/id/${b.cover}-M.jpg`; img.alt = ""; img.loading = "lazy"; img.onerror = () => img.remove(); cover.append(img); }

  $(".card-topic", node).textContent = b.topic;
  $(".card-title", node).innerHTML = highlight(b.title, toks);
  const meta = [b.authors.join(", "), b.edition ? `${b.edition}` : (b.year ? `${b.year}` : "")].filter(Boolean).join(" · ");
  $(".card-meta", node).innerHTML = highlight(meta, toks);
  $(".card-why", node).textContent = b.why;

  const links = $(".card-links", node);
  const L = b.links || {};
  if (L.free) links.append(link(L.free, "Read free", "lnk free ext"));
  if (L.official) links.append(link(L.official, /link\.springer|mitpress|pearson|pragprog|oreilly|wiley|athenasc|cambridge/.test(L.official) ? "Publisher" : "Official site", "lnk ext"));
  links.append(link(L.openlibrary || `https://openlibrary.org/search?q=${encodeURIComponent(`${b.title} ${b.authors[0] || ""}`)}`, "Open Library", "lnk ext"));
  return node;
}

function link(href, text, cls) { const a = el("a", cls, text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }
function shortTitle(t) { const s = t.replace(/[:(].*$/, "").trim(); return s.length > 40 ? s.slice(0, 38) + "…" : s; }

// ---------- online search (Open Library) ----------
function hideOnline() {
  clearTimeout(state.onlineTimer);
  if (state.onlineAbort) { state.onlineAbort.abort(); state.onlineAbort = null; }
  $("#online").hidden = true;
}

function scheduleOnline(q) {
  clearTimeout(state.onlineTimer);
  if (state.onlineAbort) { state.onlineAbort.abort(); state.onlineAbort = null; }
  const box = $("#online");
  if (q.length < 3) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<h2>Not in the library yet</h2><p class="sub"><span class="spinner"></span>Looking up “${esc(q)}” on Open Library…</p>`;
  state.onlineTimer = setTimeout(() => searchOnline(q), 450);
}

async function searchOnline(q) {
  const box = $("#online");
  const ctrl = new AbortController(); state.onlineAbort = ctrl;
  let docs;
  try {
    const url = `${OL_SEARCH}?q=${encodeURIComponent(q)}&fields=${OL_FIELDS}&limit=8`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    docs = (await res.json()).docs || [];
  } catch (e) {
    if (e.name === "AbortError") return;
    box.innerHTML = `<h2>Not in the library yet</h2><p class="sub">Couldn't reach Open Library (${esc(e.message)}). You can still <a href="${issueUrl({ title: q })}" target="_blank" rel="noopener">suggest “${esc(q)}” directly</a>.</p>`;
    return;
  }
  if (state.onlineAbort !== ctrl) return;

  box.innerHTML = "";
  box.append(el("h2", null, "Not in the library yet"));
  if (!docs.length) {
    const p = el("p", "sub"); p.innerHTML = `Open Library has nothing for “${esc(q)}”. Try the author's surname or a shorter title, or <a href="${issueUrl({ title: q })}" target="_blank" rel="noopener">suggest it directly</a>.`;
    box.append(p); return;
  }
  const p = el("p", "sub");
  p.innerHTML = `Found on Open Library. Each result is pre-checked against the library's “classic” bar — the same check the GitHub Action runs. <strong>Add</strong> opens a pre-filled issue; you'll need a GitHub account.`;
  box.append(p);

  const list = el("div", "online-list");
  const seen = new Set();
  for (const d of docs) {
    const key = (d.title || "").toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    list.append(hit(d));
  }
  box.append(list);
}

function hit(d) {
  const row = el("div", "hit");
  const img = el("img", "thumb"); img.alt = "";
  if (d.cover_i) { img.src = `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg`; img.onerror = () => { img.removeAttribute("src"); }; }
  row.append(img);

  const body = el("div");
  const dup = isDuplicate({ key: d.key, title: d.title, isbn: d.isbn, authors: d.author_name }, state.books);
  const a = assessBook(d);
  const badge = dup ? `<span class="badge dup">Already listed</span>`
    : a.verdict === "pass" ? `<span class="badge pass">Likely classic · auto-add</span>`
    : a.verdict === "review" ? `<span class="badge review">Needs review</span>`
    : `<span class="badge reject">Not eligible</span>`;
  body.innerHTML = `
    <div class="t">${esc(d.title || "Untitled")}${badge}</div>
    <div class="m">${esc((d.author_name || []).slice(0, 3).join(", "))}${d.first_publish_year ? ` · ${d.first_publish_year}` : ""}${d.edition_count ? ` · ${d.edition_count} edition${d.edition_count === 1 ? "" : "s"}` : ""}</div>
    <ul class="reasons">${a.reasons.slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  row.append(body);

  const actions = el("div");
  if (dup) {
    const b = el("a", "btn secondary", "Show in library"); b.href = `?q=${encodeURIComponent(dup.title)}`;
    b.onclick = (e) => { e.preventDefault(); $("#q").value = dup.title; state.q = dup.title; state.topic = "All"; syncUrl(); renderChips(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    actions.append(b);
  } else if (a.verdict === "reject") {
    const b = el("button", "btn secondary", "Add"); b.disabled = true; b.title = "Doesn't meet the classic bar"; actions.append(b);
  } else {
    const b = el("a", "btn", a.verdict === "pass" ? "Add to library" : "Submit for review");
    b.href = issueUrl({ title: d.title, authors: (d.author_name || []).slice(0, 4).join(", "), year: d.first_publish_year, olkey: d.key, topic: guessTopic(d) });
    b.target = "_blank"; b.rel = "noopener";
    actions.append(b);
  }
  row.append(actions);
  return row;
}

function guessTopic(d) {
  const h = [d.title, ...(d.subject || []).slice(0, 40)].join(" ").toLowerCase();
  const rules = [
    ["Robotics", /robot|kinematic|manipulat|slam|autonomous|computer vision|motion planning/],
    ["Control & Optimization", /control|optimi[sz]ation|kalman|estimation|dynamic programming|mpc/],
    ["AI & Machine Learning", /machine learning|artificial intelligence|neural|deep learning|reinforcement|pattern recognition|statistical learning|graphical model/],
    ["Systems", /operating system|computer architecture|network|database|distributed|unix|linux|compiler/],
    ["Software Engineering", /software engineering|refactor|design pattern|agile|clean code|software development/],
    ["Programming Languages", /programming language|c\+\+|python|java\b|scheme|lisp|haskell|rust|\bgit\b/],
    ["Mathematics", /mathematic|linear algebra|probability|statistics|calculus|discrete/],
  ];
  for (const [t, re] of rules) if (re.test(h)) return t;
  return "Algorithms & Theory";
}

function issueUrl({ title, authors, year, olkey, topic, link }) {
  const p = new URLSearchParams({ template: "add-book.yml", title: `[Book] ${title || ""}`.trim() });
  if (authors) p.set("authors", authors);
  if (year) p.set("year", String(year));
  if (olkey) p.set("olkey", olkey);
  if (topic) p.set("topic", topic);
  if (link) p.set("link", link);
  return `https://github.com/${REPO}/issues/new?${p}`;
}

boot().catch((e) => { $("#results").innerHTML = `<p class="empty">Failed to load books.json: ${esc(e.message)}</p>`; });
