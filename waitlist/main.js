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

// ---------- the signature move: three manias crossfade in one frame ----------
(() => {
  const frame = $('.mania-frame');
  if (!frame || reduced) return;
  const imgs = $$('img', frame), cap = $('[data-k="cap"]');
  imgs.forEach((img) => { img.loading = 'eager'; });
  let i = 0, timer = null, visible = false;
  const step = () => {
    imgs[i].classList.remove('is-on');
    i = (i + 1) % imgs.length;
    imgs[i].classList.add('is-on');
    cap.textContent = imgs[i].dataset.cap;
  };
  const sync = () => {
    const run = visible && document.visibilityState === 'visible';
    if (run && !timer) timer = setInterval(step, 5600);
    if (!run && timer) { clearInterval(timer); timer = null; }
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.2 }).observe(frame);
  document.addEventListener('visibilitychange', sync);
})();

// ---------- the film loop: plays only while seen, never under reduced motion ----------
(() => {
  const video = $('.tape video');
  if (!video) return;
  if (reduced) { video.removeAttribute('autoplay'); video.pause(); return; }
  new IntersectionObserver(([e]) => { if (e.isIntersecting) video.play().catch(() => {}); else video.pause(); }, { threshold: 0.1 }).observe(video);
})();

// ---------- how you use it: the statement nearest the middle drives the fragment ----------
(() => {
  const steps = $$('.step'), stage = $('.stage-inner');
  if (!steps.length || !stage || !('IntersectionObserver' in window)) return;
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
