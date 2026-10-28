import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "../web/node_modules/typescript/lib/typescript.js";

// Execute the real controller branch with a deterministic detector/surface seam.
// This is a display/safety contract test, not an accuracy test of these fixtures.
const source = fs.readFileSync(process.env.CONTROLLER_SOURCE || new URL("../web/src/services/workflowIncisionController.ts", import.meta.url), "utf8");
assert.match(source, /interface RejectedMarkerPreview[\s\S]*?parameters: WorkflowMarkerRequestSnapshot;/,
  "rejected purple previews retain the marker parameters that produced them");
assert.match(source, /const rejectedFresh = Boolean\([\s\S]*?workflowMarkerRequestStillCurrent\(rejectedPreview\.parameters, markerRequestSnapshot\(state\)\)/,
  "rejected purple previews expire when marker parameters change");
assert.match(source, /rejectedPreview\.boundary\.map\(\(point\) => diagnosticSourceClientPoint\(state, \[point\.x, point\.y, 0\]\)\)/,
  "rejected purple previews use photo coordinates even when surface mapping fails");
assert.match(source, /rejectedMarkerPath\?\.setAttribute\("d", rejectedMapped\.length >= 3 \? pathData\(rejectedMapped, true\) : ""\)/,
  "rejected purple geometry is drawn only when every point maps to the current photo");
const start = source.indexOf("async function runControlledMarker(");
const end = source.indexOf("\nfunction pathData(", start);
assert(start >= 0 && end > start);
const js = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
const boundary = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }];
for (const condition of ["unmapped", "opening", "rejected", "stale"] as const) {
  const state: any = { mounted: true, markerBusy: false, markerMode: true, markerRequestId: 0, boundaryMode: "ellipse", repairStrokes: [], boundaryPhotoPoints: [], boundaryClosed: false, controlledBoundary: false, markerPreviewSuppressed: true };
  const frame = { source: {}, kind: "image", landmarks: [[0, 0, 0]], revision: 1, width: 32, height: 32 };
  let planned = 0;
  const context: any = {
    state, frame, console, Promise, Uint8ClampedArray,
    sourceState: { planning2d: { getFrameState: () => ({ ...frame }), setSelection: () => {} } },
    mobileWorkflowViewportActive: () => false,
    markerRequestSnapshot: () => ({ kind: "cutaneous", diameterMm: 8, depthMm: 6, marginMm: 0, scanDiameterMm: 20 }),
    workflowMarkerRequestStillCurrent: () => true,
    workflowPhotoProjection: () => ({ surfaceLandmarks: frame.landmarks }),
    controlledMarkerPixelsPerMm: () => 5,
    requestFrame: () => {},
    document: { createElement: () => ({ getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4) }) }) }) },
    prepareControlledMarkerAttempt: () => {}, drawRepairsToContext: () => {},
    markerDiagnostics: new WeakMap(), publish: () => {},
    completeControlledMarkerAttempt: () => { state.markerBusy = false; },
    workflowSurfaceRefAtSource: () => condition === "unmapped" ? null : { tri: 0 },
    surfaceRefToModelPoint: () => [0, 0, 0],
    buildTumorInput: (input: any) => input, withControlledMarkerProvenance: (input: any) => input,
    inspectTumorEngineeringExclusions: () => ({ passed: false }),
    controlledMarkerRepairable: () => false, controlledMarkerFailureMessage: () => "rejected",
    setStatus: (_state: any, status: string) => { state.stageStatus = status; },
    runWorkflow: () => { planned++; throw Error("unsafe generation"); },
    resetMarkerRepair: () => {},
    replay: { worker: { api: { detectControlledMarker: async () => {
      if (condition === "stale") frame.revision++;
      return { ok: condition !== "rejected", center: { x: 15, y: 15 }, boundary, geometry_mode: "dark_component", rejected_boundary: condition === "rejected" ? boundary : [] };
    } } } },
    Comlink: { transfer: (x: any) => x },
  };
  vm.createContext(context);
  await vm.runInContext(js + "\nrunControlledMarker(state, {x:15,y:15}, replay)", context);
  if (condition === "unmapped" || condition === "opening") {
    assert.deepEqual(JSON.parse(JSON.stringify(state.boundaryPhotoPoints)), boundary, condition);
    assert.equal(state.boundaryPhotoRevision, 1);
    assert.equal(state.boundaryClosed, true);
    assert.equal(state.controlledBoundary, true);
    assert.equal(state.markerPreviewSuppressed, false);
  } else {
    assert.equal(state.boundaryPhotoPoints.length, 0, "rejected/stale detection must not become an accepted yellow boundary");
  }
  assert.equal(planned, 0, "retaining photo geometry must not bypass surgical safety gates");
}
console.log("PASS yellow boundary independent of surface/opening gates; rejected/stale fail closed");
