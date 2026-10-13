/** Records the conversation + dashboard captures for the demo video.
 *  Reads /tmp/vo/timings.json (reply TTS durations) if present, else uses estimates. */
const { chromium } = require('playwright');
const fs = require('fs');

const CONVO = [
  "Good morning Tend",
  "I slept poorly last night, kept waking up",
  "I took my amlodipine with breakfast",
  "I had a nice walk by the temple pond",
  "I forgot my metformin yesterday evening",
  "Feeling a bit lonely today",
];
let gaps = [16, 11, 8, 9, 13, 11]; // seconds of hold after each reply lands; refined from TTS durations
try {
  const t = JSON.parse(fs.readFileSync('/tmp/vo/timings.json', 'utf8'));
  gaps = t.gaps;
} catch {}

(async () => {
  fs.mkdirSync('/tmp/cap', { recursive: true });
  const b = await chromium.launch({ args: ['--no-sandbox'] });

  // --- conversation capture ---
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: '/tmp/cap', size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = [];
  const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); };

  await page.goto('http://127.0.0.1:7702/');
  await page.waitForTimeout(2500);
  mark('intro-hold');
  await page.waitForTimeout(14000); // N3 narration plays over the idle page

  for (let i = 0; i < CONVO.length; i++) {
    mark('type-' + i);
    await page.locator('#inp').pressSequentially(CONVO[i], { delay: 55 });
    await page.waitForTimeout(350);
    await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('#send').disabled, { timeout: 30000 });
    mark('reply-' + i);
    await page.waitForTimeout(gaps[i] * 1000);
  }
  mark('convo-end');
  await page.waitForTimeout(2500);
  await ctx.close(); // finalizes webm

  // --- dashboard capture ---
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: '/tmp/cap', size: { width: 1280, height: 720 } } });
  const dash = await ctx2.newPage();
  await dash.goto('http://127.0.0.1:7702/dashboard.html');
  await dash.waitForTimeout(3000);
  // slow scroll through the page for a living feel
  await dash.mouse.move(640, 400);
  for (let y = 0; y <= 500; y += 100) { await dash.mouse.wheel(0, 100); await dash.waitForTimeout(900); }
  await dash.waitForTimeout(1500);
  // acknowledge the top alert if present
  const ack = await dash.$('[data-ack]');
  if (ack) { await ack.click(); await dash.waitForTimeout(2500); }
  for (let y = 0; y >= -500; y -= 100) { await dash.mouse.wheel(0, -100); await dash.waitForTimeout(700); }
  await dash.waitForTimeout(1200);
  await ctx2.close();

  fs.writeFileSync('/tmp/cap/marks.json', JSON.stringify(marks, null, 2));
  await b.close();
  console.log('captures done', fs.readdirSync('/tmp/cap'));
})().catch((e) => { console.error(e); process.exit(1); });
