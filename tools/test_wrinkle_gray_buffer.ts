import assert from 'node:assert/strict';
import {buildWrinkleTextureFrame} from '../web/src/services/liveWrinkleTextureTracking.ts';

// Exercise every RGB value, including rounding boundaries, with reused storage.
const rgba = new Uint8ClampedArray(256 * 256 * 4);
const buffer = new Uint8Array(256 * 256);
const expected = new Uint8Array(256 * 256);
for (let red = 0; red < 256; red++) {
  for (let i = 0; i < buffer.length; i++) {
    rgba[i * 4] = red;
    rgba[i * 4 + 1] = i >> 8;
    rgba[i * 4 + 2] = i & 255;
    rgba[i * 4 + 3] = 255;
    expected[i] = Math.round(red * 0.299 + (i >> 8) * 0.587 + (i & 255) * 0.114);
  }
  const fresh = buildWrinkleTextureFrame(rgba, 256, 256);
  const reused = buildWrinkleTextureFrame(rgba, 256, 256, 256, 256, buffer);
  assert.equal(reused.gray, buffer);
  assert.deepEqual(reused.gray, fresh.gray);
  assert.deepEqual(reused.gray, expected);
}
const resized = buildWrinkleTextureFrame(new Uint8ClampedArray(16), 2, 2, 2, 2, buffer);
assert.equal(resized.gray.length, 4);
assert.notEqual(resized.gray, buffer);
console.log('ok: all 16,777,216 RGB values produce identical gray bytes; resize replaces storage');
