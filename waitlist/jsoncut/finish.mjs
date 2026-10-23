// The last step of either renderer: from a rendered master, make the web copy and its poster frame,
// an optional smaller copy for phones, and list a reel that fills a page slot in assets/reels.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed`);
};

export function publish(job, site, renderedWith) {
  const master = join(site, job.output);
  if (!job.web) return;
  const { src, width, crf, poster, posterAt, slot, small } = job.web;
  mkdirSync(dirname(join(site, src)), { recursive: true });
  ffmpeg(['-i', master, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(site, src)]);
  ffmpeg(['-ss', String(posterAt), '-i', join(site, src), '-frames:v', '1', '-q:v', '3', join(site, poster)]);
  console.log(`  web copy ${src}, poster ${poster}`);
  const srcSmall = small ? src.replace(/\.mp4$/, `-${small.width}.mp4`) : null;
  if (small) {
    ffmpeg(['-i', master, '-vf', `scale=${small.width}:-2:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(small.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(site, srcSmall)]);
    console.log(`  phone copy ${srcSmall}`);
  }
  if (!slot) return;
  const listPath = join(site, 'assets', 'reels.json');
  const list = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : {};
  list[slot] = { src, ...(srcSmall && { srcSmall }), poster, renderedWith, renderedAt: new Date().toISOString() };
  writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');
  console.log(`  listed in assets/reels.json as "${slot}"`);
}
