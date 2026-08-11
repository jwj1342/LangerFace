import assert from "node:assert/strict";

import {
  readAnnotateDrawCommand,
  readAnnotateLibraryCommand,
  readLiveRenderCommand,
} from "../web/src/services/workbenchCommandSchemas.ts";

const event = (detail: unknown) => ({ detail });

assert.deepEqual(
  readLiveRenderCommand(event({ command: "density_input", value: 72 })),
  { command: "density_input", value: 72 },
);
assert.equal(
  readLiveRenderCommand(event({ command: "density_input", value: 101 })),
  null,
);
assert.equal(
  readLiveRenderCommand(event({ command: "opacity_input", value: "NaN" })),
  null,
);
assert.deepEqual(
  readLiveRenderCommand(event({ command: "mirror_toggle", value: false })),
  { command: "mirror_toggle", value: false },
);
assert.equal(
  readLiveRenderCommand(event({ command: "mirror_toggle", value: "false" })),
  null,
);
assert.deepEqual(
  readLiveRenderCommand(event({ command: "template_change", value: "rstl" })),
  { command: "template_change", value: "rstl" },
);
assert.equal(
  readLiveRenderCommand(event({ command: "template_change", value: "provider" })),
  null,
);

assert.deepEqual(
  readAnnotateDrawCommand(event({ command: "system_changed", value: "langer" })),
  { command: "system_changed", value: "langer" },
);
assert.equal(
  readAnnotateDrawCommand(event({ command: "system_changed", value: "flame" })),
  null,
);
assert.deepEqual(
  readAnnotateLibraryCommand(event({ command: "restore_line", index: 0 })),
  { command: "restore_line", index: 0 },
);
assert.equal(
  readAnnotateLibraryCommand(event({ command: "delete_line", index: -1 })),
  null,
);
assert.equal(
  readAnnotateLibraryCommand(event({ command: "delete_line", index: "0" })),
  null,
);
assert.equal(
  readAnnotateLibraryCommand(event({ command: "provider_connect" })),
  null,
);

console.log("test_workbench_command_schemas: live and annotation payload schemas passed");
