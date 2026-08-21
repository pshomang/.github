#!/usr/bin/env node
// Parses the ai-boost/awesome-prompts README.md into a browsable JSON index,
// and copies out the full text of every linked prompt so the site can offer
// a "view full prompt + copy" experience without hitting GitHub at runtime.
//
// Usage: node scripts/build-data.mjs --source /path/to/awesome-prompts/checkout

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { source: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") args.source = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.source) {
  console.error("Usage: node build-data.mjs --source /path/to/awesome-prompts");
  process.exit(1);
}

const SOURCE_DIR = path.resolve(args.source);
const README_PATH = path.join(SOURCE_DIR, "README.md");
const SOURCE_PROMPTS_DIR = path.join(SOURCE_DIR, "prompts");
const OUT_DATA_DIR = path.join(ROOT, "data");
const OUT_PROMPTS_DIR = path.join(OUT_DATA_DIR, "prompts");
const REPO_SLUG = "ai-boost/awesome-prompts";
const REPO_URL = `https://github.com/${REPO_SLUG}`;

if (!fs.existsSync(README_PATH)) {
  console.error(`README.md not found at ${README_PATH}`);
  process.exit(1);
}

fs.mkdirSync(OUT_PROMPTS_DIR, { recursive: true });

const raw = fs.readFileSync(README_PATH, "utf8");
const lines = raw.split(/\r?\n/);

// ---------- markdown-cell -> HTML (small, deliberately not a full parser) ----------

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMdToHtml(md) {
  let s = escapeHtml(md.trim());
  // images (badges) - do before links since both use [...]
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    return `<img class="badge" src="${src}" alt="${alt}" loading="lazy">`;
  });
  // links
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

