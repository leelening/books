#!/usr/bin/env node
// Runs inside the "Add book from issue" GitHub Action.
//
// 1. Reads the issue that triggered the run (GITHUB_EVENT_PATH).
// 2. Looks the book up on Open Library.
// 3. Runs the shared quality gate (script./quality-gate.js).
// 4. pass  -> appends to books.json, comments, closes the issue.
//    review -> labels `needs-review` and explains why. A maintainer can then
//              add the `approved` label, which re-runs this script and adds the
//              book unconditionally.
//    reject -> comments and closes.
//
// Env: GITHUB_EVENT_PATH, GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo)
//      BOOKS_JSON (default ./books.json)  DRY_RUN=1 skips GitHub API calls.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assessBook, isDuplicate, TOPICS, PASS_SCORE } from "./quality-gate.js";

const OL_FIELDS = [
  "key", "title", "author_name", "first_publish_year", "edition_count", "publisher", "subject",
  "ratings_average", "ratings_count", "readinglog_count", "want_to_read_count",
  "number_of_pages_median", "cover_i", "isbn",
].join(",");

const MAINTAINER_ROLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// ---------- helpers ----------
export function parseIssueForm(body) {
  // Issue forms render as "### Label\n\nvalue\n\n### Next label ..."
  const out = {};
  const parts = String(body || "").split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const label = part.slice(0, nl).trim().toLowerCase();
    let value = part.slice(nl + 1).trim();
    if (value === "_No response_") value = "";
    out[label] = value;
  }
  return {
    title: out["title"] || "",
    authors: out["authors"] || "",
    year: out["first published (year)"] || out["year"] || "",
    olkey: normalizeWorkKey(out["open library work key"] || out["open library key"] || ""),
    topic: out["topic"] || "",
    why: out["why is it a classic?"] || out["why"] || "",
    link: out["official or free link"] || out["link"] || "",
  };
}

export function normalizeWorkKey(s) {
  const m = String(s).match(/OL\d+W/i);
  return m ? `/works/${m[0].toUpperCase()}` : "";
}

