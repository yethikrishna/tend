/** Drives a choreographed conversation and screenshots both surfaces. */
const { chromium } = require('playwright');

const SCRIPT = [
  "Good morning Tend",
  "I slept poorly last night, kept waking up",
  "I took my amlodipine after breakfast",
  "Then I went for a short walk by the temple pond",
  "Oh, I forgot my metformin yesterday evening",
];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:7702/');
  await page.waitForTimeout(2200);

  for (let i = 0; i < SCRIPT.length; i++) {
    await page.fill('#inp', SCRIPT[i]);
    await page.click('#send');
    await page.waitForSelector('.msg.them >> nth=' + i);
    // wait until send re-enabled = reply complete
    await page.waitForFunction(() => !document.querySelector('#send').disabled, { timeout: 20000 });
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: '/tmp/tend-sim-full.png', fullPage: true });

  const dash = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await dash.goto('http://127.0.0.1:7702/dashboard.html');
  await dash.waitForTimeout(2500);
  await dash.screenshot({ path: '/tmp/tend-dash-full.png', fullPage: true });
  await b.close();
  console.log('shots done');
})().catch((e) => { console.error(e.message); process.exit(1); });
