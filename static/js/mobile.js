const mobileApp = {
  currentPage: 'outbound',
  overview: null,
  inventoryData: [],
  outboundResults: [],
  inboundResults: [],
  calibrationResults: [],
  calibrationRecords: [],
  selectedOutboundReagent: null,
  selectedOutboundBatchId: null,
  selectedInboundReagent: null,
  selectedInboundBatchNo: '',
  selectedCalibrationPreview: null,
  selectedCalibrationRecordId: null,
  calibrationMode: 'create',
  inboundBatchSuggestions: [],
  inventoryFilters: { keyword: '', status: 'all', onlyWarnings: false },
  expandedInventoryIds: new Set(),
  isWarningFoldExpanded: false,
  isSubmittingOutbound: false,
  isSubmittingInbound: false,
  isSubmittingCalibration: false,

  async init() {
    this.bindEvents();
    this.showEmpty('mobile-outbound-results', '输入试剂名称后开始搜索');
    this.showEmpty('mobile-inbound-results', '输入试剂名称后开始搜索');
    this.showEmpty('mobile-calibration-results', '输入试剂名称后开始搜索');
    await Utils.loadOperators();
    await Promise.all([
      Utils.populateOperatorSelect('mobile-outbound-operator', { allowEmpty: false, defaultValue: Utils.getLastOperator() }),
      Utils.populateOperatorSelect('mobile-inbound-operator', { allowEmpty: false, defaultValue: Utils.getLastOperator() }),
      Utils.populateOperatorSelect('mobile-calibration-operator', { allowEmpty: false, defaultValue: Utils.getLastOperator() }),
      this.refreshOverview(),
      this.loadInventory(),
      this.loadCalibrationRecords()
    ]);
    this.switchPage(this.currentPage || 'outbound');
    this.toggleWarningFold(false);
  },

  bindEvents() {
    document.querySelectorAll('.mobile-tab').forEach((button) => {
      button.addEventListener('click', () => this.switchPage(button.dataset.page));
    });
    document.getElementById('mobile-refresh-btn')?.addEventListener('click', async () => {
      await Promise.all([this.refreshOverview(), this.loadInventory()]);
    });
    document.getElementById('mobile-warning-toggle')?.addEventListener('click', () => this.toggleWarningFold());
    document.getElementById('mobile-outbound-search')?.addEventListener('input', Utils.debounce((event) => this.searchOutboundReagents(event.target.value.trim()), 220));
    document.getElementById('mobile-inbound-search')?.addEventListener('input', Utils.debounce((event) => this.searchInboundReagents(event.target.value.trim()), 220));
    document.getElementById('mobile-calibration-search')?.addEventListener('input', Utils.debounce((event) => this.searchCalibrationReagents(event.target.value.trim()), 220));
    document.getElementById('mobile-calibration-refresh')?.addEventListener('click', () => this.loadCalibrationRecords());
    document.getElementById('mobile-inbound-batch-no')?.addEventListener('input', () => this.syncInboundBatchDetails(false));
    document.getElementById('mobile-inbound-change-reagent')?.addEventListener('click', () => this.resetInboundSelection());
    document.getElementById('mobile-inbound-batch-suggestions')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-batch-no]');
      if (button) this.selectInboundBatch(button.dataset.batchNo || '');
    });
    document.getElementById('mobile-outbound-close')?.addEventListener('click', () => this.closeOutboundSheet());
    document.getElementById('mobile-outbound-sheet')?.addEventListener('click', (event) => {
      if (event.target.classList.contains('mobile-sheet-backdrop')) this.closeOutboundSheet();
    });
    document.getElementById('mobile-outbound-quantity')?.addEventListener('input', () => this.refreshOutboundPreview());
    document.getElementById('mobile-outbound-unit')?.addEventListener('change', () => this.refreshOutboundPreview());
    document.getElementById('mobile-outbound-submit')?.addEventListener('click', () => this.submitOutbound());
    document.getElementById('mobile-inbound-submit')?.addEventListener('click', () => this.submitInbound());
    document.getElementById('mobile-calibration-close')?.addEventListener('click', () => this.closeCalibrationSheet());
    document.getElementById('mobile-calibration-sheet')?.addEventListener('click', (event) => {
      if (event.target.classList.contains('mobile-sheet-backdrop')) this.closeCalibrationSheet();
    });
    document.getElementById('mobile-calibration-submit')?.addEventListener('click', () => this.handleCalibrationSubmit());
    document.getElementById('mobile-calibration-save-only')?.addEventListener('click', () => this.submitCalibration(false));
    document.getElementById('mobile-calibration-save-outbound')?.addEventListener('click', () => this.submitCalibration(true));
    document.getElementById('mobile-calibration-result-unit')?.addEventListener('input', () => this.syncCalibrationResultUnitNotes());
    document.getElementById('mobile-calibration-result-grid')?.addEventListener('paste', (event) => this.handleCalibrationResultPaste(event));
    document.getElementById('mobile-calibration-result-grid')?.addEventListener('keydown', (event) => this.handleCalibrationResultKeydown(event));
    document.getElementById('mobile-inventory-search')?.addEventListener('input', Utils.debounce((event) => {
      this.inventoryFilters.keyword = event.target.value.trim();
      this.renderInventory();
    }, 180));
    document.getElementById('mobile-inventory-status')?.addEventListener('change', (event) => {
      this.inventoryFilters.status = event.target.value || 'all';
      this.renderInventory();
    });
    document.getElementById('mobile-inventory-only-warnings')?.addEventListener('change', (event) => {
      this.inventoryFilters.onlyWarnings = event.target.checked;
      this.renderInventory();
    });
  },

  switchPage(page) {
    this.currentPage = page;
    document.querySelectorAll('.mobile-page').forEach((section) => section.classList.toggle('active', section.id === `mobile-page-${page}`));
    document.querySelectorAll('.mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  },

  toggleWarningFold(forceExpanded) {
    this.isWarningFoldExpanded = typeof forceExpanded === 'boolean' ? forceExpanded : !this.isWarningFoldExpanded;
    document.getElementById('mobile-warning-fold')?.classList.toggle('hidden', !this.isWarningFoldExpanded);
    document.getElementById('mobile-warning-toggle')?.setAttribute('aria-expanded', String(this.isWarningFoldExpanded));
    const label = document.getElementById('mobile-warning-toggle-label');
    if (label) label.textContent = this.isWarningFoldExpanded ? '收起' : '展开';
  },

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  normalizePositiveInteger(value, fallback = 1) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  },

  getStatusLabel(status) {
    return { normal: '正常', expiring: '近效期', low: '低库存', empty: '零库存', expired: '已过期' }[status] || '正常';
  },

  formatDays(days) {
    if (days === null || days === undefined) return '未记录';
    if (days < 0) return `已过期 ${Math.abs(days)} 天`;
    if (days === 0) return '今天到期';
    return `剩余 ${days} 天`;
  },

  showEmpty(containerId, message) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = `<div class="mobile-empty">${this.escapeHtml(message)}</div>`;
  },

  async refreshOverview() {
    try {
      this.overview = await API.mobile.overview();
      this.renderOverview();
    } catch (error) {
      Utils.showToast(`手机首页加载失败：${error.message}`, 'error');
    }
  },

  renderOverview() {
    const summary = this.overview?.pending_tasks;
    const warningCountEl = document.getElementById('mobile-warning-count');
    if (!summary) {
      if (warningCountEl) warningCountEl.textContent = '0';
      this.showEmpty('mobile-summary-cards', '暂无待处理摘要');
      this.showEmpty('mobile-warning-list', '暂无重点预警');
      this.showEmpty('mobile-recent-list', '暂无最近出库记录');
      return;
    }
    const warnings = this.overview.warning_reagents || [];
    if (warningCountEl) warningCountEl.textContent = String(warnings.length);
    const summaryCards = [
      { label: '近效期', value: summary.expiring_reagent_count, tone: 'warning', status: 'expiring' },
      { label: '低库存', value: summary.low_or_empty_reagent_count, tone: 'warning', status: 'low_or_empty' },
      { label: '零库存', value: summary.zero_stock_unarchived_count, tone: 'danger', status: 'empty' }
    ];
    document.getElementById('mobile-summary-cards').innerHTML = summaryCards.map((item) => `
      <article class="mobile-summary-card ${item.tone}" onclick="mobileApp.openInventoryByStatus('${item.status}')">
        <span>${item.label}</span>
        <strong>${item.value}</strong>
      </article>
    `).join('');

    if (!warnings.length) {
      this.showEmpty('mobile-warning-list', '当前没有需要优先处理的试剂');
    } else {
      document.getElementById('mobile-warning-list').innerHTML = warnings.map((item) => `
        <article class="mobile-warning-card ${item.status_level}" onclick="mobileApp.openInventoryFocus(${item.reagent_id})">
          <div class="mobile-card-head">
            <div>
              <div class="mobile-card-title">${this.escapeHtml(item.reagent_name)}</div>
              <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
            </div>
            <span class="mobile-status mobile-status-${item.status_level}">${this.getStatusLabel(item.status_level)}</span>
          </div>
          <div class="mobile-card-metrics">
            <span>库存 ${item.total_min_quantity}${this.escapeHtml(item.min_unit || '')}</span>
            <span>${item.nearest_expiry_date ? `最近效期 ${this.escapeHtml(item.nearest_expiry_date)}` : '最近效期 -'}</span>
            <span>${this.escapeHtml(this.formatDays(item.nearest_expiry_days))}</span>
          </div>
        </article>
      `).join('');
    }

    const rows = this.overview.recent_outbounds || [];
    if (!rows.length) {
      this.showEmpty('mobile-recent-list', '暂无最近出库记录');
    } else {
      document.getElementById('mobile-recent-list').innerHTML = rows.map((item) => `
        <article class="mobile-recent-card">
          <div class="mobile-card-head">
            <div class="mobile-card-title">${this.escapeHtml(item.reagent_name)}</div>
            <div class="mobile-card-meta">${this.escapeHtml(Utils.formatDateTime(item.created_at))}</div>
          </div>
          <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)} · ${this.escapeHtml(item.operator)}</div>
          <div class="mobile-card-metrics">
            <span>批号 ${this.escapeHtml(item.batch_no || '-')}</span>
            <span>${item.quantity_min}${this.escapeHtml(item.min_unit || '')}</span>
          </div>
        </article>
      `).join('');
    }
  },

  async searchOutboundReagents(keyword) {
    if (!keyword) {
      this.outboundResults = [];
      this.showEmpty('mobile-outbound-results', '输入试剂名称后开始搜索');
      return;
    }
    try {
      this.outboundResults = await API.outbound.searchReagents({ q: keyword });
      this.renderOutboundResults();
    } catch (error) {
      Utils.showToast(`试剂搜索失败：${error.message}`, 'error');
    }
  },

  renderOutboundResults() {
    const container = document.getElementById('mobile-outbound-results');
    if (!this.outboundResults.length) {
      container.innerHTML = '<div class="mobile-empty">没有找到匹配的试剂</div>';
      return;
    }
    container.innerHTML = this.outboundResults.map((item) => {
      const status = this.getMobileSearchStatus(item);
      return `
        <article class="mobile-result-card ${status}" onclick="mobileApp.openOutboundSheet(${item.reagent_id})">
          <div class="mobile-card-head">
            <div>
              <div class="mobile-card-title">${this.escapeHtml(item.reagent_name)}</div>
              <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
            </div>
            <span class="mobile-status mobile-status-${status}">${this.getStatusLabel(status)}</span>
          </div>
          <div class="mobile-card-metrics">
            <span>库存 ${item.total_min_quantity}${this.escapeHtml(item.min_unit)}</span>
            <span>${item.nearest_expiry_date ? `最近效期 ${this.escapeHtml(item.nearest_expiry_date)}` : '最近效期 -'}</span>
            <span>批次数 ${item.batch_count}</span>
          </div>
        </article>
      `;
    }).join('');
  },

  getMobileSearchStatus(item) {
    if (item.total_min_quantity <= 0) return 'empty';
    if (item.contains_expired) return 'expired';
    const days = item.nearest_expiry_date ? Utils.getDaysUntilExpiry(item.nearest_expiry_date) : null;
    if (days !== null && days <= 30) return 'expiring';
    return 'normal';
  },
  async openOutboundSheet(reagentId) {
    const reagent = this.outboundResults.find((item) => item.reagent_id === reagentId) || this.inboundResults.find((item) => item.reagent_id === reagentId);
    if (!reagent) return;
    try {
      const batches = await API.outbound.getStock(reagentId);
      const availableBatches = batches.filter((item) => item.available_min_quantity > 0);
      if (!availableBatches.length) {
        Utils.showToast('当前试剂没有可用库存批号', 'warning');
        return;
      }
      this.selectedOutboundReagent = { ...reagent, batches: availableBatches };
      const preferredBatch = availableBatches.find((item) => !item.is_expired) || availableBatches[0];
      this.selectedOutboundBatchId = preferredBatch.id;
      document.getElementById('mobile-outbound-selected-meta').textContent = `${reagent.work_group_name} / ${reagent.instrument_name} · 默认推荐最早有效批号`;
      document.getElementById('mobile-outbound-quantity').value = '1';
      document.getElementById('mobile-outbound-unit').innerHTML = `
        <option value="min">${this.escapeHtml(reagent.min_unit)}</option>
        <option value="package">${this.escapeHtml(reagent.package_unit)}</option>
      `;
      await Utils.populateOperatorSelect('mobile-outbound-operator', { allowEmpty: false, defaultValue: Utils.getLastOperator() });
      this.renderOutboundBatches();
      document.getElementById('mobile-outbound-sheet').classList.remove('hidden');
      await this.refreshOutboundPreview();
    } catch (error) {
      Utils.showToast(`加载批号失败：${error.message}`, 'error');
    }
  },

  renderOutboundBatches() {
    const container = document.getElementById('mobile-outbound-batches');
    if (!this.selectedOutboundReagent) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = this.selectedOutboundReagent.batches.map((batch) => `
      <label class="mobile-batch-card ${batch.id === this.selectedOutboundBatchId ? 'active' : ''}">
        <input type="radio" name="mobile-outbound-batch" ${batch.id === this.selectedOutboundBatchId ? 'checked' : ''} onchange="mobileApp.selectOutboundBatch(${batch.id})">
        <div class="mobile-outbound-batch-main">
          <div class="mobile-outbound-batch-top">
            <div class="mobile-card-title">${this.escapeHtml(batch.batch_no)}</div>
            <span class="mobile-outbound-batch-stock">库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}</span>
          </div>
          <div class="mobile-card-meta">有效期 ${this.escapeHtml(batch.expiry_date)} · ${this.escapeHtml(this.formatDays(Utils.getDaysUntilExpiry(batch.expiry_date)))}</div>
        </div>
      </label>
    `).join('');
  },

  selectOutboundBatch(batchId) {
    this.selectedOutboundBatchId = batchId;
    this.renderOutboundBatches();
    this.refreshOutboundPreview();
  },

  async refreshOutboundPreview() {
    if (!this.selectedOutboundReagent || !this.selectedOutboundBatchId) return;
    const selectedBatch = this.selectedOutboundReagent.batches.find((item) => item.id === this.selectedOutboundBatchId);
    if (!selectedBatch) return;
    try {
      const quantity = this.normalizePositiveInteger(document.getElementById('mobile-outbound-quantity').value, 1);
      const outboundUnit = document.getElementById('mobile-outbound-unit').value || 'min';
      const preview = await API.outbound.preview({
        source: 'manual',
        reagent_id: this.selectedOutboundReagent.reagent_id,
        quantity,
        outbound_unit: outboundUnit,
        deduction_mode: 'scanned_batch',
        raw_barcode: `MOBILE::OUTBOUND::${this.selectedOutboundReagent.reagent_id}`,
        scanned_batch_no: selectedBatch.batch_no,
        scanned_expiry_date: selectedBatch.expiry_date
      });
      const previewEl = document.getElementById('mobile-outbound-preview');
      previewEl.classList.remove('hidden');
      previewEl.innerHTML = `
        <div><strong>${this.escapeHtml(preview.reagent_name)}</strong></div>
        <div>批号 ${this.escapeHtml(selectedBatch.batch_no)} · ${this.escapeHtml(selectedBatch.expiry_date)}</div>
        <div>出库 ${preview.requested_quantity}${this.escapeHtml(outboundUnit === 'package' ? preview.package_unit : preview.min_unit)}</div>
        <div>折合最小单位 ${preview.requested_min_quantity}${this.escapeHtml(preview.min_unit)}</div>
      `;
    } catch (error) {
      const previewEl = document.getElementById('mobile-outbound-preview');
      previewEl.classList.remove('hidden');
      previewEl.innerHTML = `<div>${this.escapeHtml(error.message)}</div>`;
    }
  },

  closeOutboundSheet() {
    document.getElementById('mobile-outbound-sheet').classList.add('hidden');
    document.getElementById('mobile-outbound-preview').classList.add('hidden');
    document.getElementById('mobile-outbound-preview').innerHTML = '';
    this.selectedOutboundReagent = null;
    this.selectedOutboundBatchId = null;
    this.isSubmittingOutbound = false;
  },

  async submitOutbound() {
    if (this.isSubmittingOutbound || !this.selectedOutboundReagent || !this.selectedOutboundBatchId) return;
    const batch = this.selectedOutboundReagent.batches.find((item) => item.id === this.selectedOutboundBatchId);
    const operator = Utils.getValidOperator(document.getElementById('mobile-outbound-operator').value);
    if (!batch || !operator) {
      Utils.showToast('请选择批号和操作人', 'warning');
      return;
    }
    this.isSubmittingOutbound = true;
    const submitButton = document.getElementById('mobile-outbound-submit');
    submitButton.disabled = true;
    submitButton.textContent = '提交中...';
    try {
      const quantity = this.normalizePositiveInteger(document.getElementById('mobile-outbound-quantity').value, 1);
      const outboundUnit = document.getElementById('mobile-outbound-unit').value || 'min';
      await API.outbound.stockOutBatch({
        operator,
        items: [{
          source: 'manual', reagent_id: this.selectedOutboundReagent.reagent_id, quantity, outbound_unit: outboundUnit,
          deduction_mode: 'scanned_batch', raw_barcode: `MOBILE::OUTBOUND::${this.selectedOutboundReagent.reagent_id}`,
          scanned_batch_no: batch.batch_no, scanned_expiry_date: batch.expiry_date
        }]
      });
      Utils.saveLastOperator(operator);
      Utils.showToast('出库成功', 'success');
      this.closeOutboundSheet();
      await Promise.all([this.refreshOverview(), this.loadInventory()]);
      const keyword = document.getElementById('mobile-outbound-search').value.trim();
      if (keyword) await this.searchOutboundReagents(keyword);
    } catch (error) {
      Utils.showToast(`出库失败：${error.message}`, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = '正式出库';
      this.isSubmittingOutbound = false;
    }
  },
  async searchInboundReagents(keyword) {
    if (!keyword) {
      this.inboundResults = [];
      document.getElementById('mobile-inbound-results')?.classList.remove('hidden');
      document.getElementById('mobile-inbound-form-panel')?.classList.add('hidden');
      this.showEmpty('mobile-inbound-results', '输入试剂名称后开始搜索');
      return;
    }
    try {
      const reagents = await API.reagents.list({ keyword, status: 'active' });
      this.inboundResults = reagents.map((item) => ({
        reagent_id: item.id,
        reagent_name: item.name,
        instrument_id: item.instrument_id,
        instrument_name: item.instrument_name,
        work_group_id: item.work_group_id,
        work_group_name: item.work_group_name,
        package_unit: item.package_unit,
        min_unit: item.unit,
        package_to_min_qty: item.package_to_min_qty,
        manufacturer: item.manufacturer || ''
      }));
      document.getElementById('mobile-inbound-results')?.classList.remove('hidden');
      this.renderInboundResults();
    } catch (error) {
      Utils.showToast(`试剂搜索失败：${error.message}`, 'error');
    }
  },

  renderInboundResults() {
    const container = document.getElementById('mobile-inbound-results');
    if (!this.inboundResults.length) {
      container.innerHTML = '<div class="mobile-empty">没有找到匹配的试剂</div>';
      return;
    }
    container.innerHTML = this.inboundResults.map((item) => `
      <article class="mobile-result-card" onclick="mobileApp.selectInboundReagent(${item.reagent_id})">
        <div class="mobile-card-title">${this.escapeHtml(item.reagent_name)}</div>
        <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
        <div class="mobile-card-metrics">
          <span>包装 ${this.escapeHtml(item.package_unit)}</span>
          <span>最小单位 ${this.escapeHtml(item.min_unit)}</span>
          <span>换算 1${this.escapeHtml(item.package_unit)} = ${item.package_to_min_qty}${this.escapeHtml(item.min_unit)}</span>
        </div>
      </article>
    `).join('');
  },

  async selectInboundReagent(reagentId) {
    const reagent = this.inboundResults.find((item) => item.reagent_id === reagentId);
    if (!reagent) return;
    this.selectedInboundReagent = reagent;
    this.selectedInboundBatchNo = '';
    document.getElementById('mobile-inbound-form-panel').classList.remove('hidden');
    document.getElementById('mobile-inbound-results')?.classList.add('hidden');
    document.getElementById('mobile-inbound-selected-meta').textContent = `${reagent.reagent_name} · ${reagent.work_group_name} / ${reagent.instrument_name}`;
    document.getElementById('mobile-inbound-batch-no').value = '';
    document.getElementById('mobile-inbound-expiry-date').value = '';
    document.getElementById('mobile-inbound-quantity').value = '1';
    document.getElementById('mobile-inbound-unit').innerHTML = `
      <option value="package">${this.escapeHtml(reagent.package_unit)}</option>
      <option value="min">${this.escapeHtml(reagent.min_unit)}</option>
    `;
    document.getElementById('mobile-inbound-unit').value = 'package';
    document.getElementById('mobile-inbound-relation').textContent = `包装关系：1${reagent.package_unit} = ${reagent.package_to_min_qty}${reagent.min_unit}`;
    await Utils.populateOperatorSelect('mobile-inbound-operator', { allowEmpty: false, defaultValue: Utils.getLastOperator() });

    const inventoryReagent = this.getInventoryReagentById(reagentId);
    if (inventoryReagent?.batches?.length) {
      this.inboundBatchSuggestions = [...inventoryReagent.batches]
        .sort((left, right) => {
          const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
          const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
          return rightTime - leftTime;
        })
        .slice(0, 8);
    } else {
      try {
        const batches = await API.outbound.getStock(`${reagentId}?include_zero_stock=true`);
        this.inboundBatchSuggestions = batches.slice(0, 8);
      } catch (error) {
        this.inboundBatchSuggestions = [];
      }
    }
    this.renderInboundBatchSuggestions();
  },

  resetInboundSelection() {
    this.selectedInboundReagent = null;
    this.selectedInboundBatchNo = '';
    this.inboundBatchSuggestions = [];
    document.getElementById('mobile-inbound-form-panel')?.classList.add('hidden');
    document.getElementById('mobile-inbound-results')?.classList.remove('hidden');
    document.getElementById('mobile-inbound-batch-suggestions').innerHTML = '';
  },

  renderInboundBatchSuggestions() {
    const container = document.getElementById('mobile-inbound-batch-suggestions');
    if (!this.inboundBatchSuggestions.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = this.inboundBatchSuggestions.map((batch) => `
      <button class="mobile-batch-card ${batch.batch_no === this.selectedInboundBatchNo ? 'active' : ''}" type="button" data-batch-no="${this.escapeHtml(batch.batch_no)}">
        <div>
          <div class="mobile-card-title">${this.escapeHtml(batch.batch_no)}</div>
          <div class="mobile-card-meta">有效期 ${this.escapeHtml(batch.expiry_date || '-')} · ${this.escapeHtml(this.formatDays(batch.expiry_days_left))} · 库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}</div>
        </div>
      </button>
    `).join('');
  },

  selectInboundBatch(batchNo) {
    this.selectedInboundBatchNo = batchNo;
    const batchInput = document.getElementById('mobile-inbound-batch-no');
    if (batchInput) batchInput.value = batchNo;
    this.syncInboundBatchDetails(true);
  },

  syncInboundBatchDetails(forceReplace) {
    const batchInput = document.getElementById('mobile-inbound-batch-no');
    const expiryInput = document.getElementById('mobile-inbound-expiry-date');
    const batchNo = batchInput?.value.trim() || '';
    this.selectedInboundBatchNo = batchNo;
    if (!batchNo) {
      if (forceReplace && expiryInput) expiryInput.value = '';
      this.renderInboundBatchSuggestions();
      return;
    }
    const matchedBatch = this.inboundBatchSuggestions.find((batch) => batch.batch_no === batchNo);
    if (matchedBatch && expiryInput && matchedBatch.expiry_date && (forceReplace || !expiryInput.value)) {
      expiryInput.value = matchedBatch.expiry_date;
    }
    this.renderInboundBatchSuggestions();
  },

  async submitInbound() {
    if (this.isSubmittingInbound || !this.selectedInboundReagent) return;
    const batchNo = document.getElementById('mobile-inbound-batch-no').value.trim();
    const expiryDate = document.getElementById('mobile-inbound-expiry-date').value;
    const quantity = this.normalizePositiveInteger(document.getElementById('mobile-inbound-quantity').value, 1);
    const inboundUnit = document.getElementById('mobile-inbound-unit').value || 'package';
    const operator = Utils.getValidOperator(document.getElementById('mobile-inbound-operator').value);
    if (!batchNo || !expiryDate || !operator) {
      Utils.showToast('请填写批号、有效期和操作人', 'warning');
      return;
    }
    const ratio = Math.max(parseInt(this.selectedInboundReagent.package_to_min_qty, 10) || 1, 1);
    let submitQuantity = quantity;
    if (inboundUnit === 'min') {
      if (quantity % ratio !== 0) {
        Utils.showToast(`按最小单位入库时，数量需要是 ${ratio} 的整数倍`, 'warning');
        return;
      }
      submitQuantity = quantity / ratio;
    }
    this.isSubmittingInbound = true;
    const submitButton = document.getElementById('mobile-inbound-submit');
    submitButton.disabled = true;
    submitButton.textContent = '提交中...';
    try {
      await API.inbound.stockInBatch({
        operator,
        items: [{
          source: 'manual',
          reagent_id: this.selectedInboundReagent.reagent_id,
          reagent_name: this.selectedInboundReagent.reagent_name,
          batch_no: batchNo,
          expiry_date: expiryDate,
          quantity: submitQuantity,
          package_unit: this.selectedInboundReagent.package_unit,
          min_unit: this.selectedInboundReagent.min_unit,
          package_to_min_qty: this.selectedInboundReagent.package_to_min_qty,
          raw_barcode: `MOBILE::INBOUND::${this.selectedInboundReagent.reagent_id}`
        }]
      });
      Utils.saveLastOperator(operator);
      Utils.showToast('入库成功', 'success');
      document.getElementById('mobile-inbound-batch-no').value = '';
      document.getElementById('mobile-inbound-expiry-date').value = '';
      document.getElementById('mobile-inbound-quantity').value = '1';
      document.getElementById('mobile-inbound-unit').value = 'package';
      this.selectedInboundBatchNo = '';
      this.renderInboundBatchSuggestions();
      await Promise.all([this.refreshOverview(), this.loadInventory()]);
    } catch (error) {
      Utils.showToast(`入库失败：${error.message}`, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = '确认入库';
      this.isSubmittingInbound = false;
    }
  },

  async searchCalibrationReagents(keyword) {
    if (!keyword) {
      this.calibrationResults = [];
      this.showEmpty('mobile-calibration-results', '输入试剂名称后开始搜索');
      return;
    }
    try {
      const reagents = await API.reagents.list({ keyword, status: 'active' });
      this.calibrationResults = reagents
        .filter((item) => !item.is_calibrator)
        .map((item) => ({
          reagent_id: item.id,
          reagent_name: item.name,
          instrument_id: item.instrument_id,
          instrument_name: item.instrument_name,
          work_group_id: item.work_group_id,
          work_group_name: item.work_group_name,
          manufacturer: item.manufacturer || '',
          result_unit: item.calibration_result_unit || 'nmmol/L',
          min_unit: item.unit,
          package_unit: item.package_unit
        }));
      this.renderCalibrationResults();
    } catch (error) {
      Utils.showToast(`校准试剂搜索失败：${error.message}`, 'error');
    }
  },

  renderCalibrationResults() {
    const container = document.getElementById('mobile-calibration-results');
    if (!this.calibrationResults.length) {
      container.innerHTML = '<div class="mobile-empty">没有找到可校准的试剂</div>';
      return;
    }
    container.innerHTML = this.calibrationResults.map((item) => `
      <article class="mobile-result-card" onclick="mobileApp.openCalibrationForReagent(${item.reagent_id})">
        <div class="mobile-card-title">${this.escapeHtml(item.reagent_name)}</div>
        <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
        <div class="mobile-card-metrics">
          <span>结果单位 ${this.escapeHtml(item.result_unit)}</span>
          <span>最小单位 ${this.escapeHtml(item.min_unit || '-')}</span>
          <span>${this.escapeHtml(item.manufacturer || '未填厂家')}</span>
        </div>
      </article>
    `).join('');
  },

  async openCalibrationForReagent(reagentId) {
    try {
      const preview = await API.calibration.mobilePreview(reagentId);
      await this.openCalibrationSheet(preview, 'create');
    } catch (error) {
      Utils.showToast(`校准预览失败：${error.message}`, 'error');
    }
  },

  async loadCalibrationRecords() {
    try {
      this.calibrationRecords = await API.calibration.listRecords({ limit: 10 });
      this.renderCalibrationRecords();
    } catch (error) {
      this.showEmpty('mobile-calibration-records', `校准记录加载失败：${error.message}`);
    }
  },

  renderCalibrationRecords() {
    const container = document.getElementById('mobile-calibration-records');
    if (!this.calibrationRecords.length) {
      this.showEmpty('mobile-calibration-records', '暂无校准记录');
      return;
    }
    container.innerHTML = this.calibrationRecords.map((record) => `
      <article class="mobile-recent-card" onclick="mobileApp.openCalibrationRecord(${record.id})">
        <div class="mobile-card-head">
          <div>
            <div class="mobile-card-title">${this.escapeHtml(record.target_reagent_name)}</div>
            <div class="mobile-card-meta">${this.escapeHtml(Utils.formatDateTime(record.created_at))} / ${this.escapeHtml(record.operator || '-')}</div>
          </div>
          <span class="mobile-status mobile-status-normal">${record.calibration_source === 'reagent' ? '自带校准' : '校准品'}</span>
        </div>
        <div class="mobile-card-meta">来源 ${this.escapeHtml(record.calibrator_name)} · 批号 ${this.escapeHtml(record.calibrator_batch_no || '-')}</div>
        <div class="mobile-card-metrics">
          <span>旧批号 ${this.escapeHtml(record.target_old_batch_no || '未填')}</span>
          <span>新批号 ${this.escapeHtml(record.target_new_batch_no || '未填')}</span>
          <span>用量 ${record.usage_times}${this.escapeHtml(record.result_unit ? ` / ${record.result_unit}` : '')}</span>
        </div>
      </article>
    `).join('');
  },

  async openCalibrationRecord(recordId) {
    try {
      const record = await API.calibration.getRecord(recordId);
      await this.openCalibrationSheet(record, 'edit');
    } catch (error) {
      Utils.showToast(`校准记录打开失败：${error.message}`, 'error');
    }
  },

  async openCalibrationSheet(data, mode = 'create') {
    this.calibrationMode = mode;
    this.selectedCalibrationPreview = data;
    this.selectedCalibrationRecordId = mode === 'edit' ? data.id : null;
    document.getElementById('mobile-calibration-sheet-title').textContent = mode === 'edit' ? '补录校准记录' : '本次校准';
    document.getElementById('mobile-calibration-selected-meta').textContent =
      `${data.target_reagent_name || ''} · ${data.calibration_source === 'reagent' ? '试剂自带校准' : '独立校准品'}`;
    this.renderCalibrationSource(data);
    this.populateCalibrationTargetSelect(data);
    this.populateCalibrationBatchSelect('mobile-calibration-old-batch', data.old_batch_candidates || [], data.target_old_batch_no || data.default_old_batch_no);
    this.populateCalibrationBatchSelect('mobile-calibration-new-batch', data.new_batch_candidates || [], data.target_new_batch_no || data.default_new_batch_no);
    document.getElementById('mobile-calibration-result-unit').value = data.result_unit || 'nmmol/L';
    this.syncCalibrationResultUnitNotes(data.result_unit || 'nmmol/L');
    document.getElementById('mobile-calibration-usage-times').value = String(data.usage_times || data.default_usage_times || 1);
    this.fillCalibrationResults(data);
    document.getElementById('mobile-calibration-fallback-confirm')?.classList.add('hidden');
    document.getElementById('mobile-calibration-submit').classList.toggle('hidden', false);
    document.getElementById('mobile-calibration-submit').textContent = mode === 'edit' ? '保存校准记录' : '保存本次校准';
    await Utils.populateOperatorSelect('mobile-calibration-operator', {
      allowEmpty: false,
      defaultValue: data.operator || Utils.getLastOperator()
    });
    document.getElementById('mobile-calibration-sheet').classList.remove('hidden');
    requestAnimationFrame(() => document.getElementById('mobile-calibration-usage-times')?.focus());
  },

  renderCalibrationSource(data) {
    const card = document.getElementById('mobile-calibration-source-card');
    const sourceLabel = data.calibration_source === 'reagent' ? '试剂自带校准' : '独立校准品';
    card.innerHTML = `
      <div><strong>${this.escapeHtml(sourceLabel)}</strong></div>
      <div>来源 ${this.escapeHtml(data.calibrator_name || '-')}</div>
      <div>来源批号 ${this.escapeHtml(data.calibrator_batch_no || '-')} · 库存 ${data.calibrator_available_min_quantity ?? '-'}${this.escapeHtml(data.calibrator_min_unit || '')}</div>
    `;
  },

  populateCalibrationTargetSelect(data) {
    const select = document.getElementById('mobile-calibration-target');
    const options = data.target_options?.length ? data.target_options : [{
      reagent_id: data.target_reagent_id,
      reagent_name: data.target_reagent_name
    }];
    select.innerHTML = options.map((item) => `
      <option value="${item.reagent_id}" ${String(item.reagent_id) === String(data.target_reagent_id) ? 'selected' : ''}>${this.escapeHtml(item.reagent_name)}</option>
    `).join('');
    select.disabled = true;
  },

  populateCalibrationBatchSelect(selectId, candidates, selectedValue) {
    const select = document.getElementById(selectId);
    const normalizedSelected = selectedValue || '';
    const hasSelected = !normalizedSelected || candidates.some((item) => item.batch_no === normalizedSelected);
    select.innerHTML = [
      '<option value="">未填</option>',
      ...(!hasSelected ? [`<option value="${this.escapeHtml(normalizedSelected)}">${this.escapeHtml(normalizedSelected)}</option>`] : []),
      ...candidates.map((item) => `
        <option value="${this.escapeHtml(item.batch_no)}">${this.escapeHtml(item.batch_no)} · ${this.escapeHtml(item.expiry_date || '-')}</option>
      `)
    ].join('');
    select.value = normalizedSelected;
  },

  fillCalibrationResults(data) {
    for (let i = 1; i <= 5; i += 1) {
      document.getElementById(`mobile-calibration-old-result-${i}`).value = data[`old_result_${i}`] || '';
      document.getElementById(`mobile-calibration-new-result-${i}`).value = data[`new_result_${i}`] || '';
    }
  },

  syncCalibrationResultUnitNotes(unitValue) {
    const unit = String(unitValue ?? document.getElementById('mobile-calibration-result-unit')?.value ?? '').trim() || '-';
    const text = `录入单位：${unit}`;
    document.getElementById('mobile-calibration-old-result-unit-note').textContent = text;
    document.getElementById('mobile-calibration-new-result-unit-note').textContent = text;
  },

  handleCalibrationResultPaste(event) {
    const input = event.target.closest('.mobile-result-input');
    if (!input || input.dataset.resultIndex !== '1') return;
    const text = event.clipboardData?.getData('text') || '';
    const values = text.split(/[\s,;，；]+/).map((item) => item.trim()).filter(Boolean);
    if (values.length < 2) return;
    event.preventDefault();
    const group = input.dataset.resultGroup;
    values.slice(0, 5).forEach((value, index) => {
      const target = document.getElementById(`mobile-calibration-${group}-result-${index + 1}`);
      if (target) target.value = value;
    });
    document.getElementById(`mobile-calibration-${group}-result-${Math.min(values.length, 5)}`)?.focus();
  },

  handleCalibrationResultKeydown(event) {
    const input = event.target.closest('.mobile-result-input');
    if (!input || event.key !== 'Enter') return;
    event.preventDefault();
    this.focusNextCalibrationResult(input);
  },

  focusNextCalibrationResult(input) {
    const group = input.dataset.resultGroup;
    const index = parseInt(input.dataset.resultIndex, 10) || 1;
    const next =
      index < 5
        ? document.getElementById(`mobile-calibration-${group}-result-${index + 1}`)
        : group === 'old'
          ? document.getElementById('mobile-calibration-new-result-1')
          : document.getElementById('mobile-calibration-submit');
    next?.focus();
  },

  buildCalibrationPayload(autoOutboundPackage = false) {
    const payload = {
      calibrator_reagent_id: this.selectedCalibrationPreview.calibrator_reagent_id,
      calibrator_batch_stock_id: this.selectedCalibrationPreview.calibrator_batch_stock_id,
      target_reagent_id: parseInt(document.getElementById('mobile-calibration-target').value, 10),
      target_old_batch_no: document.getElementById('mobile-calibration-old-batch').value || null,
      target_new_batch_no: document.getElementById('mobile-calibration-new-batch').value || null,
      usage_times: this.normalizePositiveInteger(document.getElementById('mobile-calibration-usage-times').value, 1),
      result_unit: document.getElementById('mobile-calibration-result-unit').value || 'nmmol/L',
      operator: Utils.getValidOperator(document.getElementById('mobile-calibration-operator').value),
      raw_barcode: this.selectedCalibrationPreview.raw_barcode || `MOBILE::CALIBRATION::${this.selectedCalibrationPreview.target_reagent_id}`,
      auto_outbound_package: Boolean(autoOutboundPackage)
    };
    for (let i = 1; i <= 5; i += 1) {
      payload[`old_result_${i}`] = document.getElementById(`mobile-calibration-old-result-${i}`).value.trim() || null;
      payload[`new_result_${i}`] = document.getElementById(`mobile-calibration-new-result-${i}`).value.trim() || null;
    }
    return payload;
  },

  handleCalibrationSubmit() {
    if (!this.selectedCalibrationPreview) return;
    const payload = this.buildCalibrationPayload(false);
    if (!payload.target_reagent_id || !payload.operator) {
      Utils.showToast('请先确认被校准试剂和操作人', 'warning');
      return;
    }
    if (this.calibrationMode === 'create' && this.selectedCalibrationPreview.calibration_source === 'reagent') {
      document.getElementById('mobile-calibration-fallback-confirm')?.classList.remove('hidden');
      document.getElementById('mobile-calibration-submit')?.classList.add('hidden');
      return;
    }
    this.submitCalibration(false);
  },

  async submitCalibration(autoOutboundPackage = false) {
    if (this.isSubmittingCalibration || !this.selectedCalibrationPreview) return;
    const payload = this.buildCalibrationPayload(autoOutboundPackage);
    if (!payload.target_reagent_id || !payload.operator) {
      Utils.showToast('请先确认被校准试剂和操作人', 'warning');
      return;
    }
    this.isSubmittingCalibration = true;
    const submitButton = document.getElementById('mobile-calibration-submit');
    submitButton.disabled = true;
    submitButton.textContent = '提交中...';
    try {
      if (this.calibrationMode === 'edit') {
        await API.calibration.updateRecord(this.selectedCalibrationRecordId, payload);
        Utils.showToast('校准记录已更新', 'success');
      } else {
        await API.calibration.createRecord(payload);
        Utils.showToast(autoOutboundPackage ? '校准记录已保存，并已同步出库' : '校准记录已保存', 'success');
      }
      Utils.saveLastOperator(payload.operator);
      this.closeCalibrationSheet();
      await Promise.all([this.loadCalibrationRecords(), this.refreshOverview(), this.loadInventory()]);
      const keyword = document.getElementById('mobile-calibration-search')?.value.trim();
      if (keyword) await this.searchCalibrationReagents(keyword);
    } catch (error) {
      Utils.showToast(`校准保存失败：${error.message}`, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = this.calibrationMode === 'edit' ? '保存校准记录' : '保存本次校准';
      this.isSubmittingCalibration = false;
    }
  },

  closeCalibrationSheet() {
    document.getElementById('mobile-calibration-sheet')?.classList.add('hidden');
    document.getElementById('mobile-calibration-fallback-confirm')?.classList.add('hidden');
    document.getElementById('mobile-calibration-submit')?.classList.remove('hidden');
    this.selectedCalibrationPreview = null;
    this.selectedCalibrationRecordId = null;
    this.calibrationMode = 'create';
    this.isSubmittingCalibration = false;
  },

  async loadInventory() {
    try {
      this.inventoryData = await API.inventory.get();
      this.renderInventory();
    } catch (error) {
      this.showEmpty('mobile-inventory-list', `库存加载失败：${error.message}`);
    }
  },

  getFlattenedInventoryItems() {
    const items = [];
    this.inventoryData.forEach((group) => {
      (group.instruments || []).forEach((instrument) => {
        (instrument.reagents || []).forEach((reagent) => {
          items.push({ ...reagent, work_group_id: group.id, work_group_name: group.name, instrument_id: instrument.id, instrument_name: instrument.name });
        });
      });
    });
    return items;
  },

  getInventoryReagentById(reagentId) {
    return this.getFlattenedInventoryItems().find((item) => Number(item.id) === Number(reagentId)) || null;
  },

  matchesInventoryFilter(item) {
    const keyword = this.inventoryFilters.keyword.toLowerCase();
    if (keyword && !item.name.toLowerCase().includes(keyword)) return false;
    const status = this.inventoryFilters.status;
    if (status === 'low_or_empty') {
      if (!['low', 'empty'].includes(item.status_level)) return false;
    } else if (status !== 'all' && item.status_level !== status) {
      return false;
    }
    if (this.inventoryFilters.onlyWarnings && item.status_level === 'normal') return false;
    return true;
  },

  renderInventory() {
    const container = document.getElementById('mobile-inventory-list');
    const items = this.getFlattenedInventoryItems()
      .filter((item) => this.matchesInventoryFilter(item))
      .sort((left, right) => {
        const priority = { empty: 0, expired: 1, expiring: 2, low: 3, normal: 4 };
        return (priority[left.status_level] ?? 99) - (priority[right.status_level] ?? 99)
          || (left.nearest_expiry_days ?? 10 ** 9) - (right.nearest_expiry_days ?? 10 ** 9)
          || left.name.localeCompare(right.name, 'zh-CN');
      });
    if (!items.length) {
      container.innerHTML = '<div class="mobile-empty">当前没有符合条件的库存</div>';
      return;
    }
    container.innerHTML = items.map((item) => `
      <article class="mobile-stock-card ${item.status_level}" data-reagent-id="${item.id}" onclick="mobileApp.toggleInventoryCard(${item.id})">
        <div class="mobile-card-head">
          <div>
            <div class="mobile-card-title">${this.escapeHtml(item.name)}</div>
            <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
          </div>
          <span class="mobile-status mobile-status-${item.status_level}">${this.getStatusLabel(item.status_level)}</span>
        </div>
        <div class="mobile-card-metrics">
          <span>库存 ${item.total_min_quantity}${this.escapeHtml(item.unit)}</span>
          <span>${item.nearest_expiry_date ? `最近效期 ${this.escapeHtml(item.nearest_expiry_date)}` : '最近效期 -'}</span>
          <span>${this.escapeHtml(this.formatDays(item.nearest_expiry_days))}</span>
        </div>
        ${this.expandedInventoryIds.has(item.id) ? `<div class="mobile-stock-batches">${(item.batches || []).map((batch) => `
          <div class="mobile-batch-detail ${batch.is_expired ? 'expired' : batch.available_min_quantity <= 0 ? 'empty' : item.status_level === 'expiring' || item.status_level === 'low' ? 'warning' : ''}">
            <div>批号 ${this.escapeHtml(batch.batch_no)}</div>
            <div>有效期 ${this.escapeHtml(batch.expiry_date)} · ${this.escapeHtml(this.formatDays(batch.expiry_days_left))}</div>
            <div>库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}</div>
          </div>`).join('')}</div>` : ''}
      </article>
    `).join('');
  },

  toggleInventoryCard(reagentId) {
    if (this.expandedInventoryIds.has(reagentId)) this.expandedInventoryIds.delete(reagentId);
    else this.expandedInventoryIds.add(reagentId);
    this.renderInventory();
  },

  openInventoryFocus(reagentId) {
    this.switchPage('inventory');
    this.expandedInventoryIds.add(reagentId);
    this.renderInventory();
    requestAnimationFrame(() => {
      document.querySelector(`.mobile-stock-card[data-reagent-id="${reagentId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  },

  openInventoryByStatus(status) {
    this.switchPage('inventory');
    this.inventoryFilters.keyword = '';
    this.inventoryFilters.onlyWarnings = false;
    document.getElementById('mobile-inventory-search').value = '';
    document.getElementById('mobile-inventory-only-warnings').checked = false;
    document.getElementById('mobile-inventory-status').value = status;
    this.inventoryFilters.status = status;
    this.renderInventory();
    const firstCard = document.querySelector('.mobile-stock-card');
    if (!firstCard) return;
    const reagentId = Number(firstCard.dataset.reagentId || 0);
    if (!reagentId) return;
    this.expandedInventoryIds.add(reagentId);
    this.renderInventory();
    requestAnimationFrame(() => {
      document.querySelector(`.mobile-stock-card[data-reagent-id="${reagentId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
};

window.mobileApp = mobileApp;

document.addEventListener('DOMContentLoaded', () => {
  mobileApp.init();
});
