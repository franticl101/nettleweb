// Renders the JsonCut jobs in jobs.mjs here, without the JsonCut API, by following the job format
// that the JsonCut AGENTS.md describes:
//   - each clip is laid out in headless Chrome at the job's width and height, layers bottom to top;
//   - every frame is exact: CSS animations are paused and set to the frame's time, and video layers
//     are seeked to it, then the frame is captured;
//   - clips are encoded with ffmpeg and joined with its xfade filter for the transitions.
// It covers what these jobs use (image layers with Ken Burns, video layers with cutFrom/cutTo, html
// layers with `animated`, position presets, fill-color, fade and fadecolor transitions). JsonCut's own
// renderer may differ in small ways, such as the easing of a Ken Burns move.
//
//   node waitlist/jsoncut/render-local.mjs [job-name …]
//
// Needs Node 22+, ffmpeg, and Chrome or Chromium (set CHROME_PATH if it is not found).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Browser } from '../../.claude/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { jobs } from './jobs.mjs';
import { publish } from './finish.mjs';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2' };
// JsonCut's xfade-style transitions, by their nearest ffmpeg xfade name
const XFADE = { fade: 'fade', fadecolor: 'fadeblack', fadegrayscale: 'fadegrays', wipeLeft: 'wipeleft', wipeRight: 'wiperight', wipeUp: 'wipeup', wipeDown: 'wipedown', circleopen: 'circleopen', pixelize: 'pixelize', SimpleZoom: 'zoomin', squeeze: 'squeezev', Radial: 'radial' };

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const media = (path) => (path.startsWith('@media/') ? `/jsoncut/media/${path.slice(7)}` : path);

