import { chromium, type LaunchOptions } from "@playwright/test";
import { captureMarkerIdentity, assertMarkerIdentity, TARGET_MARKER_PROFILE,
  type MarkerIdentity } from "../../../tools/marker_runtime_identity.mts";

export async function readMarkerRuntime(baseURL: string, expected: MarkerIdentity) {
  const response = await fetch(new URL("/__runtime-identity.json", baseURL), {
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`运行身份端点不可用 (${response.status})；旧服务、普通 preview 或启动后已修改源码不能通过。`);
  }
  const identity = await response.json();
  assertMarkerIdentity(identity, expected);
  return identity;
}

export async function verifyMarkerRuntime(baseURL: string, launchOptions: LaunchOptions = {}) {
  const expected = captureMarkerIdentity(TARGET_MARKER_PROFILE);
  const identity = await readMarkerRuntime(baseURL, expected);
  // One short-lived headless browser, closed before the product tests start.
  // The page imports the actual selector; no MediaPipe, webcam or inference.
  const browser = await chromium.launch({ ...launchOptions, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL("/__runtime-identity", baseURL).href, { timeout: 20_000 });
    await page.waitForFunction(() => "__markerRuntimeProof" in window, { }, { timeout: 15_000 });
    const proof = await page.evaluate(() => Reflect.get(window, "__markerRuntimeProof"));
    assertMarkerIdentity(proof.identity, expected);
    if (proof.browser.profile !== expected.profile
      || proof.browser.implementationVersion !== expected.implementationVersion) {
      throw new Error("浏览器实际算法与预期不符，停止验收。");
    }
    return { ...proof, baseURL, verifiedAt: new Date().toISOString(),
      diagnosticsEnabled: identity.diagnosticsEnabled };
  } finally {
    await browser.close();
  }
}
