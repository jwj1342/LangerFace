import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resolveControlledMarkerDetectorProfile,
  detectorVersionForProfile,
} from "../web/src/services/controlledMarkerDetectionProfile.ts";

export const markerRepoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
export const TARGET_MARKER_PROFILE = "color-difference-v0.35";
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// Include unsaved-to-Git source, not just HEAD. Exclude logs, test output and secrets.
export function captureMarkerIdentity(rawProfile: string | undefined, root = markerRepoRoot) {
  const files: string[] = [];
  function walk(relative: string) {
    if (!existsSync(resolve(root, relative))) return;
    for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`身份范围内不允许链接：${name}`);
      if (entry.isDirectory()) walk(name);
      else files.push(name);
    }
  }
  for (const directory of ["web/src", "web/app", "web/dev"]) walk(directory);
  files.push("web/index.html", "web/vite.config.ts", "web/package.json", "web/package-lock.json",
    "tools/marker_runtime_identity.mts", "tools/run_controlled_marker_v035_dev.mjs");
  const sourceHashes = files.sort().map((file) => [file, hash(readFileSync(resolve(root, file)))]);
  // Essential photo geometry/model inputs. This is not an RSTL effect-equivalence claim.
  const assetHashes = ["face_landmarker.task", "atlas_rstl.json", "atlas_langer.json",
    "canonical_vertices.json", "triangles.json", "topology_mediapipe_468.json"]
    .map((name) => [name, hash(readFileSync(resolve(root, "web/assets", name)))]);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", windowsHide: true,
  }).trim();
  const profile = resolveControlledMarkerDetectorProfile(rawProfile);
  return {
    schema: 1,
    profile,
    implementationVersion: detectorVersionForProfile(profile),
    branch: git("branch", "--show-current"),
    head: git("rev-parse", "HEAD"),
    // Do not publish a user's absolute path, credentials or image data.
    worktreeId: hash(realpathSync(root)),
    sourceDigest: hash(JSON.stringify(sourceHashes)),
    assetDigest: hash(JSON.stringify(assetHashes)),
    sourceFileCount: sourceHashes.length,
    assetHashes: Object.fromEntries(assetHashes),
  };
}

export type MarkerIdentity = ReturnType<typeof captureMarkerIdentity>;
export function assertMarkerIdentity(actual: Partial<MarkerIdentity>, expected: MarkerIdentity) {
  for (const key of ["schema", "profile", "implementationVersion", "branch", "head", "worktreeId",
    "sourceDigest", "assetDigest"] as const) {
    if (actual?.[key] !== expected[key]) {
      throw new Error(`运行身份不匹配：${key}；期望 ${expected[key]}，实际 ${actual?.[key] ?? "缺失"}。请核对服务并重新启动，不能用 HTTP 200 放行。`);
    }
  }
}
