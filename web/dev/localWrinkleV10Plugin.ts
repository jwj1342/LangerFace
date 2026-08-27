import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Plugin, PreviewServer, ViteDevServer } from "vite";

const ENDPOINT = "/api/local-wrinkle-v10";
const MAXIMUM_REQUEST_BYTES = 32 * 1024 * 1024;

function pythonExecutable(): string {
  const configured = process.env.LANGERFACE_WRINKLE_PYTHON;
  const virtualEnvironment = process.env.VIRTUAL_ENV;
  const candidates = [
    configured,
    virtualEnvironment
      ? join(virtualEnvironment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
      : undefined,
    "/opt/anaconda3/envs/sod/bin/python",
    "/opt/anaconda3/envs/longerface/bin/python",
    "python3",
    "python",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (!candidate.includes("/") || existsSync(candidate)) {
      if (candidate.includes("/")) accessSync(candidate, constants.X_OK);
      return candidate;
    }
  }
  throw new Error("未找到可运行四区域皱纹检测的 Python 环境");
}

type LocalViteServer = Pick<ViteDevServer | PreviewServer, "httpServer" | "middlewares">;

class PersistentDetector {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdout = "";
  private stderr = "";
  private pending = new Map<number, {
    resolve: () => void;
    reject: (error: Error) => void;
  }>();

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;
    const child = spawn(pythonExecutable(), [
      resolve(import.meta.dirname, "../../tools/run_live_four_region_wrinkle.py"),
      "--serve",
    ], {
      cwd: resolve(import.meta.dirname, "../.."),
      env: {
        ...process.env,
        MPLCONFIGDIR: resolve(tmpdir(), "langerface-matplotlib"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.stdout = "";
    this.stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consumeStdout(String(chunk)));
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_384);
    });
    const fail = (reason: unknown) => {
      if (this.child === child) this.child = null;
      const detail = reason instanceof Error ? reason.message : String(reason);
      const error = new Error(`四区域皱纹检测服务中断：${detail || this.stderr}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    child.once("error", fail);
    child.once("exit", (code, signal) => fail(`exit ${code ?? signal}`));
    return child;
  }

  private consumeStdout(chunk: string): void {
    this.stdout += chunk;
    for (;;) {
      const newline = this.stdout.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      let message: { id?: number; ok?: boolean; error?: string };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = Number.isInteger(message.id) ? this.pending.get(message.id!) : null;
      if (!pending) continue;
      this.pending.delete(message.id!);
      if (message.ok) pending.resolve();
      else pending.reject(new Error(`四区域皱纹检测失败：${message.error || this.stderr}`));
    }
  }

  run(requestFile: string, rgbaFile: string, outputDirectory: string): Promise<void> {
    const child = this.ensureProcess();
    const id = this.nextId++;
    const result = new Promise<void>((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
    });
    child.stdin.write(`${JSON.stringify({
      id,
      request: requestFile,
      rgba: rgbaFile,
      output: outputDirectory,
    })}\n`);
    return result;
  }

  start(): void {
    this.ensureProcess();
  }

  close(): void {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill("SIGTERM");
  }
}

async function readRequest(req: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAXIMUM_REQUEST_BYTES) throw new Error("皱纹检测请求超过 32 MB 限制");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function localWrinkleV10Plugin(): Plugin {
  const detector = new PersistentDetector();
  const configure = (server: LocalViteServer) => {
    detector.start();
    server.httpServer?.once("close", () => detector.close());
    server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url || "").split("?")[0];
        if (pathname !== ENDPOINT) {
          next();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end("Method Not Allowed");
          return;
        }
        let temporaryDirectory: string | null = null;
        try {
          const body = await readRequest(req);
          if (body.length < 5) throw new Error("皱纹检测请求为空");
          const metadataLength = body.readUInt32LE(0);
          if (metadataLength <= 0 || metadataLength > body.length - 4) {
            throw new Error("皱纹检测请求头无效");
          }
          const metadata = JSON.parse(body.subarray(4, 4 + metadataLength).toString("utf8"));
          const width = Number(metadata.width);
          const height = Number(metadata.height);
          const rgba = body.subarray(4 + metadataLength);
          if (!Number.isInteger(width) || !Number.isInteger(height)
              || rgba.length !== width * height * 4) {
            throw new Error("皱纹检测像素数据尺寸不匹配");
          }
          temporaryDirectory = await mkdtemp(resolve(tmpdir(), "langerface-live-wrinkle-"));
          const requestFile = resolve(temporaryDirectory, "request.json");
          const rgbaFile = resolve(temporaryDirectory, "input.rgba");
          const outputDirectory = resolve(temporaryDirectory, "output");
          await Promise.all([
            writeFile(requestFile, JSON.stringify(metadata)),
            writeFile(rgbaFile, rgba),
          ]);
          await detector.run(requestFile, rgbaFile, outputDirectory);
          const response = await readFile(resolve(outputDirectory, "response.json"));
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(response);
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          if (!res.writableEnded) {
            res.end(JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        } finally {
          if (temporaryDirectory) {
            await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
          }
        }
    });
  };
  return {
    name: "local-wrinkle-v10-api",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
