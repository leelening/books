// Offline tests for the quality gate and the issue -> books.json flow.
// Run: npm test
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessBook, isDuplicate, normalizeTitle } from "./quality-gate.js";
import { parseIssueForm, run, normalizeWorkKey } from "./add-book.js";

// --- fixtures shaped like openlibrary.org/search.json docs ---
const THRUN = { key: "/works/OL8196103W", title: "Probabilistic Robotics", author_name: ["Sebastian Thrun", "Wolfram Burgard", "Dieter Fox"],
  first_publish_year: 2005, edition_count: 7, publisher: ["MIT Press"], subject: ["Robotics", "Probabilities", "Computer science"],
  ratings_average: 4.4, ratings_count: 31, readinglog_count: 410, want_to_read_count: 300, number_of_pages_median: 647, cover_i: 1, isbn: ["9780262201629"] };
const NEWBIE = { key: "/works/OL999W", title: "Learn Rust in 24 Hours", author_name: ["Someone"], first_publish_year: 2024, edition_count: 1,
  publisher: ["Self"], subject: ["Programming", "Rust"], readinglog_count: 3, number_of_pages_median: 90 };
const COOKBOOK = { key: "/works/OL555W", title: "Tuscan Cooking", author_name: ["Chef"], first_publish_year: 1990, edition_count: 20,
  publisher: ["Random House"], subject: ["Cooking", "Italy"], number_of_pages_median: 300 };
const MID = { key: "/works/OL777W", title: "Some Decent Systems Book", author_name: ["A"], first_publish_year: 2014, edition_count: 3,
  publisher: ["Wiley"], subject: ["Computer science"], readinglog_count: 20, number_of_pages_median: 400 };

// --- quality gate ---
assert.equal(assessBook(THRUN).verdict, "pass");
assert.equal(assessBook(NEWBIE).verdict, "reject");
assert.equal(assessBook(COOKBOOK).verdict, "reject");
assert.equal(assessBook(MID).verdict, "review");
assert.equal(normalizeTitle("Introduction to Algorithms (4th ed.)"), "introduction algorithms");
assert.equal(normalizeTitle("Refactoring: Improving the Design of Existing Code"), "refactoring improving design existing code");
const ASIMOV = { key: "/works/OL1W", title: "Robot Dreams", author_name: ["Isaac Asimov"], first_publish_year: 1986, edition_count: 25,
  publisher: ["Byron Preiss"], subject: ["Science fiction", "Short stories", "Robots"], readinglog_count: 900, number_of_pages_median: 350 };
assert.equal(assessBook(ASIMOV).verdict, "reject", "fiction about robots is out of scope");
assert.equal(normalizeWorkKey("https://openlibrary.org/works/OL8196103W/Probabilistic_Robotics"), "/works/OL8196103W");

// --- issue form parsing (exactly how GitHub renders issue forms) ---
const body = `### Title

Probabilistic Robotics

### Authors

Sebastian Thrun, Wolfram Burgard, Dieter Fox

### First published (year)

2005

### Open Library work key

/works/OL8196103W

### Topic

Robotics

### Official or free link

http://www.probabilistic-robotics.org/

### Why is it a classic?

_No response_`;
const form = parseIssueForm(body);
assert.equal(form.title, "Probabilistic Robotics");
assert.equal(form.olkey, "/works/OL8196103W");
assert.equal(form.topic, "Robotics");
assert.equal(form.why, "");

// --- end-to-end against a temp books.json ---
function harness(books) {
  const dir = mkdtempSync(join(tmpdir(), "books-"));
  const p = join(dir, "books.json");
  writeFileSync(p, JSON.stringify({ books }));
  const log = { comments: [], labels: [], closed: null };
  const api = { comment: async (_, b) => log.comments.push(b), label: async (_, l) => log.labels.push(...l), unlabel: async () => {}, close: async (_, r) => (log.closed = r) };
  return { p, api, log, read: () => JSON.parse(readFileSync(p, "utf8")).books };
}
const issue = (b, extra = {}) => ({ action: "opened", issue: { number: 1, body: b, author_association: "NONE" }, ...extra });
const fetchFor = (doc) => async () => [doc];

