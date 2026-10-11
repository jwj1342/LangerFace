#!/usr/bin/env node

import { DEFAULT_CONTROLLED_MARKER_DETECTOR_PROFILE } from "../web/src/services/controlledMarkerDetectionProfile.ts";
import { CONTROLLED_MARKER_RELEASE } from "../web/src/services/controlledMarkerRelease.ts";

const mode = process.argv[2] || "command";
console.warn(
  `[marker-runtime] npm run ${mode} 默认使用 ${CONTROLLED_MARKER_RELEASE.name} `
  + `version=${CONTROLLED_MARKER_RELEASE.version} profile=${DEFAULT_CONTROLLED_MARKER_DETECTOR_PROFILE}；`
  + "如需回退旧检测器，必须显式设置 VITE_CONTROLLED_MARKER_DETECTOR_PROFILE=legacy-v0.23。",
);
