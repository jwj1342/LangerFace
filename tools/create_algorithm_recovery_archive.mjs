#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { captureMarkerIdentity } from "./marker_runtime_identity.mts";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const archiveName = process.argv[2];
if (!archiveName || !/^[^\\/:*?"<>|]+$/.test(archiveName)) {
  throw new Error("用法：node tools/create_algorithm_recovery_archive.mjs <不含路径分隔符的存档名称>");
}

const archiveRoot = resolve(repoRoot, "local_outputs/recovery-packages", archiveName);
if (existsSync(archiveRoot)) throw new Error(`存档已存在，拒绝覆盖：${archiveRoot}`);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const recoveryRoot = realpathSync(resolve(repoRoot, "local_outputs/recovery-packages"));
const baseManifestArgument = process.argv[3];
let baseArchive = null;
let baseCopied = new Map();
if (baseManifestArgument) {
  const baseManifestPath = realpathSync(resolve(repoRoot, baseManifestArgument));
  if (!baseManifestPath.startsWith(`${recoveryRoot}${sep}`)
    || basename(baseManifestPath) !== "manifest.json") {
    throw new Error("基础恢复包必须位于受控恢复目录且指向 manifest.json");
  }
  const bytes = readFileSync(baseManifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.schema !== "skin-texture-algorithm-recovery/2") {
    throw new Error("基础恢复包格式不受支持");
  }
  baseArchive = {
    manifestPath: relative(repoRoot, baseManifestPath).replaceAll("\\", "/"),
    manifestSha256: sha256(bytes),
  };
  baseCopied = new Map((manifest.copied || []).map((entry) => [entry.relativePath, entry]));
}
mkdirSync(archiveRoot, { recursive: true });
const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], {
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 64 * 1024 * 1024,
});

const excludedPrefixes = [
  ".git/",
  "local_outputs/",
  "web/node_modules/",
  "web/dist/",
  "web/output/",
  "web/test-results/",
  "web/playwright-report/",
  "web/.playwright-cli/",
];
const scopePath = resolve(repoRoot, "docs/quality/algorithm-archive-scope.json");
const archiveScope = JSON.parse(readFileSync(scopePath, "utf8"));
const externalDependencies = new Set(archiveScope.externalDependencies || []);
const normalizedExact = new Set(archiveScope.includeExact.map((path) => path.replaceAll("\\", "/")));
const normalizedPrefixes = archiveScope.includePrefixes.map((path) => path.replaceAll("\\", "/"));
const isInArchiveScope = (path) => externalDependencies.has(path) || normalizedExact.has(path)
  || normalizedPrefixes.some((prefix) => path.startsWith(prefix));
const fingerprintOnlyExtensions = new Set([
  ".base64", ".bin", ".bmp", ".cer", ".crt", ".db", ".gif", ".jpeg", ".jpg",
  ".key", ".mov", ".mp4", ".npy", ".npz", ".obj", ".onnx", ".p12", ".pem",
  ".pfx", ".png", ".pth", ".sqlite", ".task", ".tif", ".tiff", ".webm", ".webp",
  ".wasm", ".zip",
]);
const sensitiveBasenamePattern = /^(?:\.env(?:\..*)?|.*(?:credential|secret|token).*)$/i;
const allCandidates = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
  .split("\0")
  .filter(Boolean)
  .map((path) => path.replaceAll("\\", "/"))
  .filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix)));
const candidates = allCandidates.filter(isInArchiveScope);
const changedPaths = [...new Set([
  ...git("diff", "--name-only", "-z", "HEAD").split("\0"),
  ...git("ls-files", "-z", "--others", "--exclude-standard").split("\0"),
])]
  .filter(Boolean)
  .map((path) => path.replaceAll("\\", "/"))
  .filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix)));
const changedOutsideScope = changedPaths.filter((path) => !isInArchiveScope(path)).sort();

