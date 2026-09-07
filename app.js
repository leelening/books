import { assessBook, isDuplicate, TOPICS } from "./scripts/quality-gate.js";

const REPO = "leelening/computer_science_books";
const OL_SEARCH = "https://openlibrary.org/search.json";
const OL_FIELDS = "key,title,author_name,first_publish_year,edition_count,publisher,subject,ratings_average,ratings_count,readinglog_count,want_to_read_count,number_of_pages_median,cover_i,isbn";

// One colour pair per topic — used for the generated cover tiles and topic labels.
const PALETTE = {
  "Mathematics & Foundations":       ["#3d5a80", "#3d5a80"],
  "Algorithms & Theory":             ["#4a3f8f", "#4a3f8f"],
  "Programming Languages":           ["#a85b1b", "#a85b1b"],
  "Software Engineering":            ["#1f7a6d", "#1f7a6d"],
  "Systems":                         ["#4b5563", "#4b5563"],
  "Machine Learning":                ["#9c2f6f", "#9c2f6f"],
  "AI, RL & Game Theory":            ["#7a2d8c", "#7a2d8c"],
  "Control & Optimization":          ["#a0341f", "#a0341f"],
  "Robotics: Mechanics & Control":   ["#1f5fbf", "#1f5fbf"],
  "Robotics: Perception & Planning": ["#0f766e", "#0f766e"],
};

// Deterministic small hue shift per book so a shelf of one topic isn't uniform.
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function coverColor(book) {
  const base = (PALETTE[book.topic] || ["#555"])[0];
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
  const k = ((hash(book.id) % 21) - 10) / 100; // -10% .. +10%
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
  return `rgb(${adj(r)} ${adj(g)} ${adj(b)})`;
}

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = { books: [], topic: "All", q: "", freeOnly: false, onlineTimer: null, onlineAbort: null };

// ---------- boot ----------
async function boot() {
  const data = await (await fetch("books.json", { cache: "no-cache" })).json();
  state.books = data.books;

  const params = new URLSearchParams(location.search);
  state.q = params.get("q") || "";
  state.topic = TOPICS.includes(params.get("topic")) ? params.get("topic") : "All";
  state.freeOnly = params.get("free") === "1";
  $("#q").value = state.q;
  $("#freeOnly").checked = state.freeOnly;

  const free = state.books.filter((b) => b.links?.free).length;
  $("#stats").innerHTML = `<span><b>${state.books.length}</b> books</span><span><b>${free}</b> free to read, legally</span><span><b>${TOPICS.length}</b> topics</span>`;

  renderChips();
  render();

  $("#freeOnly").addEventListener("change", (e) => { state.freeOnly = e.target.checked; syncUrl(); render(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName)) { e.preventDefault(); $("#q").focus(); $("#q").select(); }
  });

  $("#q").addEventListener("input", (e) => { state.q = e.target.value; syncUrl(); render(); });
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; state.q = ""; syncUrl(); render(); } });
  if (!state.q) $("#q").focus({ preventScroll: true });
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.topic !== "All") p.set("topic", state.topic);
  if (state.freeOnly) p.set("free", "1");
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

