import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

const FACE_PAIR_JPEG = readFileSync(new URL(
  "../../compat/personalized/v6_demo/id_003/rstl_before_after.jpg",
  import.meta.url,
)).toString("base64");

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

export async function uploadGeneratedVideo(page: Page, inputSelector = "#fileInput") {
  await page.evaluate(async ({ base64, selector }) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error("live media input is missing");
    if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder is unavailable");

    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(bitmap.width / 2);
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("video fixture context is missing");
    const stream = canvas.captureStream(15);
    const mimeType = ["video/webm;codecs=vp8", "video/webm"]
      .find((value) => MediaRecorder.isTypeSupported(value));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: BlobPart[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener("error", () => reject(recorder.error || new Error("video fixture recording failed")), { once: true });
    });

    recorder.start(100);
    for (let frame = 0; frame < 18; frame += 1) {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      context.fillStyle = frame % 2 === 0 ? "#101820" : "#111921";
      context.fillRect(canvas.width - 2, canvas.height - 2, 2, 2);
      await new Promise((resolve) => setTimeout(resolve, 67));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    bitmap.close();

    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    if (blob.size === 0) throw new Error("video fixture is empty");
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "authorized-demo-face.webm", { type: "video/webm" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { base64: FACE_PAIR_JPEG, selector: inputSelector });
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