function stripMd(md) {
  return md
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function firstLink(md) {
  const m = md.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
  if (!m) return null;
  return { text: m[1], href: m[2] };
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

// ---------- split into heading blocks ----------
// A "block" is everything between one heading and the next heading of level <= its own.

function headingLevel(line) {
  const m = line.match(/^(#{1,6})\s+(.*)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

const sections = []; // {level, title, startLine, endLine}
for (let i = 0; i < lines.length; i++) {
  const h = headingLevel(lines[i]);
  if (h && (h.level === 2 || h.level === 3)) {
    sections.push({ level: h.level, title: h.text, start: i });
  }
}
for (let i = 0; i < sections.length; i++) {
  let end = lines.length;
  for (let j = i + 1; j < sections.length; j++) {
    if (sections[j].level <= sections[i].level) {
      end = sections[j].start;
      break;
    }
  }
  sections[i].end = end;
}

// ---------- table parsing ----------

function parseTableAt(blockLines, idx) {
  // blockLines[idx] is the header row "| A | B |"
  if (!/^\|.*\|\s*$/.test(blockLines[idx])) return null;
  if (idx + 1 >= blockLines.length) return null;
  if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(blockLines[idx + 1])) return null;

  const splitRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headers = splitRow(blockLines[idx]);
  let cursor = idx + 2;
  const rows = [];
  while (cursor < blockLines.length && /^\|.*\|\s*$/.test(blockLines[cursor])) {
    rows.push(splitRow(blockLines[cursor]));
    cursor++;
  }
  return { headers, rows, nextIdx: cursor };
}

// ---------- list-based fallback (bullets / numbered) for sections with no table ----------

function parseListItems(blockLines) {
  const items = [];
  for (const line of blockLines) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (!m) continue;
    const content = m[1].trim();
    if (!content) continue;
    // Title = leading **bold** or [link] text; description = remainder after " — " / ": " / "-"
    let title = null;
    let rest = content;
    const boldStart = content.match(/^\*\*([^*]+)\*\*\s*[—:-]?\s*(.*)$/);
    const linkStart = content.match(/^\[([^\]]+)\]\(([^)\s]+)\)\s*[—:-]?\s*(.*)$/);
    let href = null;
    if (linkStart) {
      title = linkStart[1];
      href = linkStart[2];
      rest = linkStart[3];
    } else if (boldStart) {
      title = boldStart[1];
      rest = boldStart[2];
      const l = firstLink(content);
      if (l) href = l.href;
    } else {
      title = stripMd(content).slice(0, 60);
      const l = firstLink(content);
      if (l) href = l.href;
    }
    items.push({
      title: stripMd(title),
      descriptionHtml: inlineMdToHtml(rest || ""),
      href,
    });
  }
  return items;
}

// ---------- code-snippet fallback (Prompt Attack & Defense style: **Bold:** + fenced block) ----------

function parseBoldCodePairs(blockLines) {
  const items = [];
  for (let i = 0; i < blockLines.length; i++) {
    const boldOnly = blockLines[i].match(/^\*\*([^*]+)\*\*\s*$/);
    if (!boldOnly) continue;
    let j = i + 1;
    while (j < blockLines.length && blockLines[j].trim() === "") j++;
    if (j < blockLines.length && blockLines[j].trim().startsWith("```")) {
      const fenceStart = j;
      let k = j + 1;
      const codeLines = [];
      while (k < blockLines.length && !blockLines[k].trim().startsWith("```")) {
        codeLines.push(blockLines[k]);
        k++;
      }
      items.push({
        title: boldOnly[1].trim().replace(/:$/, ""),
        code: codeLines.join("\n"),
      });
      i = k;
    }
  }
  return items;
}

// ---------- build items from a table ----------

let usedIds = new Set();
function makeId(base) {
  let id = slugify(base) || "item";
  let candidate = id;
  let n = 2;
  while (usedIds.has(candidate)) {
    candidate = `${id}-${n++}`;
  }
  usedIds.add(candidate);
  return candidate;
}

const copiedPromptFiles = new Map(); // sourceRelPath -> outFileName

function localPromptPathFromUrl(url) {
  // e.g. https://github.com/ai-boost/awesome-prompts/blob/main/prompts/foo.txt
  const m = url.match(/awesome-prompts\/blob\/[^/]+\/prompts\/(.+)$/);
  if (m) return m[1];
  return null;
}

function copyPromptFile(relPath) {
  if (copiedPromptFiles.has(relPath)) return copiedPromptFiles.get(relPath);
  const srcPath = path.join(SOURCE_PROMPTS_DIR, relPath);
  if (!fs.existsSync(srcPath)) return null;
  const outName = relPath.replace(/\//g, "__");
  fs.copyFileSync(srcPath, path.join(OUT_PROMPTS_DIR, outName));
  copiedPromptFiles.set(relPath, outName);
  return outName;
}

function buildItemsFromTable(table, sectionTitle) {
  const { headers, rows } = table;
  const titleColIdx = 0;
  const promptColIdx = headers.findIndex((h) => /^prompt$/i.test(h));

  return rows.map((row) => {
    const titleCellRaw = row[titleColIdx] || "";
    const titleLink = firstLink(titleCellRaw);
    const emojiMatch = titleCellRaw.match(
      /^([\p{Emoji_Presentation}\p{Extended_Pictographic}☀-➿️]+)\s*/u
    );
    let plainTitle = stripMd(titleCellRaw);
    let emoji = null;
    if (emojiMatch) {
      emoji = emojiMatch[1];
      plainTitle = plainTitle.replace(emojiMatch[0], "").trim();
    }

    const columns = {};
    headers.forEach((h, i) => {
      if (i === titleColIdx) return;
      if (i === promptColIdx) return;
      const cell = row[i] || "";
      if (cell.trim() === "" || cell.trim() === "—" || cell.trim() === "-") return;
      columns[h] = inlineMdToHtml(cell);
    });

    let promptFile = null;
    let promptSourceUrl = null;
    if (promptColIdx !== -1) {
      const promptCell = row[promptColIdx] || "";
      const link = firstLink(promptCell);
      if (link) {
        promptSourceUrl = link.href;
        const rel = localPromptPathFromUrl(link.href);
        if (rel) {
          const outName = copyPromptFile(rel);
          if (outName) promptFile = `data/prompts/${outName}`;
        }
      }
    }

    const externalUrl = !promptFile && titleLink ? titleLink.href : null;

    return {
      id: makeId(`${sectionTitle}-${plainTitle}`),
      title: plainTitle,
      emoji,
      titleUrl: titleLink ? titleLink.href : null,
      columns,
      promptFile,
      promptSourceUrl,
      externalUrl,
    };
  });
}

function buildItemsFromList(listItems, sectionTitle) {
  return listItems.map((li) => ({
    id: makeId(`${sectionTitle}-${li.title}`),
    title: li.title,
    emoji: null,
    titleUrl: li.href,
    columns: li.descriptionHtml ? { Description: li.descriptionHtml } : {},
    promptFile: null,
    promptSourceUrl: null,
    externalUrl: li.href,
  }));
}

function buildItemsFromCodePairs(pairs, sectionTitle) {
  return pairs.map((p) => {
    const id = makeId(`${sectionTitle}-${p.title}`);
    const outName = `${id}.txt`;
    fs.writeFileSync(path.join(OUT_PROMPTS_DIR, outName), p.code, "utf8");
    return {
      id,
      title: p.title,
      emoji: null,
      titleUrl: null,
      columns: {},
      promptFile: `data/prompts/${outName}`,
      promptSourceUrl: null,
      externalUrl: null,
    };
  });
}

// ---------- extract leading description paragraph(s) of a block, before any table/list ----------

function leadingDescription(blockLines) {
  const paras = [];
  for (const line of blockLines) {
    if (/^\|.*\|\s*$/.test(line)) break;
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) break;
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim().startsWith("```")) break;
    if (/^\*\*([^*]+)\*\*\s*$/.test(line)) break; // start of a bold+code-fence pair
    if (line.trim() === "" || line.trim() === "---") continue;
    if (line.trim().startsWith(">")) continue; // skip blockquote callouts
    paras.push(line.trim());
  }
  return paras.length ? inlineMdToHtml(paras.join(" ")) : "";
}

