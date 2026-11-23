import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const requireWeb = createRequire(new URL("../web/package.json", import.meta.url));
const ts = requireWeb("typescript");
const source = readFileSync(new URL("../web/src/services/workflowViewport.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
for (const test of [
  { width: 360, points: 5, coarse: true, hover: true, expected: true },
  { width: 360, points: 5, coarse: false, hover: true, expected: true },
  { width: 560, points: 0, coarse: true, hover: false, expected: true },
  { width: 561, points: 5, coarse: true, hover: false, expected: false },
  { width: 1920, points: 5, coarse: true, hover: true, expected: false },
  { width: 360, points: 0, coarse: false, hover: true, expected: false },
]) {
  const listeners = new Map<string, () => void>();
  const queries = new Set<string>();
  const exports: Record<string, (...args: any[]) => any> = {};
  const api = {
    exports,
    navigator: { maxTouchPoints: test.points },
    window: {
      // Existence of this API alone must not activate the touch layout.
      ontouchstart: null,
      matchMedia(query: string) {
        queries.add(query);
        return {
          matches: query === "(max-width: 560px)" ? test.width <= 560 : test.coarse,
          addEventListener: (_: string, callback: () => void) => listeners.set(query, callback),
          removeEventListener: () => listeners.delete(query),
        };
      },
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
  };
  runInNewContext(code, api);
  assert.equal(exports.narrowTouchWorkflowViewportActive(), test.expected, JSON.stringify(test));
  assert.equal([...queries].some((query) => query.includes("hover")), false, "hover must not veto real touch capability");
  let changes = 0;
  const cleanup = exports.subscribeWorkflowViewport(() => changes++);
  assert.equal(listeners.size, 3);
  for (const notify of listeners.values()) notify();
  assert.equal(changes, 3, "width, pointer capability and resize can refresh layout");
  cleanup();
  assert.equal(listeners.size, 0, "all viewport subscriptions are released");
}
const exports: Record<string, () => boolean> = {};
runInNewContext(code, { exports });
assert.equal(exports.narrowTouchWorkflowViewportActive(), false, "non-browser capability query is safe");
console.log("PASS workflow viewport: 6 capability cases, subscriptions and non-browser query");
