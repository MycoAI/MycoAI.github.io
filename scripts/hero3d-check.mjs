// Headless check of the 3D hero on the home page, used by scripts/check.rb.
// Drives the installed Chrome over the DevTools protocol (Node 22+, no packages needed).
//
//   node scripts/hero3d-check.mjs http://127.0.0.1:4000/ [path-to-chrome]
//
// It loads the page at 1440px and 360px wide, at 1440px with the GPU disabled (software
// WebGL, as on machines without graphics acceleration), at 1440px in system dark mode and at
// 1440px with reduced motion in dark mode (the model must still be shown, only without motion
// and without rain), and reports console errors, failed requests, the size of the <canvas>
// inside #stage and the draw calls and triangles of one frame (counted on the WebGL context,
// as three.js renderer.info does). Rain (a WebGL LINES draw) must show only in dark mode,
// follow the theme toggle at once, and stay off with reduced motion. The stage is scrolled
// into view when the model has not loaded by itself, as three.js loads only near the viewport.
// Prints JSON; exits 1 when a run has no visible canvas with a size, console errors, failed
// requests or wrong rain.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
const chrome = process.argv[3] ||
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "google-chrome");
if (!url) {
  console.error("usage: node scripts/hero3d-check.mjs <home page url> [chrome]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(extraFlags) {
  const profile = mkdtempSync(join(tmpdir(), "hero3d-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", ...extraFlags, "about:blank",
  ], { stdio: "ignore" });
  return {
    port,
    async stop() {
      // wait for Chrome to exit and release its files, then remove the temporary profile
      const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once("exit", r));
      proc.kill();
      await Promise.race([exited, sleep(5000)]);
      for (let i = 0; i < 20; i++) {
        try { rmSync(profile, { recursive: true, force: true }); return; } catch { await sleep(250); }
      }
    },
  };
}

async function endpoint(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map(), handlers = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) handlers.forEach((h) => h(msg));
  };
  return new Promise((resolve) => {
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const n = ++id;
        const timer = setTimeout(() => { pending.delete(n); rej(new Error(`${method} timed out`)); }, 15000);
        pending.set(n, (msg) => { clearTimeout(timer); res(msg); });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
      on: (h) => handlers.push(h),
      close: () => ws.close(),
    });
  });
}

/* counts draw calls per rendered frame; three.js clears once at the start of each render */
const GL_HOOK = `(() => {
  const S = window.__glStats = { cur: { calls: 0, triangles: 0, lines: 0 }, last: null, frames: 0 };
  const add = (mode, count) => {
    S.cur.calls++;
    if (mode === 4) S.cur.triangles += count / 3;
    else if (mode === 5 || mode === 6) S.cur.triangles += count - 2;
    else if (mode === 1) S.cur.lines += count / 2;
    else if (mode === 2 || mode === 3) S.cur.lines += count - 1;
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const p = C.prototype, clear = p.clear, de = p.drawElements, da = p.drawArrays;
    p.clear = function () { if (S.cur.calls) { S.last = S.cur; S.frames++; } S.cur = { calls: 0, triangles: 0, lines: 0 }; return clear.apply(this, arguments); };
    p.drawElements = function (mode, count) { add(mode, count); return de.apply(this, arguments); };
    p.drawArrays = function (mode, first, count) { add(mode, count); return da.apply(this, arguments); };
  }
})()`;
const STATS = `(() => { const s = window.__glStats; return s && s.last ? { ...s.last, frames: s.frames } : null; })()`;

const PROBE = `(() => {
  const stage = document.getElementById("stage");
  if (!stage) return { stage: null };
  const s = stage.getBoundingClientRect();
  const c = stage.querySelector("canvas");
  const r = c ? c.getBoundingClientRect() : null;
  return {
    stage: { width: Math.round(s.width), height: Math.round(s.height) },
    canvas: r ? { width: Math.round(r.width), height: Math.round(r.height), visible: getComputedStyle(c).display !== "none" } : null,
    is3d: stage.classList.contains("is-3d"),
    three: typeof window.THREE !== "undefined",
    fallbackVisible: !!stage.querySelector(".fallback") && getComputedStyle(stage.querySelector(".fallback")).display !== "none",
  };
})()`;

