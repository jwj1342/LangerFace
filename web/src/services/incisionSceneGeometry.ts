import * as THREE from "three";

import type { Triangle, Vec3 } from "./softBody";

export type VectorLike = ArrayLike<number>;

export const subtract3 = (a: VectorLike, b: VectorLike): Vec3 =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const add3 = (a: VectorLike, b: VectorLike): Vec3 =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const scale3 = (vector: VectorLike, scalar: number): Vec3 =>
  [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];

export const dot3 = (a: VectorLike, b: VectorLike): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const length3 = (vector: VectorLike): number =>
  Math.hypot(vector[0], vector[1], vector[2]);

export const normalize3 = (vector: VectorLike): Vec3 => {
  const length = length3(vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

export const cross3 = (a: VectorLike, b: VectorLike): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

export function meanMeshEdgeLength(vertices: Vec3[], triangles: Triangle[]): number {
  let total = 0;
  let count = 0;
  for (const [a, b, c] of triangles) {
    for (const [first, second] of [[a, b], [b, c], [c, a]]) {
      total += length3(subtract3(vertices[first], vertices[second]));
      count += 1;
    }
  }
  return count ? total / count : 1;
}

export function tangentFrame(
  normal: VectorLike,
  axis: VectorLike = [1, 0, 0],
): { u: Vec3; v: Vec3 } {
  const initial = normalize3(cross3(normal, axis));
  const u: Vec3 = length3(initial) > 0 ? initial : [1, 0, 0];
  const v = normalize3(cross3(normal, u));
  return { u, v };
}

function lineGeometry(points: VectorLike[]): THREE.BufferGeometry {
  const positions = points.flatMap((point) => [point[0], point[1], point[2]]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export function buildRingGeometry(
  center: VectorLike,
  normal: VectorLike,
  radius: number,
  meanEdgeLength: number,
): THREE.BufferGeometry {
  const { u, v } = tangentFrame(normal, [0, 1, 0]);
  const lift = meanEdgeLength * 0.18;
  const points: Vec3[] = [];
  for (let index = 0; index <= 72; index += 1) {
    const angle = index / 72 * Math.PI * 2;
    points.push(add3(
      add3(center, scale3(u, Math.cos(angle) * radius)),
      add3(scale3(v, Math.sin(angle) * radius), scale3(normal, lift)),
    ));
  }
  return lineGeometry(points);
}

export function buildBoundaryGeometry(
  points: VectorLike[],
  normal: VectorLike,
  meanEdgeLength: number,
  closed = true,
): THREE.BufferGeometry {
  const lift = meanEdgeLength * 0.22;
  const lifted = (closed && points.length ? points.concat([points[0]]) : points)
    .map((point) => add3(point, scale3(normal, lift)));
  return lineGeometry(lifted);
}

export function buildPolylineGeometry(
  points: VectorLike[],
  normal: VectorLike,
  meanEdgeLength: number,
): THREE.BufferGeometry {
  const lift = meanEdgeLength * 0.32;
  return lineGeometry(points.map((point) => add3(point, scale3(normal, lift))));
}
