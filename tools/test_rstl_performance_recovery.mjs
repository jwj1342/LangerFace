import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Restore onto the recorded pre-performance base, not the current checkout:
// otherwise unarchived files in HEAD can silently satisfy missing dependencies.
const root = fileURLToPath(new URL('../', import.meta.url));
const release = JSON.parse(readFileSync(join(root, 'docs/quality/controlled-marker-release.json')));
const manifestPath = resolve(root, release.archive.manifestPath);
const manifestBytes = readFileSync(manifestPath);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256(manifestBytes), release.archive.manifestSha256);
const manifest = JSON.parse(manifestBytes);
const base = release.rstlPerformanceIntegration.base;
const required = [
  'tools/test_rstl_endpoint_smoothing.ts',
  'web/src/services/render2d.ts',
  'tools/test_forehead_curve_distance.ts',
  'tools/test_forehead_trajectory_attraction.ts',
  'web/src/services/personalized/foreheadTrajectoryAttraction.ts',
  'tools/fixtures/forehead-attraction/yellow-geometry.json',
];
for (const name of required) {
  assert.ok(manifest.copied.some(entry => entry.relativePath === name), `${name}: available in archive`);
}
const restored = mkdtempSync(join(tmpdir(), 'rstl-performance-restored-'));
try {
  const tar = execFileSync('git', ['-C', root, 'archive', '--format=tar', base], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', restored], { input: tar });
  for (const entry of manifest.copied) {
    const source = join(dirname(manifestPath), 'worktree', entry.relativePath);
    const bytes = readFileSync(source);
    assert.equal(bytes.length, entry.bytes, `${entry.relativePath}: archived length`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.relativePath}: archived hash`);
    const target = join(restored, entry.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  for (const name of required) {
    // Compare with committed source bytes. A clean Windows checkout can use
    // CRLF even though both the Git blob and the frozen archive contain LF.
    const committed = execFileSync('git', ['-C', root, 'cat-file', 'blob', `HEAD:${name}`]);
    assert.equal(sha256(readFileSync(join(restored, name))), sha256(committed),
      `${name}: restored tests and implementation match current PR`);
  }
  for (const name of ['tools/test_live_wrinkle_refinement.ts', 'tools/test_forehead_trajectory_attraction.ts']) {
    const output = execFileSync(process.execPath, [name], {
      cwd: restored, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(output);
  }
  console.log(`RSTL recovery: clean base ${base} + archived files passed both test entrypoints`);
} finally {
  rmSync(restored, { recursive: true, force: true });
}
