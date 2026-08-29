import { inspectLocalWrinkleRuntime } from "../web/dev/localWrinkleV10Plugin.ts";
import { WRINKLE_V10_DETECTOR_VERSION } from
  "../web/src/services/personalized/wrinkleV10Provider.ts";

try {
  const runtime = inspectLocalWrinkleRuntime();
  console.log(JSON.stringify({
    ready: true,
    detectorVersion: WRINKLE_V10_DETECTOR_VERSION,
    python: runtime.python,
    pythonVersion: runtime.pythonVersion,
    dependencies: runtime.dependencies,
    checkpoint: runtime.checkpoint,
    checkpointSha256: runtime.checkpointSha256,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
