const { test, expect } = require('@playwright/test');

async function getSetupContext(request) {
  const operatorsResponse = await request.get('/api/operators');
  expect(operatorsResponse.ok()).toBeTruthy();
  const operators = await operatorsResponse.json();
  const activeOperator = operators.find((item) => item.is_active) || operators[0];

  const groupsResponse = await request.get('/api/work-groups');
  expect(groupsResponse.ok()).toBeTruthy();
  const groups = await groupsResponse.json();
  const workGroup = groups[0];

  const instrumentsResponse = await request.get(`/api/instruments?work_group_id=${workGroup.id}`);
  expect(instrumentsResponse.ok()).toBeTruthy();
  const instruments = await instrumentsResponse.json();
  const instrument = instruments[0];

  return {
    operatorName: activeOperator.name,
    workGroupId: String(workGroup.id),
    instrumentId: String(instrument.id)
  };
}

function uniqueValue(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function createExactReagent(request, { instrumentId, name, barcode, packageToMinQty = 1, warningDays = 30, warningStock = 5 }) {
  const response = await request.post('/api/reagents', {
    data: {
      instrument_id: Number(instrumentId),
      name,
      match_mode: 'exact',
      match_pattern: barcode,
      manufacturer: 'Playwright',
      unit: '瓶',
      package_unit: '盒',
      package_to_min_qty: packageToMinQty,
      warning_days: warningDays,
      warning_stock: warningStock
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function stockInReagent(request, { operatorName, reagentId, reagentName, batchNo, quantity, expiryDate, rawBarcode, packageToMinQty = 1 }) {
  const response = await request.post('/api/inbound/batch', {
    data: {
      operator: operatorName,
      items: [{
        source: 'manual',
        reagent_id: reagentId,
        reagent_name: reagentName,
        batch_no: batchNo,
        expiry_date: expiryDate,
        quantity,
        package_unit: '盒',
        min_unit: '瓶',
        package_to_min_qty: packageToMinQty,
        raw_barcode: rawBarcode
      }]
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function stockOutReagent(request, { operatorName, reagentId, quantity, rawBarcode, scannedBatchNo = null, scannedExpiryDate = null }) {
  const response = await request.post('/api/outbound/batch', {
    data: {
      operator: operatorName,
      items: [{
        source: 'scan',
        reagent_id: reagentId,
        quantity,
        outbound_unit: 'min',
        deduction_mode: scannedBatchNo ? 'scanned_batch' : 'fefo',
        raw_barcode: rawBarcode,
        scanned_batch_no: scannedBatchNo,
        scanned_expiry_date: scannedExpiryDate
      }]
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createSeededReagentWithStock(request, { instrumentId, operatorName, name, barcode, batchNo, quantity = 2, expiryDate = '2030-12-31', packageToMinQty = 1, warningDays = 30, warningStock = 5 }) {
  const reagent = await createExactReagent(request, {
    instrumentId,
    name,
    barcode,
    packageToMinQty,
    warningDays,
    warningStock
  });

  await stockInReagent(request, {
    operatorName,
    reagentId: reagent.id,
    reagentName: name,
    batchNo,
    quantity,
    expiryDate,
    rawBarcode: barcode,
    packageToMinQty
  });

  return reagent;
}

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
    await expect(page.locator('#dashboard-mobile-qr')).toBeVisible();
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

  test('dashboard warning card jumps to focused inventory card', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW预警试剂');
    const uniqueBarcode = uniqueValue('PW-WARN-BARCODE');

    await createSeededReagentWithStock(request, {
      instrumentId: setup.instrumentId,
      operatorName: setup.operatorName,
      name: uniqueName,
      barcode: uniqueBarcode,
      batchNo: 'PW-WARN-001',
      quantity: 1,
      expiryDate: '2026-04-12',
      warningDays: 30,
      warningStock: 5
    });

    await page.reload();
    const warningCard = page.locator('#dashboard-warning-list .dashboard-warning-card').filter({ hasText: uniqueName }).first();
    await expect(warningCard).toBeVisible();
    await warningCard.click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
    await expect(page.locator('.inventory-card-focused')).toBeVisible();
  });

  test('inbound page scan input is available', async ({ page }) => {
    await page.locator('.nav-link[data-page="inbound"]').click();
    await expect(page.locator('#page-inbound')).toHaveClass(/active/);
    await expect(page.locator('#scan-barcode')).toBeVisible();
  });

  test('inbound scan can add recognized barcode into pending list', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW扫码入库');
    const uniqueBarcode = uniqueValue('PW-INBOUND-SCAN-BARCODE');

    await createExactReagent(request, {
      instrumentId: setup.instrumentId,
      name: uniqueName,
      barcode: uniqueBarcode,
      packageToMinQty: 1
    });

    await page.locator('.nav-link[data-page="inbound"]').click();
    await expect(page.locator('#page-inbound')).toHaveClass(/active/);

    await page.locator('#scan-barcode').fill(uniqueBarcode);
    await page.locator('#scan-barcode').press('Enter');

    await expect(page.locator('#scan-item-count')).toHaveText('1');
    await expect(page.locator('#scan-items-list')).toContainText(uniqueName);
  });

  test('inbound unmatched barcode opens new reagent modal', async ({ page }) => {
    await page.locator('.nav-link[data-page="inbound"]').click();
    await expect(page.locator('#page-inbound')).toHaveClass(/active/);

    await page.locator('#scan-barcode').fill('UNMATCHED-PLAYWRIGHT-001');
    await page.locator('#scan-barcode').press('Enter');

    await expect(page.locator('#new-reagent-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#new-reagent-barcode')).toHaveValue('UNMATCHED-PLAYWRIGHT-001');
    await page.evaluate(() => {
      inboundPage.closeNewReagentModal();
    });
    await expect(page.locator('#new-reagent-modal')).toHaveClass(/hidden/);
  });

  test('outbound preview can resolve deducted batch for existing reagent', async ({ request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW扫码出库');
    const uniqueBarcode = uniqueValue('PW-OUTBOUND-SCAN-BARCODE');
    const reagent = await createSeededReagentWithStock(request, {
      instrumentId: setup.instrumentId,
      operatorName: setup.operatorName,
      name: uniqueName,
      barcode: uniqueBarcode,
      batchNo: 'PW-OUT-SCAN-001',
      quantity: 2,
      expiryDate: '2030-12-31'
    });

    const previewResponse = await request.post('/api/outbound/preview', {
      data: {
        source: 'manual',
        reagent_id: reagent.id,
        quantity: 1,
        outbound_unit: 'min',
        deduction_mode: 'fefo',
        raw_barcode: uniqueBarcode
      }
    });
    expect(previewResponse.ok()).toBeTruthy();
    const payload = await previewResponse.json();
    expect(payload.reagent_name).toBe(uniqueName);
    expect(payload.deducted_batches[0].batch_no).toBe('PW-OUT-SCAN-001');
  });

  test('scan create flow can submit inbound and appear in inventory', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW入库试剂');
    const uniqueBarcode = uniqueValue('PW-INBOUND-BARCODE');

    await page.locator('.nav-link[data-page="inbound"]').click();
    await expect(page.locator('#page-inbound')).toHaveClass(/active/);

    await page.locator('#scan-barcode').fill(uniqueBarcode);
    await page.locator('#scan-barcode').press('Enter');

    await expect(page.locator('#new-reagent-modal')).not.toHaveClass(/hidden/);
    await page.locator('#new-reagent-work-group').selectOption(setup.workGroupId);
    await page.locator('#new-reagent-instrument').selectOption(setup.instrumentId);
    await page.locator('#new-reagent-name').fill(uniqueName);
    await page.locator('#new-reagent-manufacturer').fill('Playwright');
    await page.locator('#new-reagent-batch-no').fill('PW-IN-001');
    await page.locator('#new-reagent-expiry-date').fill('2030-12-31');
    await page.locator('#new-reagent-package-to-min-qty').fill('3');
    await page.locator('#new-reagent-quantity').fill('2');
    await page.locator('#new-reagent-submit-btn').click();

    await expect(page.locator('#new-reagent-modal')).toHaveClass(/hidden/);
    await expect(page.locator('#scan-item-count')).toHaveText('1');
    await expect(page.locator('#scan-items-list')).toContainText(uniqueName);

    await page.locator('#scan-items-section .btn.btn-primary').click();
    await expect(page.locator('#inbound-confirm-modal')).not.toHaveClass(/hidden/);
    await page.locator('#confirm-operator').selectOption({ label: setup.operatorName });
    await page.locator('#confirm-submit-btn').click();

    await expect(page.locator('#inbound-confirm-modal')).toHaveClass(/hidden/);
    await expect(page.locator('#scan-item-count')).toHaveText('0');

    await page.locator('.nav-link[data-page="inventory"]').click();
    await page.locator('#inventory-search').fill(uniqueName);
    await expect(page.locator('#inventory-reagent-list')).toContainText(uniqueName);
  });

  test('dashboard outbound submit updates recent outbounds list', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW出库试剂');
    const uniqueBarcode = uniqueValue('PW-OUTBOUND-BARCODE');
    const reagent = await createExactReagent(request, {
      instrumentId: setup.instrumentId,
      name: uniqueName,
      barcode: uniqueBarcode,
      packageToMinQty: 1,
      warningStock: 1
    });

    await stockInReagent(request, {
      operatorName: setup.operatorName,
      reagentId: reagent.id,
      reagentName: uniqueName,
      batchNo: 'PW-OUT-001',
      quantity: 2,
      expiryDate: '2030-12-31',
      rawBarcode: uniqueBarcode,
      packageToMinQty: 1
    });

    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
    await page.locator('#dashboard-outbound-panel .mode-tab[data-mode="manual"]').click();
    await expect(page.locator('#outbound-manual-mode')).not.toHaveClass(/hidden/);

    await page.locator('#outbound-manual-search').fill(uniqueName);
    await expect(page.locator('#outbound-manual-search-results')).toContainText(uniqueName);
    await page.locator('#outbound-manual-search-results .candidate-item').first().click();
    await expect(page.locator('#outbound-manual-summary')).toContainText(uniqueName);
    await page.locator('#outbound-manual-mode .button-group .btn.btn-primary').click();

    await expect(page.locator('#outbound-item-count')).toHaveText('1');
    await expect(page.locator('#outbound-items-list')).toContainText(uniqueName);

    await page.locator('#outbound-items-section .btn.btn-primary').click();
    await expect(page.locator('#outbound-confirm-modal')).not.toHaveClass(/hidden/);
    await page.locator('#outbound-confirm-operator').selectOption({ label: setup.operatorName });
    await page.locator('#outbound-confirm-submit').click();

    await expect(page.locator('#outbound-confirm-modal')).toHaveClass(/hidden/);
    await expect(page.locator('#dashboard-recent-outbounds')).toContainText(uniqueName);
  });

  test('zero-stock reagent can be archived from inventory page', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW归档试剂');
    const uniqueBarcode = uniqueValue('PW-ARCHIVE-BARCODE');
    const reagent = await createExactReagent(request, {
      instrumentId: setup.instrumentId,
      name: uniqueName,
      barcode: uniqueBarcode,
      packageToMinQty: 1
    });

    await stockInReagent(request, {
      operatorName: setup.operatorName,
      reagentId: reagent.id,
      reagentName: uniqueName,
      batchNo: 'PW-AR-001',
      quantity: 1,
      expiryDate: '2030-12-31',
      rawBarcode: uniqueBarcode,
      packageToMinQty: 1
    });

    await stockOutReagent(request, {
      operatorName: setup.operatorName,
      reagentId: reagent.id,
      quantity: 1,
      rawBarcode: uniqueBarcode,
      scannedBatchNo: 'PW-AR-001',
      scannedExpiryDate: '2030-12-31'
    });

    page.once('dialog', (dialog) => dialog.accept());

    await page.locator('.nav-link[data-page="inventory"]').click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
    await page.locator('#inventory-search').fill(uniqueName);
    await expect(page.locator('#inventory-reagent-list')).toContainText(uniqueName);

    const targetCard = page.locator('#inventory-reagent-list .inventory-card').filter({ hasText: uniqueName }).first();
    await expect(targetCard).toBeVisible();
    await targetCard.locator('.btn.btn-danger').click();

    await expect(page.locator('#inventory-reagent-list')).not.toContainText(uniqueName);
  });

  test('inventory reagent settings modal opens and closes', async ({ page }) => {
    await page.locator('#dashboard-warning-list .dashboard-warning-card').first().click();
    await expect(page.locator('#page-inventory')).toHaveClass(/active/);
    await expect(page.locator('.inventory-card-focused')).toBeVisible();

    const focusedButton = page.locator('.inventory-card-focused .btn.btn-secondary').filter({ hasText: '设置试剂信息' }).first();
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

  test('mobile page loads with bottom tabs and summary cards', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');

    await expect(page.locator('.mobile-header h1')).toHaveText('试剂出入库');
    await expect(page.locator('.mobile-tab')).toHaveCount(3);
    await expect(page.locator('#mobile-summary-cards .mobile-summary-card')).toHaveCount(3);
    await expect(page.locator('#mobile-page-outbound')).toHaveClass(/active/);
  });

  test('mobile outbound and inbound quick flows work for existing reagent', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW-Mobile');
    const uniqueBarcode = uniqueValue('PW-MOBILE-BARCODE');
    const reagent = await createExactReagent(request, {
      instrumentId: setup.instrumentId,
      name: uniqueName,
      barcode: uniqueBarcode,
      packageToMinQty: 2
    });

    await stockInReagent(request, {
      operatorName: setup.operatorName,
      reagentId: reagent.id,
      reagentName: uniqueName,
      batchNo: 'PW-MOBILE-001',
      quantity: 3,
      expiryDate: '2030-12-31',
      rawBarcode: uniqueBarcode,
      packageToMinQty: 2
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');
    await expect(page.locator('#mobile-summary-cards .mobile-summary-card')).toHaveCount(3);
    await expect(page.locator('#mobile-outbound-results')).toContainText('输入试剂名称后开始搜索');

    await page.locator('#mobile-outbound-search').fill(uniqueName);
    await expect(page.locator('#mobile-outbound-results')).toContainText(uniqueName);
    await page.locator('#mobile-outbound-results .mobile-result-card').first().click();
    await expect(page.locator('#mobile-outbound-sheet')).not.toHaveClass(/hidden/);
    await expect(page.locator('#mobile-outbound-batches')).toContainText('PW-MOBILE-001');
    await page.locator('#mobile-outbound-operator').selectOption({ label: setup.operatorName });
    await page.locator('#mobile-outbound-submit').click();
    await expect(page.locator('#mobile-outbound-sheet')).toHaveClass(/hidden/);

    await page.locator('.mobile-tab[data-page="inbound"]').click();
    await expect(page.locator('#mobile-page-inbound')).toHaveClass(/active/);
    await page.locator('#mobile-inbound-search').fill(uniqueName);
    await expect(page.locator('#mobile-inbound-results')).toContainText(uniqueName);
    await page.locator('#mobile-inbound-results .mobile-result-card').first().click();
    await expect(page.locator('#mobile-inbound-form-panel')).not.toHaveClass(/hidden/);
    await page.locator('#mobile-inbound-batch-no').fill('PW-MOBILE-002');
    await page.locator('#mobile-inbound-expiry-date').fill('2031-01-31');
    await page.locator('#mobile-inbound-operator').selectOption({ label: setup.operatorName });
    await page.locator('#mobile-inbound-submit').click();

    await page.locator('.mobile-tab[data-page="inventory"]').click();
    await page.locator('#mobile-inventory-search').fill(uniqueName);
    await expect(page.locator('#mobile-inventory-list')).toContainText(uniqueName);
  });

  test('mobile warning fold can expand and warning card can jump to inventory', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW-Mobile-Warn');
    const uniqueBarcode = uniqueValue('PW-MOBILE-WARN-BARCODE');

    await createSeededReagentWithStock(request, {
      instrumentId: setup.instrumentId,
      operatorName: setup.operatorName,
      name: uniqueName,
      barcode: uniqueBarcode,
      batchNo: 'PW-MOBILE-WARN-001',
      quantity: 1,
      expiryDate: '2026-04-12',
      warningDays: 30,
      warningStock: 5
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');
    await expect(page.locator('#mobile-summary-cards .mobile-summary-card')).toHaveCount(3);
    await expect(page.locator('#mobile-warning-toggle-label')).toHaveText('展开');

    await expect(page.locator('#mobile-warning-fold')).toHaveClass(/hidden/);
    await page.locator('#mobile-warning-toggle').click();
    await expect(page.locator('#mobile-warning-fold')).not.toHaveClass(/hidden/);
    const warningCard = page.locator('#mobile-warning-list .mobile-warning-card').filter({ hasText: uniqueName }).first();
    await expect(warningCard).toBeVisible();
    await warningCard.click();

    await expect(page.locator('#mobile-page-inventory')).toHaveClass(/active/);
    await expect(page.locator(`#mobile-inventory-list .mobile-stock-card[data-reagent-id]`).filter({ hasText: uniqueName }).first()).toBeVisible();
  });

  test('mobile summary card can jump to zero-stock inventory list', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW-Mobile-Empty');
    const uniqueBarcode = uniqueValue('PW-MOBILE-EMPTY-BARCODE');
    const reagent = await createSeededReagentWithStock(request, {
      instrumentId: setup.instrumentId,
      operatorName: setup.operatorName,
      name: uniqueName,
      barcode: uniqueBarcode,
      batchNo: 'PW-MOBILE-EMPTY-001',
      quantity: 1,
      expiryDate: '2030-12-31',
      packageToMinQty: 1
    });

    await stockOutReagent(request, {
      operatorName: setup.operatorName,
      reagentId: reagent.id,
      quantity: 1,
      rawBarcode: uniqueBarcode,
      scannedBatchNo: 'PW-MOBILE-EMPTY-001',
      scannedExpiryDate: '2030-12-31'
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');

    const emptySummaryCard = page.locator('#mobile-summary-cards .mobile-summary-card').filter({ hasText: '零库存' }).first();
    await expect(emptySummaryCard).toBeVisible();
    await emptySummaryCard.click();

    await expect(page.locator('#mobile-page-inventory')).toHaveClass(/active/);
    await expect(page.locator('#mobile-inventory-status')).toHaveValue('empty');
    await expect(page.locator('#mobile-inventory-list')).toContainText(uniqueName);
  });

  test('mobile inbound historical batch suggestion can autofill zero-stock batch and expiry', async ({ page, request }) => {
    const setup = await getSetupContext(request);
    const uniqueName = uniqueValue('PW-Mobile-Inbound-History');
    const uniqueBarcode = uniqueValue('PW-MOBILE-INBOUND-HISTORY-BARCODE');
    const reagent = await createSeededReagentWithStock(request, {
      instrumentId: setup.instrumentId,
      operatorName: setup.operatorName,
      name: uniqueName,
      barcode: uniqueBarcode,
      batchNo: 'PW-MOBILE-HIS-001',
      quantity: 1,
      expiryDate: '2031-03-31',
      packageToMinQty: 5
    });

    await stockOutReagent(request, {
      operatorName: setup.operatorName,
      reagentId: reagent.id,
      quantity: 5,
      rawBarcode: uniqueBarcode,
      scannedBatchNo: 'PW-MOBILE-HIS-001',
      scannedExpiryDate: '2031-03-31'
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/m');
    await expect(page.locator('#mobile-summary-cards .mobile-summary-card')).toHaveCount(3);
    await page.locator('.mobile-tab[data-page="inbound"]').click();
    await expect(page.locator('#mobile-page-inbound')).toHaveClass(/active/);

    await page.locator('#mobile-inbound-search').fill(uniqueName);
    await expect(page.locator('#mobile-inbound-results')).toContainText(uniqueName);
    await page.locator('#mobile-inbound-results .mobile-result-card').first().click();

    const batchSuggestion = page.locator('#mobile-inbound-batch-suggestions [data-batch-no="PW-MOBILE-HIS-001"]').first();
    await expect(batchSuggestion).toBeVisible();
    await batchSuggestion.click();

    await expect(page.locator('#mobile-inbound-batch-no')).toHaveValue('PW-MOBILE-HIS-001');
    await expect(page.locator('#mobile-inbound-expiry-date')).toHaveValue('2031-03-31');
  });
});
