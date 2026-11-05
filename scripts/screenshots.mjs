// Captures documentation screenshots and a short GIF from the real production build.
// Scenes are staged through the window.__ashfall test hook (seeded world, resources,
// time of day, learned profile); everything on screen is the live game rendering.
// Usage: npm run build && npm run screenshots
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import gifenc from 'gifenc';
import pngjs from 'pngjs';
import { preview } from 'vite';

const { GIFEncoder, applyPalette, quantize } = gifenc;
const { PNG } = pngjs;
const OUT = 'docs/screenshots';
const PORT = 4180;
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

await mkdir(OUT, { recursive: true });
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel });

async function open(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...opts });
  await page.goto(`http://localhost:${PORT}/?seed=20261105`);
  await page.waitForFunction(() => window.__ashfall);
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', name);
};

// Stage a scene: teach the enemies a play style, advance time, spawn foes around the player.
async function stage(page, { style, amount = 30, time = 40, foes = [], fire = false, walls = [], wood = 6, stone = 4 }) {
  await page.evaluate(
    ({ style, amount, time, foes, fire, walls, wood, stone }) => {
      const g = window.__ashfall.game;
      g.spawnT = Infinity;
      const P = g.player;
      P.wood = wood;
      P.stone = stone;
      P.rations = 3;
      if (style) {
        g.ai.observe(style, amount);
        g.ai.adapt(2, true);
        const msg = g.ai.adapt(3, true);
        if (msg) g.addLog(msg);
      }
      g.time = time;
      g.world.time = time;
      g.day = Math.floor(time / 100) + 1;
      if (fire) {
        P.wood += 5;
        P.face = 0;
        g.craft('fire');
      }
      for (const [x, y] of walls) g.world.walls.set(`${Math.floor(P.x / 32) + x},${Math.floor(P.y / 32) + y}`, { hp: 8 });
      g.wallsVersion++;
      for (const [type, dx, dy] of foes) {
        const e = g.spawnEnemy(type);
        if (!e) continue;
        e.x = P.x + dx;
        e.y = P.y + dy;
        e.lx = e.x;
        e.ly = e.y;
      }
    },
    { style, amount, time, foes, fire, walls, wood, stone },
  );
}

// 1. Start screen
{
  const page = await open();
  await shot(page, '01-start');
  await page.close();
}

// 2. Daytime: gathering and a fight with the HUD and intel panel
{
  const page = await open();
  await page.click('#go');
  await page.mouse.move(820, 430);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(320);
  }
  await stage(page, { style: 'melee', amount: 18, time: 225, foes: [['chaser', 120, -60], ['flanker', -150, 90], ['brute', 210, 140]] });
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await shot(page, '02-day-combat');
  await page.close();
}

// 3. Night by the campfire: spitters siege at range, brutes raid the fire
{
  const page = await open();
  await page.click('#go');
  await stage(page, {
    style: 'camp',
    amount: 40,
    time: 238, // day 3, dusk
    fire: true,
    foes: [['spitter', 210, -90], ['spitter', -190, 120], ['brute', 170, 60], ['chaser', -150, -140]],
  });
  await page.mouse.move(760, 450);
  await page.waitForTimeout(1600);
  await shot(page, '03-night-fire-siege');
  await page.close();
}

// 4. Walled in: brutes come for the walls
{
  const page = await open();
  await page.click('#go');
  const ring = [];
  for (let x = -2; x <= 2; x++) ring.push([x, -2], [x, 2]);
  for (let y = -1; y <= 1; y++) ring.push([-2, y], [2, y]);
  await stage(page, { style: 'build', amount: 30, time: 225, walls: ring, foes: [['brute', 200, 0], ['brute', -180, 120], ['chaser', 0, -220]] });
  await page.mouse.move(820, 300);
  await page.waitForTimeout(2500);
  await shot(page, '04-walls-vs-brutes');
  await page.close();
}

// 5. Pause menu
{
  const page = await open();
  await page.click('#go');
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyP');
  await shot(page, '05-paused');
  await page.close();
}

// 6. Game over summary from a real run: a scripted kiting bot plays until it dies.
{
  const page = await open();
  await page.click('#go');
  await page.evaluate(() => {
    const g = window.__ashfall.game;
    for (let k = 0; k < 60 * 900 && !g.over; k++) {
      const P = g.player;
      const e = g.nearestEnemy(P.x, P.y);
      const inp = {};
      if (k % 30 === 0) {
        g.harvest();
        if (P.food < 70) g.eat();
      }
      if (e) {
        const dx = e.x - P.x;
        const dy = e.y - P.y;
        const d = Math.hypot(dx, dy);
        inp.aim = { x: e.x, y: e.y };
        if (d < 220) {
          inp.mx = -dx / d;
          inp.my = -dy / d;
          inp.sprint = true;
        }
        inp.attack = d < 60;
        inp.throw = d < 300 && P.stone > 0;
      } else {
        inp.mx = Math.cos(k / 400);
        inp.my = Math.sin(k / 400);
      }
      g.update(1 / 60, inp);
    }
  });
  await page.locator('#over').waitFor({ state: 'visible' });
  await shot(page, '06-game-over');
  await page.close();
}

// 7. Mobile with touch controls
{
  const page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.tap('#go');
  await stage(page, { style: 'ranged', amount: 25, time: 225, foes: [['chaser', 110, -120], ['spitter', -120, 170]] });
  await page.waitForTimeout(800);
  await shot(page, '07-mobile-touch');
  await page.close();
}

// 8. GIF: a short live fight, captured frame by frame
{
  const page = await open({ viewport: { width: 960, height: 640 } });
  await page.click('#go');
  await stage(page, { style: 'ranged', amount: 25, time: 225, stone: 12, foes: [['chaser', 200, -40], ['flanker', -220, 60], ['chaser', 40, 230]] });
  const gif = GIFEncoder();
  const clip = { x: 230, y: 120, width: 500, height: 400 };
  for (let k = 0; k < 56; k++) {
    // simple scripted play: back off, throw stones, then strike up close
    const st = await page.evaluate(() => {
      const g = window.__ashfall.game;
      const e = g.nearestEnemy(g.player.x, g.player.y);
      if (!e) return null;
      return { dx: e.x - g.player.x, dy: e.y - g.player.y };
    });
    if (st) {
      await page.mouse.move(480 + st.dx, 320 + st.dy);
      const d = Math.hypot(st.dx, st.dy);
      if (d > 90 && k % 3 === 0) await page.mouse.click(480 + st.dx, 320 + st.dy, { button: 'right' });
      if (d < 70) await page.mouse.click(480 + st.dx, 320 + st.dy);
    }
    await page.waitForTimeout(60);
    const png = PNG.sync.read(await page.screenshot({ clip }));
    const palette = quantize(png.data, 128);
    gif.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: 110 });
  }
  gif.finish();
  await writeFile(`${OUT}/gameplay.gif`, gif.bytes());
  console.log('saved gameplay.gif');
  await page.close();
}

await browser.close();
await new Promise((res) => server.httpServer.close(res));
