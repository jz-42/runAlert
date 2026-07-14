#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const sourceIndex = args.indexOf("--source");
const source = path.resolve(
  sourceIndex >= 0 && args[sourceIndex + 1] ? args[sourceIndex + 1] : process.cwd()
);

const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["Stripe live key", /sk_live_[A-Za-z0-9]{16,}/g],
  ["npm token", /npm_[A-Za-z0-9]{20,}/g],
  ["SendGrid key", /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g],
  ["JWT/service key", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g],
  ["Twilio API key", /SK[0-9a-fA-F]{32}/g],
];
const assignmentPattern =
  /(?:secret|token|password|api[_-]?key|service[_-]?role[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{20,})/gi;
const placeholderPattern =
  /(?:example|placeholder|replace|change-?me|dummy|fake|fixture|your[-_]|process\.env|import\.meta|github\.token)/i;
const excludedFiles = new Set([
  "package-lock.json",
  "dashboard/package-lock.json",
  "scripts/scan-secrets.mjs",
]);
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".icns",
  ".pdf",
  ".zip",
  ".dmg",
  ".appx",
  ".woff",
  ".woff2",
]);

function git(argsForGit, options = {}) {
  return execFileSync("git", ["-C", source, ...argsForGit], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function looksLikePlaceholder(value) {
  if (placeholderPattern.test(value)) return true;
  const compact = value.replace(/[^A-Za-z0-9]/g, "");
  return compact.length > 0 && new Set(compact.toLowerCase()).size <= 3;
}

function classifications(line) {
  const found = [];
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) found.push(label);
  }
  assignmentPattern.lastIndex = 0;
  for (const match of line.matchAll(assignmentPattern)) {
    if (!looksLikePlaceholder(match[1])) found.push("credential assignment");
  }
  return [...new Set(found)];
}

function scanCurrentTree(findings) {
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    if (excludedFiles.has(file) || binaryExtensions.has(path.extname(file).toLowerCase())) {
      continue;
    }
    const absolute = path.join(source, file);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).size > 2 * 1024 * 1024) continue;
    const contents = fs.readFileSync(absolute, "utf8");
    if (contents.includes("\0")) continue;
    contents.split(/\r?\n/).forEach((line, index) => {
      for (const kind of classifications(line)) {
        findings.add(`${kind} at current:${file}:${index + 1}`);
      }
    });
  }
}

function scanHistory(findings) {
  const history = git([
    "log",
    "--all",
    "--no-ext-diff",
    "--no-color",
    "--format=RUNALERT_COMMIT:%H",
    "--patch",
    "--",
    ".",
    ":(exclude)package-lock.json",
    ":(exclude)dashboard/package-lock.json",
    ":(exclude)scripts/scan-secrets.mjs",
  ]);
  let commit = "unknown";
  let file = "unknown";
  for (const line of history.split(/\r?\n/)) {
    if (line.startsWith("RUNALERT_COMMIT:")) {
      commit = line.slice("RUNALERT_COMMIT:".length, "RUNALERT_COMMIT:".length + 12);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith("+++ /dev/null")) continue;
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const kind of classifications(line.slice(1))) {
      findings.add(`${kind} at history:${commit}:${file}`);
    }
  }
}

try {
  git(["rev-parse", "--is-inside-work-tree"]);
  const findings = new Set();
  scanCurrentTree(findings);
  scanHistory(findings);
  if (findings.size > 0) {
    console.error("Secret scan failed. Values are redacted; inspect these locations:");
    for (const finding of [...findings].sort()) console.error(`- ${finding}`);
    process.exitCode = 1;
  } else {
    console.log("Secret scan passed (current tree and full Git history).");
  }
} catch (error) {
  console.error(`Secret scan could not complete: ${error.message}`);
  process.exitCode = 2;
}
