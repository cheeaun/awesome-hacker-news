/**
 * Lints and sorts markdown link lists alphabetically inside README.md using remark/unified.
 * Skips the doctoc-generated Table of Contents and any non-link lists.
 *
 * Usage:
 *   node .github/scripts/sort-readme.mjs            # Sort README.md in place
 *   node .github/scripts/sort-readme.mjs --dry-run  # Report unsorted lists without writing
 *   node .github/scripts/sort-readme.mjs --check    # Same as --dry-run, exits 1 if unsorted
 *
 * Credit: Contributed for cheeaun/awesome-hacker-news#77 (park-bit).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { lintRule } from "unified-lint-rule";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import { VFile } from "vfile";
import { reporter } from "vfile-reporter";

const TOC_START = "<!-- START doctoc";
const TOC_END = "<!-- END doctoc";

function getItemLabel(listItem) {
  let label = "";
  visit(listItem, "link", (link) => {
    if (!label) {
      label = toString(link);
    }
  });
  if (!label) {
    label = toString(listItem);
  }
  return label.replace(/^@/, "").trim();
}

function compareItems(a, b) {
  const keyA = getItemLabel(a.node).toLowerCase();
  const keyB = getItemLabel(b.node).toLowerCase();
  const cmp = keyA.localeCompare(keyB, "en", { sensitivity: "base" });
  if (cmp !== 0) return cmp;
  return keyA < keyB ? -1 : keyA > keyB ? 1 : a.index - b.index;
}

function isLinkList(listNode) {
  return (
    listNode.type === "list" &&
    !listNode.ordered &&
    listNode.children.length >= 2 &&
    listNode.children.every((item) => {
      let hasLink = false;
      visit(item, "link", () => {
        hasLink = true;
      });
      return hasLink;
    })
  );
}

function getSortableLists(tree) {
  const lists = [];
  let inToc = false;

  for (const node of tree.children) {
    if (node.type === "html") {
      if (node.value.includes(TOC_START)) inToc = true;
      if (node.value.includes(TOC_END)) inToc = false;
      continue;
    }
    if (inToc) continue;
    if (isLinkList(node)) {
      lists.push(node);
    }
  }

  return lists;
}

export const alphabeticalListsRule = lintRule(
  "awesome:alphabetical-lists",
  (tree, file) => {
    for (const listNode of getSortableLists(tree)) {
      const indexed = listNode.children.map((node, index) => ({ node, index }));
      const sorted = [...indexed].sort(compareItems);
      const firstMismatch = indexed.findIndex((entry, idx) => entry.index !== sorted[idx].index);

      if (firstMismatch !== -1) {
        const expected = getItemLabel(sorted[firstMismatch].node);
        const actual = getItemLabel(indexed[firstMismatch].node);
        file.message(
          `List is not sorted alphabetically (expected "${expected}" before "${actual}")`,
          listNode.children[firstMismatch]
        );
      }
    }
  }
);

export async function lintReadmeContent(raw, filePath = "README.md") {
  const processor = unified().use(remarkParse).use(alphabeticalListsRule);
  const file = new VFile({ path: filePath, value: raw });
  const tree = processor.parse(file);
  await processor.run(tree, file);
  return { tree, file };
}

export async function sortReadmeContent(raw, filePath = "README.md") {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const { tree, file } = await lintReadmeContent(raw, filePath);
  const lists = getSortableLists(tree);

  // Replace unsorted lists from back to front so earlier character offsets remain valid.
  let output = raw;
  for (let i = lists.length - 1; i >= 0; i--) {
    const listNode = lists[i];
    const indexed = listNode.children.map((node, index) => ({ node, index }));
    const sorted = [...indexed].sort(compareItems);
    const isAlreadySorted = indexed.every((entry, idx) => entry.index === sorted[idx].index);
    if (isAlreadySorted) continue;

    const listStart = listNode.position.start.offset;
    const listEnd = listNode.position.end.offset;
    const sortedSlices = sorted.map(({ node }) =>
      raw.slice(node.position.start.offset, node.position.end.offset)
    );
    output = output.slice(0, listStart) + sortedSlices.join(eol) + output.slice(listEnd);
  }

  return { updated: output, file };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  const checkOnly = process.argv.includes("--check");
  const targetPath = path.resolve(process.cwd(), "README.md");
  const original = fs.readFileSync(targetPath, "utf8");
  const { updated, file } = await sortReadmeContent(original, path.basename(targetPath));

  if (dryRun || checkOnly) {
    const report = reporter(file, { quiet: true });
    if (report) console.log(report.trimEnd());
    if (original === updated) {
      console.log("README.md is already sorted.");
    } else if (checkOnly) {
      process.exitCode = 1;
    } else {
      console.log("README.md has unsorted links (dry-run, no changes written).");
    }
  } else if (original === updated) {
    console.log("README.md is already sorted.");
  } else {
    fs.writeFileSync(targetPath, updated, "utf8");
    console.log("Sorted links in README.md.");
  }
}
