// Headless check of the 3D hero on the home page, used by scripts/check.rb.
// Drives the installed Chrome over the DevTools protocol (Node 22+, no packages needed).
//
//   node scripts/hero3d-check.mjs http://127.0.0.1:4000/ [path-to-chrome]
//
// It loads the page at 1440px and 360px wide, at 1440px with the GPU disabled (software
// WebGL, as on machines without graphics acceleration) and at 1440px with reduced motion
// (the model must still be shown, only without motion), and reports console
// errors, failed requests and the size of the <canvas> inside #stage. Prints JSON; exits 1
// when a run has no visible canvas with a size, or console errors or failed requests.

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
      proc.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
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

async function run(cdp, width, height, mobile, reduceMotion) {
  const errors = [], failed = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(`${msg.params.entry.text} ${msg.params.entry.url || ""}`.trim());
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) failed.push(`${msg.params.response.status} ${msg.params.response.url}`);
    if (msg.method === "Network.loadingFailed" && !msg.params.canceled) failed.push(`${msg.params.errorText} ${msg.params.requestId}`);
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (reduceMotion) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  await cdp.send("Page.navigate", { url });
  let probe = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    probe = (await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true })).result.result.value;
    if (probe && probe.canvas && probe.is3d) break;
  }
  await sleep(500);
  return { width, height, probe, errors: [...new Set(errors)], failed: [...new Set(failed)] };
}

async function check(width, height, mobile, flags = [], reduceMotion = false) {
  const browser = launch(flags);
  try {
    const cdp = await client(await endpoint(browser.port));
    for (const d of ["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"]) await cdp.send(d);
    const result = await run(cdp, width, height, mobile, reduceMotion);
    cdp.close();
    return { ...result, flags: reduceMotion ? [...flags, "prefers-reduced-motion"] : flags };
  } catch (e) {
    return { width, height, error: String(e) };
  } finally {
    await browser.stop();
  }
}

const results = [
  await check(1440, 900, false),
  await check(360, 740, true),
  await check(1440, 900, false, ["--disable-gpu"]),
  await check(1440, 900, false, [], true),
];
const ok = results.every((r) => r.probe && r.probe.canvas && r.probe.canvas.width > 0 && r.probe.canvas.height > 0 &&
  r.probe.canvas.visible && r.errors.length === 0 && r.failed.length === 0);
console.log(JSON.stringify({ ok, results }, null, 2));
process.exit(ok ? 0 : 1);
