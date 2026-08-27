import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import {
  WRINKLE_V10_CHECKPOINT_SHA256,
  WRINKLE_V10_DETECTOR_VERSION,
  WRINKLE_V10_ENDPOINT,
  WRINKLE_V10_PROVIDER_SCHEMA,
  WRINKLE_V10_REQUEST_TIMEOUT_MS,
} from "../src/services/personalized/wrinkleV10Provider.ts";

// The live worker sends lossless RGBA pixels. A 1280x1280 frame is already
// over 6 MiB before metadata, so keep the transport guard above that size.
const MAXIMUM_REQUEST_BYTES = 32 * 1024 * 1024;

export class LocalProviderError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

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

interface PersistentDetectorOptions {
  requestTimeoutMs?: number;
  spawnDetector?: () => ChildProcessWithoutNullStreams;
}

export class PersistentDetector {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdout = "";
  private stderr = "";
  private readonly options: PersistentDetectorOptions;
  private readyPromise: Promise<void> | null = null;
  private settleReady: ((error?: Error) => void) | null = null;
  private pending = new Map<number, {
    finish: (error?: Error) => void;
  }>();

  constructor(options: PersistentDetectorOptions = {}) {
    this.options = options;
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;
    const child = this.options.spawnDetector?.() || spawn(pythonExecutable(), [
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
    this.readyPromise = new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      this.settleReady = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.settleReady = null;
        if (error) reject(error);
        else resolvePromise();
      };
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consumeStdout(String(chunk)));
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_384);
    });
    const fail = (reason: unknown) => {
      if (this.child !== child) return;
      this.child = null;
      const detail = reason instanceof Error ? reason.message : String(reason);
      const error = new Error(`四区域皱纹检测服务中断：${detail || this.stderr}`);
      this.readyPromise = null;
      this.settleReady?.(error);
      for (const pending of [...this.pending.values()]) pending.finish(error);
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
      let message: {
        type?: string;
        detectorVersion?: string;
        checkpointSha256?: string;
        id?: number;
        ok?: boolean;
        error?: string;
      };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.type === "ready") {
        if (message.detectorVersion !== WRINKLE_V10_DETECTOR_VERSION
            || message.checkpointSha256 !== WRINKLE_V10_CHECKPOINT_SHA256) {
          this.stop(new Error("V10 本地检测器的算法版本或 checkpoint 不匹配"));
        } else {
          this.settleReady?.();
        }
        continue;
      }
      const pending = Number.isInteger(message.id) ? this.pending.get(message.id!) : null;
      if (!pending) continue;
      if (message.ok) pending.finish();
      else pending.finish(new Error(`四区域皱纹检测失败：${message.error || this.stderr}`));
    }
  }

  async run(
    requestFile: string,
    rgbaFile: string,
    outputDirectory: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.pending.size >= 1) {
      throw new LocalProviderError("V10 检测器正在处理另一张图片，请稍后重试", 429);
    }
    const id = this.nextId++;
    const result = new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        this.stop(new LocalProviderError(
          "V10 四区域检测超过 45 秒，Python 任务已终止",
          504,
        ));
      }, this.options.requestTimeoutMs ?? WRINKLE_V10_REQUEST_TIMEOUT_MS);
      const onAbort = () => {
        this.stop(new Error("浏览器已取消 V10 检测，Python 任务已终止"));
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        if (error) reject(error);
        else resolvePromise();
      };
      this.pending.set(id, { finish });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try {
      await this.start();
      if (!signal.aborted) {
        const child = this.child;
        if (!child || child.exitCode !== null) throw new Error("V10 Python 进程未就绪");
        child.stdin.write(`${JSON.stringify({
          id,
          request: requestFile,
          rgba: rgbaFile,
          output: outputDirectory,
        })}\n`, (error) => {
          if (error) this.stop(new Error(`无法向 V10 Python 进程写入请求：${error.message}`));
        });
      }
    } catch (error) {
      this.pending.get(id)?.finish(error instanceof Error ? error : new Error(String(error)));
    }
    return result;
  }

  async start(): Promise<void> {
    this.ensureProcess();
    if (!this.readyPromise) throw new Error("V10 Python 进程未提供就绪信号");
    await this.readyPromise;
  }

  close(): void {
    this.stop(new Error("V10 检测服务已关闭"));
  }

  private stop(error: Error): void {
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    this.settleReady?.(error);
    if (child && child.exitCode === null) child.kill("SIGTERM");
    for (const pending of [...this.pending.values()]) pending.finish(error);
  }
}

async function readRequest(req: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAXIMUM_REQUEST_BYTES) {
      throw new LocalProviderError("皱纹检测请求超过 32 MB 限制", 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function localWrinkleV10Plugin(): Plugin {
  const detector = new PersistentDetector();
  const configure = (server: LocalViteServer) => {
    void detector.start().catch(() => undefined);
    server.httpServer?.once("close", () => detector.close());
    server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url || "").split("?")[0];
        if (pathname !== WRINKLE_V10_ENDPOINT) {
          next();
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            await detector.start();
            res.statusCode = 200;
            res.end(JSON.stringify({
              schemaVersion: WRINKLE_V10_PROVIDER_SCHEMA,
              providerId: "local-python-v10",
              detectorVersion: WRINKLE_V10_DETECTOR_VERSION,
              checkpointSha256: WRINKLE_V10_CHECKPOINT_SHA256,
              processingLocation: "host_machine",
              ready: true,
              directDetectUrl: WRINKLE_V10_ENDPOINT,
              accessToken: null,
              expiresAt: null,
              maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
            }));
          } catch (error) {
            res.statusCode = 503;
            res.end(JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }));
          }
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "GET, POST");
          res.end("Method Not Allowed");
          return;
        }
        let temporaryDirectory: string | null = null;
        const controller = new AbortController();
        const cancelIfDisconnected = () => {
          if (!res.writableEnded) controller.abort();
        };
        req.once("aborted", cancelIfDisconnected);
        res.once("close", cancelIfDisconnected);
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
          await detector.run(requestFile, rgbaFile, outputDirectory, controller.signal);
          const response = await readFile(resolve(outputDirectory, "response.json"));
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(response);
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = error instanceof LocalProviderError ? error.statusCode : 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          if (!res.writableEnded) {
            res.end(JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        } finally {
          req.off("aborted", cancelIfDisconnected);
          res.off("close", cancelIfDisconnected);
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
