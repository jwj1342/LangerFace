import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

const FACE_PAIR_JPEG = readFileSync(new URL(
  "../../compat/personalized/v6_demo/id_003/rstl_before_after.jpg",
  import.meta.url,
)).toString("base64");

export async function uploadGeneratedPhoto(page: Page, mode: "single" | "multiple" | "blank") {
  await page.evaluate(async ({ base64, uploadMode }) => {
    const input = document.querySelector<HTMLInputElement>("#incisionPhotoInput");
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
  }, { base64: FACE_PAIR_JPEG, uploadMode: mode });
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
