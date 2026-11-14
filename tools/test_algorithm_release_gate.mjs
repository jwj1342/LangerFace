import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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
  const manifest = { archiveScope: { configSha256: scopeDigest, externalDependencies: [], changedOutsideScope: [] }, algorithmIdentity: identity, copied: [], inherited: [] };
  const manifestBytes = JSON.stringify(manifest);
  if (gitState.withArchive) fixture.archive.manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
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
      ? JSON.stringify(fixture) : String(path).endsWith("manifest.json") ? manifestBytes : gitState.scopeBytes ?? scopeBytes,
    existsSync: () => Boolean(gitState.withArchive),
    realpathSync: (path) => { if (gitState.withArchive) return String(path); throw new Error('must not resolve an absent private archive'); },
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

assert.equal(run(undefined, 'dev', {}, {dirty: ' M source', withArchive: true}).exitCode, 0, 'a candidate with a validated archive retains the original strict recovery path');
assert.equal(run(undefined, 'dev', {}, {noBackup: true, withArchive: true}).exitCode, 0, 'archive-backed developer candidates do not need a redundant Git backup branch');
assert.equal(run(undefined, 'dev', {current: {sourceDigest: 'stale'}}, {dirty: ' M source', withArchive: true}).exitCode, 1, 'archive fallback does not weaken source identity');

const changedCiScope = run('true', 'pr', {}, {scopeBytes: Buffer.from('{"changed":true}')});
assert.equal(changedCiScope.exitCode, 1, 'CI must fail for a changed scope configuration');
assert.match(changedCiScope.messages, /责任范围配置指纹与发布登记不一致/,
  'CI must report the changed scope configuration');
const changedArchiveScope = run(undefined, 'deploy', {}, {scopeBytes: Buffer.from('{"changed":true}'), withArchive: true});
assert.equal(changedArchiveScope.exitCode, 1, 'local archives must fail for a changed scope configuration');
assert.match(changedArchiveScope.messages, /恢复包使用的责任范围配置不是当前版本/,
  'local archives must report the changed scope configuration');

// Reproduce the real Git checkout boundary; a byte fixture alone misses EOL conversion.
const scopeRelativePath = 'docs/quality/algorithm-archive-scope.json';
const actualScope = readFileSync(new URL('../' + scopeRelativePath, import.meta.url));
const actualRelease = JSON.parse(readFileSync(new URL('../docs/quality/controlled-marker-release.json', import.meta.url), 'utf8'));
const attributes = readFileSync(new URL('../.gitattributes', import.meta.url));
const temporaryRoot = realpathSync(tmpdir());
for (const autocrlf of ['false', 'input', 'true']) {
  const checkoutRoot = mkdtempSync(join(temporaryRoot, 'langerface-scope-checkout-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', checkoutRoot, ...args], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    git('init', '--quiet');
    git('config', 'core.autocrlf', autocrlf);
    git('config', 'core.safecrlf', 'false');
    writeFileSync(join(checkoutRoot, '.gitattributes'), attributes);
    const scopePath = join(checkoutRoot, scopeRelativePath);
    mkdirSync(dirname(scopePath), {recursive: true});
    writeFileSync(scopePath, actualScope.toString('utf8').replace(/\r\n/g, '\n'));
    git('add', '--', '.gitattributes', scopeRelativePath);
    const indexedScope = git('show', ':' + scopeRelativePath);
    assert.equal(indexedScope.includes(Buffer.from('\r\n')), false, 'the Git index retains normalized text');
    rmSync(scopePath);
    git('checkout-index', '--force', '--', scopeRelativePath);
    const checkedOutScope = readFileSync(scopePath);
    assert.equal(createHash('sha256').update(checkedOutScope).digest('hex'), actualRelease.archive.scopeConfigSha256,
      `core.autocrlf=${autocrlf}: checkout must match the existing archive byte fingerprint`);
    assert.deepEqual(JSON.parse(checkedOutScope), JSON.parse(actualScope), 'checkout must preserve every scope value');
  } finally {
    assert.equal(dirname(realpathSync(checkoutRoot)), temporaryRoot);
    assert.ok(basename(checkoutRoot).startsWith('langerface-scope-checkout-'));
    rmSync(checkoutRoot, {recursive: true, force: true});
  }
}
console.log('archive scope checkout: LF/input/CRLF environments retain exact archive bytes and reject content changes');