export function slugify(title) {
  return String(title).toLowerCase().replace(/c\+\+/g, "cpp").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function uniqueId(base, books) {
  let id = base || "book", n = 2;
  const ids = new Set(books.map((b) => b.id));
  while (ids.has(id)) id = `${base}-${n++}`;
  return id;
}

async function olSearch(params) {
  const url = new URL("https://openlibrary.org/search.json");
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  url.searchParams.set("fields", OL_FIELDS);
  url.searchParams.set("limit", "5");
  const res = await fetch(url, { headers: { "User-Agent": "cs-books-library (github action)" } });
  if (!res.ok) throw new Error(`Open Library ${res.status} for ${url}`);
  return (await res.json()).docs || [];
}

export async function lookup(form, fetchImpl = olSearch) {
  if (form.olkey) {
    const docs = await fetchImpl({ q: `key:"${form.olkey}"` });
    if (docs[0]) return docs[0];
  }
  const docs = await fetchImpl({ title: form.title, author: form.authors.split(",")[0] });
  return docs[0] || null;
}

export function buildEntry(doc, form, books) {
  const title = form.title || doc.title;
  const links = { openlibrary: `https://openlibrary.org${doc.key}` };
  if (form.link) {
    const isFree = /\.(pdf|html?)$|free|book\b/i.test(form.link) && !/amazon|springer|mitpress|pearson|oreilly|wiley/i.test(form.link);
    links[isFree ? "free" : "official"] = form.link.trim();
  }
  const entry = {
    id: uniqueId(slugify(title), books),
    title,
    authors: form.authors ? form.authors.split(",").map((s) => s.trim()).filter(Boolean) : (doc.author_name || []).slice(0, 4),
    year: Number(form.year) || doc.first_publish_year || null,
    topic: TOPICS.includes(form.topic) ? form.topic : "Algorithms & Theory",
    tags: (doc.subject || []).slice(0, 6).map((s) => String(s).toLowerCase()),
    why: form.why || "Added via the site's online search.",
    links,
    ol: doc.key,
    source: "community",
  };
  if (doc.cover_i) entry.cover = doc.cover_i;
  if (Array.isArray(doc.isbn) && doc.isbn.length) entry.isbn = doc.isbn.slice(0, 5);
  return entry;
}

function fmtReasons(a) { return a.reasons.map((r) => `- ${r}`).join("\n"); }

// ---------- GitHub API ----------
function gh(token, repo) {
  const base = `https://api.github.com/repos/${repo}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cs-books-library" };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    comment: (n, body) => call("POST", `/issues/${n}/comments`, { body }),
    label: (n, labels) => call("POST", `/issues/${n}/labels`, { labels }),
    unlabel: (n, name) => call("DELETE", `/issues/${n}/labels/${encodeURIComponent(name)}`).catch(() => null),
    close: (n, reason = "completed") => call("PATCH", `/issues/${n}`, { state: "closed", state_reason: reason }),
  };
}

// ---------- main ----------
export async function run({ event, booksPath, api, fetchImpl }) {
  const issue = event.issue;
  const n = issue.number;
  const form = parseIssueForm(issue.body);
  const data = JSON.parse(readFileSync(booksPath, "utf8"));
  const books = data.books;

  const approved = event.action === "labeled" && event.label?.name === "approved" && MAINTAINER_ROLES.has(event.sender?.author_association || issue.author_association);

  if (!form.title && !form.olkey) {
    await api.comment(n, "I couldn't find a title in this issue. Please use the **Add a book** form.");
    await api.close(n, "not_planned");
    return { outcome: "invalid" };
  }

  const doc = await lookup(form, fetchImpl);
  if (!doc) {
    await api.comment(n, `Open Library has no record of **${form.title}**. The library only lists books that can be verified there, so I can't add it automatically. A maintainer can still add it by hand.`);
    await api.label(n, ["needs-review"]);
    return { outcome: "not-found" };
  }

  const dup = isDuplicate({ key: doc.key, title: form.title || doc.title, isbn: doc.isbn, authors: form.authors ? form.authors.split(",") : doc.author_name }, books);
  if (dup) {
    await api.comment(n, `**${dup.title}** is already in the library (id \`${dup.id}\`). Nothing to add.`);
    await api.close(n, "not_planned");
    return { outcome: "duplicate", dup };
  }

  const verdict = assessBook(doc);
  const olLink = `[${doc.title}](https://openlibrary.org${doc.key})`;

  if (verdict.verdict === "pass" || approved) {
    const entry = buildEntry(doc, form, books);
    books.push(entry);
    data.updated = new Date().toISOString().slice(0, 10);
    writeFileSync(booksPath, JSON.stringify(data, null, 2) + "\n");
    const how = approved ? "approved by a maintainer" : `passed the classic check (score ${verdict.score})`;
    await api.comment(n, `✅ Added **${entry.title}** to the library — ${how}.\n\nMatched Open Library record: ${olLink}\n\n${fmtReasons(verdict)}\n\nThe site updates within a minute or two.`);
    await api.unlabel(n, "needs-review");
    await api.label(n, ["added"]);
    await api.close(n, "completed");
    return { outcome: "added", entry, verdict };
  }

  if (verdict.verdict === "review") {
    await api.comment(n, `🔍 **${doc.title}** needs a human look (score ${verdict.score}, needs ${PASS_SCORE} to auto-add).\n\nMatched Open Library record: ${olLink}\n\n${fmtReasons(verdict)}\n\nA maintainer can add the \`approved\` label to include it anyway.`);
    await api.label(n, ["needs-review"]);
    return { outcome: "review", verdict };
  }

  await api.comment(n, `❌ **${doc.title}** doesn't meet the bar for this library (score ${verdict.score}).\n\n${fmtReasons(verdict)}\n\nThis list is deliberately small: classic, widely-used computer science and robotics books only. If you think this is wrong, a maintainer can reopen and add the \`approved\` label.`);
  await api.label(n, ["rejected"]);
  await api.close(n, "not_planned");
  return { outcome: "rejected", verdict };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const booksPath = process.env.BOOKS_JSON || "books.json";
  const dry = process.env.DRY_RUN === "1";
  const api = dry
    ? { comment: async (n, b) => console.log(`[dry] comment #${n}:\n${b}\n`), label: async (n, l) => console.log(`[dry] label #${n}: ${l}`), unlabel: async () => {}, close: async (n, r) => console.log(`[dry] close #${n} (${r})`) }
    : gh(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY);
  run({ event, booksPath, api }).then((r) => {
    console.log(`outcome: ${r.outcome}`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
