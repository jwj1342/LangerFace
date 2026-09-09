import type { Plugin } from "vite";
import { resolve } from "node:path";
import { captureMarkerIdentity, assertMarkerIdentity } from "../../tools/marker_runtime_identity.mts";

// Dev-only observation endpoint: no product entry import, DOM change or inference.
export function markerRuntimeIdentityPlugin(): Plugin {
  return {
    name: "marker-runtime-identity",
    apply: "serve",
    configureServer(server) {
      const profile = server.config.env.VITE_CONTROLLED_MARKER_DETECTOR_PROFILE;
      const sourceRoot = resolve(server.config.root, "..");
      // Missing optional local assets must not break an unrelated generic dev page.
      // Only identity-based acceptance is blocked when provenance cannot be captured.
      let identity: ReturnType<typeof captureMarkerIdentity> | undefined;
      try { identity = captureMarkerIdentity(profile, sourceRoot); } catch { /* endpoint reports unavailable */ }
      const snapshot = { ...identity, mode: "development", capturedAt: new Date().toISOString(),
        diagnosticsEnabled: server.config.env.VITE_CONTROLLED_MARKER_DETECTOR_DIAGNOSTICS === "1" };
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0];
        if (pathname !== "/__runtime-identity.json" && pathname !== "/__runtime-identity") return next();
        res.setHeader("Cache-Control", "no-store");
        if (pathname === "/__runtime-identity.json") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            if (!identity) throw new Error("启动时未能取得完整身份");
            assertMarkerIdentity(captureMarkerIdentity(profile, sourceRoot), identity);
            res.end(JSON.stringify(snapshot));
          } catch {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: "身份不完整，或源文件/资产在启动后发生变化；请检查依赖并重启规范服务再验收。" }));
          }
          return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>运行身份核对</title>
<style>body{font:16px/1.65 system-ui;margin:24px;max-width:900px}pre{background:#f3f4f6;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#075985}</style>
<h1>运行身份核对</h1><p id="status">正在读取浏览器实际加载的算法…</p>
<p>这里只核对版本和来源，不代表识别准确率或临床验收通过。回档标签与算法实现号是不同概念。</p>
<pre id="result"></pre><a href="/app/workflow">进入操作页面</a>
<script type="module">
import {CONTROLLED_MARKER_DETECTOR_PROFILE as profile, CONTROLLED_MARKER_DETECTOR_VERSION as implementationVersion} from '/src/services/controlledMarkerDetectionProfile.ts';
try {
 const response = await fetch('/__runtime-identity.json', {cache:'no-store'});
 const identity = await response.json();
 if(!response.ok) throw new Error(identity.error || '身份请求失败');
 if(profile!==identity.profile || implementationVersion!==identity.implementationVersion) throw new Error('浏览器算法与服务身份不一致');
 const proof={identity,browser:{profile,implementationVersion}};
 window.__markerRuntimeProof=proof;
 document.querySelector('#status').textContent=profile==='color-difference-v0.35'?'版本核对通过：当前是受控标记 v0.35 系列。':'注意：当前不是目标 v0.35 系列，请勿用于本轮验收。';
 document.querySelector('#result').textContent='实际算法：'+profile+'\\n实现版本：'+implementationVersion+'\\n分支：'+identity.branch+'\\n提交：'+identity.head+'\\n工作区指纹：'+identity.worktreeId+'\\n含未提交修改的源码指纹：'+identity.sourceDigest+'\\n关键资产指纹：'+identity.assetDigest+'\\n服务启动：'+identity.capturedAt;
} catch(error) { document.querySelector('#status').textContent='核对失败：'+error.message; }
</script></html>`);
      });
    },
  };
}
