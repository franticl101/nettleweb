// Renders the JsonCut jobs in jobs.mjs, following the JsonCut AGENTS.md workflow:
// upload the local media, validate each config, create the job, poll it, download the result.
//
//   JSONCUT_API_KEY=jc_live_… node waitlist/jsoncut/render.mjs [job-name …]
//
// finish.mjs then makes the web copy and poster each job names, and lists page reels in
// assets/reels.json. Run from anywhere; paths are resolved against the waitlist folder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobs } from './jobs.mjs';
import { publish } from './finish.mjs';

const API = 'https://api.jsoncut.com/api/v1';
const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const key = process.env.JSONCUT_API_KEY;
if (!key) {
  console.error('JSONCUT_API_KEY is not set. Add it to the environment (never commit it) and run again.');
  process.exit(2);
}
const headers = { 'x-api-key': key };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { ...headers, ...init.headers } });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok || body?.success === false) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error ?? body).slice(0, 600)}`);
  return body;
}

const CATEGORY = { '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.mp4': 'video', '.webm': 'video', '.mp3': 'audio', '.woff2': 'font' };
const uploaded = new Map();
async function upload(name) {
  if (uploaded.has(name)) return uploaded.get(name);
  const file = join(site, 'jsoncut', 'media', name);
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)]), basename(file));
  form.append('category', CATEGORY[extname(file).toLowerCase()]);
  form.append('ttlHours', '2');
  const { data } = await api('/files/upload', { method: 'POST', body: form });
  console.log(`  uploaded ${name} → ${data.storageUrl}`);
  uploaded.set(name, data.storageUrl);
  return data.storageUrl;
}

// replace every "@media/<file>" string in the config with the uploaded file's storage path
async function resolveMedia(value) {
  if (typeof value === 'string' && value.startsWith('@media/')) return upload(value.slice(7));
  if (Array.isArray(value)) return Promise.all(value.map(resolveMedia));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await resolveMedia(v);
    return out;
  }
  return value;
}

const wanted = process.argv.slice(2);

for (const job of jobs.filter((j) => !wanted.length || wanted.includes(j.name))) {
  console.log(`\n${job.name}`);
  const config = await resolveMedia(job.config);
  const check = await api('/jobs/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: job.type, config }) });
  console.log(`  valid${check.data?.estimatedTokens != null ? `, about ${check.data.estimatedTokens} tokens` : ''}`);
  const { data: created } = await api('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: job.type, config }) });
  let status = created;
  for (const started = Date.now(); !['COMPLETED', 'FAILED'].includes(status.status); ) {
    if (Date.now() - started > 15 * 60 * 1000) throw new Error(`${job.name}: still ${status.status} after 15 minutes (job ${created.id})`);
    await sleep(5000);
    ({ data: status } = await api(`/jobs/${created.id}`));
    process.stdout.write(`  ${status.status.toLowerCase()}${status.progress != null ? ` ${status.progress}%` : ''}\r`);
  }
  if (status.status === 'FAILED') throw new Error(`${job.name} failed: ${JSON.stringify(status.error)}`);
  const out = join(site, job.output);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await api(`/files/${status.outputFileId}/download`)));
  console.log(`  saved ${job.output}                `);
  publish(job, site, `JsonCut API, job ${created.id}`);
}
