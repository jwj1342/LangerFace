#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { captureMarkerIdentity, TARGET_MARKER_PROFILE } from "./marker_runtime_identity.mts";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const mode = process.argv[2] || "deploy";
if (!new Set(["local", "dev", "deploy", "pr"]).has(mode)) {
  throw new Error("算法发布门禁只接受 local、dev、deploy 或 pr 模式");
}
let requiresArchive = mode === "deploy" || mode === "pr";

const releasePath = resolve(repoRoot, "docs/quality/controlled-marker-release.json");
const release = JSON.parse(readFileSync(releasePath, "utf8"));
const scopeConfigPath = resolve(repoRoot, "docs/quality/algorithm-archive-scope.json");
const identity = captureMarkerIdentity(undefined, repoRoot);
const failures = [];
let boundaryCodePathCount = null;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) {
  failures.push(message);
}

function numericVersion(value) {
  const match = semverPattern.exec(String(value));
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareNumeric(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const current = release.current || {};
const currentNumeric = numericVersion(current.version);
if (!currentNumeric) fail(`当前版本不是规范 SemVer：${current.version}`);
if (!Array.isArray(current.nameKeywords) || current.nameKeywords.length < 1
  || current.nameKeywords.some((keyword) => !String(current.releaseName || "").includes(String(keyword)))) {
  fail("版本名称没有体现 nameKeywords 登记的主要改动");
}
if (current.profile !== TARGET_MARKER_PROFILE || identity.profile !== TARGET_MARKER_PROFILE) {
  fail(`默认 profile 不是 ${TARGET_MARKER_PROFILE}`);
}
for (const key of ["version", "releaseName"] ) {
  const actual = key === "version" ? identity.implementationVersion : identity.releaseName;
  if (actual !== current[key]) fail(`${key} 与运行身份不一致：登记 ${current[key]}，实际 ${actual}`);
}
if (mode !== "local" && identity.sourceDigest !== current.sourceDigest) {
  fail(`源码指纹与发布登记不一致：登记 ${current.sourceDigest}，实际 ${identity.sourceDigest}`);
}
if (identity.algorithmDigest !== current.algorithmDigest) {
  fail(`算法源码指纹与发布登记不一致：登记 ${current.algorithmDigest}，实际 ${identity.algorithmDigest}`);
}

const historyVersions = (release.history || []).map((item) => String(item.version));
if (new Set(historyVersions).size !== historyVersions.length) fail("历史版本号存在重复");
if (historyVersions.includes(String(current.version))) fail("当前版本号已在历史中使用");
const historyNumeric = historyVersions.map(numericVersion);
if (historyNumeric.some((value) => !value)) fail("历史版本包含非规范 SemVer");
if (currentNumeric && historyNumeric.length) {
  const highest = historyNumeric.reduce((left, right) => compareNumeric(left, right) >= 0 ? left : right);
  if (compareNumeric(currentNumeric, highest) <= 0) fail("当前数字版本没有高于全部历史版本");
}

const archive = release.archive || {};
const currentScopeConfigSha256 = sha256(readFileSync(scopeConfigPath));
if (mode === "dev") {
  const recoveryGaps = [];
  // The exemption applies to a committed checkout, not an arbitrary dirty experiment.
  // Untracked evidence remains untouched; strict source identity is checked above.
  try {
    const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
    const head = git("rev-parse", "--verify", "HEAD^{commit}");
    if (!identity.branch || head !== identity.head) recoveryGaps.push("开发测试需要明确分支与已提交的当前 HEAD");
    if (git("status", "--porcelain=v1", "--untracked-files=no")) {
      recoveryGaps.push("仍有暂存或跟踪文件修改");
    }
    const runtimePaths = ["web/src", "web/app", "web/dev", "web/index.html", "web/vite.config.ts",
      "web/package.json", "web/package-lock.json", "tools/marker_runtime_identity.mts",
      "tools/run_controlled_marker_v035_dev.mjs", "tools/run_controlled_marker_v035_build.mjs"];
    const untrackedRuntime = git("ls-files", "--others", "--exclude-standard", "--", ...runtimePaths);
    const ignoredRuntime = git("ls-files", "--others", "--ignored", "--exclude-standard", "--", ...runtimePaths);
    if (untrackedRuntime || ignoredRuntime) recoveryGaps.push("运行源码范围内存在未提交文件，Git 回退点不能恢复这些文件");
    const refs = git("for-each-ref", "--format=%(refname)", "refs/heads/backup/")
      .split(/\r?\n/).filter(Boolean);
    const recoveryRef = refs.find((ref) => {
      try { git("merge-base", "--is-ancestor", ref, "HEAD"); return true; }
      catch { return false; }
    });
    if (!recoveryRef) recoveryGaps.push("开发测试需要指向当前提交或其祖先的本地 backup/ Git 回退点");
    else console.log(`[algorithm-release:dev] Git 回退点 ${recoveryRef}；已提交 HEAD ${head}`);
  } catch (error) {
    recoveryGaps.push(`无法核验开发测试 Git 恢复条件：${error.message}`);
  }
  if (recoveryGaps.length) {
    requiresArchive = true;
    console.log('[algorithm-release:dev] Git 免重复恢复包条件未满足，改核当前完整恢复包：' + recoveryGaps.join('；'));
  }
}
if (requiresArchive && archive.scopeConfigSha256 !== currentScopeConfigSha256) {
  fail("责任范围配置指纹与发布登记不一致");
}
if (requiresArchive && (archive.status !== "verified" || !archive.manifestPath || !archive.manifestSha256)) {
  fail("当前算法没有已验证恢复包");
} else if (requiresArchive) {
  const archiveManifestPath = resolve(repoRoot, archive.manifestPath);
  if (!existsSync(archiveManifestPath) && (process.env.CI !== "true" || mode === "dev")) fail(`恢复包 manifest 不存在：${archive.manifestPath}`);
  else if (!existsSync(archiveManifestPath)) {
    if (archive.sourceDigest !== identity.sourceDigest) fail("CI 中的恢复包登记不是当前源码指纹");
  }
  else {
    const recoveryRoot = realpathSync(resolve(repoRoot, "local_outputs/recovery-packages"));
    const actualPath = realpathSync(archiveManifestPath);
    if (!actualPath.startsWith(`${recoveryRoot}${sep}`)) fail("恢复包 manifest 不在受控恢复目录内");
    const bytes = readFileSync(actualPath);
    if (sha256(bytes) !== archive.manifestSha256) fail("恢复包 manifest SHA-256 不匹配");
    const archiveManifest = JSON.parse(bytes.toString("utf8"));
    let baseCopied = new Map();
    if (archiveManifest.baseArchive) {
      const basePath = realpathSync(resolve(repoRoot, archiveManifest.baseArchive.manifestPath));
      if (!basePath.startsWith(`${recoveryRoot}${sep}`) || basename(basePath) !== "manifest.json") {
        fail("基础恢复包不在受控恢复目录内");
      } else {
        const baseBytes = readFileSync(basePath);
        if (sha256(baseBytes) !== archiveManifest.baseArchive.manifestSha256) {
          fail("基础恢复包 manifest 指纹不匹配");
        } else {
          const baseManifest = JSON.parse(baseBytes.toString("utf8"));
          baseCopied = new Map((baseManifest.copied || []).map((entry) => [entry.relativePath, entry]));
        }
      }
    }
    for (const item of archiveManifest.inherited || []) {
      const baseEntry = baseCopied.get(item.relativePath);
      const baseCopyPath = archiveManifest.baseArchive
        ? resolve(dirname(resolve(repoRoot, archiveManifest.baseArchive.manifestPath)), "worktree", item.relativePath)
        : null;
      if (!baseEntry || baseEntry.sha256 !== item.sha256 || baseEntry.bytes !== item.bytes
        || !baseCopyPath || !existsSync(baseCopyPath)
        || sha256(readFileSync(baseCopyPath)) !== item.sha256
        || !existsSync(resolve(repoRoot, item.relativePath))
        || sha256(readFileSync(resolve(repoRoot, item.relativePath))) !== item.sha256) {
        fail(`基础恢复包继承项无法核对：${item.relativePath}`);
      }
    }
    if (archiveManifest.archiveScope?.configSha256 !== currentScopeConfigSha256) {
      fail("恢复包使用的责任范围配置不是当前版本");
    }
    if (archiveManifest.algorithmIdentity?.sourceDigest !== identity.sourceDigest
      || archiveManifest.algorithmIdentity?.algorithmDigest !== identity.algorithmDigest
      || archive.sourceDigest !== identity.sourceDigest) {
      fail("恢复包不是当前源码指纹对应的算法版本");
    }
    const externalDependencies = archiveManifest.archiveScope?.externalDependencies || [];
    for (const item of externalDependencies) {
      const copied = archiveManifest.copied?.find((entry) => entry.relativePath === item);
      const inherited = archiveManifest.inherited?.find((entry) => entry.relativePath === item);
      if (!copied && !inherited) fail(`外部依赖未纳入或继承恢复包：${item}`);
    }
    const boundaryCodePaths = (archiveManifest.archiveScope?.changedOutsideScope || [])
      .filter((path) => /^(?:web\/src\/|web\/dev\/|tools\/).+\.(?:[cm]?[jt]sx?|mjs|py|ps1)$/i.test(String(path)));
    boundaryCodePathCount = boundaryCodePaths.length;
  }
}

const scopeReview = release.scopeBoundaryReview || {};
if (requiresArchive && scopeReview.status === "pending") {
  fail(boundaryCodePathCount === null
    ? "责任范围外共享代码改动尚未取得操作者边界确认"
    : `存在 ${boundaryCodePathCount} 个责任范围外共享代码改动，尚未取得操作者边界确认`);
} else if (requiresArchive && scopeReview.status === "confirmed") {
  if (scopeReview.manifestSha256 !== archive.manifestSha256
    || !scopeReview.evidence
    || !scopeReview.confirmedAt) {
    fail("责任边界确认没有完整绑定当前恢复包");
  }
} else if (requiresArchive && scopeReview.status === "not_required" && boundaryCodePathCount) {
  fail(`存在 ${boundaryCodePathCount} 个责任范围外共享代码改动，不能标记为不需要确认`);
} else if (requiresArchive && scopeReview.status !== "not_required") {
  fail("责任边界确认状态无效");
}

if (mode === "pr") {
  const evaluation = release.operatorEvaluation || {};
  if (evaluation.status !== "accepted" || evaluation.sourceDigest !== identity.sourceDigest || !evaluation.evidence) {
    fail("缺少绑定当前源码指纹的操作者实际评价");
  }
  const saved = release.editorSaveConfirmation || {};
  if (saved.status !== "confirmed" || saved.sourceDigest !== identity.sourceDigest || !saved.confirmedAt) {
    fail("缺少操作者对编辑器文件已全部保存的确认");
  }
}

if (failures.length) {
  console.error(`[algorithm-release:${mode}] BLOCKED`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`[algorithm-release:${mode}] PASS ${identity.releaseName} / ${identity.implementationVersion} / ${identity.sourceDigest}`);
