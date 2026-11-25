import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync(new URL('../web/src/services/render2d.ts', import.meta.url), 'utf8');
const start = source.indexOf('function smooth0119EndpointDisplayLines(');
const end = source.indexOf('\ntype AnyRecord', start);
assert.ok(start >= 0 && end > start, 'exercise the production endpoint smoother');
const smooth = new Function('RSTL_0119_NAMES', 'RSTL_0118_NAMES',
  stripTypeScriptTypes(source.slice(start, end)) + ';return smooth0119EndpointDisplayLines;')(
    new Set(['standard_field_0119_left', 'standard_field_0119_right']),
    new Set(['standard_field_0118_left', 'standard_field_0118_right']),
  );
// Frozen output hashes were captured from the pre-optimization smoother.
const expected: Record<string, string> = {
  "11:320": "01559d129292996b841ca750b7606d01291c3a9383e3a80b6e65008cf3a3e61d",
  "11:640": "01559d129292996b841ca750b7606d01291c3a9383e3a80b6e65008cf3a3e61d",
  "11:1400": "01559d129292996b841ca750b7606d01291c3a9383e3a80b6e65008cf3a3e61d",
  "12:320": "bda02c2ee4c5437820b841c88bc069309bfa2eabf970d79223bd9b08ea375ac0",
  "12:640": "136aa0d2ad1500dca6c680160225c06aa75005f3b6255a748873b7bd7fb46ca1",
  "12:1400": "4d0531a880a3d3e1608923dba76926ca38108c96a468e157a9b688d669e4a01f",
  "13:320": "cd6aaf2e0d9c7b26eeb33cc450aad56d4555cf5e6dd5ec84c429d5bac7094c60",
  "13:640": "bbe20b8bceecbf3caf08dee3d15f708ad6428c4f71d3fcbeba0e91e65eaf2a2e",
  "13:1400": "145c6d2440bf2b151df9c6691c59ea607f7b722bf28889b60e797d264ea487e1",
  "40:320": "c2230500a980f4c3cd5f2b29771738a50f9b745f43f823471c7d9da4fef974fe",
  "40:640": "3068fedc322a340b8ae7341ba29d599b8c01072fecec270d1e78ae22159e05e8",
  "40:1400": "b6f0459173d37a5f06493d8a118bf04c043cf21cf4eddc2395322f133ce7879b",
  "100:320": "a2953fd973c08e9a951bdccb5b8d896a8e5938483f3d26d4a4655655dfd3efd1",
  "100:640": "9318d3766f08b7ac03b61b42d49aca0680c0d0fd6b61a1d39d80a9b533ff54d7",
  "100:1400": "e3fd15f1bfc9d2a3ed363964274961200da9b4c4f284502351c3b1c2c0eb7461",
  "250:320": "58f1c33014d46a6b9a571621db15660f8e698dab49dbb24aa21d38e0ae51c7fb",
  "250:640": "8bcfa43ed7cc27ae051d4497fe744be9ace6d25729ab13fb130d83ca6756c27e",
  "250:1400": "7678df826cb4440554414a8640aee8f1af85c015ab142aa59708f55fd501aca4"
};
for (const count of [11, 12, 13, 40, 100, 250]) for (const height of [320, 640, 1400]) {
  const lines = ['0118_left', '0118_right', '0119_left', '0119_right', '0117_left'].map((name, i) => ({
    name: 'standard_field_' + name, region: 'cheek', hiddenPointRuns: [[1, 2]],
    pts: Array.from({ length: count }, (_, j) =>
      [10 + j + Math.sin(j / 3), 80 + i * 10 + Math.cos(j / 4), -j / 50]),
  }));
  const original = structuredClone(lines);
  const result = smooth(lines, height);
  const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  assert.equal(hash, expected[`${count}:${height}`], 'exact pre-optimization numeric output');
  assert.deepStrictEqual(lines, original, 'smoothing must not mutate input or hidden runs');
  if (count >= 12) {
    result[0].pts[0][0] += 1;
    assert.deepStrictEqual(lines, original, 'modified result must not alias input points');
  }
}
console.log('RSTL endpoint smoothing: 18 frozen-output and input-isolation cases passed');
