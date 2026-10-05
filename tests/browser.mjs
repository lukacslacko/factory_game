import { checkRailLocationsUI } from './rail-locations-ui.mjs';
import { checkRailCrewsUI } from './rail-crews-ui.mjs';
import { checkDeliveryRecoveryUI } from './delivery-recovery-ui.mjs';
import { checkEquipmentIntent } from './equipment-intent.mjs';
import { checkTrackRendering } from './track-rendering.mjs';
import { checkTrackUI } from './track-ui.mjs';
import { chromium } from 'playwright';
import { checkNavigation, checkFloorDrag } from './navigation.mjs';
import { checkPhysicalRendering } from './physical-rendering.mjs';
import { checkEquipmentRoles } from './equipment-roles.mjs';
import { checkWorkAnimation } from './work-animation.mjs';
import { checkOperationsUI } from './operations-ui.mjs';
import { checkBatchProcurement } from './batch-procurement.mjs';
import { checkTimeAndWear } from './time-and-wear.mjs';
import { checkForkLoadRendering } from './fork-load-rendering.mjs';
import { checkShedRendering } from './shed-rendering.mjs';
import { checkAutomaticWork } from './automatic-work.mjs';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(base, 'test-results'), { recursive: true });
const server = await createServer({
  root: base,
  server: { host: '127.0.0.1', port: 4180, strictPort: true, hmr: false },
});
await server.listen();
let browser;
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4180')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Test server did not start.');
}
(async () => {
  await ready();
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLANT01_CHROME ||
      (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined),
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push(m.text());
  });
  await page.goto('http://127.0.0.1:4180');
  await page.locator('[data-action="new:empty"]').click();
  await page.locator('[data-action="dismiss-guide"]').click();
  await page.evaluate(() => {
    plant01.state.paused = true;
  });
  await checkNavigation(page);
  assert.equal(await page.evaluate(() => plant01.state.zones.length), 0);
  // Designate storage through the actual tool before ordering material.
  await page.locator('[data-action="tool:zone"]').click();
  const zonePoint = await page.evaluate(() => plant01.world.project({ x: 24.4, z: 26.4 }));
  const zoneCanvas = await page.locator('#world').boundingBox();
  const zoneEnd = await page.evaluate(() => plant01.world.project({ x: 50.4, z: 49.4 }));
  await page.mouse.move(zoneCanvas.x + zonePoint.x, zoneCanvas.y + zonePoint.y);
  await page.mouse.down();
  await page.mouse.move(zoneCanvas.x + zoneEnd.x, zoneCanvas.y + zoneEnd.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => plant01.state.zones.length), 1);
  await page.locator('[data-action="shop"]').click();
  await page.locator('[data-action="purchase:builder"]').click();
  await page.locator('[data-action="purchase:operator"]').click();
  await page.locator('[data-action="purchase:excavator"]').click();
  await page.locator('#qty-slab').fill('30');
  await page.locator('[data-action="purchase:slab"]').click();
  await page.locator('[data-action="purchase:office"]').click();
  await page.locator('[data-action="close-modal"]').click();
  await page.evaluate(() => {
    plant01.state.paused = false;
    for (
      let t = 0;
      t < 1200 &&
      plant01.state.orders.some(
        (o) => ['builder', 'operator', 'excavator'].includes(o.item) && o.status !== 'done',
      );
      t += 0.1
    )
      plant01.Sim.tick(plant01.state, 0.1);
    plant01.step(0);
    plant01.state.paused = true;
  });
  assert.equal(await page.evaluate(() => plant01.state.workers.length), 2);
  assert.equal(await page.evaluate(() => plant01.state.equipment.length), 1);
  assert.equal(await page.evaluate(() => plant01.state.equipment[0].transportOrder), undefined);
  assert.deepEqual(await page.evaluate(() => plant01.state.workers.map((w) => w.name)), [
    'Worker #1',
    'Worker #2',
  ]);
  // Place an office by clicking the actual projected world cell.
  await page.locator('[data-action="tool:office"]').click();
  const p = await page.evaluate(() => plant01.world.project({ x: 6.4, z: 33.4 }));
  const canvas = await page.locator('#world').boundingBox();
  await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
  assert.equal(
    await page.evaluate(() => plant01.state.jobs.filter((j) => j.kind === 'office').length),
    1,
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    plant01.state.paused = false;
    for (
      let t = 0;
      t < 2400 &&
      (plant01.state.jobs.some((j) => j.status !== 'done') ||
        plant01.state.orders.some((o) => o.status !== 'done'));
      t += 0.1
    )
      plant01.Sim.tick(plant01.state, 0.1);
    plant01.step(0);
    plant01.state.paused = true;
  });
  assert.equal(
    await page.evaluate(() => plant01.state.buildings.filter((b) => b.kind === 'office').length),
    1,
    JSON.stringify(
      await page.evaluate(() => ({
        jobs: plant01.state.jobs.filter((j) => j.status !== 'done'),
        orders: plant01.state.orders.filter((o) => o.status !== 'done'),
        stacks: plant01.state.stacks,
      })),
    ),
  );
  const buildingPoint = await page.evaluate(() => plant01.world.project({ x: 8, z: 34 }));
  const yardBounds = await page.locator('#world').boundingBox();
  await page.mouse.click(yardBounds.x + buildingPoint.x, yardBounds.y + buildingPoint.y);
  assert.equal(await page.evaluate(() => plant01.selection?.type), 'building');
  await page.locator('[data-action="tab:materials"]').click();
  assert((await page.locator('#records').innerText()).toLowerCase().includes('physical storage'));
  await page.locator('[data-action="tab:workers"]').click();
  const operator = await page.evaluate(
    () => plant01.state.workers.find((w) => w.role === 'operator').id,
  );
  await page.locator(`[data-action="control:${operator}"]`).click();
  // Operators remain seated between tasks. Exercise a real exit and reboarding,
  // rather than passing because this operator was already inside the machine.
  await page.evaluate((operator) => plant01.action('locate:worker:' + operator), operator);
  assert.ok(
    await page.evaluate(async (operator) => {
      const button = document.querySelector(`[data-action="exit:${operator}"]`);
      await new Promise((resolve) => setTimeout(resolve, 750));
      return !!button && button === document.querySelector(`[data-action="exit:${operator}"]`);
    }, operator),
    'Paused inspector retains its buttons instead of replacing them each refresh',
  );
  await page.locator(`[data-action="exit:${operator}"]`).click();
  await page.evaluate(() => {
    plant01.state.paused = false;
    plant01.step(8);
    plant01.state.paused = true;
  });
  assert.equal(
    await page.evaluate(
      (operator) => plant01.state.workers.find((w) => w.id === operator).vehicle,
      operator,
    ),
    undefined,
  );
  const equipment = await page.evaluate(() => plant01.state.equipment[0].id);
  await page.evaluate(({ equipment }) => plant01.action('locate:equipment:' + equipment), {
    equipment,
  });
  await page.locator(`[data-action="enter:${equipment}"]`).click();
  await page.evaluate(() => {
    plant01.state.paused = false;
    plant01.step(30);
    plant01.state.paused = true;
  });
  assert.equal(
    await page.evaluate(() => plant01.state.workers.find((w) => w.role === 'operator').vehicle),
    equipment,
  );
  await checkFloorDrag(page);
  await page.locator('[data-action="release"]').click();
  await page.locator('[data-action="tab:reports"]').click();
  await page.locator('[data-action="sql-run"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#sql-status')?.textContent.includes('rows'),
  );
  assert.equal(await page.locator('#sql-results tbody tr').count(), 14);
  await page.locator('[data-action="sql-example:1"]').click();
  await page.locator('[data-action="sql-run"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#sql-results')?.textContent.includes('Purchases'),
  );
  await page.locator('[data-action="tab:costs"]').click();
  const dl = page.waitForEvent('download');
  await page.locator('[data-action="export-costs"]').click();
  assert.equal((await dl).suggestedFilename(), 'plant01-costs.csv');
  await page.locator('header [data-action="notices"]').click();
  await page.locator('[data-notice]').first().selectOption('doing');
  assert.ok(await page.evaluate(() => plant01.state.notices.some((n) => n.state === 'doing')));
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  const old = await page.evaluate(() => plant01.state.buildings.length);
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  assert.equal(await page.evaluate(() => plant01.state.buildings.length), old);
  await page.evaluate(() => plant01.start('demo'));
  await page.locator('[data-action="dismiss-guide"]').click();
  const physicalRendering = await checkPhysicalRendering(page);
  await page.evaluate(() => plant01.start('demo'));
  await page.locator('[data-action="dismiss-guide"]').click();
  await page.evaluate(() => {
    plant01.state.paused = true;
    plant01.world.focus({ x: 25, z: 30 }, 1.6);
  });
  await page.waitForTimeout(700);
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.locator('#delivery-toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/yard-preview.png' });
  await page.locator('[data-action="tab:materials"]').click();
  await page.screenshot({ path: base + '/records-preview.png' });
  const equipmentRoles = await checkEquipmentRoles(page, base);
  const workAnimation = await checkWorkAnimation(page);
  const operations = await checkOperationsUI(page, base);
  const timeAndWear = await checkTimeAndWear(page, base);
  const batchProcurement = await checkBatchProcurement(page, base);
  const forkLoadRendering = await checkForkLoadRendering(page, base);
  const shedRendering = await checkShedRendering(page, base);
  const automaticWork = await checkAutomaticWork(page, base);
  const trackRendering = await checkTrackRendering(page, base);
  const trackUI = await checkTrackUI(page, base);
  const equipmentIntent = await checkEquipmentIntent(page, base);
  const railLocations = await checkRailLocationsUI(page, base);
  const railCrews = await checkRailCrewsUI(page, base);
  const deliveryRecovery = await checkDeliveryRecoveryUI(page, base);
  const layouts = [];
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const t of [
      'workers',
      'equipment',
      'deliveries',
      'jobs',
      'activity',
      'costs',
      'railways',
    ]) {
      await page.locator(`#tabs [data-action="tab:${t}"]`).click();
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(metrics.scroll <= metrics.width);
      layouts.push({ tab: t, ...metrics });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(logs, []);
  fs.writeFileSync(
    base + '/test-results/browser-result.json',
    JSON.stringify(
      {
        passed: true,
        errors,
        logs,
        layouts,
        physicalRendering,
        equipmentRoles,
        operations,
        workAnimation,
        timeAndWear,
        batchProcurement,
        forkLoadRendering,
        shedRendering,
        automaticWork,
        equipmentIntent,
        railLocations,
        railCrews,
        deliveryRecovery,
        trackRendering,
        trackUI,
        checks: [
          'perspective depth and view-relative WASD after orbit',
          'floor grab-pan without click or worker commands',
          'rendered 1,435 mm gauge and pole/buffer geometry',
          'empty start and player-designated storage',
          'real UI procurement',
          'owned equipment drives off lowloader with hired operator',
          'grounded worker boots and rail wheel contact',
          'six interpolated render frames per simulation tick',
          'separate four-axle locomotive and flatcar with articulated bogies',
          '3D office placement',
          'complete construction',
          'worker control and boarding',
          'SQL material and cost queries',
          'CSV export',
          'notice workflow',
          'save reload',
          'named rail locations: geometry picking, edit, reposition, delete, SQL, and save reload',
          'rail work group equipment, dedicated support workers, linked inspectors, and save reload',
          'safe paused delivery recovery, actual manual driving, saved loads, and live warning filters',
          'equipment work roles in register, inspector, SQL, and saved yard',
          'records responsive layouts',
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, errors, logs, layouts }));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await server.close();
  });