// ---------- topic chips ----------
function renderChips() {
  const box = $("#chips"); box.innerHTML = "";
  const counts = Object.fromEntries(TOPICS.map((t) => [t, 0]));
  for (const b of state.books) counts[b.topic] = (counts[b.topic] || 0) + 1;
  const mk = (label, n) => {
    const c = el("button", "chip"); c.type = "button"; c.setAttribute("aria-pressed", String(state.topic === label));
    c.append(el("span", null, label), el("span", "n", n));
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
  let pool = state.topic === "All" ? state.books : state.books.filter((b) => b.topic === state.topic);
  if (state.freeOnly) pool = pool.filter((b) => b.links?.free);
  const hits = pool.map((b) => [score(b, toks), b]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || a[1].year - b[1].year);

  const out = $("#results"); out.innerHTML = "";
  $("#count").textContent = toks.length ? `${hits.length} of ${pool.length} match` : `${pool.length} book${pool.length === 1 ? "" : "s"}${state.freeOnly ? " · free to read" : ""}`;

  if (!hits.length) {
    const e = el("div", "empty");
    e.innerHTML = state.q.trim()
      ? `Nothing in the library matches <strong>${esc(state.q)}</strong>${state.topic !== "All" ? ` under ${esc(state.topic)}` : ""}${state.freeOnly ? " with a free copy" : ""}.`
      : `No books here yet.`;
    out.append(e);
    if (state.q.trim()) scheduleOnline(state.q.trim()); else hideOnline();
    return;
  }
  hideOnline();

  if (!toks.length) {
    // Browsing: group by topic in canonical order, chronological within a topic.
    for (const t of TOPICS) {
      const group = hits.filter(([, b]) => b.topic === t).map(([, b]) => b).sort((a, b) => a.year - b.year);
      if (!group.length) continue;
      const sec = el("section", "group grouped");
      const head = el("div", "group-head"); head.append(el("h2", null, t), el("span", "n", `${group.length}`)); sec.append(head);
      const g = el("div", "grid"); for (const b of group) g.append(card(b, toks)); sec.append(g);
      out.append(sec);
    }
  } else {
    const g = el("div", "grid"); for (const [, b] of hits) g.append(card(b, toks)); out.append(g);
  }
}

function card(b, toks) {
  const node = $("#card-tpl").content.firstElementChild.cloneNode(true);
  const tc = (PALETTE[b.topic] || ["#555", "#555"])[1];
  node.style.setProperty("--c", coverColor(b));
  node.style.setProperty("--tc", tc);

  const L = b.links || {};
  const primary = L.free || L.official || L.openlibrary || `https://openlibrary.org/search?q=${encodeURIComponent(`${b.title} ${b.authors[0] || ""}`)}`;
  const cover = $(".cover", node); cover.href = primary;
  $(".cover-topic", node).textContent = b.topic.replace(/^Robotics: /, "");
  $(".cover-year", node).textContent = b.year || "";
  $(".cover-title", node).textContent = shortTitle(b.title);
  $(".cover-author", node).textContent = b.authors.map(surname).slice(0, 3).join(" · ");
  if (L.free) $(".ribbon", node).hidden = false;
  if (b.cover) { const img = new Image(); img.src = `https://covers.openlibrary.org/b/id/${b.cover}-M.jpg`; img.alt = ""; img.loading = "lazy"; img.onerror = () => img.remove(); cover.append(img); }

  $(".book-topic", node).textContent = b.topic; $(".book-topic", node).style.color = tc;
  $(".book-title", node).innerHTML = highlight(b.title, toks);
  const meta = [b.authors.join(", "), b.edition || (b.year ? String(b.year) : "")].filter(Boolean).join(" · ");
  $(".book-meta", node).innerHTML = highlight(meta, toks);
  $(".book-why", node).textContent = b.why;

  const links = $(".book-links", node);
  if (L.free) {
    const isPdf = /\.pdf(\?|$)/i.test(L.free);
    const a = link(L.free, isPdf ? "Free PDF" : "Read free", "lnk free ext");
    a.title = `Published by the rights holder at ${host(L.free)}`;
    links.append(a);
  }
  if (L.official) links.append(link(L.official, officialLabel(L.official), "lnk ext"));
  // Open Library is the fallback for books with no free copy and no official page.
  if (!L.free && !L.official) links.append(link(L.openlibrary || `https://openlibrary.org/search?q=${encodeURIComponent(`${b.title} ${b.authors[0] || ""}`)}`, "Open Library", "lnk ext"));
  return node;
}

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function surname(a) { return String(a).replace(/,.*$/, "").trim().split(/\s+/).pop(); }
function officialLabel(u) {
  return /link\.springer|mitpress|pearson|pragprog|oreilly|wiley|athenasc|cambridge|man7|siam/.test(u) ? "Publisher" : "Book site";
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
    ["Robotics: Perception & Planning", /slam|localization|motion planning|computer vision|state estimation|mobile robot|perception/],
    ["Robotics: Mechanics & Control", /robot|kinematic|manipulat|mechatronic|legged|humanoid/],
    ["AI, RL & Game Theory", /reinforcement|markov decision|game theory|multi-?agent|mechanism design|artificial intelligence/],
    ["Control & Optimization", /control|optimi[sz]ation|kalman|dynamic programming|mpc|feedback/],
    ["Machine Learning", /machine learning|neural|deep learning|pattern recognition|statistical learning|graphical model|bayesian/],
    ["Systems", /operating system|computer architecture|network|database|distributed|unix|linux|compiler|concurren|hardware/],
    ["Software Engineering", /software engineering|refactor|design pattern|agile|clean code|software development|reliability|project management/],
    ["Programming Languages", /programming language|c\+\+|python|java\b|scheme|lisp|haskell|rust|type system|\bgit\b/],
    ["Mathematics & Foundations", /mathematic|linear algebra|probability|statistics|calculus|discrete|numerical/],
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
