import assert from 'node:assert/strict';
import { LivePreviewCadence } from '../web/src/services/livePreviewCadence.ts';

const cadence = new LivePreviewCadence();
assert.equal(cadence.shouldDraw(0), true);
assert.equal(cadence.shouldDraw(30), false);
assert.equal(cadence.shouldDraw(65), false);
assert.equal(cadence.shouldDraw(67), true);
assert.equal(cadence.shouldDraw(70, true), true, 'paused and static edits update immediately');
assert.equal(cadence.shouldDraw(71), false);
cadence.reset();
assert.equal(cadence.shouldDraw(72), true, 'source/visibility changes cannot keep stale previews');
assert.equal(cadence.shouldDraw(0), true, 'clock reset must not block rendering');
console.log('ok: secondary previews are bounded, resettable, and immediate when forced');
