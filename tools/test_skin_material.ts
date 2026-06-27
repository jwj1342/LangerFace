import assert from "node:assert/strict";
import { createSkinMaterial, meshBounds } from "../web/src/services/skinMaterial.ts";

const verts = [
  [-2, -4, -1],
  [2, 6, 3],
  [0, 1, 0],
];

const bounds = meshBounds(verts);
assert.deepEqual(bounds.center, [0, 1, 1]);
assert.deepEqual(bounds.extent, [2, 5, 2]);

const material = createSkinMaterial(verts);
const shader = {
  uniforms: {},
  vertexShader: "#include <common>\n#include <begin_vertex>",
  fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>",
};
material.onBeforeCompile(shader);

assert.equal(material.roughness, 0.72);
assert.equal(material.metalness, 0);
assert.equal(material.customProgramCacheKey(), "langerface-skin-v1");
assert.deepEqual(shader.uniforms.skinCenter.value.toArray(), [0, 1, 1]);
assert.match(shader.fragmentShader, /skinPores/);
assert.match(shader.fragmentShader, /skinLips/);
assert.match(shader.fragmentShader, /roughnessFactor = clamp/);
assert.match(shader.fragmentShader, /skinHeight/);
assert.match(shader.vertexShader, /vSkinPosition = position/);

material.dispose();
console.log("ok: procedural skin material contract");
