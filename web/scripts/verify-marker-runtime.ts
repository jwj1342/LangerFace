import { verifyMarkerRuntime } from "../e2e/support/verifyMarkerRuntime.ts";

const address = process.argv[2] || "http://127.0.0.1:4173";
const url = new URL(address);
if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) {
  throw new Error("只接受无内嵌凭据的 HTTP(S) 地址。");
}
const proof = await verifyMarkerRuntime(url.origin, {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
console.log(JSON.stringify(proof, null, 2));
