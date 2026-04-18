const mobileApp = {
  currentPage: 'outbound',
  instrumentContextId: null,
  instrumentContextName: '',
  instrumentModeActive: false,
  overview: null,
  inventoryData: [],
  outboundResults: [],
  inboundResults: [],
  calibrationResults: [],
  defaultOutboundResults: [],
  defaultInboundResults: [],
  defaultCalibrationResults: [],
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
    this.parseInstrumentContext();
    this.bindEvents();
    this.renderInstrumentModeBanner();
    this.renderSearchDefaults();
    await Utils.loadOperators();
    await Promise.all([this.populateOperatorSelects(), this.refreshData()]);
    this.switchPage('outbound');
  },

  parseInstrumentContext() {
    const params = new URLSearchParams(window.location.search);
    const instrumentId = Number(params.get('instrument_id') || '');
    if (Number.isFinite(instrumentId) && instrumentId > 0) {
      this.instrumentContextId = instrumentId;
      this.instrumentModeActive = true;
      this.currentPage = 'outbound';
    }
  },

  bindEvents() {
    document.querySelectorAll('.mobile-tab').forEach((button) => {
      button.addEventListener('click', () => this.switchPage(button.dataset.page));
    });
    document.getElementById('mobile-instrument-toggle')?.addEventListener('click', () => this.toggleInstrumentMode());
    document.getElementById('mobile-refresh-btn')?.addEventListener('click', async () => {
      await this.refreshData();
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

  getActiveInstrumentId() {
    return this.instrumentContextId && this.instrumentModeActive ? this.instrumentContextId : null;
  },

  getInstrumentLabel() {
    return this.instrumentContextName || (this.instrumentContextId ? `仪器 #${this.instrumentContextId}` : '');
  },

  setInstrumentContextName(name) {
    const normalized = String(name || '').trim();
    if (normalized) {
      this.instrumentContextName = normalized;
    }
  },

  getPreferredOperator() {
    if (this.instrumentContextId) {
      return Utils.getLastOperatorForInstrument(this.instrumentContextId) || Utils.getLastOperator();
    }
    return Utils.getLastOperator();
  },

  rememberOperator(operator) {
    if (this.instrumentContextId) {
      Utils.saveLastOperatorForInstrument(this.instrumentContextId, operator);
      return;
    }
    Utils.saveLastOperator(operator);
  },

  async populateOperatorSelects() {
    const defaultValue = this.getPreferredOperator();
    await Promise.all([
      Utils.populateOperatorSelect('mobile-outbound-operator', { allowEmpty: false, defaultValue }),
      Utils.populateOperatorSelect('mobile-inbound-operator', { allowEmpty: false, defaultValue }),
      Utils.populateOperatorSelect('mobile-calibration-operator', { allowEmpty: false, defaultValue })
    ]);
  },

  renderInstrumentModeBanner() {
    const bar = document.getElementById('mobile-instrument-mode');
    const title = document.getElementById('mobile-instrument-title');
    const note = document.getElementById('mobile-instrument-note');
    const toggle = document.getElementById('mobile-instrument-toggle');
    if (!bar || !title || !note || !toggle) return;

    if (!this.instrumentContextId) {
      bar.classList.add('hidden');
      return;
    }

    const label = this.getInstrumentLabel();
    bar.classList.remove('hidden');
    if (this.instrumentModeActive) {
      title.textContent = `当前仪器：${label}`;
      note.textContent = '默认只展示该仪器的出库、入库、校准和库存信息。';
      toggle.textContent = '查看全部';
    } else {
      title.textContent = '已切换到全部仪器';
      note.textContent = `仍保留 ${label} 的扫码上下文，可随时切回。`;
      toggle.textContent = `回到 ${label}`;
    }
  },

  async toggleInstrumentMode() {
    if (!this.instrumentContextId) return;
    this.instrumentModeActive = !this.instrumentModeActive;
    this.renderInstrumentModeBanner();
    await this.populateOperatorSelects();
    await this.refreshData();
  },

  switchPage(page) {
    this.currentPage = page;
    document.querySelectorAll('.mobile-page').forEach((section) => section.classList.toggle('active', section.id === `mobile-page-${page}`));
    document.querySelectorAll('.mobile-tab').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
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

  getStatusTone(status) {
    if (status === 'empty' || status === 'expired') return 'danger';
    if (status === 'expiring' || status === 'low') return 'warning';
    if (status === 'normal') return 'success';
    return 'neutral';
  },

  getStockTone(quantity, warningStock = 0) {
    const numericQuantity = Number(quantity ?? 0);
    const numericWarningStock = Number(warningStock ?? 0);
    if (numericQuantity <= 0) return 'danger';
    if (numericQuantity <= numericWarningStock) return 'warning';
    return 'success';
  },

  getReagentStockTone(item) {
    return this.getStockTone(item?.total_min_quantity, item?.warning_stock);
  },

  getExpiryTone(days, warningDays = 30) {
    if (days === null || days === undefined) return 'neutral';
    if (days < 0) return 'danger';
    if (days <= warningDays) return 'warning';
    return 'success';
  },

  getBatchStockTone(batch) {
    return Number(batch?.available_min_quantity || 0) <= 0 ? 'danger' : 'success';
  },

  getBatchExpiryTone(batch, warningDays = 30) {
    const days = batch?.expiry_days_left;
    return this.getExpiryTone(days, warningDays);
  },

  getBatchCardTone(batch, warningDays = 30) {
    if (batch?.is_expired || Number(batch?.available_min_quantity || 0) <= 0) return 'danger';
    return this.getBatchExpiryTone(batch, warningDays);
  },

  getBatchDetailTone(batch, warningDays = 30) {
    if (batch?.is_expired || Number(batch?.available_min_quantity || 0) <= 0) return 'danger';
    if (this.getBatchExpiryTone(batch, warningDays) === 'warning') return 'warning';
    return 'neutral';
  },

  renderMetricChip(content, tone = 'neutral') {
    return `<span class="mobile-metric-chip mobile-metric-${tone}">${content}</span>`;
  },

  renderInlineTone(content, tone = 'neutral') {
    return `<span class="mobile-inline-tone mobile-inline-tone-${tone}">${content}</span>`;
  },

  renderInventoryMetric(label, value, tone = 'neutral') {
    return `
      <div class="mobile-inventory-metric">
        <span class="mobile-inventory-metric-label">${label}</span>
        <strong class="mobile-inventory-metric-value mobile-inventory-metric-value-${tone}">${value}</strong>
      </div>
    `;
  },

  renderPreviewLine(content, tone = 'neutral') {
    return `<div class="mobile-preview-line mobile-preview-line-${tone}">${content}</div>`;
  },

  mapReagentToInboundItem(item) {
    return {
      reagent_id: item.id,
      reagent_name: item.name,
      instrument_id: item.instrument_id,
      instrument_name: item.instrument_name,
      work_group_id: item.work_group_id,
      work_group_name: item.work_group_name,
      reagent_group_id: item.reagent_group_id,
      reagent_group_name: item.reagent_group_name,
      reagent_group_sort_order: item.reagent_group_sort_order,
      package_unit: item.package_unit,
      min_unit: item.unit,
      package_to_min_qty: item.package_to_min_qty,
      manufacturer: item.manufacturer || ''
    };
  },

  mapReagentToCalibrationItem(item) {
    return {
      reagent_id: item.id,
      reagent_name: item.name,
      instrument_id: item.instrument_id,
      instrument_name: item.instrument_name,
      work_group_id: item.work_group_id,
      work_group_name: item.work_group_name,
      reagent_group_id: item.reagent_group_id,
      reagent_group_name: item.reagent_group_name,
      reagent_group_sort_order: item.reagent_group_sort_order,
      manufacturer: item.manufacturer || '',
      result_unit: item.calibration_result_unit || 'nmmol/L',
      min_unit: item.unit,
      package_unit: item.package_unit
    };
  },

  groupQuickItems(items) {
    const groups = new Map();
    items.forEach((item) => {
      const key = item.reagent_group_name || '未分组';
      if (!groups.has(key)) {
        groups.set(key, {
          name: key,
          sortOrder: item.reagent_group_sort_order ?? 9999,
          items: []
        });
      }
      groups.get(key).items.push(item);
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((left, right) => left.reagent_name.localeCompare(right.reagent_name, 'zh-CN'))
      }))
      .sort((left, right) => (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999) || left.name.localeCompare(right.name, 'zh-CN'));
  },

  renderQuickSections(containerId, items, {
    emptyMessage,
    action,
    metaText,
    compact = false,
    hideMeta = false,
    showGroupCount = true,
  } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<div class="mobile-empty">${this.escapeHtml(emptyMessage)}</div>`;
      return;
    }

    container.innerHTML = this.groupQuickItems(items).map((group) => `
      <section class="mobile-quick-group">
        <div class="mobile-quick-group-head">
          <h3>${this.escapeHtml(group.name)}</h3>
          ${showGroupCount ? `<span>${group.items.length} 个试剂</span>` : ''}
        </div>
        <div class="mobile-quick-grid ${compact ? 'compact' : ''}">
          ${group.items.map((item) => `
            <button class="mobile-quick-button ${compact ? 'compact' : ''}" type="button" onclick="mobileApp.${action}(${item.reagent_id})">
              <strong>${this.escapeHtml(item.reagent_name)}</strong>
              ${hideMeta ? '' : `<span>${this.escapeHtml(metaText(item))}</span>`}
            </button>
          `).join('')}
        </div>
      </section>
    `).join('');
  },

  renderSearchDefaults() {
    const outboundKeyword = document.getElementById('mobile-outbound-search')?.value.trim() || '';
    const inboundKeyword = document.getElementById('mobile-inbound-search')?.value.trim() || '';
    const calibrationKeyword = document.getElementById('mobile-calibration-search')?.value.trim() || '';

    if (!outboundKeyword) {
      if (this.getActiveInstrumentId()) {
        this.renderQuickSections('mobile-outbound-results', this.defaultOutboundResults, {
          emptyMessage: '当前仪器暂无可出库试剂',
          action: 'openOutboundSheet',
          metaText: (item) => `库存 ${item.total_min_quantity}${item.min_unit || ''}`,
          compact: true,
          hideMeta: true,
          showGroupCount: false,
        });
      } else {
        this.showEmpty('mobile-outbound-results', '输入试剂名称后开始搜索');
      }
    }

    if (!this.selectedInboundReagent && !inboundKeyword) {
      const inboundResults = document.getElementById('mobile-inbound-results');
      inboundResults?.classList.remove('hidden');
      if (this.getActiveInstrumentId()) {
        this.renderQuickSections('mobile-inbound-results', this.defaultInboundResults, {
          emptyMessage: '当前仪器暂无可快速入库试剂',
          action: 'selectInboundReagent',
          metaText: (item) => `${item.package_unit} / ${item.min_unit}`,
          compact: true,
          hideMeta: true,
          showGroupCount: false,
        });
      } else {
        this.showEmpty('mobile-inbound-results', '输入试剂名称后开始搜索');
      }
    }

    if (!calibrationKeyword) {
      if (this.getActiveInstrumentId()) {
        this.renderQuickSections('mobile-calibration-results', this.defaultCalibrationResults, {
          emptyMessage: '当前仪器暂无可校准试剂',
          action: 'openCalibrationForReagent',
          metaText: (item) => `${item.result_unit} · ${item.instrument_name}`,
          compact: true,
          hideMeta: true,
          showGroupCount: false,
        });
      } else {
        this.showEmpty('mobile-calibration-results', '输入试剂名称后开始搜索');
      }
    }
  },

  async refreshData() {
    await Promise.all([
      this.refreshOverview(),
      this.loadInventory(),
      this.loadCalibrationRecords(),
      this.loadDefaultQuickLists()
    ]);
    this.renderInstrumentModeBanner();
    this.renderSearchDefaults();
  },

  async loadDefaultQuickLists() {
    if (!this.instrumentContextId) {
      this.defaultOutboundResults = [];
      this.defaultInboundResults = [];
      this.defaultCalibrationResults = [];
      return;
    }

    if (!this.instrumentModeActive) {
      this.defaultOutboundResults = [];
      this.defaultInboundResults = [];
      this.defaultCalibrationResults = [];
      return;
    }

    try {
      const [outboundItems, reagentItems] = await Promise.all([
        API.outbound.searchReagents({ instrument_id: this.instrumentContextId }),
        API.reagents.list({ instrument_id: this.instrumentContextId, status: 'active' })
      ]);
      this.defaultOutboundResults = outboundItems;
      this.defaultInboundResults = reagentItems.map((item) => this.mapReagentToInboundItem(item));
      this.defaultCalibrationResults = reagentItems
        .filter((item) => !item.is_calibrator)
        .map((item) => this.mapReagentToCalibrationItem(item));

      const instrumentName = outboundItems[0]?.instrument_name || reagentItems[0]?.instrument_name || '';
      this.setInstrumentContextName(instrumentName);
    } catch (error) {
      this.defaultOutboundResults = [];
      this.defaultInboundResults = [];
      this.defaultCalibrationResults = [];
      Utils.showToast(`仪器默认列表加载失败：${error.message}`, 'error');
    }
  },

  getOutboundReagentById(reagentId) {
    return [
      ...this.outboundResults,
      ...this.defaultOutboundResults,
      ...this.inboundResults,
      ...this.defaultInboundResults
    ].find((item) => Number(item.reagent_id) === Number(reagentId)) || null;
  },

  getInboundReagentById(reagentId) {
    return [...this.inboundResults, ...this.defaultInboundResults].find((item) => Number(item.reagent_id) === Number(reagentId)) || null;
  },

  showEmpty(containerId, message) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = `<div class="mobile-empty">${this.escapeHtml(message)}</div>`;
  },

  async refreshOverview() {
    try {
      const instrumentId = this.getActiveInstrumentId();
      this.overview = await API.mobile.overview(instrumentId ? { instrument_id: instrumentId } : {});
      this.renderOverview();
    } catch (error) {
      Utils.showToast(`手机首页加载失败：${error.message}`, 'error');
    }
  },

  renderOverview() {
    const summary = this.overview?.pending_tasks;
    const expiredCountEl = document.getElementById('mobile-summary-expired');
    const expiringCountEl = document.getElementById('mobile-summary-expiring');
    const lowCountEl = document.getElementById('mobile-summary-low');
    const emptyCountEl = document.getElementById('mobile-summary-empty');
    const expiredStatEl = document.getElementById('mobile-overview-stat-expired');
    const expiringStatEl = document.getElementById('mobile-overview-stat-expiring');
    const lowStatEl = document.getElementById('mobile-overview-stat-low');
    const emptyStatEl = document.getElementById('mobile-overview-stat-empty');
    if (!summary) {
      if (expiredCountEl) expiredCountEl.textContent = '0';
      if (expiringCountEl) expiringCountEl.textContent = '0';
      if (lowCountEl) lowCountEl.textContent = '0';
      if (emptyCountEl) emptyCountEl.textContent = '0';
      expiredStatEl?.classList.add('danger');
      expiringStatEl?.classList.add('warning');
      lowStatEl?.classList.add('warning');
      emptyStatEl?.classList.add('danger');
      this.showEmpty('mobile-recent-list', '暂无最近出库记录');
      return;
    }
    if (expiredCountEl) expiredCountEl.textContent = String(summary.expired_batch_count || 0);
    if (expiringCountEl) expiringCountEl.textContent = String(summary.expiring_reagent_count || 0);
    if (lowCountEl) lowCountEl.textContent = String(summary.low_or_empty_reagent_count || 0);
    if (emptyCountEl) emptyCountEl.textContent = String(summary.zero_stock_unarchived_count || 0);
    expiredStatEl?.classList.toggle('danger', (summary.expired_batch_count || 0) > 0);
    expiringStatEl?.classList.toggle('warning', (summary.expiring_reagent_count || 0) > 0);
    lowStatEl?.classList.toggle('warning', (summary.low_or_empty_reagent_count || 0) > 0);
    emptyStatEl?.classList.toggle('danger', (summary.zero_stock_unarchived_count || 0) > 0);

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
            ${this.renderMetricChip(`批号 ${this.escapeHtml(item.batch_no || '-')}`, 'neutral')}
            ${this.renderMetricChip(`${item.quantity_min}${this.escapeHtml(item.min_unit || '')}`, 'success')}
          </div>
        </article>
      `).join('');
    }
  },

  async searchOutboundReagents(keyword) {
    if (!keyword) {
      this.outboundResults = [];
      this.renderSearchDefaults();
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
            ${this.renderMetricChip(`库存 ${item.total_min_quantity}${this.escapeHtml(item.min_unit)}`, this.getReagentStockTone(item))}
            ${this.renderMetricChip(item.nearest_expiry_date ? `最近效期 ${this.escapeHtml(item.nearest_expiry_date)}` : '最近效期 -', this.getExpiryTone(item.nearest_expiry_date ? Utils.getDaysUntilExpiry(item.nearest_expiry_date) : null, 30))}
            ${this.renderMetricChip(`批次数 ${item.batch_count}`, item.batch_count > 0 ? 'success' : 'danger')}
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
    const reagent = this.getOutboundReagentById(reagentId);
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
      await Utils.populateOperatorSelect('mobile-outbound-operator', { allowEmpty: false, defaultValue: this.getPreferredOperator() });
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
      <label class="mobile-batch-card mobile-batch-card-${this.getBatchCardTone(batch, this.selectedOutboundReagent?.effective_warning_days || 30)} ${batch.id === this.selectedOutboundBatchId ? 'active' : ''}">
        <input type="radio" name="mobile-outbound-batch" ${batch.id === this.selectedOutboundBatchId ? 'checked' : ''} onchange="mobileApp.selectOutboundBatch(${batch.id})">
        <div class="mobile-outbound-batch-main">
          <div class="mobile-outbound-batch-top">
            <div class="mobile-card-title">${this.escapeHtml(batch.batch_no)}</div>
            <span class="mobile-outbound-batch-stock mobile-metric-chip mobile-metric-${this.getBatchStockTone(batch)}">库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}</span>
          </div>
          <div class="mobile-card-meta">有效期 ${this.escapeHtml(batch.expiry_date)} · ${this.renderInlineTone(this.escapeHtml(this.formatDays(Utils.getDaysUntilExpiry(batch.expiry_date))), this.getExpiryTone(Utils.getDaysUntilExpiry(batch.expiry_date), this.selectedOutboundReagent?.effective_warning_days || 30))}</div>
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
        ${this.renderPreviewLine(`<strong>${this.escapeHtml(preview.reagent_name)}</strong>`, 'neutral')}
        ${this.renderPreviewLine(`批号 ${this.escapeHtml(selectedBatch.batch_no)} · ${this.escapeHtml(selectedBatch.expiry_date)}`, this.getExpiryTone(Utils.getDaysUntilExpiry(selectedBatch.expiry_date), this.selectedOutboundReagent?.effective_warning_days || 30))}
        ${this.renderPreviewLine(`出库 ${preview.requested_quantity}${this.escapeHtml(outboundUnit === 'package' ? preview.package_unit : preview.min_unit)}`, 'warning')}
        ${this.renderPreviewLine(`折合最小单位 ${preview.requested_min_quantity}${this.escapeHtml(preview.min_unit)}`, 'success')}
      `;
    } catch (error) {
      const previewEl = document.getElementById('mobile-outbound-preview');
      previewEl.classList.remove('hidden');
      previewEl.innerHTML = this.renderPreviewLine(this.escapeHtml(error.message), 'danger');
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
      this.rememberOperator(operator);
      Utils.showToast('出库成功', 'success');
      this.closeOutboundSheet();
      await Promise.all([this.refreshOverview(), this.loadInventory(), this.loadDefaultQuickLists()]);
      this.renderSearchDefaults();
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
      this.renderSearchDefaults();
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
          ${this.renderMetricChip(`包装 ${this.escapeHtml(item.package_unit)}`, 'neutral')}
          ${this.renderMetricChip(`最小单位 ${this.escapeHtml(item.min_unit)}`, 'neutral')}
          ${this.renderMetricChip(`换算 1${this.escapeHtml(item.package_unit)} = ${item.package_to_min_qty}${this.escapeHtml(item.min_unit)}`, 'success')}
        </div>
      </article>
    `).join('');
  },

  async selectInboundReagent(reagentId) {
    const reagent = this.getInboundReagentById(reagentId);
    if (!reagent) return;
    this.selectedInboundReagent = reagent;
    this.selectedInboundBatchNo = '';
    document.getElementById('mobile-inbound-form-panel').classList.remove('hidden');
    document.getElementById('mobile-inbound-results')?.classList.add('hidden');
      document.getElementById('mobile-inbound-selected-meta').textContent = `${reagent.reagent_name} / ${reagent.instrument_name}`;
    document.getElementById('mobile-inbound-batch-no').value = '';
    document.getElementById('mobile-inbound-expiry-date').value = '';
    document.getElementById('mobile-inbound-quantity').value = '1';
    document.getElementById('mobile-inbound-unit').innerHTML = `
      <option value="package">${this.escapeHtml(reagent.package_unit)}</option>
      <option value="min">${this.escapeHtml(reagent.min_unit)}</option>
    `;
    document.getElementById('mobile-inbound-unit').value = 'package';
      document.getElementById('mobile-inbound-relation').textContent = `1${reagent.package_unit} = ${reagent.package_to_min_qty}${reagent.min_unit}`;
    await Utils.populateOperatorSelect('mobile-inbound-operator', { allowEmpty: false, defaultValue: this.getPreferredOperator() });

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
    this.renderSearchDefaults();
  },

    renderInboundBatchSuggestions() {
      const container = document.getElementById('mobile-inbound-batch-suggestions');
      if (!this.inboundBatchSuggestions.length) {
        container.innerHTML = '';
        return;
    }
      container.innerHTML = this.inboundBatchSuggestions.map((batch) => `
        <button class="mobile-batch-card mobile-batch-card-${this.getBatchCardTone(batch, this.selectedInboundReagent?.warning_days || 30)} ${batch.batch_no === this.selectedInboundBatchNo ? 'active' : ''}" type="button" data-batch-no="${this.escapeHtml(batch.batch_no)}">
          <div>
            <div class="mobile-card-title mobile-inbound-batch-title">${this.escapeHtml(batch.batch_no)}</div>
            <div class="mobile-card-meta mobile-inbound-batch-meta">
              <div class="mobile-inbound-batch-row">
                <span class="mobile-inbound-batch-expiry">有效期 ${this.escapeHtml(batch.expiry_date || '-')}</span>
                ${this.renderInlineTone(this.escapeHtml(this.formatDays(batch.expiry_days_left)), this.getBatchExpiryTone(batch, this.selectedInboundReagent?.warning_days || 30))}
              </div>
              <div class="mobile-inbound-batch-row">
                ${this.renderInlineTone(`库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}`, this.getBatchStockTone(batch))}
              </div>
            </div>
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
      this.rememberOperator(operator);
      Utils.showToast('入库成功', 'success');
      document.getElementById('mobile-inbound-batch-no').value = '';
      document.getElementById('mobile-inbound-expiry-date').value = '';
      document.getElementById('mobile-inbound-quantity').value = '1';
      document.getElementById('mobile-inbound-unit').value = 'package';
      this.selectedInboundBatchNo = '';
      this.renderInboundBatchSuggestions();
      await Promise.all([this.refreshOverview(), this.loadInventory(), this.loadDefaultQuickLists()]);
      this.renderSearchDefaults();
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
      this.renderSearchDefaults();
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
          ${this.renderMetricChip(`结果单位 ${this.escapeHtml(item.result_unit)}`, 'neutral')}
          ${this.renderMetricChip(`最小单位 ${this.escapeHtml(item.min_unit || '-')}`, 'neutral')}
          ${this.renderMetricChip(this.escapeHtml(item.manufacturer || '未填厂家'), 'neutral')}
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
      const instrumentId = this.getActiveInstrumentId();
      this.calibrationRecords = await API.calibration.listRecords(instrumentId ? { limit: 10, instrument_ids: instrumentId } : { limit: 10 });
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
          ${this.renderMetricChip(`旧批号 ${this.escapeHtml(record.target_old_batch_no || '未填')}`, 'neutral')}
          ${this.renderMetricChip(`新批号 ${this.escapeHtml(record.target_new_batch_no || '未填')}`, 'neutral')}
          ${this.renderMetricChip(`用量 ${record.usage_times}${this.escapeHtml(record.result_unit ? ` / ${record.result_unit}` : '')}`, Number(record.usage_times || 0) > 0 ? 'success' : 'neutral')}
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
      defaultValue: data.operator || this.getPreferredOperator()
    });
    document.getElementById('mobile-calibration-sheet').classList.remove('hidden');
    requestAnimationFrame(() => document.getElementById('mobile-calibration-usage-times')?.focus());
  },

  renderCalibrationSource(data) {
    const card = document.getElementById('mobile-calibration-source-card');
    const sourceLabel = data.calibration_source === 'reagent' ? '试剂自带校准' : '独立校准品';
    card.innerHTML = `
      ${this.renderPreviewLine(`<strong>${this.escapeHtml(sourceLabel)}</strong>`, 'neutral')}
      ${this.renderPreviewLine(`来源 ${this.escapeHtml(data.calibrator_name || '-')}`, 'neutral')}
      ${this.renderPreviewLine(`来源批号 ${this.escapeHtml(data.calibrator_batch_no || '-')} · 库存 ${data.calibrator_available_min_quantity ?? '-'}${this.escapeHtml(data.calibrator_min_unit || '')}`, Number(data.calibrator_available_min_quantity ?? 0) > 0 ? 'success' : 'danger')}
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
      this.rememberOperator(payload.operator);
      this.closeCalibrationSheet();
      await Promise.all([this.loadCalibrationRecords(), this.refreshOverview(), this.loadInventory(), this.loadDefaultQuickLists()]);
      this.renderSearchDefaults();
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
      this.inventoryData = await API.inventory.get(this.getActiveInstrumentId());
      const currentInstrument = this.inventoryData[0]?.instruments?.[0];
      if (this.getActiveInstrumentId()) {
        this.setInstrumentContextName(currentInstrument?.name || '');
      }
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

  groupInventoryItems(items) {
    const groups = new Map();
    items.forEach((item) => {
      const key = item.reagent_group_name || '未分组';
      if (!groups.has(key)) {
        groups.set(key, {
          name: key,
          sortOrder: item.reagent_group_sort_order ?? 9999,
          items: [],
        });
      }
      groups.get(key).items.push(item);
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort((left, right) => {
          const priority = { empty: 0, expired: 1, expiring: 2, low: 3, normal: 4 };
          return (priority[left.status_level] ?? 99) - (priority[right.status_level] ?? 99)
            || (left.nearest_expiry_days ?? 10 ** 9) - (right.nearest_expiry_days ?? 10 ** 9)
            || left.name.localeCompare(right.name, 'zh-CN');
        }),
      }))
      .sort((left, right) => (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999) || left.name.localeCompare(right.name, 'zh-CN'));
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
      .filter((item) => this.matchesInventoryFilter(item));
    if (!items.length) {
      container.innerHTML = '<div class="mobile-empty">当前没有符合条件的库存</div>';
      return;
    }
    container.innerHTML = this.groupInventoryItems(items).map((group) => `
      <section class="mobile-inventory-group">
        <div class="mobile-inventory-group-head">
          <h3>${this.escapeHtml(group.name)}</h3>
          <span>${group.items.length} 个试剂</span>
        </div>
        <div class="mobile-card-list mobile-inventory-group-list">
          ${group.items.map((item) => `
            <article class="mobile-stock-card ${item.status_level}" data-reagent-id="${item.id}" onclick="mobileApp.toggleInventoryCard(${item.id})">
              <div class="mobile-card-head">
                <div>
                  <div class="mobile-card-title">${this.escapeHtml(item.name)}</div>
                  <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
                </div>
                <span class="mobile-status mobile-status-${item.status_level}">${this.getStatusLabel(item.status_level)}</span>
              </div>
              <div class="mobile-inventory-metrics">
                ${this.renderInventoryMetric('总库存', `${item.total_min_quantity}${this.escapeHtml(item.unit)}`, this.getReagentStockTone(item))}
                ${this.renderInventoryMetric('最近效期', item.nearest_expiry_date ? this.escapeHtml(item.nearest_expiry_date) : '-', this.getExpiryTone(item.nearest_expiry_days, item.effective_warning_days || item.warning_days || 30))}
                ${this.renderInventoryMetric('剩余天数', this.escapeHtml(this.formatDays(item.nearest_expiry_days)), this.getExpiryTone(item.nearest_expiry_days, item.effective_warning_days || item.warning_days || 30))}
                ${this.renderInventoryMetric('预警值', `${item.warning_stock ?? 0}${this.escapeHtml(item.unit)}`, this.getStockTone(item.warning_stock ?? 0, item.warning_stock ?? 0))}
              </div>
              ${this.expandedInventoryIds.has(item.id) ? `<div class="mobile-stock-batches">${(item.batches || []).map((batch) => `
                <div class="mobile-batch-detail ${this.getBatchDetailTone(batch, item.effective_warning_days || item.warning_days || 30)}">
                  <div class="mobile-batch-detail-row mobile-batch-detail-row-primary">
                    <span class="mobile-batch-detail-code">批号 ${this.escapeHtml(batch.batch_no)}</span>
                    <span class="mobile-batch-detail-expiry">效期 ${this.escapeHtml(batch.expiry_date || '-')}</span>
                    ${this.renderInlineTone(this.escapeHtml(this.formatDays(batch.expiry_days_left)), this.getBatchExpiryTone(batch, item.effective_warning_days || item.warning_days || 30))}
                    ${this.renderInlineTone(`库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}`, this.getBatchStockTone(batch))}
                  </div>
                  <div class="mobile-batch-detail-row mobile-batch-detail-row-secondary">
                    <span class="mobile-batch-detail-entry">入库 ${this.escapeHtml(batch.created_at ? Utils.formatDateTime(batch.created_at).slice(0, 10) : '-')}</span>
                  </div>
                </div>`).join('')}</div>` : ''}
            </article>
          `).join('')}
        </div>
      </section>
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
