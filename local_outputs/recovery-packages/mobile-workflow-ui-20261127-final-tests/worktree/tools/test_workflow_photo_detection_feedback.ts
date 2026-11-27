import assert from "node:assert/strict";
import { createPhotoPlanningController } from "../web/src/services/photoPlanningController.ts";
import { workflowPhotoDetectionFeedback } from "../web/src/services/workflowControllerUtils.ts";
import { MarkerRunDiagnostics, auditMarkerDiagnosticExport } from "../web/src/services/controlledMarkerRunDiagnostics.ts";

const planning = createPhotoPlanningController({ owner: "live" });
assert.equal(workflowPhotoDetectionFeedback(planning.getSnapshot()), null);
const revision = planning.replaceSource({ source: {}, kind: "image", width: 1199, height: 1600 });
planning.setDetection({ sourceRevision: revision, status: "detecting" });
assert.equal(workflowPhotoDetectionFeedback(planning.getSnapshot()), null);

for (const [reason, copy] of [
  ["multiple_faces", /多个人脸候选/],
  ["no_face", /未检测到人脸/],
  ["detection_error", /检测失败/],
  ["other_failure", /other_failure/],
  ["private-patient@example.com", /unknown_detection_failure/],
] as const) {
  planning.setDetection({ sourceRevision: revision, status: "failed", reason, attempts: 3 });
  const snapshot = planning.getSnapshot();
  const before = JSON.stringify(snapshot);
  const feedback = workflowPhotoDetectionFeedback(snapshot)!;
  assert.match(feedback.message, copy);
  assert.match(feedback.message, /检测 3 次/);
  assert.equal(feedback.failed, true);
  assert.equal(feedback.sourceRevision, revision);
  assert.equal(feedback.width, 1199);
  assert.equal(feedback.height, 1600);
  assert.equal(JSON.stringify(snapshot), before, "feedback must not mutate detection or its acceptance gate");
  assert.equal(workflowPhotoDetectionFeedback({
    ...snapshot, detection: { ...snapshot.detection, source_revision: revision - 1 },
  }), null, "stale detection must not explain a different upload");
}

planning.setDetection({ sourceRevision: revision, status: "ready", landmarks: [[1, 2, 3]], attempts: 1 });
const ready = workflowPhotoDetectionFeedback(planning.getSnapshot())!;
assert.equal(ready.failed, false);
assert.equal(ready.message, "", "a successful replacement must clear the previous failure");
assert.equal(ready.reason, "single_face_ready");
assert.equal(ready.landmarkCount, 1);
planning.replaceSource({ source: {}, kind: "video", width: 1280, height: 720 });
assert.equal(workflowPhotoDetectionFeedback(planning.getSnapshot()), null);

const doc = new EventTarget();
const win = new EventTarget();
Object.defineProperties(globalThis, {
  document: { configurable: true, value: doc },
  window: { configurable: true, value: win },
});
const diagnostics = new MarkerRunDiagnostics(() => ({ kind: "image", revision, width: 1199, height: 1600 }));
await diagnostics.whenReady();
assert.ok(diagnostics.recordAction({
  domain: "photo_detection", action: "image_face_detection", stage: "failed", reason: "multiple_faces",
  details: {
    status: "failed", reason: "multiple_faces", source_revision: revision,
    width: 1199, height: 1600, attempts: 1, accepted_landmark_count: 0,
    blocked_actions: ["zoom_regions", "controlled_marker"],
    message: "人脸检测返回了多个人脸候选，单人脸检查未通过；子图和标记暂不可用。",
  },
}));
const exported = JSON.parse(diagnostics.exportSession());
assert.equal(exported.action_events.at(-1).reason, "multiple_faces");
assert.equal(exported.action_events.at(-1).details.source_revision, revision);
assert.equal(auditMarkerDiagnosticExport(exported).passed, true);
diagnostics.dispose();
planning.dispose();
console.log("PASS photo detection failure feedback, stale/ready transitions, and diagnostic privacy/export");
