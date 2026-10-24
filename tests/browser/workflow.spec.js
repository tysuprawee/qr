import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { fixtureGLB } from '../fixtures.js';
import http from 'node:http';
import { createApp } from '../../server/index.js';

test('phone approval, camera, uploads, WebSocket sync, real failure, explicit demo, placement and persistence', async ({ page, browser }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#scene canvas')).toBeVisible();
  const sessionResponse = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Scan with Phone', exact: true }).first().click();
  await expect(page.locator('.qr-image')).toBeVisible();
  const invitation = (await (await sessionResponse).json()).url;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const phone = await phoneContext.newPage(); phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(invitation); await expect(phone).toHaveURL('http://localhost:3000/capture'); await phone.getByRole('button', { name: 'Request desktop approval' }).click();
  await expect(phone.locator('#approval')).toBeVisible();
  await expect(page.locator('.pair-request')).toBeVisible();
  const verification = await phone.locator('#verification').textContent(); await expect(page.locator('.pair-request')).toContainText(verification);
  await page.getByRole('button', { name: 'Approve phone' }).click(); await expect(phone.locator('#approved')).toBeVisible();
  await phone.getByRole('button', { name: 'Open rear camera' }).click(); await expect(phone.locator('#camera')).toBeVisible();
  await expect.poll(() => phone.locator('#camera').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await phone.getByRole('button', { name: 'Take photo', exact: true }).click(); await expect(phone.locator('.phone-photo')).toHaveCount(1);
  await phone.getByRole('button', { name: 'Upload selected photos' }).click(); await expect(phone.locator('#upload-status')).toContainText('Uploaded.');
  await expect(page.locator('.pairing-bottom')).toContainText('1 captures received');
  await page.getByRole('button', { name: 'View captures' }).click(); await expect(page.locator('.capture-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select & reconstruct' }).click(); const canvas = page.locator('#mask-canvas'); await expect(canvas).toBeVisible();
  const rect = await canvas.boundingBox(); for (const [x, y] of [[.2,.2],[.8,.2],[.8,.8],[.2,.8]]) await canvas.click({ position: { x: rect.width*x, y: rect.height*y } });
  await page.getByRole('button', { name: 'Reconstruct with SAM 3D' }).click(); await expect(page.locator('#capture-job')).toContainText('Reconstruction failed'); await expect(page.locator('#capture-job')).toContainText('no inference worker');
  await expect(phone.locator('#phone-job')).toContainText('Reconstruction unavailable');
  await page.getByRole('button', { name: 'Import demo chair', exact: true }).click(); await expect(page.locator('.asset-details')).toContainText('DEMO ASSET');
  await page.locator('#asset-dim-0').fill('0.82'); await page.locator('#asset-dim-0').blur(); await page.locator('#confirm-scale').check(); await page.getByRole('button', { name: 'Add to my room' }).click();
  await expect(page.locator('#object-total')).toHaveText('5 objects'); await expect(page.locator('#object-name')).toHaveValue('Demo lounge chair');
  await page.locator('#position-0').fill('1.2'); await page.locator('#position-0').blur(); await page.locator('#object-rotation').fill('45'); await page.locator('#object-rotation').blur();
  await expect(page.locator('#save-status')).toHaveText('Saved on this device');
  await page.screenshot({ path: 'test-results/desktop-roomshift.png', fullPage: true }); await phone.screenshot({ path: 'test-results/mobile-roomshift.png', fullPage: true });
  await page.reload(); await page.locator('[data-object]').filter({ hasText: 'Demo lounge chair' }).click(); await expect(page.locator('#position-0')).toHaveValue('1.20'); await expect(page.locator('#object-rotation')).toHaveValue('45');
  await page.getByRole('button', { name: 'Scan with Phone', exact: true }).first().click(); await page.getByRole('button', { name: 'Disconnect phone' }).click(); await expect(phone.locator('#approval')).toContainText('Session ended');
  await page.getByRole('button', { name: 'End session & delete captures' }).click(); await expect(page.locator('#pairing-content')).toContainText('captures were deleted');
  await phoneContext.close(); expect(errors).toEqual([]);
});

test('GLB import requires scale confirmation and imported object can move and rotate', async ({ page }) => {
  await page.goto('/'); await page.locator('#asset-file').setInputFiles({ name: 'contract-test-fixture.glb', mimeType: 'model/gltf-binary', buffer: fixtureGLB() });
  await expect(page.locator('#asset-preview canvas')).toBeVisible(); await expect(page.locator('#confirm-import')).toBeDisabled();
  await page.locator('#asset-name').fill('Transport test fixture'); await page.locator('#confirm-scale').check(); await page.locator('#confirm-import').click();
  await expect(page.locator('#object-total')).toHaveText('5 objects'); await page.getByRole('button', { name: 'Rotate object', exact: true }).click(); await page.locator('#object-rotation').fill('90'); await page.locator('#object-rotation').blur(); await page.locator('#position-2').fill('-1'); await page.locator('#position-2').blur();
  await expect(page.locator('#object-rotation')).toHaveValue('90'); await expect(page.locator('#object-name')).toHaveValue('Transport test fixture');
});

test('room references, image deletion and phone reload retain approved pairing', async ({ page, browser }) => {
  await page.goto('/'); await page.locator('#scan-phone').click(); const code = await page.locator('.pairing-code').textContent();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const phone = await context.newPage();
  await phone.goto('/capture'); await phone.locator('#pair-code').fill(code); await phone.locator('#pair-form button').click(); await page.getByRole('button', { name: 'Approve phone' }).click();
  await expect(phone.locator('#approved')).toBeVisible(); await phone.locator('#room-mode').click(); await expect(phone.locator('#mode-help')).toContainText('do not produce a metrically accurate');
  const buffer = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#a8b594' } }).png().toBuffer();
  await phone.locator('#phone-files').setInputFiles({ name: 'room-reference.png', mimeType: 'image/png', buffer }); await phone.locator('#upload-selected').click(); await expect(phone.locator('#upload-status')).toContainText('Uploaded.');
  await phone.reload(); await expect(phone.locator('#approved')).toBeVisible(); await expect(phone.locator('.phone-photo')).toHaveCount(1);
  await page.getByRole('button', { name: 'View captures' }).click(); await expect(page.locator('.capture-card')).toContainText('ROOM REFERENCE');
  await page.getByRole('button', { name: 'Delete capture' }).click(); await expect(phone.locator('.phone-photo')).toHaveCount(0); await context.close();
});

test('successful inference transport fixture reaches preview, confirmation, library and movable scene object', async ({ browser }) => {
  // This private test worker returns synthetic geometry. It does not exercise GPU inference.
  const worker = http.createServer(async (req, res) => { for await (const _chunk of req) {} res.setHeader('Content-Type', 'model/gltf-binary'); res.end(fixtureGLB()); });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  const runtime = await createApp({ production: true, origin: 'http://localhost:3001', workerUrl: `http://127.0.0.1:${worker.address().port}/reconstruct` });
  await new Promise(resolve => runtime.server.listen(3001, '127.0.0.1', resolve));
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const phoneContext = await browser.newContext();
  try {
    const desktop = await desktopContext.newPage(), phone = await phoneContext.newPage();
    await desktop.goto('http://localhost:3001'); await desktop.locator('#scan-phone').click(); const code = await desktop.locator('.pairing-code').textContent();
    await phone.goto('http://localhost:3001/capture'); await phone.locator('#pair-code').fill(code); await phone.locator('#pair-form button').click(); await desktop.getByRole('button', { name: 'Approve phone' }).click(); await expect(phone.locator('#approved')).toBeVisible();
    const buffer = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#839b72' } }).jpeg().toBuffer();
    await phone.locator('#phone-files').setInputFiles({ name: 'synthetic-contract-input.jpg', mimeType: 'image/jpeg', buffer }); await phone.locator('#upload-selected').click(); await expect(phone.locator('#upload-status')).toContainText('Uploaded.');
    await desktop.getByRole('button', { name: 'View captures' }).click(); await desktop.getByRole('button', { name: 'Select & reconstruct' }).click();
    const canvas = desktop.locator('#mask-canvas'); const rect = await canvas.boundingBox();
    for (const [x,y] of [[.15,.15],[.85,.15],[.85,.85],[.15,.85]]) await canvas.click({ position: { x: rect.width*x, y: rect.height*y } });
    await desktop.getByRole('button', { name: 'Reconstruct with SAM 3D' }).click(); await expect(desktop.locator('#capture-job')).toContainText('Your piece is ready');
    await desktop.getByRole('button', { name: 'Preview & confirm scale' }).click(); await expect(desktop.locator('#asset-preview canvas')).toBeVisible();
    await desktop.locator('#asset-name').fill('Synthetic transport fixture'); await desktop.locator('#asset-dim-1').fill('1.1'); await desktop.locator('#asset-dim-1').blur(); await desktop.locator('#confirm-scale').check(); await desktop.locator('#confirm-import').click();
    await expect(desktop.locator('#object-total')).toHaveText('5 objects'); await expect(desktop.locator('#object-name')).toHaveValue('Synthetic transport fixture');
    await desktop.locator('#position-0').fill('1.5'); await desktop.locator('#position-0').blur(); await desktop.locator('#object-rotation').fill('35'); await desktop.locator('#object-rotation').blur();
    await expect(desktop.locator('#object-size-1')).toHaveValue('1.10'); await expect(phone.locator('#phone-job')).toContainText('Your 3D asset is ready'); await expect(phone.locator('.phone-photo')).toHaveCount(0);
  } finally { await phoneContext.close(); await desktopContext.close(); await runtime.close(); await new Promise(resolve => worker.close(resolve)); }
});

test('layout metadata imports and alignment is preserved by project export/import', async ({ page }) => {
  await page.goto('/'); await page.locator('#room-file').setInputFiles('examples/room-layout.json'); await expect(page.locator('#align-room')).toBeVisible();
  await page.locator('#align-room').click(); await page.locator('#align-x').fill('0.4'); await page.locator('#align-angle').fill('90'); await page.locator('#apply-alignment').click();
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export-room').click(); const result = await downloadEvent; const exportedPath = await result.path();
  await page.locator('#room-file').setInputFiles(exportedPath); await expect(page.locator('#align-room')).toBeVisible(); await expect(page.locator('#object-total')).toHaveText('4 objects');
});
