import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, 'demo.html');
const gifFile = join(__dirname, '..', 'docs', 'demo.gif');
const framesDir = join(__dirname, 'frames');

(async () => {
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [browser]', msg.text());
  });

  await page.goto('file://' + htmlPath);
  console.log('Recording demo...');

  // Capture 300 frames at 10fps (30s total) — starts immediately from frame 0
  const frameInterval = 100;
  const totalFrames = 300;

  console.log(`Capturing ${totalFrames} frames...`);
  for (let i = 0; i < totalFrames; i++) {
    await page.screenshot({ path: join(framesDir, `frame_${String(i).padStart(4,'0')}.png`), type: 'png' });
    if (i % 30 === 0) process.stdout.write(`\r  Frame ${i}/${totalFrames}`);
  }
  console.log('\nDone capturing.');

  // Generate palette
  const paletteFile = join(framesDir, 'palette.png');
  execSync(
    `ffmpeg -y -f image2 -framerate 10 -i '${join(framesDir, 'frame_%04d.png')}' -vf 'palettegen=max_colors=256:stats_mode=diff' -update 1 '${paletteFile}'`,
    { stdio: 'pipe' }
  );

  // Create GIF
  execSync(
    `ffmpeg -y -f image2 -framerate 10 -i '${join(framesDir, 'frame_%04d.png')}' -i '${paletteFile}' -lavfi 'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle' '${gifFile}'`,
    { stdio: 'pipe' }
  );

  fs.rmSync(framesDir, { recursive: true, force: true });

  const stats = fs.statSync(gifFile);
  console.log(`✅ ${gifFile} (${(stats.size / 1024).toFixed(0)} KB, ${totalFrames} frames @ 10fps = 30s)`);

  await browser.close();
})();
