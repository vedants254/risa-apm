// deck.html -> layout JSON for build_pptx_editable.py.
// Opens the deck in headless Edge over the DevTools protocol (no extra packages: Node's built-in fetch/WebSocket),
// waits for the auto-fit, runs pptx_extract.js in the page and writes its result.
// Usage: node extract_pptx.mjs <out.json>
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) { console.error('usage: node extract_pptx.mjs <out.json>'); process.exit(2); }
const edge = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = mkdtempSync(path.join(tmpdir(), 'pptx-edge-'));
const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  let targets = null;
  for (let i = 0; i < 150 && !targets; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); if (r.ok) targets = await r.json(); } catch { await sleep(100); }
  }
  const page = targets && targets.find(t => t.type === 'page');
  if (!page) throw new Error('Edge DevTools endpoint not reachable (is Edge installed at ' + edge + '?)');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(here, 'deck.html')).href });
  for (let i = 0; i < 200; i++) {
    const r = await send('Runtime.evaluate', { expression: 'document.readyState==="complete" && document.body && document.body.dataset.fit==="1"', returnByValue: true });
    if (r.result && r.result.result && r.result.result.value === true) break;
    await sleep(100);
  }
  const r = await send('Runtime.evaluate', { expression: readFileSync(path.join(here, 'pptx_extract.js'), 'utf8'), awaitPromise: true, returnByValue: true });
  if (r.error || r.result.exceptionDetails) throw new Error('extractor failed: ' + JSON.stringify(r.error || r.result.exceptionDetails).slice(0, 2000));
  writeFileSync(out, JSON.stringify(r.result.result.value));
  console.log('layout ->', out);
  ws.close();
} finally {
  proc.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold the profile lock */ }
}
