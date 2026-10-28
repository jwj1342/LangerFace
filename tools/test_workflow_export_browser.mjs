import assert from "node:assert/strict";
import { chromium } from "../web/node_modules/playwright/index.mjs";

// Synthetic layers exercise the real route adapter and PNG/video encoders;
// they do not stand in for lesion detection, RSTL or clinical validation.
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
      isMobile: mobile, hasTouch: mobile,
    });
    try {
      const page = await context.newPage();
      await page.goto(new URL("/app/workflow?developer=1", process.argv[2] || "http://127.0.0.1:5199").href);
      await page.waitForSelector("#canvas");
      for (const mirror of [false, true]) {
        for (const zoom of [0.75, 1.25]) {
          const result = await page.evaluate(async ({ mirror, zoom }) => {
            const { createLiveRecordingActions } = await import("/src/services/liveRecordingActions.ts");
            const { createCanvasRecordingController } = await import("/src/services/canvasRecording.ts");
            const wrap = document.createElement("div");
            wrap.className = "main-wrap";
            wrap.style.cssText = `position:fixed;left:0;top:0;width:256px;height:128px;transform:scale(${zoom});transform-origin:0 0;z-index:99999`;
            document.body.append(wrap);
            const canvas = document.createElement("canvas");
            canvas.width = 256; canvas.height = 128;
            canvas.style.cssText = "position:absolute;inset:0;width:256px;height:128px;max-width:none;max-height:none";
            canvas.classList.toggle("mirror", mirror);
            const g = canvas.getContext("2d");
            g.fillStyle = "black"; g.fillRect(0, 0, 256, 128);
            g.fillStyle = "red"; g.fillRect(16, 8, 16, 16);
            g.fillStyle = "cyan"; g.fillRect(80, 8, 16, 16);
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.id = "workflowIncisionOverlay";
            svg.style.cssText = "position:absolute;inset:0;width:256px;height:128px;overflow:hidden";
            svg.innerHTML = '<path data-boundary d="M32 48 L224 48" style="fill:none;stroke:yellow;stroke-width:8"/><path data-candidate d="M32 80 L224 80" style="fill:none;stroke:blue;stroke-width:8;stroke-dasharray:16 4"/><g style="display:none"><path d="M32 110 L224 110" stroke="lime" stroke-width="12"/></g>';
            wrap.append(canvas, svg);
            let saved;
            const errors = [];
            const actions = createLiveRecordingActions({
              canvas: () => canvas, getExtraCanvases: () => [], system: () => "synthetic",
              onStateChange() {}, setMsg(message) { errors.push(message); }, setTransientMsg() {},
              logError(event, error) { errors.push(`${event}: ${error}`); },
            }, options => createCanvasRecordingController({ ...options,
              presentFile(blob) { saved = blob; return true; },
            }));
            const pixels = async blob => {
              const bitmap = await createImageBitmap(blob);
              const out = document.createElement("canvas"); out.width = bitmap.width; out.height = bitmap.height;
              out.getContext("2d").drawImage(bitmap, 0, 0); bitmap.close();
              const at = (x, y) => [...out.getContext("2d").getImageData(x, y, 1, 1).data];
              return { boundary: at(100, 48), candidate: at(100, 80), hidden: at(100, 110),
                baseRed: at(mirror ? 231 : 24, 16), baseCyan: at(mirror ? 167 : 88, 16), width: out.width, height: out.height };
            };
            try {
              await actions.exportCurrentImage();
              const visible = await pixels(saved);
              let videoPixels = null;
              if (!mirror && zoom === 0.75) {
                await actions.toggleRecording();
                await new Promise(resolve => setTimeout(resolve, 650));
                svg.querySelector("[data-boundary]").setAttribute("d", "M32 96 L224 96");
                await new Promise(resolve => setTimeout(resolve, 800));
                actions.stop();
                const deadline = Date.now() + 5000;
                while (!saved?.type.startsWith("video/") && Date.now() < deadline) {
                  await new Promise(resolve => setTimeout(resolve, 25));
                }
                if (!saved?.type.startsWith("video/")) throw new Error("No real encoded video was produced");
                const url = URL.createObjectURL(saved);
                const video = document.createElement("video");
                video.muted = true; video.playsInline = true; video.src = url;
                document.body.append(video);
                const sample = () => {
                  const out = document.createElement("canvas"); out.width = 256; out.height = 128;
                  out.getContext("2d").drawImage(video, 0, 0, 256, 128);
                  const at = y => [...out.getContext("2d").getImageData(100, y, 1, 1).data];
                  return { old: at(48), moved: at(96), incision: at(80) };
                };
                try {
                  await video.play();
                  await new Promise(resolve => setTimeout(resolve, 250));
                  const early = sample();
                  await new Promise(resolve => setTimeout(resolve, 800));
                  videoPixels = { early, late: sample(), bytes: saved.size, mime: saved.type };
                } finally { video.pause(); video.remove(); URL.revokeObjectURL(url); }
                svg.querySelector("[data-boundary]").setAttribute("d", "M32 48 L224 48");
              }
              svg.style.display = "none";
              await actions.exportCurrentImage();
              const hidden = await pixels(saved);
              svg.style.display = "";
              svg.querySelector("[data-boundary]").setAttribute("d", "");
              await actions.exportCurrentImage();
              const cleared = await pixels(saved);
              return { visible, hidden, cleared, errors, videoPixels };
            } finally { actions.stop(); wrap.remove(); }
          }, { mirror, zoom });
          assert.deepEqual(result.errors, []);
          assert.deepEqual(result.visible.boundary, [255, 255, 0, 255], "yellow lesion layer must be in exported PNG");
          assert.deepEqual(result.visible.candidate, [0, 0, 255, 255], "blue incision layer must be in exported PNG");
          assert.deepEqual(result.visible.baseRed, [255, 0, 0, 255], "existing base layer and mirror must be preserved");
          assert.deepEqual(result.visible.baseCyan, [0, 255, 255, 255]);
          assert.deepEqual(result.visible.hidden, [0, 0, 0, 255]);
          assert.deepEqual(result.hidden.boundary, [0, 0, 0, 255]);
          assert.deepEqual(result.cleared.boundary, [0, 0, 0, 255]);
          assert.equal(result.visible.width, 256); assert.equal(result.visible.height, 128);
          if (result.videoPixels) {
            const { early, late } = result.videoPixels;
            assert.ok(early.old[0] > 200 && early.old[1] > 200 && early.old[2] < 70, "encoded early video contains lesion overlay");
            assert.ok(late.moved[0] > 200 && late.moved[1] > 200 && late.moved[2] < 70, "encoded video follows overlay updates");
            assert.ok(late.old[0] < 70 && late.old[1] < 70, "video must not retain stale overlay pixels");
            assert.ok(late.incision[2] > 180 && late.incision[0] < 70, "encoded video contains incision overlay");
          }
          results.push({ mobile, mirror, zoom, png: "PASS", video: result.videoPixels ? "PASS" : "covered-in-unmirrored-case" });
        }
      }
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: "PASS", results, excludes: ["real-phone", "clinical-effect", "algorithm-equivalence"] }, null, 2));
} finally { await browser.close(); }
