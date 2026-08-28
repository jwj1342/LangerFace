import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

const FACE_PAIR_JPEG = readFileSync(new URL(
  "../../compat/personalized/v6_demo/id_003/rstl_before_after.jpg",
  import.meta.url,
)).toString("base64");
// VP8 fixture derived from the first authorized face above; pre-encoding keeps CI decoding deterministic.
const FACE_VIDEO_WEBM = readFileSync(new URL(
  "../fixtures/authorized-demo-face.webm.base64",
  import.meta.url,
), "utf8").trim();

export interface ControlledMarkerFixture {
  xRatio: number;
  yRatio: number;
  radiusRatio?: number;
  interiorRetrace?: boolean;
  strokeOpacity?: number;
}

export async function uploadGeneratedPhoto(
  page: Page,
  mode: "single" | "multiple" | "blank",
  inputSelector = "#incisionPhotoInput",
) {
  await page.evaluate(async ({ base64, uploadMode, selector }) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error("incision photo input is missing");

    let file: File;
    if (uploadMode === "blank") {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2d context is missing");
      context.fillStyle = "#d8dee7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("blank PNG encoding failed")),
        "image/png",
      ));
      file = new File([blob], "blank.png", { type: "image/png" });
    } else {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const sourceBlob = new Blob([bytes], { type: "image/jpeg" });
      if (uploadMode === "multiple") {
        file = new File([sourceBlob], "two-faces.jpg", { type: "image/jpeg" });
      } else {
        const bitmap = await createImageBitmap(sourceBlob);
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(bitmap.width / 2);
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2d context is missing");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("face JPEG encoding failed")),
          "image/jpeg",
          0.94,
        ));
        file = new File([blob], "single-face.jpg", { type: "image/jpeg" });
      }
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { base64: FACE_PAIR_JPEG, uploadMode: mode, selector: inputSelector });
}

export async function uploadGeneratedPhotoWithControlledMarkers(
  page: Page,
  markers: ControlledMarkerFixture[],
  inputSelector = "#incisionPhotoInput",
) {
  await page.evaluate(async ({ base64, markerFixtures, selector }) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error("incision photo input is missing");

    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(bitmap.width / 2);
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("controlled-marker fixture context is missing");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    for (const marker of markerFixtures) {
      const radius = Math.max(14, canvas.width * (marker.radiusRatio ?? 0.043));
      const centerX = canvas.width * marker.xRatio;
      const centerY = canvas.height * marker.yRatio;
      const radiusY = radius * 0.82;
      const rotation = 0.12;
      context.save();
      context.beginPath();
      context.ellipse(
        centerX,
        centerY,
        radius,
        radiusY,
        rotation,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = "#160d0a";
      context.lineWidth = Math.max(5, canvas.width * 0.008);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.globalAlpha = marker.strokeOpacity ?? 1;
      context.stroke();
      if (marker.interiorRetrace) {
        const chordAngle = 0.7;
        const endpoint = (angle: number) => ({
          x: centerX + radius * Math.cos(angle) * Math.cos(rotation)
            - radiusY * Math.sin(angle) * Math.sin(rotation),
          y: centerY + radius * Math.cos(angle) * Math.sin(rotation)
            + radiusY * Math.sin(angle) * Math.cos(rotation),
        });
        const first = endpoint(chordAngle);
        const second = endpoint(chordAngle + Math.PI);
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      }
      context.restore();
    }

    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("controlled-marker PNG encoding failed")),
      "image/png",
    ));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "controlled-marker-face.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { base64: FACE_PAIR_JPEG, markerFixtures: markers, selector: inputSelector });
}

export async function clickPhotoRatio(page: Page, point: { xRatio: number; yRatio: number }) {
  const canvas = page.locator("#incisionPhotoCanvas");
  await expect(canvas).toHaveAttribute("data-active", "true");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("incision photo canvas has no layout box");
  await canvas.click({ position: { x: box.width * point.xRatio, y: box.height * point.yRatio } });
}

export async function pickSafePhotoCheek(page: Page) {
  const canvas = page.locator("#incisionPhotoCanvas");
  await expect(canvas).toHaveAttribute("data-active", "true", { timeout: 45_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("incision photo canvas has no layout box");
  await canvas.click({ position: { x: box.width * 0.72, y: box.height * 0.5 } });
}

export async function uploadGeneratedVideo(page: Page, inputSelector = "#fileInput") {
  return page.evaluate(async ({ base64, selector }) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error("live media input is missing");
    const video = document.querySelector<HTMLVideoElement>("#video");
    if (!video) throw new Error("live video element is missing");
    if (typeof video.requestVideoFrameCallback !== "function") {
      throw new Error("video frame callbacks are unavailable");
    }
    const presentedFrame = new Promise<{
      mediaTime: number;
      presentedFrames: number;
      width: number;
      height: number;
    }>((resolve, reject) => {
      let callbackId: number | null = null;
      const onLoadedData = () => {
        callbackId = video.requestVideoFrameCallback((_now, metadata) => {
          window.clearTimeout(timeoutId);
          resolve({
            mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames,
            width: metadata.width,
            height: metadata.height,
          });
        });
      };
      const timeoutId = window.setTimeout(() => {
        video.removeEventListener("loadeddata", onLoadedData);
        if (callbackId != null) video.cancelVideoFrameCallback(callbackId);
        reject(new Error("uploaded video did not present a decoded frame"));
      }, 15_000);
      video.addEventListener("loadeddata", onLoadedData, { once: true });
    });
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "authorized-demo-face.webm", { type: "video/webm" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return presentedFrame;
  }, { base64: FACE_VIDEO_WEBM, selector: inputSelector });
}

export async function installGeneratedCamera(page: Page) {
  await page.evaluate(async ({ base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(bitmap.width / 2);
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("camera fixture context is missing");
    let frame = 0;
    const drawFrame = () => {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      context.fillStyle = frame % 2 === 0 ? "#101820" : "#111921";
      context.fillRect(canvas.width - 2, canvas.height - 2, 2, 2);
      frame += 1;
    };
    drawFrame();
    const stream = canvas.captureStream(24);
    const interval = window.setInterval(drawFrame, 42);
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track);
      track.stop = () => {
        window.clearInterval(interval);
        bitmap.close();
        stop();
      };
    }
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => stream,
    });
  }, { base64: FACE_PAIR_JPEG });
}

export async function findPhotoEndpointHandles(page: Page) {
  return page.locator(".incision-photo-endpoint-handle:not([hidden])").evaluateAll((handles) => handles.map((handle) => {
    const rect = handle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }));
}

export async function dragFirstPhotoEndpoint(page: Page, fraction = 0.22) {
  await page.locator("#incisionPhotoCanvas").scrollIntoViewIfNeeded();
  const endpointHandles = await findPhotoEndpointHandles(page);
  expect(endpointHandles).toHaveLength(2);
  const [firstHandle, secondHandle] = endpointHandles;
  await page.mouse.move(firstHandle.x, firstHandle.y);
  await page.mouse.down();
  await page.mouse.move(
    firstHandle.x + (secondHandle.x - firstHandle.x) * fraction,
    firstHandle.y + (secondHandle.y - firstHandle.y) * fraction,
    { steps: 8 },
  );
  await page.mouse.up();
}
