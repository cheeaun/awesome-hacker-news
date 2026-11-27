/**
 * Sorts markdown link lists alphabetically inside each section of README.md.
 * Skips the doctoc-generated Table of Contents and any prose-only sections.
 *
 * Usage:
 *   node .github/scripts/sort-readme.mjs            # Sort README.md in place
 *   node .github/scripts/sort-readme.mjs --dry-run  # Check without writing
 *
 * Credit: Contributed for cheeaun/awesome-hacker-news#77 (park-bit).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TOC_START = "<!-- START doctoc";
const TOC_END = "<!-- END doctoc";

function sortKey(itemLines) {
  const firstLine = itemLines[0].trim();
  const match = firstLine.match(/^(?:-\s+)+\[([^\]]+)\]/);
  const label = match ? match[1] : firstLine.replace(/^(?:-\s+)+/, "");
  return label.replace(/^@/, "").trim().toLowerCase();
}

function compareItems(a, b) {
  const keyA = sortKey(a);
  const keyB = sortKey(b);
  const cmp = keyA.localeCompare(keyB, "en", { sensitivity: "base" });
  if (cmp !== 0) return cmp;
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

function sortSection(sectionLines) {
  const items = [];
  let hasProse = false;

  for (const line of sectionLines) {
    if (line.trim() === "") continue;
    if (/^-\s+/.test(line)) {
      items.push([line]);
    } else if (/^\s{2,}\S/.test(line) && items.length > 0) {
      items[items.length - 1].push(line);
    } else {
      hasProse = true;
      break;
    }
  }

  if (hasProse || items.length < 2) {
    return sectionLines;
  }

  const sorted = [...items].sort(compareItems).flat();
  const hadLeadingBlank = sectionLines[0]?.trim() === "";
  const hadTrailingBlank = sectionLines[sectionLines.length - 1]?.trim() === "";

  return [
    ...(hadLeadingBlank ? [""] : []),
    ...sorted,
    ...(hadTrailingBlank ? [""] : []),
  ];
}

export function sortReadmeContent(raw) {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);

  const out = [];
  let inToc = false;
  let sectionBuffer = [];
  let inHeadingSection = false;

  const flushSection = () => {
    if (!inHeadingSection) return;
    out.push(...sortSection(sectionBuffer));
    sectionBuffer = [];
  };

  for (const line of lines) {
    if (line.includes(TOC_START)) {
      flushSection();
      inHeadingSection = false;
      inToc = true;
      out.push(line);
      continue;
    }

    if (inToc) {
      out.push(line);
      if (line.includes(TOC_END)) {
        inToc = false;
      }
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      flushSection();
      inHeadingSection = true;
      out.push(line);
      continue;
    }

    if (inHeadingSection) {
      sectionBuffer.push(line);
    } else {
      out.push(line);
    }
  }

  flushSection();
  return out.join(eol);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  const targetPath = path.resolve(process.cwd(), "README.md");
  const original = fs.readFileSync(targetPath, "utf8");
  const updated = sortReadmeContent(original);

  if (original === updated) {
    console.log("README.md is already sorted.");
  } else if (dryRun) {
    console.log("README.md has unsorted links (dry-run, no changes written).");
  } else {
    fs.writeFileSync(targetPath, updated, "utf8");
    console.log("Sorted links in README.md.");
  }
}