// ---------- walk sections into groups (##) and subcategories (###) ----------

function extractItemsForBlock(blockLines, title) {
  // Try every table in the block (a section may have >1 table, e.g. intro + table)
  let items = [];
  for (let i = 0; i < blockLines.length; i++) {
    const t = parseTableAt(blockLines, i);
    if (t) {
      items = items.concat(buildItemsFromTable(t, title));
      i = t.nextIdx - 1;
    }
  }
  if (items.length === 0) {
    const codePairs = parseBoldCodePairs(blockLines);
    if (codePairs.length) {
      items = items.concat(buildItemsFromCodePairs(codePairs, title));
    }
  }
  if (items.length === 0) {
    const listItems = parseListItems(blockLines);
    if (listItems.length) {
      items = items.concat(buildItemsFromList(listItems, title));
    }
  }
  return items;
}

const groups = [];
let currentGroup = null;

for (let secIdx = 0; secIdx < sections.length; secIdx++) {
  const sec = sections[secIdx];
  // A level-2 section's "own" content stops at its first level-3 child (if any),
  // not at sec.end (which spans all the way past every subsection it owns).
  let ownEnd = sec.end;
  if (sec.level === 2) {
    for (let j = secIdx + 1; j < sections.length; j++) {
      if (sections[j].level <= 2) break;
      if (sections[j].level === 3 && sections[j].start < sec.end) {
        ownEnd = sections[j].start;
        break;
      }
    }
  }
  const blockLines = lines.slice(sec.start + 1, ownEnd);
  if (sec.level === 2) {
    const items = extractItemsForBlock(blockLines, sec.title);
    currentGroup = {
      slug: slugify(sec.title),
      title: sec.title,
      description: leadingDescription(blockLines),
      items,
      subcategories: [],
    };
    groups.push(currentGroup);
  } else if (sec.level === 3 && currentGroup) {
    const items = extractItemsForBlock(blockLines, sec.title);
    if (items.length === 0) continue; // skip empty/prose-only subsections
    currentGroup.subcategories.push({
      slug: slugify(sec.title),
      title: sec.title,
      description: leadingDescription(blockLines),
      items,
    });
  }
}

// Drop groups that ended up with nothing, and drop the navigational Table of Contents
const finalGroups = groups.filter(
  (g) =>
    (g.items.length > 0 || g.subcategories.length > 0) &&
    g.slug !== "table-of-contents"
);

function countGroupItems(g) {
  return g.items.length + g.subcategories.reduce((n, s) => n + s.items.length, 0);
}

let commit = null;
try {
  commit = fs
    .readFileSync(path.join(SOURCE_DIR, ".git", "HEAD"), "utf8")
    .trim();
} catch {}

const index = {
  generatedAt: new Date().toISOString(),
  source: {
    repo: REPO_SLUG,
    url: REPO_URL,
    license: "GPL-3.0",
  },
  groups: finalGroups.map((g) => ({
    ...g,
    itemCount: countGroupItems(g),
  })),
};

fs.writeFileSync(
  path.join(OUT_DATA_DIR, "index.json"),
  JSON.stringify(index),
  "utf8"
);

const totalItems = finalGroups.reduce((n, g) => n + countGroupItems(g), 0);
console.log(`Groups: ${finalGroups.length}`);
console.log(`Total items: ${totalItems}`);
console.log(`Copied prompt files: ${copiedPromptFiles.size}`);
console.log(`Wrote ${path.join(OUT_DATA_DIR, "index.json")}`);
