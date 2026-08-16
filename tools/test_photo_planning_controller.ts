import assert from "node:assert/strict";
import fs from "node:fs";

import {
  PHOTO_PLANNING_SNAPSHOT_SCHEMA,
  canvasPointToSource,
  clientPointToSource,
  createPhotoPlanningController,
  createPhotoPlanningTransform,
  sourcePointToCanvas,
  sourcePointToClient,
  sourcePointToSurfaceRef,
  surfaceRefToSourcePoint,
} from "../web/src/services/photoPlanningController.ts";
import { buildForeheadSurfaceLandmarks } from "../web/src/services/incisionPhotoPlanning.ts";
import type { Triangle, Vec3 } from "../web/src/services/softBody.ts";

const close = (actual: number, expected: number, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

const landmarks: Vec3[] = [
  [0, 0, 0],
  [1000, 0, 0],
  [0, 500, 0],
  [1000, 500, 0],
];
const triangles: Triangle[] = [[0, 1, 2], [1, 3, 2]];

for (const mirror of [false, true]) {
  for (const devicePixelRatio of [1, 2]) {
    const transform = createPhotoPlanningTransform(1000, 500, {
      viewportLeft: 40,
      viewportTop: 25,
      viewportWidth: 800,
      viewportHeight: 700,
      canvasWidth: 1000 * devicePixelRatio,
      canvasHeight: 500 * devicePixelRatio,
      zoom: 2.2,
      offsetX: 37,
      offsetY: -19,
      mirror,
      devicePixelRatio,
    });
    assert.ok(transform);
    const source = { x: 322.5, y: 217.25 };
    const client = sourcePointToClient(source, transform);
    assert.ok(client);
    const roundTrip = clientPointToSource(client, transform);
    assert.ok(roundTrip);
    close(roundTrip.x, source.x);
    close(roundTrip.y, source.y);

    const canvas = sourcePointToCanvas(source, transform);
    const sourceFromCanvas = canvasPointToSource(canvas, transform);
    close(sourceFromCanvas.x, source.x);
    close(sourceFromCanvas.y, source.y);
    close(canvas.x, source.x * devicePixelRatio);
    close(canvas.y, source.y * devicePixelRatio);
  }
}

const picked = sourcePointToSurfaceRef({ x: 250, y: 125 }, landmarks, triangles);
assert.ok(picked);
assert.equal(picked.tri, 0);
close(picked.u + picked.v + picked.w, 1);
const mapped = surfaceRefToSourcePoint(picked, landmarks, triangles);
assert.ok(mapped);
close(mapped.x, 250);
close(mapped.y, 125);
assert.equal(sourcePointToSurfaceRef({ x: -5, y: -5 }, landmarks, triangles), null);

const foreheadLandmarks = Array.from({ length: 468 }, () => [500, 300, 0] as Vec3);
foreheadLandmarks[9] = [500, 260, 0];
foreheadLandmarks[10] = [500, 180, 0];
foreheadLandmarks[109] = [430, 190, 0];
foreheadLandmarks[338] = [570, 190, 0];
foreheadLandmarks[108] = [450, 230, 0];
const foreheadTriangles: Triangle[] = [[109, 108, 10]];
const expandedForeheadLandmarks = buildForeheadSurfaceLandmarks(foreheadLandmarks);
assert.ok(expandedForeheadLandmarks[10][1] < foreheadLandmarks[10][1],
  "photo surface extends the forehead contour upward from the detected top boundary");
const expandedOnlyPoint = {
  x: (expandedForeheadLandmarks[109][0] + expandedForeheadLandmarks[108][0] + expandedForeheadLandmarks[10][0]) / 3,
  y: (expandedForeheadLandmarks[109][1] + expandedForeheadLandmarks[108][1] + expandedForeheadLandmarks[10][1]) / 3,
};
assert.equal(sourcePointToSurfaceRef(expandedOnlyPoint, foreheadLandmarks, foreheadTriangles), null,
  "the synthetic point is outside the raw MediaPipe forehead triangle");
assert.ok(sourcePointToSurfaceRef(expandedOnlyPoint, expandedForeheadLandmarks, foreheadTriangles),
  "the same visible forehead point is pickable on the controlled extended surface");

let nextFrameId = 1;
const scheduled = new Map<number, () => void>();
const snapshots: unknown[] = [];
const frames: unknown[] = [];
let releasedSources = 0;
let releasedDetectors = 0;
const controller = createPhotoPlanningController({
  owner: "live",
  onSnapshot: (snapshot) => snapshots.push(snapshot),
  onRender: (frame) => frames.push(frame),
  requestFrame: (callback) => {
    const id = nextFrameId++;
    scheduled.set(id, () => {
      scheduled.delete(id);
      callback();
    });
    return id;
  },
  cancelFrame: (id) => scheduled.delete(id),
});
controller.setTopology(triangles);
controller.setDetectorLease({ detector: { name: "fake" }, release: () => { releasedDetectors += 1; } });
const firstSource = { privatePixels: true };
const firstRevision = controller.replaceSource({
  source: firstSource,
  kind: "image",
  width: 1000,
  height: 500,
  release: () => { releasedSources += 1; },
});
assert.equal(firstRevision, 1);
assert.equal(controller.detector(), controller.detector());
assert.equal(controller.setDetection({
  sourceRevision: firstRevision,
  status: "ready",
  landmarks,
  surfaceLandmarks: landmarks,
  attempts: 1,
}), true);
controller.setView({
  viewportLeft: 0,
  viewportTop: 0,
  viewportWidth: 1000,
  viewportHeight: 700,
  canvasWidth: 2000,
  canvasHeight: 1000,
  zoom: 1.5,
  mirror: true,
  devicePixelRatio: 2,
});
const centerClient = controller.sourceToClient({ x: 250, y: 125 });
assert.ok(centerClient);
const pickedFromClient = controller.pickSurfaceRef(centerClient);
assert.ok(pickedFromClient);
controller.setSelection({ centerRef: pickedFromClient, boundaryRefs: [pickedFromClient] });
controller.setOverlaySummary({ rstlLineCount: 133, tumorVisible: true, candidatePointCount: 24 });

const publicSnapshot = controller.getSnapshot();
assert.equal(publicSnapshot.schema_version, PHOTO_PLANNING_SNAPSHOT_SCHEMA);
assert.equal(publicSnapshot.source.revision, firstRevision);
assert.equal(publicSnapshot.detection.landmark_count, 4);
assert.equal(publicSnapshot.overlay.rstlLineCount, 133);
assert.equal(publicSnapshot.audit.raw_media_in_snapshot, false);
const serializedSnapshot = JSON.stringify(publicSnapshot);
assert.ok(!serializedSnapshot.includes("privatePixels"));
assert.ok(!serializedSnapshot.includes('"landmarks"'));

const frameState = controller.getFrameState();
assert.equal(frameState.source, firstSource);
assert.equal(frameState.landmarks, landmarks);
assert.equal(controller.setDetection({
  sourceRevision: firstRevision - 1,
  status: "failed",
  reason: "stale",
}), false, "stale detection cannot replace the active source result");

const secondRevision = controller.replaceSource({
  source: { second: true },
  kind: "image",
  width: 640,
  height: 480,
  release: () => { releasedSources += 1; },
});
assert.equal(secondRevision, 2);
assert.equal(releasedSources, 1, "replacing a source releases the previous resource exactly once");
assert.equal(controller.getSnapshot().detection.status, "idle");
assert.equal(controller.getSnapshot().selection.centerRef, null);
assert.deepEqual(controller.getSnapshot().selection.boundaryRefs, []);

for (const callback of [...scheduled.values()]) callback();
assert.ok(frames.length >= 1, "controller coalesces state changes into an injected render frame");
assert.ok(snapshots.length >= 1, "controller exposes low-frequency sanitized snapshots");

controller.dispose();
controller.dispose();
assert.equal(releasedSources, 2, "dispose releases the current source once");
assert.equal(releasedDetectors, 1, "dispose releases an owned detector lease once");
assert.equal(controller.getSnapshot().disposed, true);
assert.equal(scheduled.size, 0, "dispose cancels a pending render frame");
assert.throws(() => controller.replaceSource({ source: {}, kind: "image", width: 1, height: 1 }));

const remounted = createPhotoPlanningController({ owner: "live" });
assert.equal(remounted.replaceSource({ source: { remounted: true }, kind: "image", width: 320, height: 240 }), 1);
assert.equal(remounted.getSnapshot().source.kind, "image");
remounted.dispose();

const controllerSource = fs.readFileSync(new URL("../web/src/services/photoPlanningController.ts", import.meta.url), "utf8");
const liveRuntimeSource = fs.readFileSync(new URL("../web/src/services/liveRuntime.ts", import.meta.url), "utf8");
const incisionRuntimeSource = fs.readFileSync(new URL("../web/src/services/incisionRuntime.ts", import.meta.url), "utf8");
const liveStateSource = fs.readFileSync(new URL("../web/src/services/liveState.ts", import.meta.url), "utf8");
const pipelineSource = fs.readFileSync(new URL("../web/src/services/pipelineSource.ts", import.meta.url), "utf8");
const pipelineModelsSource = fs.readFileSync(new URL("../web/src/services/pipelineModels.ts", import.meta.url), "utf8");
assert.ok(!/\bdocument\b|\bwindow\b/.test(controllerSource), "shared controller must not query global DOM state");
assert.ok(!/\bfetch\s*\(/.test(controllerSource), "shared controller must not own a remote pipeline");
assert.ok(liveRuntimeSource.includes('createPhotoPlanningController({ owner: "live" })'));
assert.ok(incisionRuntimeSource.includes('createPhotoPlanningController({ owner: "incision" })'));
assert.ok(liveStateSource.includes("get source()"), "legacy live readers use a controller-backed source getter");
assert.ok(!pipelineSource.includes("sourceState.source ="), "live source adapter must not create a second raw-media owner");
assert.ok(pipelineSource.includes("planning2d.replaceSource({"), "live source changes enter the shared lifecycle controller");
assert.ok(!pipelineModelsSource.includes("./liveDom"), "shared MediaPipe initialization must not depend on the live route DOM");

console.log("test_photo_planning_controller: transforms, surface refs, ownership, stale isolation, and disposal passed");