async function run(cdp, width, height, mobile, { reduceMotion, colorScheme, rainTest }) {
  const errors = [], failed = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(`${msg.params.entry.text} ${msg.params.entry.url || ""}`.trim());
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) failed.push(`${msg.params.response.status} ${msg.params.response.url}`);
    if (msg.method === "Network.loadingFailed" && !msg.params.canceled) failed.push(`${msg.params.errorText} ${msg.params.requestId}`);
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await cdp.send("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-reduced-motion", value: reduceMotion ? "reduce" : "no-preference" },
    { name: "prefers-color-scheme", value: colorScheme || "light" },
  ] });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: GL_HOOK });
  await cdp.send("Page.navigate", { url });
  const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result.result.value;
  let probe = null, scrolled = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    probe = await evaluate(PROBE);
    if (probe && probe.canvas && probe.is3d) break;
    if (i === 11 && !scrolled) {
      scrolled = true;
      await evaluate(`document.getElementById("stage").scrollIntoView({ block: "center" })`);
    }
  }
  const settle = async () => { await sleep(rainTest || reduceMotion ? 700 : 1200); return evaluate(STATS); };
  const stats = await settle();
  let rain = null;
  if (stats) {
    // the rain is the only LINES draw in the scene
    const steps = [{ theme: null, stats }];
    if (rainTest) {
      for (const theme of ["dark", "light"]) {
        await evaluate(`document.documentElement.setAttribute("data-theme", "${theme}")`);
        steps.push({ theme, stats: await settle() });
      }
    } else if (reduceMotion) {
      // switch to dark and make the scene redraw (zoom button): still no rain
      await evaluate(`document.documentElement.setAttribute("data-theme", "dark")`);
      await evaluate(`document.getElementById("zin").click()`);
      steps.push({ theme: "dark", stats: await settle() });
    }
    const expected = (theme) => !reduceMotion && (theme ? theme === "dark" : colorScheme === "dark");
    rain = steps.map(({ theme, stats }) => ({
      theme: theme ? `data-theme ${theme}` : `system ${colorScheme || "light"}`,
      expected: expected(theme), shown: !!stats && stats.lines > 0, stats,
    }));
  }
  return {
    width, height, probe, scrolled, stats, rain, rainOk: !!rain && rain.every((r) => r.expected === r.shown),
    errors: [...new Set(errors)], failed: [...new Set(failed)],
  };
}

async function check(width, height, mobile, flags = [], options = {}) {
  const browser = launch(flags);
  try {
    const cdp = await client(await endpoint(browser.port));
    for (const d of ["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"]) await cdp.send(d);
    const result = await run(cdp, width, height, mobile, options);
    cdp.close();
    const label = [...flags];
    if (options.colorScheme === "dark") label.push("system dark");
    if (options.reduceMotion) label.push("prefers-reduced-motion");
    return { ...result, flags: label };
  } catch (e) {
    return { width, height, error: String(e) };
  } finally {
    await browser.stop();
  }
}

const results = [
  await check(1440, 900, false, [], { rainTest: true }),
  await check(360, 740, true),
  await check(1440, 900, false, ["--disable-gpu"]),
  await check(1440, 900, false, [], { colorScheme: "dark" }),
  await check(1440, 900, false, [], { colorScheme: "dark", reduceMotion: true }),
];
const ok = results.every((r) => r.probe && r.probe.canvas && r.probe.canvas.width > 0 && r.probe.canvas.height > 0 &&
  r.probe.canvas.visible && r.rainOk && r.errors.length === 0 && r.failed.length === 0);
console.log(JSON.stringify({ ok, results }, null, 2));
process.exit(ok ? 0 : 1);