// A local server for the generated clip pages and the media they use; it answers range requests so
// Chrome can seek video.
const pages = new Map();
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pages.has(path)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(pages.get(path)); }
  const file = resolve(site, '.' + path);
  if (!file.startsWith(site + sep) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  const size = statSync(file).size, type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const body = readFileSync(file);
  if (!range) { res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' }); return res.end(body); }
  const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : size - 1;
  res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
  res.end(body.subarray(start, end + 1));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// where a layer of w×h sits in a W×H frame
function place(position, w, h, W, H) {
  if (position && typeof position === 'object') {
    const x = position.x * W - (position.originX === 'right' ? w : position.originX === 'center' ? w / 2 : 0);
    const y = position.y * H - (position.originY === 'bottom' ? h : position.originY === 'center' ? h / 2 : 0);
    return [x, y];
  }
  if (!position) return [0, 0];
  const x = /left/.test(position) ? 0 : /right/.test(position) ? W - w : (W - w) / 2;
  const y = /^top/.test(position) ? 0 : /^bottom/.test(position) ? H - h : (H - h) / 2;
  return [x, y];
}

// Ken Burns as a CSS animation over the whole clip, so it is seeked like everything else
function kenBurns(dir, amount, dur, id) {
  if (!dir) return ['', ''];
  const s = 1 + (amount ?? 0.1), p = ((s - 1) / (2 * s)) * 100;
  const frames = {
    in: [`scale(1)`, `scale(${s})`],
    out: [`scale(${s})`, `scale(1)`],
    left: [`scale(${s}) translateX(${-p}%)`, `scale(${s}) translateX(${p}%)`],
    right: [`scale(${s}) translateX(${p}%)`, `scale(${s}) translateX(${-p}%)`],
    up: [`scale(${s}) translateY(${-p}%)`, `scale(${s}) translateY(${p}%)`],
    down: [`scale(${s}) translateY(${p}%)`, `scale(${s}) translateY(${-p}%)`],
  }[dir];
  return [`@keyframes kb${id}{from{transform:${frames[0]}}to{transform:${frames[1]}}}`, `animation:kb${id} ${dur}s linear both;`];
}

function clipPage(clip, cfg, dur) {
  const W = cfg.width ?? 1280, H = cfg.height ?? 720;
  let css = `html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#000}.L{position:absolute;border:0;margin:0}`;
  const body = clip.layers.map((l, i) => {
    const time = l.start != null || l.stop != null ? ` data-start="${l.start ?? 0}" data-stop="${l.stop ?? 1e9}"` : '';
    if (l.type === 'fill-color') return `<div class="L" style="inset:0;background:${l.color}"${time}></div>`;
    if (l.type === 'image' || l.type === 'image-overlay') {
      const [kf, anim] = kenBurns(l.type === 'image' ? (l.zoomDirection === undefined ? 'in' : l.zoomDirection) : l.zoomDirection, l.zoomAmount, dur, i);
      css += kf;
      const fit = l.resizeMode === 'contain' ? 'contain' : l.resizeMode === 'stretch' ? 'fill' : 'cover';
      return `<img class="L" src="${esc(media(l.path))}" style="left:0;top:0;width:100%;height:100%;object-fit:${fit};${anim}"${time}>`;
    }
    if (l.type === 'video') {
      const fit = l.resizeMode === 'contain' ? 'contain' : l.resizeMode === 'stretch' ? 'fill' : 'cover';
      return `<video class="L" src="${esc(media(l.path))}" muted preload="auto" data-from="${l.cutFrom ?? 0}" data-to="${l.cutTo ?? ''}" style="left:0;top:0;width:100%;height:100%;object-fit:${fit}"${time}></video>`;
    }
    if (l.type === 'html') {
      const w = l.width ?? W, h = l.height ?? H, [x, y] = place(l.position, w, h, W, H);
      const fonts = (l.googleFonts || []).filter((f) => f !== 'Archivo').map((f) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}&display=block">`).join('');
      const doc = `<!doctype html><meta charset="utf-8">${fonts}<style>@font-face{font-family:Archivo;src:url(${origin}/fonts/archivo-latin.woff2) format("woff2");font-weight:100 900}${l.css || ''}</style>${l.html}`;
      return `<iframe class="L" srcdoc="${esc(doc)}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:transparent"${time}></iframe>`;
    }
    throw new Error(`layer type "${l.type}" is not supported by the local renderer`);
  }).join('\n');
  const script = `<script>
  const docs = () => [document, ...[...document.querySelectorAll('iframe')].map((f) => f.contentDocument)];
  window.__ready = async () => {
    await Promise.all([...document.querySelectorAll('iframe')].map((f) => f.contentDocument?.readyState === 'complete' ? 0 : new Promise((r) => f.addEventListener('load', r, { once: true }))));
    await Promise.all(docs().map((d) => d.fonts.ready));
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    await Promise.all([...document.querySelectorAll('video')].map((v) => v.readyState >= 2 ? 0 : new Promise((r) => v.addEventListener('loadeddata', r, { once: true }))));
  };
  window.__seek = async (t, dur) => {
    for (const d of docs()) for (const a of d.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
    for (const el of document.querySelectorAll('[data-start]')) el.style.visibility = t >= +el.dataset.start && t < +el.dataset.stop ? 'visible' : 'hidden';
    await Promise.all([...document.querySelectorAll('video')].map((v) => {
      const from = +v.dataset.from, to = v.dataset.to ? +v.dataset.to : v.duration;
      const target = Math.min(from + t * ((to - from) / dur), v.duration - 0.001);
      if (Math.abs(v.currentTime - target) < 1e-4) return 0;
      return new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = target; });
    }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  </script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}${script}</body></html>`;
}

const wanted = process.argv.slice(2);
const extraArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
const browser = await Browser.launch({ width: 1440, height: 1080, extraArgs: [...extraArgs, '--autoplay-policy=no-user-gesture-required'] });
const work = mkdtempSync(join(tmpdir(), 'jsoncut-local-'));
try {
  for (const job of jobs.filter((j) => !wanted.length || wanted.includes(j.name))) {
    const cfg = job.config, W = cfg.width ?? 1280, H = cfg.height ?? 720, fps = cfg.fps ?? 25;
    console.log(`\n${job.name}: ${cfg.clips.length} clip(s), ${W}×${H} at ${fps} fps`);
    const parts = [];
    for (const [ci, clip] of cfg.clips.entries()) {
      const dur = clip.duration ?? cfg.defaults?.duration ?? 4;
      const url = `/__${job.name}-${ci}.html`;
      pages.set(url, clipPage(clip, cfg, dur));
      const page = await browser.newPage({ width: W, height: H });
      await page.goto(origin + url, { settleMs: 300 });
      await page.eval('window.__ready()');
      const dir = join(work, `${job.name}-${ci}`);
      mkdirSync(dir, { recursive: true });
      const n = Math.round(dur * fps);
      for (let f = 0; f < n; f++) {
        await page.eval(`window.__seek(${f / fps}, ${dur})`);
        await page.screenshot({ path: join(dir, `${String(f).padStart(5, '0')}.jpg`), format: 'jpeg', quality: 94 });
        if (f % fps === 0) process.stdout.write(`  clip ${ci + 1}: ${Math.round((f / n) * 100)}%   \r`);
      }
      await page.close();
      const out = join(work, `${job.name}-${ci}.mp4`);
      ffmpeg(['-framerate', String(fps), '-i', join(dir, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', out]);
      rmSync(dir, { recursive: true, force: true });
      const t = clip.transition === undefined ? cfg.defaults?.transition : clip.transition;
      parts.push({ file: out, dur, transition: t || null });
      console.log(`  clip ${ci + 1}: ${n} frames, ${dur}s${t ? `, then ${t.name} ${t.duration}s` : ''}   `);
    }

    // join the clips: each transition overlaps the end of one clip with the start of the next
    const master = join(site, job.output);
    mkdirSync(dirname(master), { recursive: true });
    const inputs = parts.flatMap((p) => ['-i', p.file]);
    const filters = [];
    let label = '0:v', length = parts[0].dur;
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i - 1].transition, out = `v${i}`;
      if (t && t.duration > 0) {
        const offset = length - t.duration;
        filters.push(`[${label}][${i}:v]xfade=transition=${XFADE[t.name] || 'fade'}:duration=${t.duration}:offset=${offset.toFixed(3)}[${out}]`);
        length = offset + parts[i].dur;
      } else {
        filters.push(`[${label}][${i}:v]concat=n=2:v=1:a=0[${out}]`);
        length += parts[i].dur;
      }
      label = out;
    }
    const map = parts.length > 1 ? ['-filter_complex', filters.join(';'), '-map', `[${label}]`] : [];
    ffmpeg([...inputs, ...map, '-r', String(fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', master]);
    console.log(`  saved ${job.output} (${length.toFixed(1)}s)`);
    publish(job, site, 'render-local.mjs (JsonCut job format, rendered without the API)');
  }
} finally {
  await browser.close?.();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(0);
