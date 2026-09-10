import cvReady from "@techstark/opencv-js";

// Keep the thenable CommonJS export behind an ESM function. Dynamically importing
// it directly makes Rolldown's interop namespace inherit Promise.prototype.
export async function loadOpenCv(): Promise<typeof import("@techstark/opencv-js")> {
  return await cvReady;
}
