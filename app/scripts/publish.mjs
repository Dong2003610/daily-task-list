import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = "Dong2003610/daily-task-list";
const dry = process.argv.includes("--dry-run");
let token = process.env.GITHUB_TOKEN;
if (!dry && !token && process.argv.includes("--token-stdin")) {
  console.log("等待本机授权输入（隐藏，不记录到文件）…");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  token = await new Promise((resolve, reject) => {
    let value = "";
    const receive = (chunk) => {
      const s = chunk.toString();
      if (s.includes("\u0003")) {
        process.exit(130);
      }
      value += s;
      if (value.length > 1000) reject(new Error("授权输入无效"));
      if (/[\r\n]/.test(value)) {
        process.stdin.off("data", receive);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(value.trim());
      }
    };
    process.stdin.on("data", receive);
    process.stdin.resume();
  });
}
if (!dry && !token)
  throw new Error(
    "请在本机临时设置 GITHUB_TOKEN；不要把 Token 写入源码或聊天。",
  );
const sourceFiles = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "index.html",
  ".gitignore",
  ".env.example",
  "README.md",
];
const changes = [];
const blobs = [];
async function add(local, remote) {
  const bytes = await fs.readFile(local);
  blobs.push({
    path: remote,
    bytes,
    sha: createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex"),
  });
}
async function walk(dir, prefix) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("不允许发布符号链接");
    const source = path.join(dir, entry.name),
      dest = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(source, dest);
    else await add(source, dest);
  }
}
await walk(path.join(root, "dist"), "");
for (const file of sourceFiles) {
  try {
    await add(path.join(root, file), `app/${file}`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
for (const dir of ["src", "public", "scripts", "tests", "docs"]) {
  try {
    await walk(path.join(root, dir), `app/${dir}`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
await add(path.join(root, "README.md"), "README.md");
if (dry) {
  console.log(
    JSON.stringify(
      {
        repo,
        files: blobs.map((b) => b.path),
        bytes: blobs.reduce((n, b) => n + b.bytes.length, 0),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
async function request(endpoint, method = "GET", body) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/${endpoint}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) {
    const detail = await response
      .json()
      .catch(() => ({ message: "GitHub 请求失败" }));
    throw new Error(`GitHub ${response.status}: ${detail.message}`);
  }
  return response.json();
}
const ref = await request("git/ref/heads/main");
const head = ref.object.sha;
if (process.env.EXPECTED_HEAD && head !== process.env.EXPECTED_HEAD)
  throw new Error("线上版本有新变更，请重新对照后发布。");
const base = await request(`git/commits/${head}`);
const existing = await request(`git/trees/${base.tree.sha}?recursive=1`);
const existingFiles = new Map(
  existing.tree.filter((x) => x.type === "blob").map((x) => [x.path, x.sha]),
);
for (let index = 0; index < blobs.length; index += 4) {
  const batch = blobs
    .slice(index, index + 4)
    .filter((b) => existingFiles.get(b.path) !== b.sha);
  await Promise.all(
    batch.map(async (blob) => {
      const result = await request("git/blobs", "POST", {
        content: blob.bytes.toString("base64"),
        encoding: "base64",
      });
      changes.push({
        path: blob.path,
        mode: "100644",
        type: "blob",
        sha: result.sha,
      });
    }),
  );
}
if (!changes.length) {
  console.log("所有文件已是最新，无需发布。");
  process.exit(0);
}
// Existing unrelated files and old assets remain recoverable; only whitelisted files change.
const tree = await request("git/trees", "POST", {
  base_tree: base.tree.sha,
  tree: changes,
});
const commit = await request("git/commits", "POST", {
  message:
    "feat: reliable task carryover, recurring schedules, quick entry and backups",
  tree: tree.sha,
  parents: [head],
});
const latest = await request("git/ref/heads/main");
if (latest.object.sha !== head)
  throw new Error("发布期间线上有新提交，已停止更新 main。");
await request("git/refs/heads/main", "PATCH", {
  sha: commit.sha,
  force: false,
});
console.log(
  JSON.stringify(
    {
      commit: commit.sha,
      url: `https://github.com/${repo}/commit/${commit.sha}`,
      files: changes.length,
      previousHead: head,
    },
    null,
    2,
  ),
);
