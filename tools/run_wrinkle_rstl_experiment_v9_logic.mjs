#!/usr/bin/env node

process.env.WRINKLE_EXPERIMENT_VERSION = "v8";
process.env.WRINKLE_REFINEMENT_MODE = "v9";
await import("./run_wrinkle_rstl_experiment_v4.mjs");
