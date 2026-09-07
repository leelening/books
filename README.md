# Classic Computer Science & Robotics Books

**Live site:** https://leelening.github.io/computer_science_books/

A short, curated list of classic computer science and robotics books, with links to where you can read each one.

Three rules:

1. **Links only, rights respected.** No PDFs or other files are stored in this repository. A "Read free" link is added only when the copy is published by the rights holder — the author's own site, the publisher, or an open-access licence (CC BY-NC etc.). Never mirrors, never "found" PDFs. Every other entry links to the publisher's page and Open Library. If you hold rights to a linked work and want the link removed, [open an issue](https://github.com/leelening/computer_science_books/issues/new) and it will be taken down promptly.
2. **Classics only.** Books that have stayed in print, gone through editions, and are what practitioners actually recommend. Being new or popular is not enough.
3. **Computer science and robotics**, plus the mathematics and control theory that underpin them.

## Adding a book

Use the search bar on the site. If a book isn't in the library, the site looks it up on [Open Library](https://openlibrary.org), shows whether it clears the "classic" bar, and gives you an **Add to library** button. That opens a pre-filled GitHub issue (you need a GitHub account).

A GitHub Action then:

- looks the book up on Open Library and runs the same quality check (`scripts/quality-gate.js`),
- **adds it automatically** if it passes — the site updates a minute later,
- labels it `needs-review` if it's borderline; a maintainer adds the `approved` label to include it,
- closes it if it's out of scope (fiction, non-technical) or clearly not a classic.

You can also open the [issue form](https://github.com/leelening/computer_science_books/issues/new?template=add-book.yml) directly, or send a pull request editing `books.json`.

### What counts as a classic?

The heuristic scores an Open Library record on years in print, number of editions, readership and ratings, publisher, and length; it needs 6 points and at least 5 years in print to be added without review. It is a filter, not a judge — the maintainer has the last word.

## Repository layout

```
index.html, style.css, app.js     the site (static, no build step)
books.json                        the library — the only data file
scripts/quality-gate.js           "is this a classic?" — shared by the site and the Action
scripts/add-book.js               Action: issue -> Open Library -> books.json
scripts/enrich.js                 Action: fills in Open Library keys / covers / ISBNs
scripts/add-book.test.js          offline tests (npm test)
.github/ISSUE_TEMPLATE/add-book.yml   the "Add a book" form
.github/workflows/                add-book, enrich (monthly), tests
```

### Running locally

```sh
npm test            # offline tests for the gate and the Action
npm run serve       # http://localhost:8080
```

### `books.json` entry

```json
{
  "id": "probabilistic-robotics",
  "title": "Probabilistic Robotics",
  "authors": ["Sebastian Thrun", "Wolfram Burgard", "Dieter Fox"],
  "year": 2005,
  "edition": "1st ed.",
  "topic": "Robotics",
  "tags": ["SLAM", "Bayes filters"],
  "why": "One sentence on why it matters.",
  "links": { "free": "…", "official": "…", "openlibrary": "…" },
  "ol": "/works/OL8196103W",
  "cover": 8259447,
  "isbn": ["9780262201629"]
}
```

`topic` is one of: Mathematics & Foundations · Algorithms & Theory · Programming Languages · Software Engineering · Systems · Machine Learning · AI, RL & Game Theory · Control & Optimization · Robotics: Mechanics & Control · Robotics: Perception & Planning.

## Setup (one-time, for the maintainer)

1. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`.** The site is plain files at the repository root.
2. **Actions → Refresh metadata → Run workflow** once, to pull covers and Open Library keys for the seed list.
3. Optionally create the labels `add-book`, `needs-review`, `approved`, `added`, `rejected` (the Action creates them on first use).

## License

Code and `books.json` are MIT. Book titles, descriptions and links refer to works that belong to their authors and publishers; nothing is redistributed here.
