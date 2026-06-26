import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function importTypeScriptModule(rel) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { fitImageToMaxSide, MAX_IMAGE_SOURCE_DIM } = await importTypeScriptModule("web/src/services/imageSource.ts");

{
  const fit = fitImageToMaxSide(6000, 4000);
  assert.equal(fit.width, MAX_IMAGE_SOURCE_DIM);
  assert.equal(fit.height, 1067);
  assert.equal(fit.scaled, true);
}

{
  const fit = fitImageToMaxSide(3000, 6000);
  assert.equal(fit.width, 800);
  assert.equal(fit.height, MAX_IMAGE_SOURCE_DIM);
  assert.equal(fit.scaled, true);
}

{
  const fit = fitImageToMaxSide(1280, 720);
  assert.equal(fit.width, 1280);
  assert.equal(fit.height, 720);
  assert.equal(fit.scaled, false);
}

{
  const fit = fitImageToMaxSide(4000, 3000, 1200);
  assert.equal(fit.width, 1200);
  assert.equal(fit.height, 900);
  assert.equal(fit.scale, 0.3);
}

console.log("ok: image upload work size is capped");
