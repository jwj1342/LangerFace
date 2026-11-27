import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import { hash, markerRepoRoot, captureMarkerIdentity, TARGET_MARKER_PROFILE } from "../../../tools/marker_runtime_identity.mts";
import { verifyMarkerRuntime, readMarkerRuntime } from "./verifyMarkerRuntime.ts";

export default async function setup(config: FullConfig) {
  if (config.workers !== 1) throw new Error("本验收包只允许单 worker。");
  // Missing input is an error, never two silently skipped tests plus a green report.
  const directory = process.env.CONTROLLED_MARKER_REAL_SAMPLE_DIR;
  if (!directory) throw new Error("请设置 CONTROLLED_MARKER_REAL_SAMPLE_DIR；不可跳过固定原图。");
  const sourceHash = hash(readFileSync(resolve(directory, "15.png")));
  if (sourceHash !== "fe4f21ca3d3e308704912cd974cc9ca9c35677c52fb164cab8b8e09915b85716") {
    throw new Error("15.png 不是已绑定的原图，停止验收。");
  }
  const project = config.projects[0];
  const baseURL = project.use.baseURL!;
  const proof = await verifyMarkerRuntime(baseURL, project.use.launchOptions);
  if (!proof.diagnosticsEnabled) throw new Error("测试服务未开启算法诊断，无法绑定实际 seed 与 profile。");
  const out = resolve(markerRepoRoot, "local_outputs/runtime-identity", `run-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "identity-before.json"), JSON.stringify({ ...proof, sourceHash }, null, 2));
  console.info(`[运行身份通过] ${proof.browser.profile} / ${proof.browser.implementationVersion} / ${proof.identity.head}\n回执：${out}`);
  return async () => {
    const after = await readMarkerRuntime(baseURL, captureMarkerIdentity(TARGET_MARKER_PROFILE));
    if (after.sourceDigest !== proof.identity.sourceDigest || after.capturedAt !== proof.identity.capturedAt) {
      throw new Error("验收过程中源码或服务发生切换，本轮成绩作废。");
    }
    writeFileSync(resolve(out, "identity-after.json"), JSON.stringify(after, null, 2));
  };
}
