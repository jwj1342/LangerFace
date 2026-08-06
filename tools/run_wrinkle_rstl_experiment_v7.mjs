#!/usr/bin/env node

process.env.WRINKLE_EXPERIMENT_VERSION = "v7";
await import("./run_wrinkle_rstl_experiment_v4.mjs");
