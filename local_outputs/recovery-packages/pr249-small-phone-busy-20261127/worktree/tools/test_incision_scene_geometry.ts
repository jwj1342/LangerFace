import assert from "node:assert/strict";

import {
  add3,
  buildBoundaryGeometry,
  buildPolylineGeometry,
  buildRingGeometry,
  clamp,
  cross3,
  dot3,
  length3,
  meanMeshEdgeLength,
  normalize3,
  scale3,
  subtract3,
  tangentFrame,
} from "../web/src/services/incisionSceneGeometry.ts";

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

assert.deepEqual(add3([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
assert.deepEqual(subtract3([4, 5, 6], [1, 2, 3]), [3, 3, 3]);
assert.deepEqual(scale3([1, 2, 3], 2), [2, 4, 6]);
assert.equal(dot3([1, 2, 3], [4, 5, 6]), 32);
assert.deepEqual(cross3([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
assert.equal(length3([3, 4, 0]), 5);
near(length3(normalize3([3, 4, 0])), 1);
assert.equal(clamp(4, 0, 3), 3);

const frame = tangentFrame([0, 0, 1], [0, 1, 0]);
near(length3(frame.u), 1);
near(length3(frame.v), 1);
near(dot3(frame.u, frame.v), 0);
near(dot3(frame.u, [0, 0, 1]), 0);
near(dot3(frame.v, [0, 0, 1]), 0);

near(
  meanMeshEdgeLength(
    [[0, 0, 0], [3, 0, 0], [0, 4, 0]],
    [[0, 1, 2]],
  ),
  4,
);
assert.equal(meanMeshEdgeLength([], []), 1);

const ring = buildRingGeometry([1, 2, 3], [0, 0, 1], 2, 10);
const ringPositions = ring.getAttribute("position");
assert.equal(ringPositions.count, 73);
near(ringPositions.getZ(0), 4.8);
near(ringPositions.getX(0), ringPositions.getX(72));
near(ringPositions.getY(0), ringPositions.getY(72));

const boundary = buildBoundaryGeometry(
  [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
  [0, 0, 1],
  10,
);
const boundaryPositions = boundary.getAttribute("position");
assert.equal(boundaryPositions.count, 4);
near(boundaryPositions.getZ(0), 2.2);
near(boundaryPositions.getX(0), boundaryPositions.getX(3));
near(boundaryPositions.getY(0), boundaryPositions.getY(3));

const polyline = buildPolylineGeometry([[0, 0, 0], [1, 0, 0]], [0, 0, 1], 10);
const polylinePositions = polyline.getAttribute("position");
assert.equal(polylinePositions.count, 2);
near(polylinePositions.getZ(0), 3.2);

ring.dispose();
boundary.dispose();
polyline.dispose();

console.log("test_incision_scene_geometry: pure vector and buffer geometry assertions passed");
