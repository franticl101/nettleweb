// Block Zero waitlist. Everything here enhances a page that already reads without it.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- reveal once on entering the viewport ----------
(() => {
  const targets = $$('[data-reveal]');
  if (!('IntersectionObserver' in window)) { targets.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
  targets.forEach((el) => io.observe(el));
  addEventListener('load', () => setTimeout(() => {
    targets.forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in'); });
  }, 2500));
})();

// ---------- the hero feed: sample launches arriving and being read ----------
(() => {
  const feed = $('#feed');
  if (!feed) return;
  const list = $('.feed-rows', feed), meta = $('.feed-meta', feed);
  const k = (name) => $(`[data-k="${name}"]`, feed);
  // sample tokens; a line starting with "!" is a flag
  const POOL = [
    { sym: 'LILPEBBLE', ca: '7Hq3', av: 1, found: ['!Bundled 41.2% in the creation slot', '!Dev sold 5 of its 6 past tokens', '!Top 10 hold 58.4%'] },
    { sym: 'TOADSTOOL', ca: '9vRm', av: 2, found: ['Mint and freeze authority revoked', 'No bundle in the creation slot', 'Top 10 hold 18.2%'] },
    { sym: 'SOGGYTOAST', ca: '4kPz', av: 3, found: ['!9 snipers hold 14.8%', 'Mint and freeze authority revoked'] },
    { sym: 'MOONMOTH', ca: '2bWx', av: 4, found: ['!Freeze authority still on', '!Top 10 hold 47.1%'] },
    { sym: 'DUSTBUNNY', ca: '8cLe', av: 1, found: ['!Dev wallet holds 22.5%', 'No bundle in the creation slot'] },
    { sym: 'COLDBREW', ca: '6wHs', av: 2, found: ['Mint and freeze authority revoked', 'No bundle, 2 snipers', 'Top 10 hold 21.0%'] },
    { sym: 'GRUMPYGOOSE', ca: '5tNa', av: 3, found: ['Mint and freeze authority revoked', 'No bundle in the creation slot', 'Top 10 hold 24.6%'] },
    { sym: 'TINYTHUNDER', ca: '2pKd', av: 4, found: ['!Mint authority still on', '!Bundled 33.0% in the creation slot', '!Top 10 hold 61.7%'] },
    { sym: 'SNAILMAIL', ca: '3gYu', av: 1, found: ['!Bundled 28.9% in the creation slot', '!Dev sold 3 of its 4 past tokens'] },
    { sym: 'WOBBLYJELLY', ca: '9eQf', av: 2, found: ['Mint and freeze authority revoked', 'No bundle in the creation slot', 'Top 10 hold 19.3%'] },
  ];
  const START = [[9, 13.8, 61], [31, 21.2, 188], [47, 8.9, 96], [72, 31.5, 402], [100, 17.3, 231], [125, 44.6, 517]];
  const MAX = 6;
  const age = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const money = (v) => `$${v.toFixed(1)}k`;
  const flags = (tok) => tok.found.filter((f) => f.startsWith('!')).length;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let rows = [], next = START.length, serial = 0, running = false, open = null;

  // a row's findings show only once its read has finished
  function findings(row, reading) {
    const ul = el('ul');
    if (reading) ul.append(el('li', 'ok', 'Still reading its first block…'));
    else for (const f of row.tok.found) ul.append(el('li', f.startsWith('!') ? '' : 'ok', f.replace(/^!/, '')));
    row.detail.replaceChildren(ul);
  }

  function verdict(row, pop) {
    findings(row);
    const n = flags(row.tok);
    row.pill.textContent = n ? (n === 1 ? '1 flag' : `${n} flags`) : 'Clean so far';
    row.pill.className = `pill ${n ? 'pill-neg' : 'pill-pos'}${pop ? ' is-pop' : ''}`;
  }

  function makeRow(tok, [s, mcap, holders], reading) {
    const id = `launch-${++serial}`;
    const li = el('li'), btn = el('button', 'feed-row');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    const t = el('span', 'tok'), av = el('span', `av av-${tok.av}`, tok.sym[0]), name = el('span', 'tok-name', `$${tok.sym}`);
    av.setAttribute('aria-hidden', 'true');
    name.append(el('small', '', `${tok.ca}…pump`));
    t.append(av, name);
    const cAge = el('span', 'num'), cMcap = el('span', 'num'), cHold = el('span', 'num'), cRead = el('span', 'num'), pill = el('span');
    cRead.append(pill);
    btn.append(t, cAge, cMcap, cHold, cRead);
    const detail = el('div', 'row-detail');
    detail.id = id;
    detail.hidden = true;
    li.append(btn, detail);
    const row = { tok, s, mcap, holders, li, btn, detail, cAge, cMcap, cHold, pill };
    btn.addEventListener('click', () => toggle(row));
    if (reading) { pill.textContent = 'Reading'; pill.className = 'pill pill-wait'; findings(row, true); } else verdict(row);
    paint(row);
    return row;
  }

  function paint(row) {
    row.cAge.textContent = age(row.s);
    row.cMcap.textContent = money(row.mcap);
    row.cHold.textContent = row.holders;
  }

  function toggle(row) {
    const opening = open !== row;
    if (open) { open.btn.setAttribute('aria-expanded', 'false'); open.detail.hidden = true; }
    open = opening ? row : null;
    if (open) { row.btn.setAttribute('aria-expanded', 'true'); row.detail.hidden = false; }
    meta.lastChild.textContent = open ? 'Sample data, paused' : 'Sample data, replaying';
  }

  // move the rows that stay from where they were to where they are (so the list slides, not jumps)
  function slide(before) {
    if (reduced) return;
    for (const r of rows) {
      const was = before.get(r.li);
      if (was == null) continue;
      const dy = was - r.li.getBoundingClientRect().top;
      if (dy) r.li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  }

  function arrive() {
    if (open) return;
    const tok = POOL[next++ % POOL.length];
    const before = new Map(rows.map((r) => [r.li, r.li.getBoundingClientRect().top]));
    const row = makeRow(tok, [0, 4 + Math.random() * 1.4, 1], true);
    row.li.classList.add('is-new');
    list.prepend(row.li);
    rows.unshift(row);
    if (rows.length > MAX) {
      const gone = rows.pop();
      gone.li.classList.add('is-leaving');
      gone.li.style.position = 'absolute';
      gone.li.style.width = '100%';
      gone.li.addEventListener('animationend', () => gone.li.remove(), { once: true });
    }
    slide(before);
    // the reader works through its seven checks, then the verdict lands
    k('reading').textContent = `$${tok.sym}`;
    k('bar').animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 1600, easing: 'linear', fill: 'forwards' });
    let done = 0;
    const count = setInterval(() => { k('checks').textContent = `${++done} of 7 checks`; if (done >= 7) clearInterval(count); }, 225);
    k('checks').textContent = '0 of 7 checks';
    setTimeout(() => verdict(row, true), 1650);
  }

  function tick() {
    for (const r of rows) {
      r.s += 1;
      r.mcap = Math.max(2.1, r.mcap * (1 + (Math.random() * 0.05 - 0.016)));
      r.holders += Math.floor(Math.random() * 4);
      paint(r);
    }
  }

  rows = POOL.slice(0, START.length).map((tok, i) => makeRow(tok, START[i]));
  rows.forEach((r, i) => r.li.style.setProperty('--n', i));
  list.replaceChildren(...rows.map((r) => r.li));
  if (reduced) return;

  let tickTimer = null, arriveTimer = null, visible = true;
  const sync = () => {
    const run = visible && document.visibilityState === 'visible';
    if (run === running) return;
    running = run;
    clearInterval(tickTimer); clearInterval(arriveTimer);
    if (run) { tickTimer = setInterval(tick, 1000); arriveTimer = setInterval(arrive, 2800); }
  };
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(feed);
  document.addEventListener('visibilitychange', sync);
  setTimeout(sync, 1400); // after the load sequence has settled
})();

