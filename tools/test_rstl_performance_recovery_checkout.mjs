import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
for (const autocrlf of ['false', 'true']) {
  const checkout = mkdtempSync(join(tmpdir(), 'rstl-recovery-checkout-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', checkout, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // These are actual Git checkouts, not manually rewritten byte fixtures.
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', root, checkout], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    git('config', 'core.autocrlf', autocrlf);
    git('checkout', '--quiet', '--detach', head);
    const source = 'tools/test_rstl_endpoint_smoothing.ts';
    const workingBytes = readFileSync(join(checkout, source));
    const committedBytes = git('cat-file', 'blob', `HEAD:${source}`);
    assert.equal(workingBytes.includes(Buffer.from('\r\n')), autocrlf === 'true',
      `core.autocrlf=${autocrlf}: exercise the intended checkout line endings`);
    assert.equal(committedBytes.includes(Buffer.from('\r\n')), false, 'Git source remains LF');
    const output = execFileSync(process.execPath, ['tools/test_rstl_performance_recovery.mjs'], {
      cwd: checkout, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(output);
    console.log(`RSTL recovery checkout: core.autocrlf=${autocrlf} passed; `
      + git('ls-files', '--eol', '--', source).toString().trim());
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}
