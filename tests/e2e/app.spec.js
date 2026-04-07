const { test, expect } = require('@playwright/test');

test.describe('Reagent inventory smoke flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('dashboard renders outbound workbench and right rail cards', async ({ page }) => {
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
    await expect(page.locator('#page-dashboard h2').first()).toBeVisible();
    await expect(page.locator('#dashboard-pending-tasks .dashboard-task-card')).toHaveCount(4);
    await expect(page.locator('#dashboard-warning-list')).toBeVisible();
    await expect(page.locator('#dashboard-recent-outbounds')).toBeVisible();
    await expect(page.locator('#outbound-barcode')).toBeVisible();
  });

  test('inventory page opens and shows filter toolbar', async ({ page }) => {
    await page.locator('.nav-link[data-page="inventory"]').click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
    await expect(page.locator('#inventory-search')).toBeVisible();
    await expect(page.locator('#inventory-status-filter')).toBeVisible();
    await expect(page.locator('#inventory-sort')).toBeVisible();
    await expect(page.locator('#inventory-reagent-list')).toBeVisible();
  });

  test('dashboard cards can jump to inventory', async ({ page }) => {
    const firstPendingCard = page.locator('#dashboard-pending-tasks .dashboard-task-card').first();
    await expect(firstPendingCard).toBeVisible();
    await firstPendingCard.click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
    await expect(page.locator('#inventory-status-filter')).toBeVisible();
  });

  test('dashboard warning card jumps to focused inventory card', async ({ page }) => {
    const firstWarningCard = page.locator('#dashboard-warning-list .dashboard-warning-card').first();
    await expect(firstWarningCard).toBeVisible();
    await firstWarningCard.click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
    await expect(page.locator('.inventory-card-focused')).toBeVisible();
  });

  test('inbound page scan input is available', async ({ page }) => {
    await page.locator('.nav-link[data-page="inbound"]').click();
    await expect(page.locator('#page-inbound')).toHaveClass(/active/);
    await expect(page.locator('#scan-barcode')).toBeVisible();
  });

  test('inventory reagent settings modal opens and closes', async ({ page }) => {
    await page.locator('#dashboard-warning-list .dashboard-warning-card').first().click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
    await expect(page.locator('.inventory-card-focused')).toBeVisible();

    const focusedButton = page.locator('.inventory-card-focused button').first();
    await expect(focusedButton).toBeVisible();
    await focusedButton.click();

    await expect(page.locator('#inventory-reagent-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#inventory-reagent-name')).toBeVisible();

    await page.locator('#inventory-reagent-modal-cancel').click();
    await expect(page.locator('#inventory-reagent-modal')).toHaveClass(/hidden/);
  });

  test('inventory export modal can trigger excel download', async ({ page }) => {
    await page.locator('.nav-link[data-page="inventory"]').click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);

    await page.locator('#inventory-export-btn').click();
    await expect(page.locator('#inventory-export-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#inventory-export-confirm')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#inventory-export-confirm').click();
    const download = await downloadPromise;
    const suggestedFilename = download.suggestedFilename();

    expect(suggestedFilename).toMatch(/\.xlsx$/i);
    await expect(page.locator('#inventory-export-modal')).toHaveClass(/hidden/);
  });

  test('reports and catalog pages open correctly', async ({ page }) => {
    await page.locator('.nav-link[data-page="reports"]').click();
    await expect(page.locator('#page-reports')).toHaveClass(/active/);

    await page.locator('.nav-link[data-page="catalog"]').click();
    await expect(page.locator('#page-catalog')).toHaveClass(/active/);
  });
});