// ---------- what it reads: choose a check and watch it run on the sample launch ----------
(() => {
  const rows = $$('.menu tr[data-check]'), panes = $$('.demo .pane'), field = $('.reads-field');
  if (!rows.length || !panes.length) return;
  const order = rows.map((r) => r.dataset.check);
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let current = rows.find((r) => r.classList.contains('is-on'))?.dataset.check || order[0];
  let lastTouch = 0, hovering = false, visible = false;

  function show(key, byUser) {
    if (byUser) lastTouch = Date.now();
    if (key === current && byUser !== 'restart') return;
    current = key;
    for (const r of rows) {
      const on = r.dataset.check === key;
      r.classList.toggle('is-on', on);
      $('.pick', r).setAttribute('aria-pressed', on);
    }
    for (const p of panes) {
      const on = p.dataset.check === key;
      if (on) { p.classList.remove('is-active'); void p.offsetWidth; } // restart its animation
      p.classList.toggle('is-active', on);
    }
  }

  for (const r of rows) {
    const pick = $('.pick', r);
    pick.addEventListener('click', () => show(r.dataset.check, true));
    pick.addEventListener('focus', () => show(r.dataset.check, true));
    r.addEventListener('mouseenter', () => { if (fine.matches) show(r.dataset.check, true); });
    r.addEventListener('click', (e) => { if (!e.target.closest('.pick')) show(r.dataset.check, true); });
  }
  field.addEventListener('mouseenter', () => { hovering = true; });
  field.addEventListener('mouseleave', () => { hovering = false; });

  if (reduced || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([e]) => {
    const was = visible;
    visible = e.isIntersecting;
    if (visible && !was) show(current, 'restart');
  }, { threshold: 0.25 }).observe(field);
  // on its own it walks through the checks; it stops for twelve seconds after any touch
  setInterval(() => {
    if (!visible || hovering || document.visibilityState !== 'visible' || Date.now() - lastTouch < 12000) return;
    show(order[(order.indexOf(current) + 1) % order.length]);
  }, 4200);
})();

