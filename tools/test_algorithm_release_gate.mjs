import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import vm from "node:vm";

// Run the actual gate with an absent private archive, as on a fresh CI checkout.
// No source/acceptance check is removed from the gate under test.
const scopeBytes = Buffer.from('{}');
const scopeDigest = createHash('sha256').update(scopeBytes).digest('hex');
const identity = { profile: 'small-lesion-boundary-candidate', implementationVersion: '0.2.0-candidate.1',
  releaseName: '肿物识别：门禁测试', sourceDigest: 'source', algorithmDigest: 'algorithm' };
const release = {
  current: { profile: identity.profile, version: identity.implementationVersion,
    releaseName: identity.releaseName, nameKeywords: ['门禁测试'], sourceDigest: 'source', algorithmDigest: 'algorithm' },
  history: [{version: '0.1.0-candidate.1'}],
  archive: { status: 'verified', manifestPath: 'local_outputs/recovery-packages/test/manifest.json',
    manifestSha256: 'manifest', sourceDigest: 'source', scopeConfigSha256: scopeDigest },
  scopeBoundaryReview: { status: 'not_required' },
  operatorEvaluation: { status: 'accepted', sourceDigest: 'source', evidence: 'synthetic gate fixture' },
  editorSaveConfirmation: { status: 'confirmed', sourceDigest: 'source', confirmedAt: 'fixture' },
};
const source = readFileSync(new URL('./check_algorithm_release_gate.mjs', import.meta.url), 'utf8')
  .replace(/^#![^\n]*\n/, '')
  .replace(/^import [\s\S]*?;\s*$/gm, '')
  .replace('const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));', 'const repoRoot = resolve("fixture-repo");');
function run(ci, mode = 'deploy', changes = {}) {
  const fixture = structuredClone(release);
  for (const [key, values] of Object.entries(changes)) Object.assign(fixture[key], values);
  const messages = [];
  let exitCode = 0;
  const context = {
    createHash, basename, dirname, resolve, sep,
    TARGET_MARKER_PROFILE: identity.profile,
    captureMarkerIdentity: () => identity,
    readFileSync: (path) => String(path).endsWith('controlled-marker-release.json')
      ? JSON.stringify(fixture) : scopeBytes,
    existsSync: () => false,
    realpathSync: () => { throw new Error('must not resolve an absent private archive'); },
    process: { argv: ['node', 'gate', mode], env: { CI: ci }, exit: code => { exitCode = code; throw new Error('gate-exit'); } },
    console: { log: value => messages.push(value), error: value => messages.push(value) },
  };
  try { vm.runInNewContext(source, context); }
  catch (error) { if (error.message !== 'gate-exit') throw error; }
  return { exitCode, messages: messages.join('\n') };
}
assert.equal(run('true').exitCode, 0, 'CI may use the validated archive registration without private files');
assert.equal(run('true', 'pr').exitCode, 0, 'PR still requires the acceptance and editor fixtures');
assert.match(run(undefined).messages, /恢复包 manifest 不存在/, 'local missing archive remains blocked');
assert.equal(run(undefined).exitCode, 1);
assert.match(run('true', 'deploy', { archive: { sourceDigest: 'stale' } }).messages, /不是当前源码指纹/);
assert.equal(run('true', 'deploy', { current: { sourceDigest: 'stale' } }).exitCode, 1);
assert.equal(run('true', 'pr', { operatorEvaluation: { status: 'pending' } }).exitCode, 1);
assert.equal(run('true', 'pr', { editorSaveConfirmation: { status: 'unknown' } }).exitCode, 1);
console.log('algorithm release gate: fresh CI, missing local archive, stale identity and PR evidence checks passed');
