import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scanner = path.resolve("scripts/scan-secrets.mjs");
const temporaryDirectories = [];

function createRepository(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runalert-secret-scan-"));
  temporaryDirectories.push(directory);
  execFileSync("git", ["init", "-q", directory]);
  execFileSync("git", ["-C", directory, "config", "user.email", "test@runalert.invalid"]);
  execFileSync("git", ["-C", directory, "config", "user.name", "runAlert tests"]);
  for (const [file, contents] of Object.entries(files)) {
    const destination = path.join(directory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }
  execFileSync("git", ["-C", directory, "add", "."]);
  execFileSync("git", ["-C", directory, "commit", "-qm", "fixture"]);
  return directory;
}

function runScanner(directory) {
  try {
    const stdout = execFileSync(process.execPath, [scanner, "--source", directory], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return {
      status: error.status,
      output: `${error.stdout || ""}${error.stderr || ""}`,
    };
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("secret history scanner", () => {
  it("passes a repository containing placeholders only", () => {
    const repository = createRepository({
      ".env.example": [
        "API_TOKEN=",
        "SERVICE_ROLE_KEY=replace-me",
        'APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"',
        "",
      ].join("\n"),
      "README.md": "Never commit credentials.\n",
    });

    expect(runScanner(repository)).toEqual({
      status: 0,
      output: "Secret scan passed (current tree and full Git history).\n",
    });
  });

  it("detects a credential in history without printing its value", () => {
    const credential = `ghp_${"a".repeat(36)}`;
    const repository = createRepository({ ".env": `TOKEN=${credential}\n` });
    fs.unlinkSync(path.join(repository, ".env"));
    execFileSync("git", ["-C", repository, "add", "-u"]);
    execFileSync("git", ["-C", repository, "commit", "-qm", "remove fixture"]);

    const result = runScanner(repository);
    expect(result.status).toBe(1);
    expect(result.output).toContain("GitHub token");
    expect(result.output).toContain("history:");
    expect(result.output).not.toContain(credential);
  });
});