// ---------- the letter's picture stage: the paragraph being read picks the picture ----------
(() => {
  const frame = $('.stage-frame');
  if (!frame) return;
  const mania = $('.mania-frame', frame), imgs = $$('img', mania), cap = $('[data-k="cap"]'), film = $('.tape video', frame);
  const wide = matchMedia('(min-width: 900px)');
  let reel = null, i = 0, timer = null, seen = false, filmSeen = false;

  const showing = (which) => (wide.matches ? frame.dataset.show === which && seen : which === 'tape' ? filmSeen : seen);
  function sync() {
    const awake = document.visibilityState === 'visible' && !reduced;
    const prints = awake && !reel && showing('mania');
    if (prints && !timer) timer = setInterval(step, 5600);
    if (!prints && timer) { clearInterval(timer); timer = null; }
    for (const [video, on] of [[film, showing('tape')], [reel, showing('mania')]]) {
      if (!video) continue;
      if (awake && on) video.play().catch(() => {}); else video.pause();
    }
  }
  function step() {
    imgs[i].classList.remove('is-on');
    i = (i + 1) % imgs.length;
    imgs[i].classList.add('is-on');
    cap.textContent = imgs[i].dataset.cap;
  }

  if (reduced) { film.removeAttribute('autoplay'); film.pause(); }
  if ('IntersectionObserver' in window) {
    const pick = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) frame.dataset.show = e.target.dataset.stage;
      sync();
    }, { rootMargin: '-45% 0px -45% 0px' });
    $$('[data-stage]').forEach((p) => pick.observe(p));
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; sync(); }, { threshold: 0.15 }).observe(frame);
    new IntersectionObserver(([e]) => { filmSeen = e.isIntersecting; sync(); }, { threshold: 0.2 }).observe(film);
  }
  document.addEventListener('visibilitychange', sync);
  wide.addEventListener('change', sync);

  // a reel rendered with JsonCut (waitlist/jsoncut/render.mjs) takes the crossfade's place once it exists
  const prints = () => imgs.forEach((img) => { img.loading = 'eager'; });
  fetch('assets/reels.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).then((reels) => {
    const r = reels?.mania;
    if (!r?.src) return prints();
    reel = document.createElement('video');
    const src = r.srcSmall && innerWidth < 700 ? r.srcSmall : r.src;
    Object.assign(reel, { src, muted: true, loop: true, playsInline: true, preload: 'metadata' });
    if (r.poster) reel.poster = r.poster;
    reel.setAttribute('aria-label', 'Film of the tulip mania in 1637, the rue Quincampoix in 1720 and the South Sea scheme in 1721, then a sample launch read by Block Zero in nine seconds');
    mania.append(reel);
    imgs.forEach((img) => { img.hidden = true; });
    cap.textContent = 'From 1637 to now in sixteen seconds, cut from the prints and film credited below.';
    sync();
  }).catch(prints);
})();