const copied = [];
const inherited = [];
const omitted = [];
for (const relativePath of [...new Set(candidates)].sort()) {
  const sourcePath = resolve(repoRoot, relativePath);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) continue;
  const bytes = statSync(sourcePath).size;
  const digest = sha256(readFileSync(sourcePath));
  const baseEntry = baseCopied.get(relativePath);
  if (baseEntry?.sha256 === digest && baseEntry.bytes === bytes) {
    const baseCopyPath = resolve(dirname(resolve(repoRoot, baseArchive.manifestPath)), "worktree", relativePath);
    if (!existsSync(baseCopyPath) || sha256(readFileSync(baseCopyPath)) !== digest) {
      throw new Error(`基础恢复包副本缺失或损坏：${relativePath}`);
    }
    inherited.push({ relativePath, bytes, sha256: digest });
    continue;
  }
  const fileName = basename(relativePath);
  const extension = extname(fileName).toLowerCase();
  if (fingerprintOnlyExtensions.has(extension) || sensitiveBasenamePattern.test(fileName)) {
    omitted.push({ relativePath, bytes, sha256: digest, reason: "sensitive_or_binary_fingerprint_only" });
    continue;
  }
  if (bytes > 10 * 1024 * 1024) {
    omitted.push({ relativePath, bytes, sha256: digest, reason: "larger_than_10_mib" });
    continue;
  }
  const targetPath = resolve(archiveRoot, "worktree", relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  const copiedDigest = sha256(readFileSync(targetPath));
  if (copiedDigest !== digest) throw new Error(`存档回读不一致：${relativePath}`);
  copied.push({ relativePath, bytes, sha256: digest });
}

const identity = captureMarkerIdentity(undefined, repoRoot);
const manifest = {
  schema: "skin-texture-algorithm-recovery/2",
  name: archiveName,
  createdAt: new Date().toISOString(),
  source: {
    branch: git("branch", "--show-current").trim(),
    head: git("rev-parse", "HEAD").trim(),
    tree: git("rev-parse", "HEAD^{tree}").trim(),
    worktreeId: sha256(realpathSync(repoRoot)),
    status: git("status", "--porcelain=v1", "--untracked-files=all"),
  },
  archiveScope: {
    schema: archiveScope.schema,
    owner: archiveScope.owner,
    defaultComponents: archiveScope.defaultComponents,
    excludedTeamAlgorithms: archiveScope.excludedTeamAlgorithms,
    externalDependencies: [...externalDependencies].sort(),
    configPath: "docs/quality/algorithm-archive-scope.json",
    configSha256: sha256(readFileSync(scopePath)),
    changedOutsideScope,
  },
  algorithmIdentity: identity,
  baseArchive,
  copied,
  inherited,
  omitted,
  limitations: [
    "不包含 Git 对象库、node_modules、构建产物、浏览器过程输出或编辑器未保存缓冲。",
    "媒体、模型、数据库、密钥类文件及大于 10 MiB 的文件只记录原位指纹；原文件丢失时不能仅靠本包完整恢复。",
    "指纹项是否含真实患者数据不作推断；恢复前必须重新核对数据授权和原文件位置。",
    "只复制项目责任范围配置列出的肿物识别、切口生成、切口微调和 UI 设计材料；范围外工作区改动不在本包内。",
    baseArchive
      ? "未变的外部依赖仅记录指纹并引用基础恢复包；基础包丢失时，本增量包不能单独恢复完整运行环境。"
      : "外部依赖文件仅为当前运行恢复而保存，不改变其团队责任归属，也不代表其效果已验收。",
    "存档和运行身份不代表算法效果、真机效果、医学结论或临床验收通过。",
  ],
};

const manifestPath = resolve(archiveRoot, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const manifestDigest = sha256(readFileSync(manifestPath));
writeFileSync(resolve(archiveRoot, "恢复说明.md"), [
  `# ${archiveName}`,
  "",
  "本包保存创建时磁盘上的源码、配置和测试，包括未提交修改。恢复必须在隔离目录逐项进行，禁止覆盖当前成果。",
  "",
  `算法身份：${identity.algorithmName} / ${identity.profile} / ${identity.implementationVersion}`,
  `源码指纹：${identity.sourceDigest}`,
  `manifest SHA-256：${manifestDigest}`,
  "",
  ...manifest.limitations,
  "",
].join("\n"), "utf8");

console.log(JSON.stringify({
  archiveRoot,
  copied: copied.length,
  inherited: inherited.length,
  omitted: omitted.length,
  manifestSha256: manifestDigest,
  algorithmIdentity: identity,
}, null, 2));
