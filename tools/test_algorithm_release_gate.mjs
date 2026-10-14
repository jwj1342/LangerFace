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
function run(ci, mode = 'deploy', changes = {}, gitState = {}) {
  const fixture = structuredClone(release);
  for (const [key, values] of Object.entries(changes)) Object.assign(fixture[key], values);
  const messages = [];
  let exitCode = 0;
  const context = {
    createHash, basename, dirname, resolve, sep,
    TARGET_MARKER_PROFILE: identity.profile,
    captureMarkerIdentity: () => ({ ...identity, head: 'a'.repeat(40), branch: 'fixture', ...gitState.identity }),
    execFileSync: (_bin, args) => {
      const command = args.slice(2).join(' ');
      if (command.startsWith('rev-parse')) return 'a'.repeat(40);
      if (command.startsWith('status')) return gitState.dirty || '';
      if (command.startsWith('ls-files')) return gitState.untrackedRuntime ? 'web/src/untracked.ts' : '';
      if (command.startsWith('for-each-ref')) return gitState.noBackup ? '' : 'refs/heads/backup/fixture';
      if (command.startsWith('merge-base')) { if (gitState.unrelatedBackup) throw new Error('not an ancestor'); return ''; }
      throw new Error('unexpected fixture Git command: ' + command);
    },
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
assert.equal(run(undefined, 'local').exitCode, 0, 'local runtime keeps identity checks without a private archive');
assert.equal(run(undefined, 'local', { current: { sourceDigest: 'stale' } }).exitCode, 0,
  'local runtime may contain unregistered integration source while preserving algorithm identity');
assert.equal(run(undefined, 'local', { current: { algorithmDigest: 'stale' } }).exitCode, 1,
  'local runtime still blocks stale algorithm identity');
assert.match(run(undefined).messages, /恢复包 manifest 不存在/, 'deploy missing archive remains blocked');
assert.equal(run(undefined).exitCode, 1);
assert.match(run('true', 'deploy', { archive: { sourceDigest: 'stale' } }).messages, /不是当前源码指纹/);
assert.equal(run('true', 'deploy', { current: { sourceDigest: 'stale' } }).exitCode, 1);
assert.equal(run('true', 'pr', { operatorEvaluation: { status: 'pending' } }).exitCode, 1);
assert.equal(run('true', 'pr', { editorSaveConfirmation: { status: 'unknown' } }).exitCode, 1);
console.log('algorithm release gate: fresh CI, missing local archive, stale identity and PR evidence checks passed');

assert.equal(run(undefined, 'dev').exitCode, 0, 'committed dev checkout with rollback reference needs no private archive');
assert.equal(run(undefined, 'dev', {}, {noBackup: true}).exitCode, 1, 'dev must retain a Git rollback reference');
assert.equal(run(undefined, 'dev', {}, {dirty: ' M web/src/app.ts'}).exitCode, 1, 'dev exemption refuses uncommitted tracked changes');
assert.equal(run(undefined, 'dev', {}, {unrelatedBackup: true}).exitCode, 1, 'unrelated Git references are not rollback evidence');
assert.equal(run(undefined, 'dev', {current: {sourceDigest: 'stale'}}).exitCode, 1, 'dev still checks exact source identity');
assert.equal(run(undefined, 'dev', {current: {algorithmDigest: 'stale'}}).exitCode, 1, 'dev still checks algorithm identity');
assert.equal(run('true', 'dev', {}, {noBackup: true}).exitCode, 1, 'CI cannot bypass dev rollback checks');
assert.equal(run(undefined, 'dev', {}, {identity: {branch: ''}}).exitCode, 1, 'dev exemption requires a branch retaining the committed checkout');
console.log('development gate: archive exemption, source checks, committed state and rollback boundary checks passed');

const packageScripts = JSON.parse(readFileSync(new URL('../web/package.json', import.meta.url), 'utf8')).scripts;
assert.match(packageScripts['predev:lesion-candidate'], /^npm run verify:algorithm-release:dev &&/);
assert.match(packageScripts['predev:lesion-candidate'], /check_web_dependency_isolation[\s\S]*doctor_wrinkle_runtime[\s\S]*run_controlled_marker_v035_dev\.mjs --check/);
assert.match(packageScripts['prebuild:lesion-candidate'], /^npm run verify:algorithm-release:deploy &&/);
assert.equal(packageScripts['verify:algorithm-release:pr'], 'node ../tools/check_algorithm_release_gate.mjs pr');
console.log('startup routing: development exemption retains resource checks and release gates');

assert.equal(run(undefined, 'dev', {}, {untrackedRuntime: true}).exitCode, 1, 'untracked or ignored runtime source is not covered by a Git checkpoint');
