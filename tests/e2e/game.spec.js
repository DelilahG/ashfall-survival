import { expect, test } from '@playwright/test';

const g = (page, fn) => page.evaluate(fn);

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?seed=42');
  await page.waitForFunction(() => window.__ashfall);
});
test.afterEach(() => expect(errors, 'console errors').toEqual([]));

test('start screen, then playing with a live HUD', async ({ page }) => {
  await expect(page).toHaveTitle(/Ashfall/);
  await expect(page.locator('#start')).toBeVisible();
  expect(await g(page, () => window.__ashfall.state)).toBe('start');
  // inventory uses SVG icons, not emoji
  expect(await page.locator('#tl .inv svg').count()).toBe(3);
  expect(await page.locator('body').innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  await page.click('#go');
  await expect(page.locator('#start')).toBeHidden();
  expect(await g(page, () => window.__ashfall.state)).toBe('playing');
  await expect.poll(() => g(page, () => window.__ashfall.game.time)).toBeGreaterThan(0.5);
  await expect(page.locator('#day')).toHaveText('1');
  await expect(page.locator('#prof .pr')).toHaveCount(5);
  await expect(page.locator('#genes .pr')).toHaveCount(7);
});

test('keyboard movement and gathering', async ({ page }) => {
  await page.click('#go');
  const x0 = await g(page, () => window.__ashfall.game.player.x);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  expect(await g(page, () => window.__ashfall.game.player.x)).toBeGreaterThan(x0 + 30);
  // stand next to the nearest tree, then press E
  await g(page, () => {
    const game = window.__ashfall.game;
    for (let r = 1; r < 30; r++)
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++)
          if (game.world.tileAt(x, y) === 3 && !game.world.solid(x - 1, y)) {
            game.player.x = (x - 1) * 32 + 16;
            game.player.y = y * 32 + 16;
            return;
          }
  });
  await page.keyboard.press('KeyE');
  await expect(page.locator('#iw')).not.toHaveText('0');
});

test('combat: striking an enemy with the mouse kills it and scores', async ({ page }) => {
  await page.click('#go');
  await g(page, () => {
    const game = window.__ashfall.game;
    game.spawnT = Infinity;
    const e = game.spawnEnemy('flanker');
    e.x = game.player.x + 28;
    e.y = game.player.y;
    e.spd = 0;
  });
  const box = await page.locator('#cv').boundingBox();
  await page.mouse.move(box.width / 2 + 80, box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await expect(page.locator('#kills')).toHaveText('1');
  expect(Number(await page.locator('#score').textContent())).toBeGreaterThanOrEqual(12);
});

test('pause, resume and restart', async ({ page }) => {
  await page.click('#go');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyP');
  await expect(page.locator('#paused')).toBeVisible();
  const t = await g(page, () => window.__ashfall.game.time);
  await page.waitForTimeout(400);
  expect(await g(page, () => window.__ashfall.game.time)).toBe(t);
  await page.click('#resume');
  await expect(page.locator('#paused')).toBeHidden();
  await expect.poll(() => g(page, () => window.__ashfall.game.time)).toBeGreaterThan(t);
  await page.click('#pbtn');
  await expect(page.locator('#paused')).toBeVisible();
  await page.click('#restart');
  await expect(page.locator('#paused')).toBeHidden();
  expect(await g(page, () => window.__ashfall.game.time)).toBeLessThan(0.5);
  await page.keyboard.press('Escape');
  await expect(page.locator('#paused')).toBeVisible();
});

test('crafting via number keys', async ({ page }) => {
  await page.click('#go');
  await g(page, () => {
    const p = window.__ashfall.game.player;
    p.wood = 20;
    p.stone = 5;
  });
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit2');
  expect(await g(page, () => window.__ashfall.game.fires.length)).toBe(1);
  await expect(page.locator('#spv')).toContainText('Spear');
  await expect(page.locator('#log')).toContainText('Spear crafted');
  const box = await page.locator('#cv').boundingBox();
  await page.mouse.move(box.width / 2, box.height / 2 + 70);
  await page.keyboard.press('Digit3');
  expect(await g(page, () => window.__ashfall.game.world.walls.size)).toBe(1);
});

test('game over shows a summary and try again starts a fresh run', async ({ page }) => {
  await page.click('#go');
  await page.waitForTimeout(300);
  await g(page, () => {
    const game = window.__ashfall.game;
    game.kills = 3;
    game.hurtPlayer(500, 'brute');
  });
  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#osum')).toContainText('A brute crushed you');
  await expect(page.locator('#ostats')).toContainText('Kills');
  await expect(page.locator('#olearn')).toContainText('You were seen fighting');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ashfall.best')).score)).toBeGreaterThanOrEqual(0);
  await page.click('#again');
  await expect(page.locator('#over')).toBeHidden();
  expect(await g(page, () => window.__ashfall.game.player.hp)).toBe(100);
});

test('sound toggle persists', async ({ page }) => {
  await page.click('#soundBtn');
  await expect(page.locator('#soundBtn')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('ashfall.muted'))).toBe('1');
  await page.keyboard.press('KeyM');
  await expect(page.locator('#soundBtn')).toHaveAttribute('aria-pressed', 'true');
});

test('losing window focus pauses the game', async ({ page }) => {
  await page.click('#go');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#paused')).toBeVisible();
});

test.describe('touch device', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('virtual stick moves the player and buttons act', async ({ page }) => {
    await expect(page.locator('#touch')).toBeVisible();
    await page.tap('#go');
    const x0 = await g(page, () => window.__ashfall.game.player.x);
    const stick = await page.locator('#stick').boundingBox();
    const cx = stick.x + stick.width / 2;
    const cy = stick.y + stick.height / 2;
    // drive the stick with pointer events
    await page.dispatchEvent('#stick', 'pointerdown', { pointerId: 7, clientX: cx, clientY: cy, isPrimary: true });
    await page.dispatchEvent('#stick', 'pointermove', { pointerId: 7, clientX: cx + 60, clientY: cy, isPrimary: true });
    await page.waitForTimeout(600);
    await page.dispatchEvent('#stick', 'pointerup', { pointerId: 7, clientX: cx + 60, clientY: cy, isPrimary: true });
    expect(await g(page, () => window.__ashfall.game.player.x)).toBeGreaterThan(x0 + 30);
    await g(page, () => (window.__ashfall.game.player.wood = 10));
    await page.dispatchEvent('[data-act="fire"]', 'pointerdown');
    expect(await g(page, () => window.__ashfall.game.fires.length)).toBe(1);
    // intel panel opens from its button on small screens
    await expect(page.locator('#tr')).toBeHidden();
    await page.tap('#intelBtn');
    await expect(page.locator('#tr')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
