import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Bound total wall time, including webServer setup, not six minutes per retry.
const web = fileURLToPath(new URL("../web/", import.meta.url));
const child = spawn(process.execPath, [
  fileURLToPath(new URL("../web/node_modules/@playwright/test/cli.js", import.meta.url)),
  "test", "--config=playwright.marker-v035.config.ts", "--project=chromium", "--workers=1",
], { cwd: web, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });
let stopped = false;
function stop() {
  if (stopped || !child.pid) return;
  stopped = true;
  console.error("停止本轮测试及其子进程（六分钟上限或用户中断），不处理其他进程。");
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
  }
}
const timer = setTimeout(stop, 360_000);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("error", (error) => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { clearTimeout(timer); process.exitCode = stopped ? 124 : code ?? 1; });
