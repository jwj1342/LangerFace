import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lineIndicesForDensity } from "../web/src/services/lineDensity.ts";

const atlas = JSON.parse(readFileSync(new URL("../web/assets/atlas_rstl.json", import.meta.url), "utf8"));
const lines = atlas.lines;

function assertCompleteMirrorPairs(visible) {
  const byName = new Map(lines.map((line, index) => [line.name, index]));
  let left = 0;
  let right = 0;
  for (let index = 0; index < lines.length; index++) {
    const name = lines[index].name || "";
    const match = name.match(/^(.*)_(left|right)$/);
    if (!match) continue;
    const mirror = `${match[1]}_${match[2] === "left" ? "right" : "left"}`;
    assert.equal(visible.has(index), visible.has(byName.get(mirror)), `${name} must be selected with ${mirror}`);
    if (visible.has(index)) {
      if (match[2] === "left") left++;
      else right++;
    }
  }
  assert.equal(left, right, "visible left/right line counts must match");
}

for (const density of [0.12, 0.25, 0.5, 0.75, 1]) {
  const visible = lineIndicesForDensity(lines, density);
  assertCompleteMirrorPairs(visible);
  assert.ok(visible.size > 0);
  assert.ok(Math.abs(visible.size - lines.length * density) <= 3, `density ${density} should stay near its target`);
}

const generic = [
  { name: "cheek_left_01" },
  { name: "cheek_right_01" },
  { name: "nose_midline" },
  { name: "jaw_l" },
  { name: "jaw_r" },
];
const genericVisible = lineIndicesForDensity(generic, 0.5);
assert.equal(genericVisible.has(0), genericVisible.has(1));
assert.equal(genericVisible.has(3), genericVisible.has(4));
assert.deepEqual([...lineIndicesForDensity(generic, 1)], [0, 1, 2, 3, 4]);
assert.equal(lineIndicesForDensity(generic, 0).size, 0);

console.log("ok: line density preserves complete left/right symmetry groups");