// pass -> added + closed
{
  const h = harness([]);
  const r = await run({ event: issue(body), booksPath: h.p, api: h.api, fetchImpl: fetchFor(THRUN) });
  assert.equal(r.outcome, "added");
  const books = h.read();
  assert.equal(books.length, 1);
  assert.equal(books[0].id, "probabilistic-robotics");
  assert.equal(books[0].topic, "Robotics");
  assert.equal(books[0].links.official, "http://www.probabilistic-robotics.org/");
  assert.equal(books[0].links.openlibrary, "https://openlibrary.org/works/OL8196103W");
  assert.equal(h.log.closed, "completed");
  assert.ok(h.log.labels.includes("added"));
}
// duplicate -> nothing added
{
  const h = harness([{ id: "x", title: "Probabilistic Robotics", ol: "/works/OL8196103W" }]);
  const r = await run({ event: issue(body), booksPath: h.p, api: h.api, fetchImpl: fetchFor(THRUN) });
  assert.equal(r.outcome, "duplicate");
  assert.equal(h.read().length, 1);
}
// review -> labelled, left open; then approved by owner -> added
{
  const h = harness([]);
  const b2 = body.replace("Probabilistic Robotics", "Some Decent Systems Book").replace("/works/OL8196103W", "/works/OL777W");
  let r = await run({ event: issue(b2), booksPath: h.p, api: h.api, fetchImpl: fetchFor(MID) });
  assert.equal(r.outcome, "review");
  assert.ok(h.log.labels.includes("needs-review"));
  assert.equal(h.log.closed, null);
  r = await run({ event: { action: "labeled", label: { name: "approved" }, sender: { author_association: "OWNER" }, issue: { number: 1, body: b2, author_association: "NONE" } }, booksPath: h.p, api: h.api, fetchImpl: fetchFor(MID) });
  assert.equal(r.outcome, "added");
  assert.equal(h.read().length, 1);
}
// approved label from a random user is NOT enough
{
  const h = harness([]);
  const b2 = body.replace("/works/OL8196103W", "/works/OL777W");
  const r = await run({ event: { action: "labeled", label: { name: "approved" }, sender: { author_association: "NONE" }, issue: { number: 1, body: b2, author_association: "NONE" } }, booksPath: h.p, api: h.api, fetchImpl: fetchFor(MID) });
  assert.equal(r.outcome, "review");
}
// Open Library down -> queued, not crashed
{
  const h = harness([]);
  const r = await run({ event: issue(body), booksPath: h.p, api: h.api, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.equal(r.outcome, "error");
  assert.ok(h.log.labels.includes("needs-review"));
  assert.equal(h.log.closed, null);
}
// reject -> closed as not planned
{
  const h = harness([]);
  const r = await run({ event: issue(body.replace("/works/OL8196103W", "/works/OL999W")), booksPath: h.p, api: h.api, fetchImpl: fetchFor(NEWBIE) });
  assert.equal(r.outcome, "rejected");
  assert.equal(h.log.closed, "not_planned");
  assert.equal(h.read().length, 0);
}
// the real seed list must be valid and free of duplicates
{
  const data = JSON.parse(readFileSync(new URL("../books.json", import.meta.url), "utf8"));
  const ids = new Set();
  for (const b of data.books) {
    assert.ok(!ids.has(b.id), `duplicate id ${b.id}`); ids.add(b.id);
    assert.ok(b.title && b.authors?.length && b.topic && b.why, `incomplete entry ${b.id}`);
    for (const u of Object.values(b.links)) assert.match(u, /^https?:\/\//, `bad link in ${b.id}`);
  }
  assert.equal(isDuplicate({ title: "Introduction to Algorithms" }, data.books)?.id, "introduction-to-algorithms");
  assert.equal(isDuplicate({ title: "Refactoring", authors: ["Martin Fowler"] }, data.books)?.id, "refactoring-improving-the-design-of-existing-code");
  assert.equal(isDuplicate({ title: "Refactoring", authors: ["Someone Else"] }, data.books), null);
  assert.equal(isDuplicate({ title: "Robotics: Control, Sensing, Vision, and Intelligence", authors: ["K. S. Fu"] }, data.books), null);
  assert.equal(isDuplicate({ title: "Robotics: Modelling, Planning and Control (2nd ed.)", authors: ["Bruno Siciliano"] }, data.books)?.id, "robotics-modelling-planning-and-control");
}
console.log("all tests passed");
