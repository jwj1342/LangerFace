import assert from "node:assert/strict";

import {
  readIncisionEditCommand,
  readIncisionLibraryCommand,
  readIncisionTumorCommand,
} from "../web/src/services/incisionCommandSchemas.ts";

const event = (detail: unknown) => ({ detail });

assert.deepEqual(
  readIncisionTumorCommand(event({ command: "kind_changed", value: "cutaneous" })),
  { command: "kind_changed", value: "cutaneous" },
);
assert.equal(
  readIncisionTumorCommand(event({ command: "kind_changed", value: "remote" })),
  null,
);
assert.deepEqual(
  readIncisionTumorCommand(event({ command: "diameter_input", value: "12.5" })),
  { command: "diameter_input", value: "12.5" },
);
assert.equal(
  readIncisionTumorCommand(event({ command: "diameter_input", value: "not-a-number" })),
  null,
);
assert.equal(
  readIncisionTumorCommand(event({ command: "diameter_input" })),
  null,
);
assert.deepEqual(
  readIncisionTumorCommand(event({ command: "toggle_boundary" })),
  { command: "toggle_boundary" },
);
assert.equal(
  readIncisionTumorCommand(event({ command: "unknown_command" })),
  null,
);
assert.equal(readIncisionTumorCommand(event("kind_changed")), null);

assert.deepEqual(
  readIncisionLibraryCommand(event({ command: "load_candidate", id: "candidate-1" })),
  { command: "load_candidate", id: "candidate-1" },
);
assert.equal(
  readIncisionLibraryCommand(event({ command: "load_candidate", id: "" })),
  null,
);
assert.equal(
  readIncisionLibraryCommand(event({ command: "remove_candidate", id: 4 })),
  null,
);
assert.deepEqual(
  readIncisionLibraryCommand(event({ command: "export_json" })),
  { command: "export_json" },
);

assert.deepEqual(
  readIncisionEditCommand(event({ command: "commit_edit" })),
  { command: "commit_edit" },
);
assert.equal(
  readIncisionEditCommand(event({ command: "provider_connect" })),
  null,
);

console.log("test_incision_command_schemas: command names and payload schemas passed");
