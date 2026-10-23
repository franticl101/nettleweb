// JsonCut jobs for the Block Zero waitlist (https://api.jsoncut.com, see .claude/skills/jsoncut).
// `node jobs.mjs` prints every job as JSON. Two ways to turn them into video:
//   render.mjs        sends them to the JsonCut API (needs JSONCUT_API_KEY)
//   render-local.mjs  renders them here with Chrome and ffmpeg, no API
// Either one saves the full-size master to `output` and a web copy plus poster frame to `web`.

const INK = '#2a1d17', MUTED = '#615148', BONE = '#e5e1d8', GREEN = '#456f3a', RED = '#7f2219';

const mark = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><rect width="28" height="28" rx="3" fill="${GREEN}"/><rect x="10" y="6" width="8" height="16" rx="4" fill="${BONE}"/></svg>`;

// A caption card that rises into the lower left of a clip.
const caption = (year, place, line) => ({
  type: 'html',
  html: `<div class="cap"><span class="y">${year}</span><span class="p">${place}</span><span class="t">${line}</span></div>`,
  css: `html,body{margin:0;background:transparent}
    .cap{position:absolute;left:56px;bottom:44px;display:flex;gap:20px;align-items:baseline;padding:16px 24px;background:${BONE};color:${INK};font-family:Archivo,sans-serif;border-radius:4px;animation:rise .9s cubic-bezier(.22,1,.36,1) .35s both}
    .y{font-size:46px;font-weight:600;letter-spacing:-.01em}.p{font-size:30px}.t{font-size:26px;color:${MUTED}}
    @keyframes rise{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}`,
  googleFonts: ['Archivo'],
  animated: true,
  duration: 3.6,
  width: 1440,
  height: 180,
  position: 'bottom',
});

// The last scene of the mania reel: the same first block, read by Block Zero in nine seconds.
const nineSeconds = {
  type: 'html',
  html: `<main>
    <p class="kicker">Today the first hour takes</p>
    <h1>nine seconds</h1>
    <section class="row">
      <span class="av">L</span><span class="name">$LILPEBBLE<small>7Hq3…pump</small></span>
      <span class="age"><small>Age</small><b class="clock"></b></span>
      <span class="pill">3 flags</span>
    </section>
    <ul>
      <li style="--d:1.0s">Bundled at launch <b>41.2% of supply</b></li>
      <li style="--d:1.5s">Dev wallet <b>sold 5 of its 6 past tokens</b></li>
      <li style="--d:2.0s">Top 10 holders <b>58.4% of supply</b></li>
    </ul>
    <footer>${mark(44)}<span>Block Zero</span></footer>
  </main>`,
  css: `html,body{margin:0;background:${BONE};color:${INK};font-family:Archivo,sans-serif}
    main{position:absolute;inset:0;padding:120px 120px 0}
    .kicker{margin:0;font-size:40px;color:${MUTED};animation:rise .8s cubic-bezier(.22,1,.36,1) both}
    h1{margin:6px 0 64px;font-size:150px;font-weight:400;letter-spacing:-.03em;line-height:1;animation:rise .9s cubic-bezier(.22,1,.36,1) .15s both}
    .row{display:grid;grid-template-columns:64px 1fr 120px 150px;gap:24px;align-items:center;padding:26px 30px;background:#f3f2ef;border:2px solid #d6cfc2;border-radius:12px;font-size:34px;animation:rise .8s cubic-bezier(.22,1,.36,1) .4s both}
    .av{width:64px;height:64px;border-radius:50%;background:#dfe8d6;display:grid;place-items:center;font-weight:600}
    .name{font-weight:600}.row small{display:block;font-size:24px;font-weight:400;color:${MUTED}}
    .age{text-align:right}.age b{font-weight:400;font-variant-numeric:tabular-nums;counter-reset:s var(--s);animation:count 2.07s linear .1s both}.age b::after{content:'0:0' counter(s)}
    .pill{justify-self:end;padding:8px 16px;border-radius:6px;background:#f6e1da;color:${RED};font-size:28px;font-weight:600;animation:pop .4s cubic-bezier(.22,1,.36,1) 2.2s both}
    ul{list-style:none;margin:28px 0 0;padding:0 30px;font-size:32px;color:${MUTED}}
    li{display:flex;justify-content:space-between;padding:14px 0;border-bottom:2px solid #d6cfc2;animation:rise .6s cubic-bezier(.22,1,.36,1) var(--d) both}
    li b{color:${RED}}
    footer{position:absolute;left:120px;bottom:90px;display:flex;gap:18px;align-items:center;font-size:40px;font-weight:600;animation:rise .8s cubic-bezier(.22,1,.36,1) 2.6s both}
    @keyframes rise{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
    @keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
    @property --s{syntax:'<integer>';inherits:false;initial-value:0}
    @keyframes count{from{--s:0}to{--s:9}}`,
  // the age counts 0:00 to 0:09 (a CSS counter, so a renderer can seek it frame by frame)
  googleFonts: ['Archivo'],
  animated: true,
  duration: 4.2,
  width: 1440,
  height: 1080,
};

const print = (file, zoomDirection) => ({ type: 'image', path: `@media/${file}`, resizeMode: 'cover', zoomDirection, zoomAmount: 0.12 });

export const jobs = [
  {
    name: 'mania-reel',
    type: 'video',
    // shown in the letter on the page, in place of the crossfade (listed in assets/reels.json)
    output: 'jsoncut/out/mania-reel.mp4',
    web: { src: 'assets/mania-reel.mp4', width: 1080, crf: 27, poster: 'assets/mania-reel-poster.jpg', posterAt: 1.4, slot: 'mania' },
    config: {
      width: 1440,
      height: 1080,
      fps: 30,
      format: 'mp4',
      defaults: { transition: { name: 'fade', duration: 0.8 } },
      clips: [
        { duration: 3.6, layers: [print('floras-mallewagen-1637-bone.jpg', 'in'), caption('1637', 'Haarlem', 'Tulip bulbs, traded in taverns')] },
        { duration: 3.6, layers: [print('quincampoix-1720-bone.jpg', 'right'), caption('1720', 'Paris', 'Mississippi shares, rue Quincampoix')] },
        { duration: 3.6, layers: [print('south-sea-scheme-1721-bone.jpg', 'left'), caption('1721', 'London', 'South Sea stock')] },
        {
          duration: 4.4,
          transition: { name: 'fadecolor', duration: 0.8 },
          layers: [
            { type: 'video', path: '@media/tape-delay.mp4', resizeMode: 'cover', cutFrom: 0, cutTo: 4.4, mixVolume: 0 },
            { ...caption('New York', 'The tape delay board', 'Trading outruns the ticker'), duration: 4.4 },
          ],
        },
        { duration: 4.2, transition: null, layers: [nineSeconds] },
      ],
    },
  },
  {
    name: 'launch-reel',
    type: 'video',
    // a square clip for posting the waitlist on X and Telegram; the web copy plays beside the signup
    output: 'jsoncut/out/launch-reel.mp4',
    web: { src: 'assets/launch-reel.mp4', width: 720, crf: 27, poster: 'assets/launch-reel-poster.jpg', posterAt: 10.4 },
    config: {
      width: 1080,
      height: 1080,
      fps: 30,
      format: 'mp4',
      clips: [
        {
          duration: 12,
          transition: null,
          layers: [
            {
              type: 'html',
              html: `<main>
                <header>${mark(40)}<span>Block Zero</span><em>Sample launch, replayed</em></header>
                <div class="story">
                <section class="row">
                  <span class="av">L</span><span class="name">$LILPEBBLE<small>7Hq3…pump</small></span>
                  <span class="pill wait">Reading</span><span class="pill flag">3 flags</span>
                </section>
                <ul>
                  <li style="--d:1.0s">Mint authority <b>Revoked</b></li>
                  <li style="--d:1.3s">Freeze authority <b>Revoked</b></li>
                  <li class="f" style="--d:1.8s">Bundled at launch <b>41.2%</b></li>
                  <li style="--d:2.2s">Snipers <b>7 wallets</b></li>
                  <li class="f" style="--d:2.6s">Dev wallet <b>5 of 6 sold</b></li>
                  <li class="f" style="--d:3.2s">Top 10 holders <b>58.4%</b></li>
                </ul>
                <figure>
                  <svg viewBox="0 0 840 220" width="840" height="220">
                    <line x1="0" x2="840" y1="210" y2="210" stroke="#d6cfc2" stroke-width="2"/>
                    <path class="up" d="M0 196 L60 170 L160 150 L260 120 L360 76 L364 30" fill="none" stroke="${GREEN}" stroke-width="5" stroke-linejoin="round"/>
                    <path class="down" d="M364 30 L372 120 L400 182 L560 196 L840 203" fill="none" stroke="${RED}" stroke-width="5" stroke-linejoin="round"/>
                    <line class="sell" x1="364" x2="364" y1="10" y2="210" stroke="${RED}" stroke-width="2" stroke-dasharray="8 8"/>
                  </svg>
                  <figcaption><span class="climb">Price still climbing at 0:51</span><span class="dump">Dev sold at 0:52</span></figcaption>
                </figure>
                </div>
                <div class="end">
                  <h1>The chart is<br>the last to know</h1>
                  <p class="sub">Block Zero reads every new Solana token in its first seconds.</p>
                  <p class="cta">Join the waitlist</p>
                </div>
              </main>`,
              css: `html,body{margin:0;background:${BONE};color:${INK};font-family:Archivo,sans-serif}
                main{position:absolute;inset:0;padding:76px 120px;animation:out .8s ease 11.2s forwards}
                header{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:600;animation:rise .7s cubic-bezier(.22,1,.36,1) both}
                header em{margin-left:auto;font-style:normal;font-weight:400;font-size:22px;color:${MUTED}}
                .row{position:relative;display:grid;grid-template-columns:56px 1fr auto;gap:20px;align-items:center;margin-top:44px;padding:20px 24px;background:#f3f2ef;border:2px solid #d6cfc2;border-radius:12px;font-size:30px;animation:rise .7s cubic-bezier(.22,1,.36,1) .4s both}
                .av{width:56px;height:56px;border-radius:50%;background:#dfe8d6;display:grid;place-items:center;font-weight:600}
                .name{font-weight:600}.row small{display:block;font-size:22px;font-weight:400;color:${MUTED}}
                .pill{grid-column:3;grid-row:1;justify-self:end;padding:6px 14px;border-radius:6px;font-size:24px;font-weight:600}
                .wait{background:#e8e6e1;color:${MUTED};animation:hide .12s linear 3.25s forwards}
                .flag{background:#f6e1da;color:${RED};animation:pop .4s cubic-bezier(.22,1,.36,1) 3.4s both}
                ul{list-style:none;margin:14px 0 0;padding:0 24px;font-size:26px;color:${MUTED}}
                li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:2px solid #e0dbd1;animation:rise .5s cubic-bezier(.22,1,.36,1) var(--d) both}
                li b{color:${INK};font-weight:400}li.f b{color:${RED};font-weight:600}
                figure{margin:40px 0 0;animation:rise .6s cubic-bezier(.22,1,.36,1) 3.7s both}
                .up{stroke-dasharray:520;stroke-dashoffset:520;animation:draw 2.4s cubic-bezier(.33,1,.68,1) 4s forwards}
                .down{stroke-dasharray:720;stroke-dashoffset:720;animation:draw 1s cubic-bezier(.55,.06,.68,.19) 6.6s forwards}
                .sell{opacity:0;animation:show .2s linear 6.5s forwards}
                figcaption{position:relative;height:36px;margin-top:10px;font-size:24px}
                figcaption span{position:absolute;left:0}
                .climb{color:${GREEN};opacity:0;animation:show .3s linear 4.6s forwards,hide .2s linear 6.5s forwards}
                .dump{color:${RED};font-weight:600;opacity:0;animation:show .2s linear 6.6s forwards}
                .story{animation:away .6s cubic-bezier(.55,.06,.68,.19) 7.6s forwards}
                .end{position:absolute;left:120px;right:120px;top:330px}
                h1{margin:0;font-size:104px;font-weight:400;letter-spacing:-.03em;line-height:1;animation:rise .9s cubic-bezier(.22,1,.36,1) 8.1s both}
                .sub{margin:36px 0 0;font-size:34px;color:${MUTED};max-width:22em;animation:rise .8s cubic-bezier(.22,1,.36,1) 8.5s both}
                .cta{display:inline-block;margin:44px 0 0;padding:18px 30px;background:${GREEN};color:#fff;border-radius:4px;font-size:32px;font-weight:600;animation:rise .7s cubic-bezier(.22,1,.36,1) 8.9s both}
                @keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
                @keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
                @keyframes draw{to{stroke-dashoffset:0}}
                @keyframes show{to{opacity:1}}@keyframes hide{to{opacity:0}}@keyframes out{to{opacity:0}}@keyframes away{to{opacity:0;transform:translateY(-28px)}}`,
              googleFonts: ['Archivo'],
              animated: true,
              duration: 12,
              width: 1080,
              height: 1080,
            },
          ],
        },
      ],
    },
  },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(jobs.map(({ name, type, config }) => ({ name, type, config })), null, 2));
}
