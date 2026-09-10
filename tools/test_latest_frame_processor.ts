import assert from 'node:assert/strict';

import { LatestFrameProcessor } from '../web/src/services/latestFrameProcessor.ts';

type Frame = { id: number; timestamp: number };
type Deferred = { resolve: (value: string) => void; reject: (error: Error) => void };
const deferred = new Map<number, Deferred>();
let concurrent = 0;
let maximumConcurrent = 0;
const committed: Array<{ result: string; frame: Frame }> = [];
const errors: number[] = [];
const processor = new LatestFrameProcessor<Frame, string>({
  timestamp: frame => frame.timestamp,
  process: frame => {
    concurrent += 1;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    return new Promise<string>((resolve, reject) => deferred.set(frame.id, {
      resolve: value => { concurrent -= 1; resolve(value); },
      reject: error => { concurrent -= 1; reject(error); },
    }));
  },
  commit: (result, frame) => committed.push({ result, frame }),
  onError: (_error, frame) => errors.push(frame.id),
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

processor.submit({ id: 1, timestamp: 1 });
await tick();
processor.submit({ id: 2, timestamp: 2 });
processor.submit({ id: 3, timestamp: 3 });
assert.equal(processor.diagnostics().droppedBeforeStart, 1);
deferred.get(1)?.resolve('one');
await tick();
assert.deepEqual(committed, [], 'an in-flight result is not committed when a newer frame waits');
assert.ok(deferred.has(3));
assert.ok(!deferred.has(2), 'an unstarted intermediate frame is discarded');
deferred.get(3)?.resolve('three');
await processor.waitForIdle();
assert.deepEqual(committed.map(item => item.frame.id), [3]);
assert.equal(maximumConcurrent, 1);

processor.submit({ id: 4, timestamp: 4 });
await tick();
deferred.get(4)?.reject(new Error('expected'));
await processor.waitForIdle();
assert.deepEqual(errors, [4]);

processor.submit({ id: 5, timestamp: 5 });
await tick();
processor.cancel();
deferred.get(5)?.resolve('cancelled');
await processor.waitForIdle();
assert.deepEqual(committed.map(item => item.frame.id), [3], 'cancel invalidates an in-flight generation');

processor.submit({ id: 6, timestamp: 6 });
await tick();
deferred.get(6)?.resolve('six');
await processor.waitForIdle();
assert.deepEqual(committed.map(item => item.frame.id), [3, 6]);

processor.submit({ id: 7, timestamp: 7 });
await tick();
processor.submit({ id: 8, timestamp: 8 });
deferred.get(7)?.reject(new Error('superseded failure'));
await tick();
assert.deepEqual(errors, [4], 'a stale request failure does not clear a newer pending result');
deferred.get(8)?.resolve('eight');
await processor.waitForIdle();
assert.deepEqual(committed.map(item => item.frame.id), [3, 6, 8]);
assert.deepEqual(processor.diagnostics(), {
  submitted: 8,
  started: 7,
  committed: 3,
  droppedBeforeStart: 1,
  supersededInFlight: 2,
  errors: 1,
  active: false,
  pending: false,
  lastCommittedTimestamp: 8,
});
console.log('latest-frame processor: one in flight, latest pending, timestamped commit and cancellation passed');
