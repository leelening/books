// Shared "is this a classic?" heuristic.
// Runs unchanged in the browser (app.js) and in Node (script./add-book.js),
// so what a visitor sees as a preview is exactly what the Action decides.
//
// Input: one document from https://openlibrary.org/search.json
// Output: { verdict: "pass" | "review" | "reject", score, reasons: string[] }

export const TOPICS = [
  "Algorithms & Theory",
  "Programming Languages",
  "Software Engineering",
  "Systems",
  "AI & Machine Learning",
  "Robotics",
  "Control & Optimization",
  "Mathematics",
];

export const PASS_SCORE = 6;
export const REVIEW_SCORE = 3;
export const MIN_AGE_YEARS = 5;

const KNOWN_PUBLISHERS = [
  "mit press", "addison-wesley", "addison wesley", "pearson", "prentice hall", "prentice-hall",
  "springer", "cambridge university press", "oxford university press", "princeton university press",
  "o'reilly", "oreilly", "wiley", "morgan kaufmann", "elsevier", "academic press", "crc press",
  "chapman and hall", "chapman & hall", "athena scientific", "siam", "mcgraw-hill", "mcgraw hill",
  "no starch", "manning", "pragmatic bookshelf", "pragmatic programmers", "dover", "birkhäuser", "birkhauser",
  "world scientific", "now publishers", "microsoft press", "apress", "cengage", "brooks/cole", "thomson",
  "w. h. freeman", "freeman", "benjamin/cummings", "benjamin cummings", "jones and bartlett", "jones & bartlett",
  "bell telephone laboratories", "at&t", "green tea press", "createspace", "lulu",
];

// Subjects / titles that mark a book as in-scope for this library.
export const TOPIC_PATTERN = new RegExp(
  [
    "computer", "software", "programming", "algorithm", "data structure", "robot", "machine learning",
    "artificial intelligence", "neural", "deep learning", "reinforcement", "control theory", "control system",
    "feedback", "optimi[sz]ation", "operating system", "compiler", "database", "network", "distributed",
    "cryptograph", "automata", "computation", "complexity", "linear algebra", "probabilit", "statistic",
    "mathematic", "discrete", "kinematic", "dynamic", "estimation", "kalman", "computer vision",
    "image processing", "motion planning", "manipulat", "autonomous", "embedded", "logic", "information theory",
    "game theory", "multi-?agent", "formal method", "model checking", "verification", "c\\+\\+", "python",
    "java", "unix", "linux", "architecture", "parallel", "concurren", "systems engineering", "mechatronic",
    "signal processing", "numerical", "graph theory", "combinatori",
  ].join("|"),
  "i",
);

// Subjects that take a book out of scope even if the title mentions robots or computers.
export const OUT_OF_SCOPE_PATTERN = /\b(fiction|novel|juvenile|children|comics?|graphic novel|poetry|short stories|fantasy|manga|romance|thriller|mystery|biograph|memoir|humou?r|cookbook|cooking|travel|self-help)\b/i;

function yearsSince(year) {
  const now = new Date().getFullYear();
  return year ? now - year : 0;
}

