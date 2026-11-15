#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, lstatSync,
  openSync, closeSync, readdirSync, writeSync } from "node:fs";
import { resolve, relative, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";
import { captureMarkerIdentity } from "./marker_runtime_identity.mts";

// Fixed inventory approved with the routing change. Adding/removing a test
// requires an explicit inventory update, rather than silently reducing coverage.
export const EXPECTED = [
  {"file":"web/e2e/clinical-theme.spec.ts","full_title_parts":["public workflow entrypoints share the blue clinical action theme"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: fine393"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: fine560"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: touch561"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: touch393"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: touch560"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: short-phone"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: landscape"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow scroll and upload remain usable: desktop1440"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow gesture assertion detects a locked existing mobile pane"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["workflow wheel assertion detects a locked narrow fallback root"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["narrow mouse layout preserves the original canvas and real refine quality"],"project":"source-contract","suite":"source"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["width transitions retain desktop controls and layer state on fine pointers"],"project":"source-contract","suite":"source"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["desktop workflow keeps the three-column shell while status text remains hidden"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["a visibility-limited candidate prompts for a reviewer before confirmation"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/freehand-mobile-regression.spec.ts","full_title_parts":["mobile freehand exits an empty session and draws after leaving controlled marker"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-controlled-marker.spec.ts","full_title_parts":["changing tumor kind before a photo pick does not create a default lesion"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-controlled-marker.spec.ts","full_title_parts":["switching to a subcutaneous tumor exits controlled marking without inventing a boundary"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-controlled-marker.spec.ts","full_title_parts":["a second controlled-marker click replaces the previous result before reporting success"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-interactions.spec.ts","full_title_parts":["clinician edit sliders retain real mouse drags after the controller echo"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-interactions.spec.ts","full_title_parts":["only the explicit generation button increments the candidate generation count"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-photo-planning.spec.ts","full_title_parts":["patient photo is the mobile incision canvas and reuploads fail safely"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-rstl-deviation.spec.ts","full_title_parts":["cutaneous candidate shows RSTL deviation before and after clinician direction edit"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-workbench.spec.ts","full_title_parts":["active controls remain readable and clinician sliders retain edits"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-workbench.spec.ts","full_title_parts":["invalid tumor imports report errors without mutating the active plan"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-workbench.spec.ts","full_title_parts":["route remount removes and rebinds one canvas listener set"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-workbench.spec.ts","full_title_parts":["live workbench controls use the same readable clinical theme"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-workbench.spec.ts","full_title_parts":["mobile layout shows the 3D stage before the long review form"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/incision-workbench.spec.ts","full_title_parts":["clinical summary hides internal codes and exposes the rule validation boundary"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/live-incision-overlay.spec.ts","full_title_parts":["approved incision reaches photo, uploaded video, and MediaStream camera"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/mobile-workflow-ui.spec.ts","full_title_parts":["phone review fixes stay visible, independent, and desktop-isolated"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/surgery-contrast.spec.ts","full_title_parts":["contrast helper composites ancestor backgrounds and reads placeholder color"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/surgery-contrast.spec.ts","full_title_parts":["surgery buttons remain readable across loading, hover, pressed, and selected states"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-header-grid.spec.ts","full_title_parts":["phone workflow header uses a valid single-column grid"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["photo risk policy preserves red opening violations and normal non-opening warnings"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["simplified workflow keeps one confirmed current record and removes candidate-library actions"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["PR226 v035 reviewed original generates and activates a fresh incision"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["PR226 v035 simplified workflow keeps an approved incision active in the camera stream"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["repeated photo replacement never auto-starts main-thread wrinkle YOLO"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["workflow keeps reviewed photo geometry stable and reprojects read-only focus views"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["disabled workflow hints use a two-second mouse, touch, and keyboard release window"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["merged workflow preserves incision geometry, warning priority, and RSTL refresh ownership"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["subcutaneous overlay stays centered and controlled scan keeps its fixed range"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["simplified workflow desktop","does not save or restore drafts and omits retired controls"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/workflow-regressions.spec.ts","full_title_parts":["simplified workflow mobile","does not save or restore drafts and omits retired controls"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/zoom-cap-current.spec.ts","full_title_parts":["incision photo zoom reaches the desktop and touch-mobile caps"],"project":"chromium","suite":"production"},
  {"file":"web/e2e/zoom-cap-current.spec.ts","full_title_parts":["main photo view zoom reaches the desktop and touch-mobile caps"],"project":"chromium","suite":"production"}
];
const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const WEB = join(ROOT, "web");
const SOURCE = EXPECTED.filter(row => row.suite === "source");
const ALLOWED_SKIPS = [
  ["web/e2e/mobile-workflow-ui.spec.ts", "phone review fixes stay visible, independent, and desktop-isolated",
    "set MOBILE_UI_TEST_ASSET_DIR and MOBILE_UI_EVIDENCE_DIR to run the local review suite"],
  ["web/e2e/workflow-regressions.spec.ts", "PR226 v035 reviewed original generates and activates a fresh incision",
    "The original-photo chain runs only in the explicitly authorized B batch."],
];
const key = row => JSON.stringify([row.file, row.full_title_parts, row.project]);
const git = (...args) => execFileSync("git", ["-C", ROOT, ...args], {
  encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
}).trim();
const optionalGit = (...args) => {
  try { return git(...args); } catch (error) { if (error.status === 1) return null; throw error; }
};

export function reportRows(report) {
  const rows = [];
  const walk = (suites, parents = []) => {
    for (const suite of suites || []) {
      const names = suite.title === suite.file ? parents : [...parents, suite.title];
      for (const spec of suite.specs || []) {
        const raw = spec.file.replaceAll("\\", "/");
        const file = isAbsolute(raw) ? relative(ROOT, raw).replaceAll("\\", "/")
          : raw.startsWith("web/e2e/") ? raw : `web/e2e/${raw}`;
        for (const test of spec.tests || []) rows.push({
          file, full_title_parts: [...names, spec.title], project: test.projectName,
          expectedStatus: test.expectedStatus, results: test.results || [],
          annotations: test.annotations || [],
        });
      }
      walk(suite.suites, names);
    }
  };
  walk(report.suites);
  return rows;
}

export function assertInventory(actual, expected) {
  const keys = actual.map(key);
  assert.equal(new Set(keys).size, keys.length, "Duplicate file/title/project");
  assert.deepEqual(keys.sort(), expected.map(key).sort(), "Incomplete or changed inventory");
}

export function assertResults(report, expected) {
  assert.equal((report.errors || []).length, 0, "Reporter errors");
  const rows = reportRows(report);
  assertInventory(rows, expected);
  for (const row of rows) {
    assert.equal(row.results.length, 1, `Missing/retried result: ${key(row)}`);
    const result = row.results[0];
    if (result.status === "passed" && row.expectedStatus === "passed") continue;
    const allowed = ALLOWED_SKIPS.find(([file, title]) =>
      file === row.file && row.full_title_parts.length === 1 && row.full_title_parts[0] === title);
    assert.ok(allowed && result.status === "skipped" && row.expectedStatus === "skipped"
      && row.annotations.some(a => a.type === "skip" && a.description === allowed[2]),
    `Failure or unapproved skip: ${key(row)} (${result.status})`);
  }
  return rows;
}

export function validateCiDescriptor(d) {
  assert.equal(d.environment.CI, "true");
  assert.equal(d.environment.GITHUB_ACTIONS, "true");
  assert.equal(d.environment.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(d.top, d.workspace, "Repository is not the exact job workspace");
  assert.equal(d.gitDir, join(d.workspace, ".git"), "Linked/external Git directory");
  assert.equal(d.commonDir, d.gitDir, "Shared Git common directory");
  assert.equal(d.gitDirectoryIsReal, true);
  assert.equal(d.worktrees.length, 1, "Shared checkout");
  assert.equal(d.worktrees[0], d.top);
  assert.equal(d.hasAlternates, false, "Shared object store");
  assert.equal(d.gitEnvironmentOverride, false);
  assert.equal(d.symbolicHead, null, "Expected a detached job checkout");
  assert.equal(d.dirty, "");
  assert.equal(d.uncommittedRuntime, "");
  assert.match(d.head, /^[a-f0-9]{40}$/);
  assert.equal(d.head, d.environment.GITHUB_SHA);
  for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) {
    assert.match(d.environment[name] || "", /^\d+$/);
  }
  const event = d.environment.GITHUB_EVENT_NAME;
  if (event === "pull_request") {
    assert.ok(Number.isSafeInteger(d.payload.number) && d.payload.number > 0);
    assert.equal(d.environment.GITHUB_REF, `refs/pull/${d.payload.number}/merge`);
    assert.equal(d.parents.length, 2, "Expected the exact PR merge commit");
    assert.equal(d.parents[1], d.payload.pull_request?.head?.sha);
  } else if (event === "push") {
    assert.equal(d.payload.after, d.head);
    assert.equal(d.payload.ref, d.environment.GITHUB_REF);
    assert.match(d.environment.GITHUB_REF, /^refs\/heads\/.+$/);
  } else throw new Error(`Unsupported GitHub event: ${event}`);
  return true;
}

function ciDescriptor() {
  const absoluteGitPath = flag => realpathSync(resolve(ROOT, git("rev-parse", flag)));
  const workspace = realpathSync(process.env.GITHUB_WORKSPACE || "");
  const gitDir = absoluteGitPath("--absolute-git-dir");
  const commonDir = absoluteGitPath("--git-common-dir");
  const runtime = ["web/src", "web/app", "web/dev", "web/index.html", "web/vite.config.ts",
    "web/package.json", "web/package-lock.json", "tools/marker_runtime_identity.mts",
    "tools/run_controlled_marker_v035_dev.mjs", "tools/run_controlled_marker_v035_build.mjs"];
  return {
    environment: Object.fromEntries(["CI", "GITHUB_ACTIONS", "RUNNER_ENVIRONMENT",
      "GITHUB_SHA", "GITHUB_REF", "GITHUB_EVENT_NAME", "GITHUB_RUN_ID",
      "GITHUB_RUN_ATTEMPT"].map(name => [name, process.env[name]])),
    payload: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    workspace, top: realpathSync(git("rev-parse", "--show-toplevel")), gitDir, commonDir,
    gitDirectoryIsReal: lstatSync(join(workspace, ".git")).isDirectory()
      && !lstatSync(join(workspace, ".git")).isSymbolicLink(),
    worktrees: git("worktree", "list", "--porcelain").split(/\r?\n/)
      .filter(line => line.startsWith("worktree ")).map(line => realpathSync(line.slice(9))),
    hasAlternates: existsSync(join(commonDir, "objects/info/alternates")),
    gitEnvironmentOverride: Object.keys(process.env).some(name =>
      /^(GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_NAMESPACE|GIT_INDEX_FILE)$/.test(name)
      && process.env[name]),
    symbolicHead: optionalGit("symbolic-ref", "-q", "HEAD"),
    head: git("rev-parse", "--verify", "HEAD^{commit}"),
    parents: git("cat-file", "-p", "HEAD").split(/\r?\n/)
      .filter(line => line.startsWith("parent ")).map(line => line.slice(7)),
    dirty: git("status", "--porcelain=v1", "--untracked-files=no"),
    uncommittedRuntime: [
      git("ls-files", "--others", "--exclude-standard", "--", ...runtime),
      git("ls-files", "--others", "--ignored", "--exclude-standard", "--", ...runtime),
    ].filter(Boolean).join("\n"),
  };
}

export function assertIdentity(actual, expected) {
  for (const name of ["profile", "implementationVersion", "releaseName", "sourceDigest",
    "algorithmDigest", "assetDigest", "head", "branch", "worktreeId"]) {
    assert.equal(actual[name], expected[name], `Runtime identity drift: ${name}`);
  }
}

export function assertRefLayout(gitDir, refs) {
  assert.equal(realpathSync(gitDir), resolve(gitDir), "Linked Git directory");
  const paths = ["HEAD", "HEAD.lock", "logs/HEAD", "logs/HEAD.lock",
    "packed-refs", "packed-refs.lock",
    ...refs.flatMap(ref => [ref, `${ref}.lock`, `logs/${ref}`, `logs/${ref}.lock`])];
  for (const name of paths) {
    assert.ok(!isAbsolute(name) && !name.split(/[\\/]/).includes(".."), "Invalid ref path");
    let current = gitDir;
    for (const segment of name.split("/")) {
      current = join(current, segment);
      try { assert.equal(lstatSync(current).isSymbolicLink(), false, `Linked ref/reflog path: ${name}`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
}

export function processSnapshot(seedPids = [process.pid], terminateRow = null) {
  if (!seedPids.length) return [];
  for (const pid of seedPids) assert.ok(Number.isSafeInteger(pid) && pid > 0);
  if (process.platform === "win32") {
    if (terminateRow) {
      assert.ok(seedPids.includes(terminateRow.pid), "Termination PID was not selected");
      assert.match(terminateRow.birth, /^\d+$/);
    }
    // A native process snapshot avoids the WMI provider queried by Get-CimInstance.
    const command = String.raw`$ErrorActionPreference = 'Stop'
try {
[Console]::Error.WriteLine("HOST_READY")
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public sealed class OwnedRow { public int pid; public int ppid; public string birth; public string image; public int error; }
public static class OwnedSnapshot {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct Entry {
    public uint size, usage, pid; public UIntPtr heap;
    public uint module, threads, parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32FirstW(IntPtr h, ref Entry e);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32NextW(IntPtr h, ref Entry e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint milliseconds);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder image, ref int length);
  public static bool Terminate(int pid, string expectedBirth) {
    IntPtr h = OpenProcess(0x00101001, false, pid);
    if (h == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      if (error == 87) return false;
      throw new Win32Exception(error);
    }
    try {
      long creation, exit, kernel, user;
      if (!GetProcessTimes(h, out creation, out exit, out kernel, out user))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      if ((creation + 504911232000000000L).ToString() != expectedBirth)
        throw new InvalidOperationException("Process instance changed; refusing termination");
      if (!TerminateProcess(h, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (WaitForSingleObject(h, 5000) != 0) throw new InvalidOperationException("Process termination not confirmed");
      return true;
    } finally { CloseHandle(h); }
  }
  public static List<OwnedRow> Read(int[] seeds) {
    long cutoff = DateTime.UtcNow.Ticks;
    IntPtr h = CreateToolhelp32Snapshot(2, 0);
    if (h == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    var rows = new List<OwnedRow>(); var entries = new List<Entry>();
    try {
      var e = new Entry(); e.size = (uint)Marshal.SizeOf(typeof(Entry));
      if (!Process32FirstW(h, ref e)) throw new Win32Exception(Marshal.GetLastWin32Error());
      do { entries.Add(e); } while (Process32NextW(h, ref e));
      if (Marshal.GetLastWin32Error() != 18) throw new Win32Exception(Marshal.GetLastWin32Error());
      var selected = new HashSet<int>(seeds); bool changed = true;
      while (changed) {
        changed = false;
        foreach (var entry in entries) if (selected.Contains((int)entry.parent)) {
          if (selected.Add((int)entry.pid)) changed = true;
        }
      }
      foreach (var entry in entries) {
        if (!selected.Contains((int)entry.pid)) continue;
        e = entry;
        IntPtr process = OpenProcess(0x1000, false, (int)e.pid);
        if (process == IntPtr.Zero) {
          int error = Marshal.GetLastWin32Error();
          if (error == 87) continue;
          rows.Add(new OwnedRow { pid=(int)e.pid, ppid=(int)e.parent, error=error });
          continue;
        }
        try {
          long creation, exit, kernel, user;
          if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) {
            rows.Add(new OwnedRow { pid=(int)e.pid, ppid=(int)e.parent, error=Marshal.GetLastWin32Error() });
            continue;
          }
          long birth = creation + 504911232000000000L;
          if (birth > cutoff) continue;
          string image = null;
          if (Array.IndexOf(seeds, (int)e.pid) >= 0) {
            var buffer = new StringBuilder(32768); int length = buffer.Capacity;
            if (QueryFullProcessImageNameW(process, 0, buffer, ref length)) image = buffer.ToString();
          }
          rows.Add(new OwnedRow { pid=(int)e.pid, ppid=(int)e.parent, birth=birth.ToString(), image=image });
        } finally {
          CloseHandle(process);
        }
      }
      return rows;
    } finally { CloseHandle(h); }
  }
}
'@
 [Console]::Error.WriteLine("COMPILED")
 ${terminateRow
    ? `@{ ok=$true; schema='owned-process/1'; terminated=[OwnedSnapshot]::Terminate(${terminateRow.pid}, '${terminateRow.birth}') }`
    : `@{ ok=$true; schema='owned-process/1'; rows=@([OwnedSnapshot]::Read([int[]]@(${seedPids.join(",")}))) }`} | ConvertTo-Json -Depth 5 -Compress
 [Console]::Error.WriteLine("SNAPSHOT_COMPLETE")`;
    const guardedCommand = command + String.raw`
} catch {
  [Console]::Error.WriteLine("HELPER_FAILED: " + $_.Exception.Message)
  exit 1
}`;
    let rows;
    try {
      const output = execFileSync(
        join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-Command", guardedCommand],
        { encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"] },
      );
      const envelope = JSON.parse(output);
      assert.equal(envelope.ok, true, "Missing native success marker");
      assert.equal(envelope.schema, "owned-process/1");
      if (terminateRow) {
        assert.equal(typeof envelope.terminated, "boolean");
        return envelope.terminated;
      }
      assert.ok(Array.isArray(envelope.rows), "Missing native rows");
      rows = envelope.rows;
    } catch (error) {
      throw new Error(`Native process snapshot ${error.code || error.status}: ${String(error.stderr || "").slice(-500)}`);
    }
    return Array.isArray(rows) ? rows : [rows];
  }
  assert.equal(terminateRow, null, "Instance-bound termination is unavailable on this platform; refusing a PID kill");
  assert.equal(process.platform, "linux", "Process ownership inspection supports Windows and Linux");
  return readdirSync("/proc").filter(name => /^\d+$/.test(name)).flatMap(name => {
    try {
      const text = readFileSync(`/proc/${name}/stat`, "utf8");
      const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
      let image = null;
      try { image = realpathSync(`/proc/${name}/exe`); }
      catch (error) { if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error; }
      return [{ pid: Number(name), ppid: Number(fields[1]), birth: fields[19], image }];
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(error.code)) return [];
      throw error;
    }
  });
}

let clockTicks;
export function birthClock() {
  if (process.platform === "win32") return BigInt(Date.now()) * 10_000n + 621355968000000000n;
  clockTicks ??= Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
  assert.ok(Number.isSafeInteger(clockTicks) && clockTicks > 0);
  return BigInt(Math.floor(Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * clockTicks));
}
const imageKey = image => process.platform === "win32" ? resolve(image).toLowerCase() : realpathSync(image);

export function collectOwned(snapshot, roots, owned) {
  const live = new Map(snapshot.map(row => [row.pid, row]));
  for (const [pid, previous] of owned) {
    const current = live.get(pid);
    if (!current || (current.birth && current.birth !== previous.birth)) owned.delete(pid);
  }
  for (const root of roots) {
    const current = live.get(root.pid);
    if (!root.active && (!current || (current.birth && current.birth !== root.birth))) root.retired = true;
  }
  for (const row of snapshot) {
    if (owned.has(row.pid)) assert.ok(row.birth, `Known process identity unavailable: PID=${row.pid} error=${row.error}`);
  }
  for (const root of roots) {
    const row = live.get(root.pid);
    if (!root.retired && row && ((root.birth === undefined && root.active) || row.birth === root.birth)) {
      assert.ok(row.birth, `Missing process identity: PID=${row.pid} error=${row.error}`);
      if (root.birth === undefined) {
        assert.equal(row.ppid, root.parentPid, "Spawn root parent changed");
        assert.ok(row.image && root.image && imageKey(row.image) === imageKey(root.image), "Spawn root image changed");
        assert.ok(BigInt(row.birth) >= root.notBefore && BigInt(row.birth) <= root.notAfter,
          "Spawn root creation outside the launch interval");
      }
      root.birth ??= row.birth;
      owned.set(row.pid, row);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of snapshot) {
      const parent = owned.get(row.ppid), liveParent = live.get(row.ppid);
      if (parent && liveParent?.birth === parent.birth) assert.ok(row.birth,
        `Child identity unavailable: PID=${row.pid} PPID=${row.ppid} error=${row.error}`);
      if (owned.get(row.pid)?.birth !== row.birth && parent && liveParent?.birth === parent.birth
        && row.birth && BigInt(row.birth) >= BigInt(parent.birth)) {
        owned.set(row.pid, row); changed = true;
      }
    }
  }
  return snapshot.filter(row => owned.get(row.pid)?.birth === row.birth);
}

export function awaitChildExit(child, { timeout, onTimeout, onAbandoned,
  onClosed = () => {}, grace = 10_000 }) {
  return new Promise((resolvePromise, reject) => {
    let finished = false, graceTimer;
    const finish = (error, status) => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(graceTimer);
      child.off("error", onError); child.off("close", onClose);
      if (error) reject(error); else resolvePromise(status);
    };
    const onError = error => finish(error);
    const onClose = (status, signal) => {
      if (!finished) onClosed(status, signal);
      finish(null, status);
    };
    const timer = setTimeout(() => {
      graceTimer = setTimeout(() => {
        try { onAbandoned(); finish(null, null); } catch (error) { finish(error); }
      }, grace);
      onTimeout();
    }, timeout);
    child.once("error", onError); child.once("close", onClose);
  });
}

function assertRegistered(identity) {
  const release = JSON.parse(readFileSync(join(ROOT, "docs/quality/controlled-marker-release.json")));
  for (const [field, actual] of Object.entries({
    profile: identity.profile, version: identity.implementationVersion,
    releaseName: identity.releaseName, sourceDigest: identity.sourceDigest,
    algorithmDigest: identity.algorithmDigest,
  })) assert.equal(actual, release.current[field], `Unregistered ${field}`);
  assert.equal(identity.profile, "small-lesion-boundary-candidate");
}

export function commandReportOptions(reportPath) {
  return {
    args: ["--reporter=json,line"],
    env: { PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath, FORCE_COLOR: "0" },
  };
}

export function writeComplete(fd, chunk, write = writeSync) {
  let offset = 0;
  while (offset < chunk.length) {
    const count = write(fd, chunk, offset, chunk.length - offset);
    assert.ok(Number.isSafeInteger(count) && count > 0 && count <= chunk.length - offset,
      "Output write made no valid progress");
    offset += count;
  }
}

export function captureCommandOutput(child, { stdoutFd, stderrFd, onOutput, onError,
  stdout = process.stdout, stderr = process.stderr }) {
  // Keep raw evidence while exposing progress; JSON has its own reporter file.
  const releases = [];
  for (const [stream, fd, destination] of [
    [child.stdout, stdoutFd, stdout], [child.stderr, stderrFd, stderr],
  ]) {
    let failed = false;
    const fail = error => {
      if (!failed) { failed = true; onError(error); }
    };
    const forward = chunk => {
      if (failed) return;
      try {
        writeComplete(fd, chunk);
        // Synchronous forwarding leaves no queued console writes after release.
        writeComplete(destination.fd, chunk);
        onOutput(chunk);
      } catch (error) { fail(error); }
    };
    stream.on("data", forward);
    stream.on("error", fail);
    releases.push(() => {
      stream.off("data", forward);
      stream.destroy();
    });
  }
  return () => releases.forEach(release => release());
}

const portOpen = port => new Promise(resolvePromise => {
  const socket = net.connect({ host: "127.0.0.1", port });
  const finish = value => { socket.destroy(); resolvePromise(value); };
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  socket.setTimeout(1000, () => finish(true));
});
async function assertPortsClosed() {
  for (const port of [4173, 4174]) assert.equal(await portOpen(port), false,
    `Port ${port} already occupied or child service not cleaned up`);
}

export async function main(args = process.argv.slice(2)) {
  assert.equal(args.length, 0, "test:browser accepts no filters or positional arguments");
  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;
    assert.ok(!/^(PWDEBUG|PW_TEST_|PWTEST_|TEST_GREP|TEST_SHARD)/.test(name), `External selection: ${name}`);
    if (name.startsWith("PLAYWRIGHT_")) {
      assert.ok(["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "PLAYWRIGHT_BROWSERS_PATH",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "PLAYWRIGHT_DOWNLOAD_HOST",
        "PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST"].includes(name), `Unsupported Playwright override: ${name}`);
    }
  }
  for (const name of ["PR226_B_RUN", "MOBILE_UI_TEST_ASSET_DIR", "MOBILE_UI_EVIDENCE_DIR"]) {
    assert.ok(!process.env[name], `${name} belongs to a separately authorized local batch`);
  }
  const folder = join(ROOT, "local_outputs/browser-contract-suites",
    new Date().toISOString().replaceAll(/[:.]/g, "-"));
  mkdirSync(folder, { recursive: true });
  const state = { status: "RUNNING", phases: [], suites: [], failures: [] };
  const save = () => writeFileSync(join(folder, "summary.json"), JSON.stringify(state, null, 2) + "\n");
  const phase = (name, details = {}) => {
    state.phases.push({ name, at: new Date().toISOString(), ...details }); save();
  };
  let interrupted = false;
  let child;
  let processUnsettled = false;
  const roots = [], owned = new Map(), observed = new Map();
  const collect = () => {
    const rows = collectOwned(processSnapshot([...new Set([
      ...roots.filter(root => !root.retired && (root.active || root.birth)).map(root => root.pid), ...owned.keys(),
    ])]), roots, owned);
    for (const row of rows) observed.set(`${row.pid}:${row.birth}`, row);
    return rows;
  };
  const terminate = () => {
    const deadline = Date.now() + 15_000;
    for (const row of collect().reverse()) {
      assert.ok(Date.now() < deadline, "Owned-process termination deadline exceeded");
      // Creation identity prevents killing an unrelated process reusing an old PID.
      if (!processSnapshot([row.pid]).some(current => current.pid === row.pid && current.birth === row.birth)) continue;
      try {
        if (process.platform === "win32") processSnapshot([row.pid], row);
        else throw new Error("No instance-bound Linux termination available; retaining FAIL without an unsafe PID kill");
      } catch (error) {
        if (processSnapshot([row.pid]).some(current => current.pid === row.pid && current.birth === row.birth)) throw error;
      }
    }
  };
  const signal = () => {
    interrupted = true;
    try { terminate(); } catch (error) { state.failures.push(`Signal cleanup: ${error.message}`); }
  };
  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
  async function run(name, executableArgs, timeout = 180_000, jsonReport = false) {
    assert.equal(interrupted, false, "Run interrupted");
    const out = join(folder, `${name}.json`);
    const rawOut = jsonReport ? join(folder, `${name}.stdout.log`) : out;
    const err = join(folder, `${name}.stderr.log`);
    const outFd = openSync(rawOut, "wx"), errFd = openSync(err, "wx");
    const startedAt = new Date().toISOString(), started = Date.now();
    let lastOutputAt = null, heartbeat, releaseOutput;
    const diagnostic = event => console.error(JSON.stringify({
      browserContract: name, event, at: new Date().toISOString(),
      elapsedMs: Date.now() - started, lastOutputAt, pid: child?.pid,
    }));
    const suite = { name, startedAt, timeoutMs: timeout, stdout: out, rawStdout: rawOut,
      stderr: err, ...(jsonReport ? { report: out } : {}) };
    state.suites.push(suite); save();
    let code;
    let monitor;
    try {
      const notBefore = birthClock();
        const reporting = jsonReport ? commandReportOptions(out) : { args: [], env: {} };
        child = spawn(process.execPath, [...executableArgs, ...reporting.args], {
          cwd: WEB, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
          env: { ...process.env, ...reporting.env },
          detached: process.platform !== "win32",
        });
        releaseOutput = captureCommandOutput(child, { stdoutFd: outFd, stderrFd: errFd,
          onOutput: () => { lastOutputAt = new Date().toISOString(); },
          onError: error => { state.failures.push(`${name} output: ${error.message}`); } });
        diagnostic("spawned");
        heartbeat = setInterval(() => diagnostic("running"), 30_000);
        const resolution = process.platform === "win32" ? 10_000n : 1n;
        const root = { pid: child.pid, active: true, parentPid: process.pid, image: process.execPath,
          notBefore: notBefore - resolution, notAfter: birthClock() + resolution };
        if (child.pid) roots.push(root);
        try { collect(); } catch (error) { state.failures.push(`Process inspection: ${error.message}`); }
        monitor = setInterval(() => {
          try { collect(); } catch (error) { state.failures.push(`Process inspection: ${error.message}`); }
        }, 2000);
        code = await awaitChildExit(child, {
          timeout,
          onTimeout: () => {
            diagnostic("timeout");
            state.failures.push(`${name}: timeout`);
            try { terminate(); } catch (error) { state.failures.push(`Timeout cleanup: ${error.message}`); }
          },
          onAbandoned: () => {
            suite.waitAbandonedAt = new Date().toISOString();
            diagnostic("termination-grace-expired");
            processUnsettled = true;
            state.failures.push(`${name}: process did not close within termination grace period`);
            releaseOutput();
            child.unref(); child.stdin?.destroy();
          },
          onClosed: (status, signal) => {
            suite.exitCode = status;
            suite.exitSignal = signal;
            suite.closedAt = new Date().toISOString();
            diagnostic("closed-before-cleanup");
          },
        });
          clearInterval(monitor);
          root.active = false;
          try {
            const remaining = collect();
            if (remaining.length) {
              state.failures.push(`${name}: remaining owned processes ${remaining.map(row => row.pid).join(",")}`);
              terminate();
            }
          } catch (error) { state.failures.push(`Process cleanup: ${error.message}`); }
          child = undefined;
    } finally {
      clearInterval(monitor); clearInterval(heartbeat);
      suite.finishedAt = new Date().toISOString();
      suite.elapsedMs = Date.now() - started;
      suite.lastOutputAt = lastOutputAt;
      releaseOutput?.();
      closeSync(outFd); closeSync(errFd); save();
    }
    diagnostic("cleanup-finished");
    return { code, report: () => JSON.parse(readFileSync(out, "utf8").replace(/^\uFEFF/, "")) };
  }
  const playwright = join(WEB, "node_modules/playwright/cli.js");
  const npmCli = process.env.npm_execpath;
  const ci = { prepared: false, attached: false };
  try {
    assert.equal(EXPECTED.length, 47);
    assertInventory(EXPECTED, EXPECTED);
    assert.equal(SOURCE.length, 2);
    await assertPortsClosed();
    assertRegistered(captureMarkerIdentity(undefined));
    if (process.env.GITHUB_ACTIONS === "true") {
      const descriptor = ciDescriptor();
      validateCiDescriptor(descriptor);
      const suffix = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
      ci.head = descriptor.head;
      ci.branch = `refs/heads/ci/source-contract-${suffix}`;
      ci.backup = `refs/heads/backup/ci-source-contract-${suffix}`;
      ci.gitDir = descriptor.gitDir;
      assertRefLayout(ci.gitDir, [ci.branch, ci.backup]);
      phase("VALIDATED", { head: ci.head, event: descriptor.environment.GITHUB_EVENT_NAME });
      assert.equal(optionalGit("show-ref", "--verify", "--quiet", ci.branch), null, "Existing CI ref");
      assert.equal(optionalGit("show-ref", "--verify", "--quiet", ci.backup), null, "Existing backup ref");
      const transaction = `start\ncreate ${ci.branch} ${ci.head}\ncreate ${ci.backup} ${ci.head}\nprepare\ncommit\n`;
      execFileSync("git", ["-C", ROOT, "update-ref", "--no-deref", "--stdin"], { input: transaction, encoding: "utf8" });
      ci.prepared = true; phase("REFS_PREPARED");
      assert.equal(optionalGit("symbolic-ref", "-q", "HEAD"), null);
      assert.equal(git("rev-parse", "HEAD"), ci.head);
      git("symbolic-ref", "HEAD", ci.branch);
      ci.attached = true;
      assert.equal(git("symbolic-ref", "HEAD"), ci.branch);
      for (const ref of [ci.branch, ci.backup]) assert.equal(git("rev-parse", ref), ci.head);
      assertRefLayout(ci.gitDir, [ci.branch, ci.backup]);
      phase("HEAD_ATTACHED");
    } else phase("LOCAL_NO_REF_MUTATION");
    const expectedIdentity = captureMarkerIdentity(undefined);
    state.identity = expectedIdentity;
    assertRegistered(expectedIdentity);
    assert.ok(npmCli && existsSync(npmCli), "Invoke via npm run test:browser");
    const status = await run("workflow-status", [npmCli, "run", "test:workflow-status"]);
    if (status.code !== 0) state.failures.push("Workflow status contract failed");

    const selections = [
      { name: "production", config: "playwright.config.ts",
        expected: EXPECTED.filter(row => row.suite === "production"), extra: [] },
      ...SOURCE.map((row, index) => ({
        name: `source-${index + 1}`, config: "playwright.source-contract.config.ts", expected: [row],
        extra: ["--grep", `${row.full_title_parts.at(-1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+@source-contract)?$`],
      })),
    ];
    for (const selection of selections) {
      try {
        const common = [playwright, "test", "--config", selection.config, ...selection.extra,
          "--workers=1", "--retries=0"];
        const listed = await run(`${selection.name}-list`, [...common, "--list"], 180_000, true);
        assert.equal(listed.code, 0, "Unable to list tests");
        assertInventory(reportRows(listed.report()), selection.expected);
      } catch (error) { state.failures.push(`${selection.name} inventory: ${error.message}`); }
    }
    // Refuse all execution if discovery could silently omit a fixed test.
    assert.ok(!state.failures.some(failure => failure.includes("inventory:")), "Inventory mismatch");
    for (const selection of selections) {
      if (interrupted || processUnsettled) break;
      try {
        await assertPortsClosed();
        assertIdentity(captureMarkerIdentity(undefined), expectedIdentity);
        const result = await run(selection.name, [playwright, "test", "--config", selection.config,
          ...selection.extra, "--workers=1", "--retries=0",
          "--output", join(folder, selection.name)], selection.name === "production" ? 900_000 : 180_000, true);
        assert.equal(result.code, 0, `${selection.name} failed`);
        const report = result.report();
        assertResults(report, selection.expected);
        if (selection.name === "production") {
          assertIdentity(JSON.parse(readFileSync(join(WEB, "dist/marker-runtime-identity.json"))), expectedIdentity);
        }
        state[selection.name] = { stats: report.stats, inventory: reportRows(report).map(key) };
      } catch (error) { state.failures.push(`${selection.name}: ${error.message}`); }
      finally {
        try { await assertPortsClosed(); assertIdentity(captureMarkerIdentity(undefined), expectedIdentity); }
        catch (error) { state.failures.push(`After ${selection.name}: ${error.message}`); }
        save();
      }
    }
    if (interrupted) state.failures.push("Interrupted");
    if (processUnsettled) state.failures.push("Further suites stopped because owned processes remain unconfirmed");
    phase("SUITES_FINISHED_OR_FAILED");
  } catch (error) { state.failures.push(error.stack || error.message); }
  finally {
    try {
      const remaining = collect();
      if (remaining.length) {
        state.failures.push(`Final cleanup found owned processes: ${remaining.map(row => row.pid).join(",")}`);
        terminate();
      }
      if (ci.prepared) {
        assertRefLayout(ci.gitDir, [ci.branch, ci.backup]);
        for (const ref of [ci.branch, ci.backup]) {
          assert.equal(optionalGit("symbolic-ref", "-q", ref), null, "Temporary ref became symbolic");
          assert.equal(git("rev-parse", ref), ci.head);
        }
        if (ci.attached) {
          assert.equal(git("symbolic-ref", "HEAD"), ci.branch);
          assert.equal(git("rev-parse", "HEAD"), ci.head);
          git("update-ref", "--no-deref", "HEAD", ci.head, ci.head);
          assert.equal(optionalGit("symbolic-ref", "-q", "HEAD"), null);
          assert.equal(git("rev-parse", "HEAD"), ci.head);
          phase("HEAD_RESTORED");
        } else {
          assert.equal(optionalGit("symbolic-ref", "-q", "HEAD"), null);
          assert.equal(git("rev-parse", "HEAD"), ci.head);
        }
        const transaction = `start\ndelete ${ci.branch} ${ci.head}\ndelete ${ci.backup} ${ci.head}\nprepare\ncommit\n`;
        execFileSync("git", ["-C", ROOT, "update-ref", "--no-deref", "--stdin"], { input: transaction, encoding: "utf8" });
        for (const ref of [ci.branch, ci.backup]) assert.equal(optionalGit("show-ref", "--verify", "--quiet", ref), null);
        phase("REFS_REMOVED");
        assert.equal(git("status", "--porcelain=v1", "--untracked-files=no"), "");
      }
      await assertPortsClosed();
      assert.equal(collect().length, 0, "Owned descendants remain");
      state.processOwnership = { observed: [...observed.values()], live: 0 };
      phase("CLOSED");
    } catch (error) { state.failures.push(`Cleanup: ${error.stack || error.message}`); }
    process.off("SIGINT", signal); process.off("SIGTERM", signal);
    if (interrupted && !state.failures.includes("Interrupted")) state.failures.push("Interrupted");
    state.status = state.failures.length ? "FAIL" : "PASS"; save();
  }
  console.log(JSON.stringify({ status: state.status, evidence: folder, failures: state.failures }));
  return state.status === "PASS" ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
