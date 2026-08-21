# Awesome Prompts Browser

A small, static, searchable web app for browsing [ai-boost/awesome-prompts](https://github.com/ai-boost/awesome-prompts) — a curated list of prompts, frameworks, and papers — without scrolling through one huge README.

- **Home** shows the README's top-level categories (Prompts, Frameworks, Papers, …) as cards.
- Clicking a category shows its subcategories (e.g. *Coding & Development*, *Product & Strategy*) or, for flatter sections, its items directly — each with the same name/description you'd see in the README's tables.
- Items that link to a prompt file get a **View prompt** button: a modal with the full prompt text and a **copy to clipboard** button.
- Items that only link out (papers, frameworks, tools) get an **Open ↗** button instead.
- The search bar at the top filters by name and description across every category at once.

## Running it locally

This is a dependency-free static site — no build step, no npm install. Just serve the folder over HTTP (it fetches `data/index.json`, which won't work from a `file://` URL):

```bash
cd awesome-prompts-browser
python3 -m http.server 8080
# then open http://localhost:8080
```

Or with Node: `npx serve .`

## Hosting

Any static host works (GitHub Pages, Netlify, Vercel, etc.) — just point it at this folder.

## How the data is built

`data/index.json` and `data/prompts/*.txt` are generated from a local checkout of the upstream repo by `scripts/build-data.mjs`. To regenerate after the upstream README changes:

```bash
git clone --depth 1 https://github.com/ai-boost/awesome-prompts /tmp/awesome-prompts
node scripts/build-data.mjs --source /tmp/awesome-prompts
```

The script is a small, dependency-free Markdown parser (no external libraries): it walks the README's `##`/`###` headings, parses each GFM table (or, for a few prose-only sections, bullet/numbered lists and fenced code blocks) into structured items, and copies out the full text of every linked prompt file so the site can show it without hitting GitHub at runtime.

## Attribution & license

All prompts, descriptions, and curation in `data/` are sourced from [ai-boost/awesome-prompts](https://github.com/ai-boost/awesome-prompts), which is licensed under [GPL-3.0](https://github.com/ai-boost/awesome-prompts/blob/main/LICENSE). Because this app redistributes that content, it's licensed under GPL-3.0 too — see [`LICENSE`](./LICENSE). This is an independent, unofficial browser for that list, not affiliated with its maintainers.
