import cvReady from "@techstark/opencv-js";
import type { CV } from "@techstark/opencv-js";

// Hide the thenable CommonJS export behind a normal ESM function. Importing
// the package namespace directly is unsafe with the browser bundler's interop.
export async function loadMarkerOpenCv(): Promise<CV> {
  return await cvReady;
}