// ---------- the replay: one example launch, its first 120 seconds ----------
(() => {
  const live = $('#live');
  if (!live) return;
  // market cap in thousands of dollars, and holder count, at given seconds after launch
  const MCAP = [[0, 4.6], [1, 9.4], [2, 9.9], [5, 11.2], [9, 13.8], [15, 17.5], [20, 20.1], [25, 22.4], [30, 24.9], [35, 28.3], [40, 31.0], [45, 34.6], [51, 38.9], [52, 21.4], [53, 9.8], [55, 7.1], [60, 6.1], [70, 5.6], [80, 4.9], [90, 4.2], [100, 3.9], [110, 3.6], [120, 3.4]];
  const HOLDERS = [[0, 1], [1, 24], [2, 27], [5, 41], [9, 61], [15, 98], [20, 131], [30, 212], [40, 301], [51, 388], [52, 384], [55, 371], [60, 359], [90, 352], [120, 347]];
  const SELL = 52;
  const W = 560, X = (t) => (t / 120) * W, Y = (v) => 150 - (v / 40) * 140;
  const at = (series, t) => {
    for (let i = 1; i < series.length; i++) {
      const [t1, v1] = series[i], [t0, v0] = series[i - 1];
      if (t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
    return series[series.length - 1][1];
  };
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const k = (name) => $(`[data-k="${name}"]`, live);
  const range = $('#scrub', live), play = k('play');
  const checks = $$('.checks li', live).map((li) => ({ li, at: Number(li.dataset.at), cls: li.className, val: $('.ck-val', li).textContent }));

  function render(t) {
    k('age').textContent = clock(t);
    k('clock').textContent = clock(t);
    k('mcap').textContent = `$${at(MCAP, t).toFixed(1)}k`;
    k('holders').textContent = Math.round(at(HOLDERS, t));
    range.setAttribute('aria-valuetext', `${Math.floor(t / 60)} minutes ${Math.floor(t % 60)} seconds`);

    let flags = 0;
    for (const c of checks) {
      const known = t >= c.at;
      c.li.className = known ? c.cls : 'is-wait';
      $('.ck-val', c.li).textContent = known ? c.val : 'Reading…';
      if (known && c.cls === 'is-flag') flags++;
    }
    const v = k('verdict');
    if (t >= SELL) { v.textContent = 'Dev sold 0:52'; v.className = 'pill pill-neg'; }
    else if (flags) { v.textContent = flags === 1 ? '1 flag' : `${flags} flags`; v.className = 'pill pill-neg'; }
    else { v.textContent = 'Reading'; v.className = 'pill pill-wait'; }
    k('event').hidden = t < SELL;
    live.classList.toggle('is-sold', t >= SELL);

    const pts = MCAP.filter(([s]) => s < t).map(([s, m]) => [X(s), Y(m)]);
    pts.push([X(t), Y(at(MCAP, t))]);
    k('past').setAttribute('d', 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L'));
    const cx = X(t), cy = Y(at(MCAP, t));
    k('cursor').setAttribute('x1', cx); k('cursor').setAttribute('x2', cx);
    const dot = k('dot'); dot.style.left = `${(cx / W) * 100}%`; dot.style.top = `${(cy / 160) * 100}%`;
  }

  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; play.textContent = 'Play'; play.setAttribute('aria-label', 'Play the first two minutes'); };
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (Number(range.value) >= 120) range.value = 0;
    play.textContent = 'Pause'; play.setAttribute('aria-label', 'Pause the replay');
    timer = setInterval(() => {
      const t = Math.min(120, Number(range.value) + 1);
      range.value = t; render(t);
      if (t >= 120) stop();
    }, 100);
  });
  let touched = false;
  range.addEventListener('input', () => { touched = true; stop(); render(Number(range.value)); });
  play.addEventListener('click', () => { touched = true; });
  render(Number(range.value));

  // first time it is seen, run the opening nine seconds once so the flags arrive in order
  if (reduced || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    if (touched) return;
    let t = 0;
    range.value = t; render(t);
    const intro = setInterval(() => {
      if (touched) return clearInterval(intro);
      t += 1; range.value = t; render(t);
      if (t >= 9) clearInterval(intro);
    }, 220);
  }, { threshold: 0.45 });
  io.observe(live);
})();

