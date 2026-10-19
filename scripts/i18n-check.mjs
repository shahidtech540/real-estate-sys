#!/usr/bin/env node
/**
 * `npm run i18n:check` — AGENTS.md §5.11 and ARCHITECTURE.md §9.5:
 * no missing keys, no orphan keys, no empty values, identical shapes.
 *
 * The catalogs are the only source of user-visible text; a key that exists in
 * one language only is a blank label for half the staff.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const localesDir = join(root, "src/i18n/locales");

const read = (name) => JSON.parse(readFileSync(join(localesDir, name), "utf8"));

function flatten(value, prefix = "", out = new Map()) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      flatten(entry, path, out);
    } else {
      out.set(path, entry);
    }
  }
  return out;
}

const en = flatten(read("en.json"));
const ur = flatten(read("ur.json"));
const problems = [];

for (const key of en.keys()) {
  if (!ur.has(key)) problems.push(`missing in ur.json: ${key}`);
}
for (const key of ur.keys()) {
  if (!en.has(key)) problems.push(`missing in en.json: ${key}`);
}
for (const [file, catalog] of [
  ["en", en],
  ["ur", ur],
]) {
  for (const [key, value] of catalog) {
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`empty value in ${file}.json: ${key}`);
    }
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

const used = new Set();
for (const file of walk(join(root, "src"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\(\s*["']([A-Za-z0-9_.]+)["']/g)) {
    used.add(match[1]);
  }
}

for (const key of used) {
  if (!en.has(key))
    problems.push(`used in code but absent from en.json: ${key}`);
}

// `errors.${code}` is assembled at runtime from API.md §5 codes; every entry is
// allowed but still has to exist in both catalogs (checked above).
for (const key of en.keys()) {
  if (key.startsWith("errors.")) continue;
  if (!used.has(key)) problems.push(`orphan key (never used): ${key}`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `i18n:check OK — ${en.size} keys, en/ur shapes identical, no orphans.`,
);
