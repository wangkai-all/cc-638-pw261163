import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const OUT = 'test-results';

// 有些环境只装了完整 chromium，没有 headless_shell；回退到完整二进制。
function chromiumExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium-') && !d.includes('shell'))) {
    const exe = path.join(root, dir, 'chrome-linux', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero-value');
  await page.screenshot({ path: `${OUT}/01-overview.png`, fullPage: true });

  const hero = await page.locator('.hero-value').innerText();
  const mape = await page.locator('.card.stat .stat-value').nth(1).innerText();
  console.log('hero', hero, 'mape', mape);

  // 点击某一天 → 单日明细
  const chart = page.locator('.chart-svg').first();
  const box = await chart.boundingBox();
  await page.mouse.click(box.x + box.width * 0.34, box.y + box.height * 0.5);
  await page.waitForTimeout(200);
  const inspectorDate = await page.locator('.inspector-date').innerText();
  const contribCount = await page.locator('.contrib li').count();
  console.log('inspector', inspectorDate, 'contributions', contribCount);
  await page.screenshot({ path: `${OUT}/02-day-detail.png`, fullPage: true });

  // 排除权重最大的候选店
  const beforeGap = await page.locator('.hero-value').innerText();
  const topRow = page.locator('.weight-row').first();
  const topName = await topRow.locator('.weight-name').innerText();
  const excludeBtn = page.locator('table.data tbody tr').filter({ hasText: topName }).locator('button', { hasText: '排除' }).first();
  await excludeBtn.click();
  await page.waitForTimeout(300);
  const afterGap = await page.locator('.hero-value').innerText();
  const weightRows = await page.locator('.weight-row').count();
  console.log('excluded', topName, beforeGap, '->', afterGap, 'weight rows', weightRows);
  await page.screenshot({ path: `${OUT}/03-excluded.png`, fullPage: true });

  // 恢复
  const restore = page.locator('table.data tbody tr').filter({ hasText: topName }).locator('button', { hasText: '恢复' }).first();
  await restore.click();
  await page.waitForTimeout(200);

  // 锁定一家
  const lockInput = page.locator('table.data .weight-input').first();
  await lockInput.fill('40');
  await lockInput.press('Enter');
  await page.waitForTimeout(300);
  const lockedChips = await page.locator('.weight-row.locked').count();
  console.log('locked rows', lockedChips);
  await page.screenshot({ path: `${OUT}/04-locked.png`, fullPage: true });

  // 安慰剂模式
  await page.getByRole('button', { name: '安慰剂对照店' }).click();
  await page.waitForTimeout(300);
  const placeboBanner = await page.locator('.banner').first().innerText();
  console.log('placebo banner:', placeboBanner.slice(0, 60));
  await page.screenshot({ path: `${OUT}/05-placebo.png`, fullPage: true });

  // 从安慰剂表选择拟合最差反例
  await page.getByRole('button', { name: '把它设为安慰剂对象，看完整计算' }).click();
  await page.waitForTimeout(400);
  const subjectLabel = await page.locator('.side .card').nth(1).innerText();
  console.log('placebo subject inspector snippet:', subjectLabel.slice(0, 80));
  await page.screenshot({ path: `${OUT}/06-placebo-worst.png`, fullPage: true });

  // 回到真实分析；深色主题
  await page.getByRole('button', { name: '活动门店' }).first().click();
  await page.getByRole('button', { name: /切换到深色主题/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/07-dark.png`, fullPage: true });

  // 方法弹窗
  await page.getByRole('button', { name: '方法与口径' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/08-method.png` });
  await page.keyboard.press('Escape');

  // 窄屏
  await page.getByRole('button', { name: /切换到浅色主题/ }).click();
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/09-mobile.png`, fullPage: true });

  // 地平线：活动前拟合很差的活动店
  await page.setViewportSize({ width: 1440, height: 1100 });
  const studySelect = page.locator('#study-select');
  const options = await studySelect.locator('option').evaluateAll((els) => els.map((e) => e.value));
  for (const v of options) {
    await studySelect.selectOption(v);
    await page.waitForTimeout(300);
    const m = await page.locator('.card.stat .stat-value').nth(1).innerText();
    const subj = await page.locator('.side .card').nth(1).innerText();
    console.log('study', v, 'mape', m, subj.split('\n')[1] ?? '');
  }

  fs.writeFileSync(`${OUT}/console-errors.json`, JSON.stringify(errors, null, 2));
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