export function assessBook(doc) {
  const reasons = [];
  let score = 0;

  const title = doc.title || "";
  const subjects = Array.isArray(doc.subject) ? doc.subject : [];
  const publishers = Array.isArray(doc.publisher) ? doc.publisher : [];
  const year = Number(doc.first_publish_year) || 0;
  const editions = Number(doc.edition_count) || 0;
  const readers = (Number(doc.readinglog_count) || 0) + (Number(doc.want_to_read_count) || 0);
  const ratings = Number(doc.ratings_count) || 0;
  const avg = Number(doc.ratings_average) || 0;
  const pages = Number(doc.number_of_pages_median) || 0;

  // 1. Scope: must look like CS / robotics / the maths behind them.
  //    Subjects decide; the title alone only counts when Open Library has no subjects.
  const subjectText = subjects.slice(0, 80).join(" | ");
  if (OUT_OF_SCOPE_PATTERN.test(subjectText)) {
    return { verdict: "reject", score: 0, reasons: ["Catalogued as fiction or another non-technical genre on Open Library."] };
  }
  const inScope = subjects.length ? TOPIC_PATTERN.test(subjectText) : TOPIC_PATTERN.test(title);
  if (!inScope) {
    return {
      verdict: "reject",
      score: 0,
      reasons: ["Does not look like a computer science, robotics or supporting-mathematics book (no matching subjects)."],
    };
  }

  // 2. Age — a classic has had time to prove itself.
  const age = yearsSince(year);
  if (!year) {
    reasons.push("No first-publication year on record.");
  } else if (age >= 20) {
    score += 3; reasons.push(`First published ${year} — ${age} years in print.`);
  } else if (age >= 10) {
    score += 2; reasons.push(`First published ${year} — ${age} years in print.`);
  } else if (age >= MIN_AGE_YEARS) {
    score += 1; reasons.push(`First published ${year} — only ${age} years old.`);
  } else {
    reasons.push(`First published ${year} — too recent to be called a classic yet.`);
  }

  // 3. Editions — reprints and new editions are the strongest signal of staying power.
  if (editions >= 12) { score += 3; reasons.push(`${editions} editions on Open Library.`); }
  else if (editions >= 6) { score += 2; reasons.push(`${editions} editions on Open Library.`); }
  else if (editions >= 3) { score += 1; reasons.push(`${editions} editions on Open Library.`); }
  else reasons.push(`Only ${editions || 1} edition${editions === 1 ? "" : "s"} on Open Library.`);

  // 4. Readership on Open Library.
  if (readers >= 300) { score += 2; reasons.push(`${readers} readers have it on their Open Library shelves.`); }
  else if (readers >= 50) { score += 1; reasons.push(`${readers} readers have it on their Open Library shelves.`); }

  // 5. Ratings.
  if (ratings >= 20 && avg >= 4.2) { score += 2; reasons.push(`Rated ${avg.toFixed(1)}/5 by ${ratings} readers.`); }
  else if (ratings >= 5 && avg >= 3.9) { score += 1; reasons.push(`Rated ${avg.toFixed(1)}/5 by ${ratings} readers.`); }
  else if (ratings >= 5 && avg < 3.5) { score -= 1; reasons.push(`Rated only ${avg.toFixed(1)}/5 by ${ratings} readers.`); }

  // 6. Publisher.
  const pubs = publishers.map((p) => String(p).toLowerCase());
  const known = pubs.find((p) => KNOWN_PUBLISHERS.some((k) => p.includes(k)));
  if (known) { score += 1; reasons.push(`Published by ${publishers[pubs.indexOf(known)]}.`); }

  // 7. Substance.
  if (pages >= 200) { score += 1; }
  else if (pages && pages < 120) { score -= 1; reasons.push(`Only ~${pages} pages.`); }

  let verdict;
  if (score >= PASS_SCORE && age >= MIN_AGE_YEARS) verdict = "pass";
  else if (score >= REVIEW_SCORE) verdict = "review";
  else verdict = "reject";

  return { verdict, score, reasons };
}

// Normalise a title for duplicate detection: lower-case, drop edition/volume
// markers and parentheticals, punctuation and articles. Keeps the subtitle.
export function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(\d+(st|nd|rd|th)\s+ed(ition)?|volume\s+\w+|vol\.?\s*\w+)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an|of|to|and|in|for|on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The part before a colon / dash, normalised.
export function mainTitle(t) {
  return normalizeTitle(String(t || "").replace(/[:\-–—].*$/, ""));
}

function surnames(authors) {
  return new Set((authors || []).map((a) => String(a).trim().toLowerCase().split(/\s+/).pop()).filter((x) => x && x.length > 2));
}

// A candidate duplicates an existing entry when it shares an Open Library key
// or ISBN, has the same full title, or has the same main title AND an author
// in common ("Refactoring" by Fowler matches "Refactoring: Improving the
// Design..." by Fowler; "Robotics" by Fu does not match "Robotics" by Siciliano).
export function isDuplicate(candidate, books) {
  const key = candidate.key || candidate.ol;
  const full = normalizeTitle(candidate.title);
  const main = mainTitle(candidate.title);
  const isbns = new Set((candidate.isbn || []).map(String));
  const names = surnames(candidate.authors || candidate.author_name);
  return books.find((b) => {
    if (key && b.ol && b.ol === key) return true;
    if (b.isbn && b.isbn.some((i) => isbns.has(String(i)))) return true;
    if (full && normalizeTitle(b.title) === full) return true;
    if (main && mainTitle(b.title) === main) {
      const theirs = surnames(b.authors);
      for (const n of names) if (theirs.has(n)) return true;
    }
    return false;
  }) || null;
}
