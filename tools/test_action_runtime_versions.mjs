import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDirectory = join(root, ".github", "workflows");
const requiredVersions = new Map([
  ["actions/checkout", "v7"],
  ["actions/setup-node", "v7"],
  ["actions/setup-python", "v7"],
]);
const seen = new Map([...requiredVersions.keys()].map((action) => [action, 0]));

for (const filename of readdirSync(workflowDirectory)) {
  if (!/\.ya?ml$/i.test(filename)) continue;
  const source = readFileSync(join(workflowDirectory, filename), "utf8");
  for (const match of source.matchAll(/uses:\s*(actions\/(?:checkout|setup-node|setup-python))@([^\s#]+)/g)) {
    const [, action, version] = match;
    assert.equal(
      version,
      requiredVersions.get(action),
      `${filename} must use the Node 24 ${action}@${requiredVersions.get(action)} runtime`,
    );
    seen.set(action, (seen.get(action) || 0) + 1);
  }
}

for (const [action, count] of seen) {
  assert.ok(count > 0, `expected at least one ${action} workflow step`);
}

console.log("test_action_runtime_versions: official workflow actions use Node 24 runtimes");
