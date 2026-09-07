#!/usr/bin/env node
// Fills in Open Library work keys, cover ids and ISBNs for entries that lack
// them, so the site can show real covers and dedupe reliably.
// Runs from the "Refresh metadata" workflow (manual or monthly). Idempotent.
//
//   node scripts/enrich.js            # updates books.json in place
//   node scripts/enrich.js --dry-run  # prints what it would change

import { readFileSync, writeFileSync } from "node:fs";
import { normalizeTitle } from "./quality-gate.js";

const path = process.env.BOOKS_JSON || "books.json";
const dry = process.argv.includes("--dry-run");
const data = JSON.parse(readFileSync(path, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let changed = 0;
for (const b of data.books) {
  if (b.ol && b.cover) continue;
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", b.title.replace(/[:(].*$/, "").trim());
  url.searchParams.set("author", (b.authors[0] || "").split(" ").pop());
  url.searchParams.set("fields", "key,title,author_name,cover_i,isbn,edition_count");
  url.searchParams.set("limit", "5");
  let docs = [];
  try {
    const res = await fetch(url, { headers: { "User-Agent": "cs-books-library enrich (github action)" } });
    if (res.ok) docs = (await res.json()).docs || [];
  } catch (e) { console.warn(`! ${b.title}: ${e.message}`); }
  const want = normalizeTitle(b.title);
  const doc = docs.find((d) => normalizeTitle(d.title) === want) || docs.find((d) => normalizeTitle(d.title).startsWith(want));
  if (!doc) { console.log(`- no match: ${b.title}`); await sleep(400); continue; }
  const before = JSON.stringify([b.ol, b.cover, b.isbn]);
  b.ol ||= doc.key;
  if (doc.cover_i && !b.cover) b.cover = doc.cover_i;
  if (Array.isArray(doc.isbn) && doc.isbn.length && !b.isbn) b.isbn = doc.isbn.slice(0, 5);
  if (JSON.stringify([b.ol, b.cover, b.isbn]) !== before) { changed++; console.log(`+ ${b.title} -> ${doc.key}${doc.cover_i ? ` cover ${doc.cover_i}` : ""}`); }
  await sleep(400); // be polite to Open Library
}
if (changed && !dry) {
  data.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}
console.log(`${changed} entr${changed === 1 ? "y" : "ies"} ${dry ? "would be " : ""}updated`);