// ---------- how you use it: the statement nearest the middle drives the fragment ----------
(() => {
  const steps = $$('.step'), stage = $('.stage-inner');
  if (!steps.length || !stage) return;
  const frags = [1, 2, 3].map((n) => $(`.frag-${n}`, stage));
  const short = matchMedia('(max-width: 899px) and (max-height: 700px)');
  const place = () => frags.forEach((f, i) => (short.matches ? steps[i].append(f) : stage.append(f)));
  place();
  short.addEventListener('change', place);
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      steps.forEach((s) => s.classList.toggle('is-active', s === e.target));
      stage.dataset.state = e.target.dataset.step;
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
})();

// ---------- questions: index on the left, one answer on the right ----------
(() => {
  const items = $$('.faq-list li'), pane = $('.faq-pane p');
  if (!items.length) return;
  const wide = matchMedia('(min-width: 900px)');
  function select(li, toggle) {
    const open = toggle && !wide.matches && li.classList.contains('is-open');
    items.forEach((x) => { const on = x === li && !open; x.classList.toggle('is-open', on); $('.faq-q', x).setAttribute('aria-expanded', on); });
    if (!wide.matches || !pane) return;
    const text = $('.faq-a p', li).textContent;
    if (pane.textContent === text) return;
    pane.classList.add('is-swapping');
    setTimeout(() => { pane.textContent = text; pane.classList.remove('is-swapping'); }, reduced ? 0 : 150);
  }
  items.forEach((li) => {
    const q = $('.faq-q', li);
    q.addEventListener('click', () => select(li, true));
    q.addEventListener('focus', () => { if (wide.matches) select(li); });
    q.addEventListener('mouseenter', () => { if (wide.matches) select(li); });
  });
})();

// ---------- the hero reel: plays while it is on screen; under reduced motion it stays on its poster ----------
(() => {
  const reel = $('.hero-reel');
  if (!reel || reduced) return;
  // the first time it plays it starts with the report already read, so the first screen is never half empty
  // and it waits for the page to load, so on a slow phone the poster is not sharing the line with it
  let seen = true, started = false, loaded = document.readyState === 'complete';
  const sync = () => {
    if (!loaded) return;
    if (!seen || document.visibilityState !== 'visible') return reel.pause();
    if (!started) { started = true; reel.currentTime = 3; }
    reel.play().catch(() => {});
  };
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { seen = e.isIntersecting; sync(); }, { threshold: 0.2 }).observe(reel);
  document.addEventListener('visibilitychange', sync);
  if (loaded) sync(); else addEventListener('load', () => { loaded = true; sync(); }, { once: true });
})();

// ---------- joining: every "Join the waitlist" lands in the email field ----------
(() => {
  const form = $('.join-form'), email = $('#email'), status = $('.join-status');
  if (!form) return;
  $$('a[href="#join"]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    $('#join').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => email.focus({ preventScroll: true }), reduced ? 0 : 500);
    history.replaceState(null, '', '#join');
  }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!email.checkValidity()) { email.reportValidity(); return; }
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      const res = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() });
      if (!res.ok) throw new Error(res.status);
      form.reset();
      status.textContent = 'You’re on the list. We’ll write once, when your spot opens.';
    } catch {
      status.textContent = 'That didn’t go through. Try again in a minute.';
    } finally {
      button.disabled = false;
    }
  });
})();
