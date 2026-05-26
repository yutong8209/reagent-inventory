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
  isOutboundBatchMode: false,
  batchOutboundSelection: new Set(),
  batchOutboundItems: [],
  selectedInboundReagent: null,
  selectedInboundBatchNo: '',
  selectedCalibrationPreview: null,
  selectedCalibrationRecordId: null,
  calibrationMode: 'create',
  calibrationOutboundBatches: [],
  calibrationOutboundBatchId: null,
  calibrationOutboundEnabled: false,
  inboundBatchSuggestions: [],
  inventoryFilters: { keyword: '', status: 'all', onlyWarnings: false },
  expandedInventoryIds: new Set(),
  isWarningFoldExpanded: false,
  isSubmittingOutbound: false,
  isSubmittingBatchOutbound: false,
  isSubmittingInbound: false,
  isSubmittingCalibration: false,
  isArchivingZeroStock: false,
  isInitialized: false,

  async init() {
    this.parseInstrumentContext();
    this.bindEvents();
    this.renderInstrumentModeBanner();
    this.renderSearchDefaults();
    await Utils.loadOperators();
    await Promise.all([this.populateOperatorSelects(), this.refreshData()]);
    this.switchPage('outbound');
    this.isInitialized = true;
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
    document.getElementById('mobile-batch-outbound-toggle')?.addEventListener('click', () => this.toggleBatchOutboundMode());
    document.getElementById('mobile-batch-outbound-cancel')?.addEventListener('click', () => this.exitBatchOutboundMode());
    document.getElementById('mobile-batch-outbound-next')?.addEventListener('click', () => this.openBatchOutboundSheet());
    document.getElementById('mobile-batch-outbound-close')?.addEventListener('click', () => this.closeBatchOutboundSheet({ keepSelection: true }));
    document.getElementById('mobile-batch-outbound-add-more')?.addEventListener('click', () => this.closeBatchOutboundSheet({ keepSelection: true }));
    document.getElementById('mobile-batch-outbound-submit')?.addEventListener('click', () => this.submitBatchOutbound());
    document.getElementById('mobile-batch-outbound-sheet')?.addEventListener('click', (event) => {
      if (event.target.classList.contains('mobile-sheet-backdrop')) this.closeBatchOutboundSheet({ keepSelection: true });
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
    document.querySelectorAll('[data-outbound-unit]')?.forEach((button) => {
      button.addEventListener('click', () => this.setOutboundUnit(button.dataset.outboundUnit || 'min'));
    });
    document.getElementById('mobile-outbound-submit')?.addEventListener('click', () => this.submitOutbound());
    document.getElementById('mobile-inbound-submit')?.addEventListener('click', () => this.submitInbound());
    document.getElementById('mobile-calibration-close')?.addEventListener('click', () => this.closeCalibrationSheet());
    document.getElementById('mobile-calibration-sheet')?.addEventListener('click', (event) => {
      if (event.target.classList.contains('mobile-sheet-backdrop')) this.closeCalibrationSheet();
    });
    document.getElementById('mobile-calibration-submit')?.addEventListener('click', () => this.handleCalibrationSubmit());
    document.getElementById('mobile-calibration-outbound-toggle')?.addEventListener('click', () => this.toggleCalibrationOutboundSection());
    document.getElementById('mobile-calibration-outbound-quantity')?.addEventListener('input', () => this.refreshCalibrationOutboundPreview());
    document.querySelectorAll('[data-cal-outbound-unit]')?.forEach((button) => {
      button.addEventListener('click', () => this.setCalibrationOutboundUnit(button.dataset.calOutboundUnit || 'package'));
    });
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
    document.getElementById('mobile-inventory-archive-zero')?.addEventListener('click', () => this.archiveZeroStockReagents());
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
      Utils.populateOperatorSelect('mobile-batch-outbound-operator', { allowEmpty: false, defaultValue }),
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
    return this.getStockTone(item?.total_min_quantity, item?.effective_warning_stock ?? item?.warning_stock);
  },

  getExpiryTone(days, warningDays = 30) {
    if (days === null || days === undefined) return 'neutral';
    if (days < 0) return 'danger';
    if (days <= warningDays) return 'warning';
    return 'success';
  },

  getBatchStockTone(batch, warningStock = 0) {
    const quantity = Number(batch?.available_min_quantity || 0);
    const normalizedWarningStock = Number(warningStock || 0);
    if (quantity <= 0) return 'danger';
    if (quantity <= normalizedWarningStock) return 'batch-warning';
    return 'success';
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

  getNormalizedReagentOrderName(name) {
    return String(name || '').toLowerCase().replace('质控品', '').replace(/\s+/g, '');
  },

  getProjectGroupingName(item) {
    return String(item?.reagent_name || item?.name || '')
      .replace(/校准品$/u, '')
      .replace(/质控品$/u, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  },

  isQualityControlReagent(item) {
    return String(item?.reagent_name || item?.name || '').includes('质控品')
      || String(item?.reagent_group_name || '').includes('质控品');
  },

  formatProjectGroupName(projectName, suffix) {
    const baseName = projectName || '未分组';
    if (baseName.endsWith(suffix)) return baseName;
    return `${baseName}${suffix}`;
  },

  getProjectDisplayOrder(projectName) {
    const normalized = String(projectName || '').replace(/试剂|校准品|\s+/g, '');
    const order = {
      甲状腺功能: 0,
      性激素: 1,
      肿瘤标志物: 2,
      心肌损伤标志物: 3,
    };
    return order[normalized] ?? 9999;
  },

  buildInventoryGroupResolver(items) {
    const projectByName = new Map();
    (items || []).forEach((item) => {
      if (item.is_calibrator || this.isQualityControlReagent(item) || !item.reagent_group_name) return;
      const key = `${item.instrument_id || ''}::${this.getProjectGroupingName(item)}`;
      if (!projectByName.has(key)) {
        projectByName.set(key, item);
      }
    });

    return (item) => {
      if (this.isQualityControlReagent(item)) {
        return {
          name: '质控品',
          sortOrder: 20000,
          categoryOrder: 2,
        };
      }
      if (item.is_calibrator) {
        const matchedProject = projectByName.get(`${item.instrument_id || ''}::${this.getProjectGroupingName(item)}`);
        const projectName = matchedProject?.reagent_group_name || item.reagent_group_name || '未分组';
        return {
          name: `校准品：${this.formatProjectGroupName(projectName, '校准品')}`,
          projectOrder: this.getProjectDisplayOrder(projectName),
          sortOrder: matchedProject?.reagent_group_sort_order ?? item.reagent_group_sort_order ?? 9999,
          categoryOrder: 1,
        };
      }
      const projectName = item.reagent_group_name || '未分组';
      return {
        name: `试剂库存：${this.formatProjectGroupName(projectName, '试剂')}`,
        projectOrder: this.getProjectDisplayOrder(projectName),
        sortOrder: item.reagent_group_sort_order ?? 9999,
        categoryOrder: 0,
      };
    };
  },

  getCustomReagentOrder(item) {
    if (!['传染病标志物', 'MAGLUMI X8质控品'].includes(item.reagent_group_name || '')) {
      return 999;
    }
    const order = {
      hbsag: 0,
      hbsab: 1,
      hbeag: 2,
      hbeab: 3,
      hbcab: 4,
      hcv: 5,
      syphilis: 6,
      hiv: 7,
    };
    return order[this.getNormalizedReagentOrderName(item.reagent_name || item.name)] ?? 999;
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
        items: [...group.items].sort((left, right) => (
          this.getCustomReagentOrder(left) - this.getCustomReagentOrder(right)
          || left.reagent_name.localeCompare(right.reagent_name, 'zh-CN')
        ))
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
    batchSelectable = false,
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
          ${group.items.map((item) => {
            const isSelected = batchSelectable && this.isBatchOutboundSelected(item.reagent_id);
            const clickAction = batchSelectable
              ? `mobileApp.toggleBatchOutboundSelection(${item.reagent_id})`
              : `mobileApp.${action}(${item.reagent_id})`;
            return `
            <button class="mobile-quick-button ${compact ? 'compact' : ''} ${isSelected ? 'selected' : ''}" type="button" onclick="${clickAction}" aria-pressed="${isSelected ? 'true' : 'false'}">
              <strong>${this.escapeHtml(item.reagent_name)}</strong>
              ${isSelected ? '<em>已选</em>' : ''}
              ${hideMeta ? '' : `<span>${this.escapeHtml(metaText(item))}</span>`}
            </button>
          `;
          }).join('')}
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
          batchSelectable: this.isOutboundBatchMode,
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
      this.defaultOutboundResults = outboundItems.filter((item) => !item.is_calibrator);
      this.defaultInboundResults = reagentItems.map((item) => this.mapReagentToInboundItem(item));
      this.defaultCalibrationResults = reagentItems
        .filter((item) => !item.is_calibrator)
        .map((item) => this.mapReagentToCalibrationItem(item));

      const instrumentName = this.defaultOutboundResults[0]?.instrument_name || reagentItems[0]?.instrument_name || '';
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

  isBatchOutboundSelected(reagentId) {
    return this.batchOutboundSelection.has(Number(reagentId));
  },

  refreshOutboundListView() {
    const keyword = document.getElementById('mobile-outbound-search')?.value.trim() || '';
    if (keyword) {
      this.renderOutboundResults();
      return;
    }
    this.renderSearchDefaults();
  },

  toggleBatchOutboundMode() {
    if (this.isOutboundBatchMode) {
      this.exitBatchOutboundMode();
      return;
    }
    this.isOutboundBatchMode = true;
    this.batchOutboundSelection.clear();
    this.batchOutboundItems = [];
    this.renderBatchOutboundBar();
    this.refreshOutboundListView();
  },

  exitBatchOutboundMode() {
    this.isOutboundBatchMode = false;
    this.batchOutboundSelection.clear();
    this.batchOutboundItems = [];
    this.closeBatchOutboundSheet({ keepSelection: false });
    this.renderBatchOutboundBar();
    this.refreshOutboundListView();
  },

  toggleBatchOutboundSelection(reagentId) {
    const id = Number(reagentId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (this.batchOutboundSelection.has(id)) {
      this.batchOutboundSelection.delete(id);
      this.batchOutboundItems = this.batchOutboundItems.filter((item) => Number(item.reagent_id) !== id);
    } else {
      this.batchOutboundSelection.add(id);
    }
    this.renderBatchOutboundBar();
    this.refreshOutboundListView();
  },

  renderBatchOutboundBar() {
    const toggleButton = document.getElementById('mobile-batch-outbound-toggle');
    const bar = document.getElementById('mobile-batch-outbound-bar');
    const countEl = document.getElementById('mobile-batch-outbound-count');
    const nextButton = document.getElementById('mobile-batch-outbound-next');
    const count = this.batchOutboundSelection.size;

    toggleButton?.classList.toggle('active', this.isOutboundBatchMode);
    if (toggleButton) toggleButton.textContent = this.isOutboundBatchMode ? '退出批量' : '批量出库';
    bar?.classList.toggle('hidden', !this.isOutboundBatchMode);
    if (countEl) countEl.textContent = `已选 ${count} 个试剂`;
    if (nextButton) nextButton.disabled = count === 0;
  },

  async openBatchOutboundSheet() {
    if (!this.isOutboundBatchMode || !this.batchOutboundSelection.size) return;
    const selectedIds = [...this.batchOutboundSelection];
    const existingById = new Map(this.batchOutboundItems.map((item) => [Number(item.reagent_id), item]));
    try {
      const items = await Promise.all(selectedIds.map(async (reagentId) => {
        const existing = existingById.get(Number(reagentId));
        const reagent = existing?.reagent || this.getOutboundReagentById(reagentId);
        if (!reagent) return null;
        const batches = existing?.batches || (await API.outbound.getStock(reagentId)).filter((batch) => batch.available_min_quantity > 0);
        if (!batches.length) {
          return { reagent, batches: [], reagent_id: reagentId, error: '无可用库存批号' };
        }
        const selectedBatchId = existing?.selectedBatchId && batches.some((batch) => Number(batch.id) === Number(existing.selectedBatchId))
          ? existing.selectedBatchId
          : (batches.find((batch) => !batch.is_expired) || batches[0]).id;
        return {
          reagent_id: reagentId,
          reagent,
          batches,
          selectedBatchId,
          outboundUnit: existing?.outboundUnit || 'min',
          quantity: existing?.quantity || 1,
          error: ''
        };
      }));

      this.batchOutboundItems = items.filter(Boolean);
      await Utils.populateOperatorSelect('mobile-batch-outbound-operator', { allowEmpty: false, defaultValue: this.getPreferredOperator() });
      this.renderBatchOutboundSheet();
      document.getElementById('mobile-batch-outbound-sheet')?.classList.remove('hidden');
    } catch (error) {
      Utils.showToast(`批量出库加载失败：${error.message}`, 'error');
    }
  },

  renderBatchOutboundSheet() {
    const container = document.getElementById('mobile-batch-outbound-items');
    const meta = document.getElementById('mobile-batch-outbound-meta');
    if (meta) meta.textContent = `共 ${this.batchOutboundItems.length} 个试剂，逐项确认后一次提交。`;
    if (!container) return;
    if (!this.batchOutboundItems.length) {
      container.innerHTML = '<div class="mobile-empty">还没有选择试剂</div>';
      return;
    }
    container.innerHTML = this.batchOutboundItems.map((item, index) => {
      const reagent = item.reagent || {};
      const minUnit = reagent.min_unit || item.batches?.[0]?.min_unit || '最小单位';
      const packageUnit = reagent.package_unit || item.batches?.[0]?.package_unit || '包装单位';
      const sameUnit = String(minUnit).trim() === String(packageUnit).trim();
      return `
        <section class="mobile-batch-outbound-item ${item.error ? 'has-error' : ''}">
          <div class="mobile-batch-outbound-head">
            <div>
              <strong>${this.escapeHtml(reagent.reagent_name || reagent.name || `试剂 #${item.reagent_id}`)}</strong>
              <span>${this.escapeHtml(reagent.work_group_name || '-')} / ${this.escapeHtml(reagent.instrument_name || '-')}</span>
            </div>
            <button class="mobile-danger-btn compact" type="button" onclick="mobileApp.removeBatchOutboundItem(${index})">删除</button>
          </div>
          ${item.error ? `<div class="mobile-inline-error">${this.escapeHtml(item.error)}</div>` : `
            <div class="mobile-batch-outbound-batches" role="group" aria-label="批号">
              ${item.batches.map((batch) => {
                const isActive = Number(batch.id) === Number(item.selectedBatchId);
                const days = Utils.getDaysUntilExpiry(batch.expiry_date);
                return `
                  <button class="mobile-batch-pick ${isActive ? 'active' : ''}" type="button" onclick="mobileApp.updateBatchOutboundItem(${index}, 'selectedBatchId', ${batch.id})" aria-pressed="${isActive ? 'true' : 'false'}">
                    <strong>${this.escapeHtml(batch.batch_no)}</strong>
                    <span>${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)} · ${this.escapeHtml(this.formatDays(days))}</span>
                  </button>
                `;
              }).join('')}
            </div>
            <div class="mobile-batch-outbound-grid">
              <label class="mobile-field">
                <span>数量</span>
                <input class="mobile-input" type="number" min="1" value="${this.escapeHtml(item.quantity)}" oninput="mobileApp.updateBatchOutboundItem(${index}, 'quantity', this.value)">
              </label>
              <label class="mobile-field mobile-batch-outbound-unit-field">
                <span>单位</span>
                <div class="mobile-unit-toggle ${sameUnit ? 'single-option' : ''}" role="group" aria-label="出库单位">
                  <button class="mobile-unit-option ${item.outboundUnit !== 'package' ? 'active' : ''}" type="button" onclick="mobileApp.updateBatchOutboundItem(${index}, 'outboundUnit', 'min')">${this.escapeHtml(minUnit)}</button>
                  ${sameUnit ? '' : `<button class="mobile-unit-option ${item.outboundUnit === 'package' ? 'active' : ''}" type="button" onclick="mobileApp.updateBatchOutboundItem(${index}, 'outboundUnit', 'package')">${this.escapeHtml(packageUnit)}</button>`}
                </div>
              </label>
            </div>
          `}
        </section>
      `;
    }).join('');
  },

  updateBatchOutboundItem(index, field, value) {
    const item = this.batchOutboundItems[index];
    if (!item) return;
    if (field === 'quantity') {
      item.quantity = this.normalizePositiveInteger(value, 1);
      return;
    } else if (field === 'selectedBatchId') {
      item.selectedBatchId = Number(value);
    } else if (field === 'outboundUnit') {
      item.outboundUnit = value === 'package' ? 'package' : 'min';
    }
    this.renderBatchOutboundSheet();
  },

  removeBatchOutboundItem(index) {
    const item = this.batchOutboundItems[index];
    if (!item) return;
    this.batchOutboundSelection.delete(Number(item.reagent_id));
    this.batchOutboundItems.splice(index, 1);
    this.renderBatchOutboundBar();
    this.renderBatchOutboundSheet();
    this.refreshOutboundListView();
  },

  closeBatchOutboundSheet({ keepSelection = true } = {}) {
    document.getElementById('mobile-batch-outbound-sheet')?.classList.add('hidden');
    this.isSubmittingBatchOutbound = false;
    if (!keepSelection) {
      this.batchOutboundItems = [];
    }
  },

  async submitBatchOutbound() {
    if (this.isSubmittingBatchOutbound || !this.batchOutboundItems.length) return;
    const operator = Utils.getValidOperator(document.getElementById('mobile-batch-outbound-operator')?.value);
    if (!operator) {
      Utils.showToast('请选择操作人', 'warning');
      return;
    }
    const invalid = this.batchOutboundItems.find((item) => (
      item.error
      || !item.selectedBatchId
      || !this.normalizePositiveInteger(item.quantity, 0)
      || !item.batches.find((batchItem) => Number(batchItem.id) === Number(item.selectedBatchId))
    ));
    if (invalid) {
      Utils.showToast('请确认每个试剂都有批号和出库数量', 'warning');
      return;
    }

    const payloadItems = this.batchOutboundItems.map((item) => {
      const batch = item.batches.find((batchItem) => Number(batchItem.id) === Number(item.selectedBatchId));
      return {
        source: 'manual',
        reagent_id: item.reagent_id,
        quantity: this.normalizePositiveInteger(item.quantity, 1),
        outbound_unit: item.outboundUnit === 'package' ? 'package' : 'min',
        deduction_mode: 'scanned_batch',
        raw_barcode: `MOBILE::BATCH_OUTBOUND::${item.reagent_id}`,
        scanned_batch_no: batch.batch_no,
        scanned_expiry_date: batch.expiry_date
      };
    });

    const submitButton = document.getElementById('mobile-batch-outbound-submit');
    this.isSubmittingBatchOutbound = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = '提交中...';
    }
    try {
      await API.outbound.stockOutBatch({ operator, items: payloadItems });
      this.rememberOperator(operator);
      Utils.showToast(`批量出库成功：${payloadItems.length} 个试剂`, 'success');
      this.exitBatchOutboundMode();
      await Promise.all([this.refreshOverview(), this.loadInventory(), this.loadDefaultQuickLists()]);
      this.renderSearchDefaults();
      const keyword = document.getElementById('mobile-outbound-search')?.value.trim() || '';
      if (keyword) await this.searchOutboundReagents(keyword);
    } catch (error) {
      Utils.showToast(`批量出库失败：${error.message}`, 'error');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = '全部确认出库';
      }
      this.isSubmittingBatchOutbound = false;
    }
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
    const batchLowCountEl = document.getElementById('mobile-summary-batch-low');
    const emptyCountEl = document.getElementById('mobile-summary-empty');
    const expiredStatEl = document.getElementById('mobile-overview-stat-expired');
    const expiringStatEl = document.getElementById('mobile-overview-stat-expiring');
    const lowStatEl = document.getElementById('mobile-overview-stat-low');
    const batchLowStatEl = document.getElementById('mobile-overview-stat-batch-low');
    const emptyStatEl = document.getElementById('mobile-overview-stat-empty');
    if (!summary) {
      if (expiredCountEl) expiredCountEl.textContent = '0';
      if (expiringCountEl) expiringCountEl.textContent = '0';
      if (lowCountEl) lowCountEl.textContent = '0';
      if (batchLowCountEl) batchLowCountEl.textContent = '0';
      if (emptyCountEl) emptyCountEl.textContent = '0';
      expiredStatEl?.classList.add('danger');
      expiringStatEl?.classList.add('warning');
      lowStatEl?.classList.add('warning');
      batchLowStatEl?.classList.add('batch-warning');
      emptyStatEl?.classList.add('danger');
      this.showEmpty('mobile-recent-list', '暂无最近出库记录');
      return;
    }
    if (expiredCountEl) expiredCountEl.textContent = String(summary.expired_batch_count || 0);
    if (expiringCountEl) expiringCountEl.textContent = String(summary.expiring_reagent_count || 0);
    if (lowCountEl) lowCountEl.textContent = String(summary.low_stock_reagent_count || 0);
    if (batchLowCountEl) batchLowCountEl.textContent = String(summary.low_stock_batch_count || 0);
    if (emptyCountEl) emptyCountEl.textContent = String(summary.zero_stock_unarchived_count || 0);
    expiredStatEl?.classList.toggle('danger', (summary.expired_batch_count || 0) > 0);
    expiringStatEl?.classList.toggle('warning', (summary.expiring_reagent_count || 0) > 0);
    lowStatEl?.classList.toggle('warning', (summary.low_stock_reagent_count || 0) > 0);
    batchLowStatEl?.classList.toggle('batch-warning', (summary.low_stock_batch_count || 0) > 0);
    emptyStatEl?.classList.toggle('danger', (summary.zero_stock_unarchived_count || 0) > 0);
    this.updateArchiveZeroStockButton();

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
      const results = await API.outbound.searchReagents({ q: keyword });
      this.outboundResults = results.filter((item) => !item.is_calibrator);
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
      const isSelected = this.isBatchOutboundSelected(item.reagent_id);
      const clickAction = this.isOutboundBatchMode
        ? `mobileApp.toggleBatchOutboundSelection(${item.reagent_id})`
        : `mobileApp.openOutboundSheet(${item.reagent_id})`;
      return `
        <article class="mobile-result-card ${status} ${isSelected ? 'selected' : ''}" onclick="${clickAction}" aria-pressed="${isSelected ? 'true' : 'false'}">
          <div class="mobile-card-head">
            <div>
              <div class="mobile-card-title">${this.escapeHtml(item.reagent_name)}</div>
              <div class="mobile-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
            </div>
            <span class="mobile-status mobile-status-${status}">${isSelected ? '已选' : this.getStatusLabel(status)}</span>
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
    if (this.isOutboundBatchMode) {
      this.toggleBatchOutboundSelection(reagentId);
      return;
    }
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
      this.renderOutboundUnitToggle(reagent);
      this.setOutboundUnit('min', { skipPreview: true });
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

  renderOutboundUnitToggle(reagent) {
    const minButton = document.getElementById('mobile-outbound-unit-min');
    const packageButton = document.getElementById('mobile-outbound-unit-package');
    const toggle = document.getElementById('mobile-outbound-unit-toggle');
    const minUnit = reagent.min_unit || '最小单位';
    const packageUnit = reagent.package_unit || '包装单位';
    if (minButton) minButton.textContent = reagent.min_unit || '最小单位';
    if (packageButton) packageButton.textContent = reagent.package_unit || '包装单位';
    const hasSameUnit = String(minUnit).trim() === String(packageUnit).trim();
    toggle?.classList.toggle('single-option', hasSameUnit);
    packageButton?.classList.toggle('hidden', hasSameUnit);
  },

  setOutboundUnit(unit, options = {}) {
    const normalizedUnit = unit === 'package' ? 'package' : 'min';
    const input = document.getElementById('mobile-outbound-unit');
    if (input) input.value = normalizedUnit;
    document.querySelectorAll('[data-outbound-unit]').forEach((button) => {
      button.classList.toggle('active', button.dataset.outboundUnit === normalizedUnit);
      button.setAttribute('aria-pressed', button.dataset.outboundUnit === normalizedUnit ? 'true' : 'false');
    });
    if (!options.skipPreview) {
      this.refreshOutboundPreview();
    }
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
    document.getElementById('mobile-calibration-submit').classList.toggle('hidden', false);
    document.getElementById('mobile-calibration-submit').textContent = mode === 'edit' ? '保存校准记录' : '保存本次校准';
    await Utils.populateOperatorSelect('mobile-calibration-operator', {
      allowEmpty: false,
      defaultValue: data.operator || this.getPreferredOperator()
    });
    if (mode === 'create') {
      await this.loadCalibrationOutboundBatches(data.target_reagent_id);
    } else {
      document.getElementById('mobile-calibration-outbound-section')?.classList.add('hidden');
    }
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
        <option value="${this.escapeHtml(item.batch_no)}">${this.escapeHtml(item.batch_no)} · ${this.escapeHtml(item.expiry_date || '-')}${item.is_archived ? ' · 已归档' : ''}</option>
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
    if (this.calibrationMode === 'create') {
      this.submitCalibration(Boolean(this.calibrationOutboundEnabled));
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
    if (autoOutboundPackage) {
      if (this.calibrationOutboundEnabled && this.calibrationOutboundBatchId) {
        payload.outbound_batch_stock_id = this.calibrationOutboundBatchId;
        payload.outbound_quantity = this.normalizePositiveInteger(document.getElementById('mobile-calibration-outbound-quantity')?.value, 1);
        payload.outbound_unit = document.getElementById('mobile-calibration-outbound-unit')?.value || 'package';
      }
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
      this.syncCalibrationSubmitLabel();
      this.isSubmittingCalibration = false;
    }
  },

  closeCalibrationSheet() {
    document.getElementById('mobile-calibration-sheet')?.classList.add('hidden');
    document.getElementById('mobile-calibration-outbound-section')?.classList.add('hidden');
    document.getElementById('mobile-calibration-outbound-section')?.classList.remove('active', 'unavailable');
    document.getElementById('mobile-calibration-outbound-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('mobile-calibration-submit')?.classList.remove('hidden');
    this.selectedCalibrationPreview = null;
    this.selectedCalibrationRecordId = null;
    this.calibrationMode = 'create';
    this.isSubmittingCalibration = false;
    this.calibrationOutboundBatches = [];
    this.calibrationOutboundBatchId = null;
    this.calibrationOutboundEnabled = false;
  },

  async loadCalibrationOutboundBatches(reagentId) {
    const section = document.getElementById('mobile-calibration-outbound-section');
    const controls = document.getElementById('mobile-calibration-outbound-controls');
    const badge = document.getElementById('mobile-cal-outbound-badge');
    const hint = document.getElementById('mobile-cal-outbound-toggle-hint');
    const batchesContainer = document.getElementById('mobile-calibration-outbound-batches');
    const count = document.getElementById('mobile-cal-outbound-batch-count');
    const toggle = document.getElementById('mobile-calibration-outbound-toggle');
    if (!section || !reagentId) {
      section?.classList.add('hidden');
      return;
    }
    this.calibrationOutboundEnabled = false;
    section.classList.remove('active', 'unavailable');
    toggle?.setAttribute('aria-expanded', 'false');
    this.syncCalibrationSubmitLabel();
    try {
      const batches = await API.outbound.getStock(reagentId);
      const available = batches.filter((item) => item.available_min_quantity > 0);
      this.calibrationOutboundBatches = available;
      if (!available.length) {
        section.classList.remove('hidden');
        section.classList.add('unavailable');
        controls?.classList.add('hidden');
        if (badge) { badge.textContent = '无库存'; badge.classList.remove('active', 'danger'); badge.classList.add('warning'); }
        if (hint) hint.textContent = '该试剂暂无可用库存';
        if (count) count.textContent = '';
        batchesContainer.innerHTML = '';
        return;
      }
      this.calibrationOutboundBatchId = available[0].id;
      section.classList.remove('hidden');
      controls?.classList.add('hidden');
      if (badge) { badge.textContent = '关闭'; badge.classList.remove('active', 'warning', 'danger'); }
      if (hint) hint.textContent = `可选 ${available.length} 个批号，点击开启`;
      if (count) count.textContent = `${available.length} 个可用`;
      this.renderCalibrationOutboundBatches();
      this.setCalibrationOutboundUnit('package', { skipPreview: true });
      document.getElementById('mobile-calibration-outbound-quantity').value = '1';
      this.renderCalibrationOutboundUnitLabels(available[0]);
      this.refreshCalibrationOutboundPreview();
    } catch (error) {
      section.classList.remove('hidden');
      section.classList.add('unavailable');
      controls?.classList.add('hidden');
      if (badge) { badge.textContent = '错误'; badge.classList.remove('active', 'warning'); badge.classList.add('danger'); }
      if (hint) hint.textContent = `加载失败：${error.message}`;
      if (count) count.textContent = '';
      batchesContainer.innerHTML = '';
    }
  },

  renderCalibrationOutboundBatches() {
    const container = document.getElementById('mobile-calibration-outbound-batches');
    if (!container) return;
    container.innerHTML = this.calibrationOutboundBatches.map((batch) => {
      const days = Utils.getDaysUntilExpiry(batch.expiry_date);
      const tone = this.getExpiryTone(days, 30);
      return `
        <label class="mobile-batch-card mobile-batch-card-${tone} ${batch.id === this.calibrationOutboundBatchId ? 'active' : ''}">
          <input type="radio" name="mobile-cal-outbound-batch" ${batch.id === this.calibrationOutboundBatchId ? 'checked' : ''} onchange="mobileApp.selectCalibrationOutboundBatch(${batch.id})">
          <div class="mobile-outbound-batch-main">
            <div class="mobile-outbound-batch-top">
              <div class="mobile-card-title">${this.escapeHtml(batch.batch_no)}</div>
              <span class="mobile-outbound-batch-stock mobile-metric-chip mobile-metric-${this.getBatchStockTone(batch)}">库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}</span>
            </div>
            <div class="mobile-card-meta">有效期 ${this.escapeHtml(batch.expiry_date)} · ${this.renderInlineTone(this.escapeHtml(this.formatDays(days)), tone)}</div>
          </div>
        </label>
      `;
    }).join('');
  },

  selectCalibrationOutboundBatch(batchId) {
    this.calibrationOutboundBatchId = batchId;
    this.renderCalibrationOutboundBatches();
    const batch = this.calibrationOutboundBatches.find((item) => item.id === this.calibrationOutboundBatchId);
    if (batch) this.renderCalibrationOutboundUnitLabels(batch);
    this.refreshCalibrationOutboundPreview();
  },

  toggleCalibrationOutboundSection() {
    const section = document.getElementById('mobile-calibration-outbound-section');
    const controls = document.getElementById('mobile-calibration-outbound-controls');
    const badge = document.getElementById('mobile-cal-outbound-badge');
    const hint = document.getElementById('mobile-cal-outbound-toggle-hint');
    const toggle = document.getElementById('mobile-calibration-outbound-toggle');
    const noBatches = !this.calibrationOutboundBatches.length;
    if (noBatches) return;
    this.calibrationOutboundEnabled = !this.calibrationOutboundEnabled;
    const enabled = this.calibrationOutboundEnabled;
    if (controls) controls.classList.toggle('hidden', !enabled);
    if (badge) {
      badge.textContent = enabled ? '已开启' : '关闭';
      badge.classList.toggle('active', enabled);
      badge.classList.remove('warning', 'danger');
    }
    if (hint) {
      hint.textContent = enabled
        ? '保存时将同步扣减所选批号库存'
        : `可选 ${this.calibrationOutboundBatches.length} 个批号，点击开启`;
    }
    section?.classList.toggle('active', enabled);
    if (toggle) toggle.setAttribute('aria-expanded', String(enabled));
    this.syncCalibrationSubmitLabel();
    if (enabled) {
      this.refreshCalibrationOutboundPreview();
    }
  },

  syncCalibrationSubmitLabel() {
    const submitButton = document.getElementById('mobile-calibration-submit');
    if (!submitButton) return;
    submitButton.textContent = this.calibrationMode === 'edit'
      ? '保存校准记录'
      : this.calibrationOutboundEnabled
        ? '保存并同步出库'
        : '保存本次校准';
  },

  renderCalibrationOutboundUnitLabels(batch) {
    const packageBtn = document.getElementById('mobile-calibration-outbound-unit-package');
    const minBtn = document.getElementById('mobile-calibration-outbound-unit-min');
    if (packageBtn) packageBtn.textContent = batch.package_unit || '包装单位';
    if (minBtn) minBtn.textContent = batch.min_unit || '最小单位';
    const toggle = document.getElementById('mobile-calibration-outbound-unit-toggle');
    const hasSameUnit = String(batch.min_unit || '').trim() === String(batch.package_unit || '').trim();
    toggle?.classList.toggle('single-option', hasSameUnit);
    minBtn?.classList.toggle('hidden', hasSameUnit);
  },

  setCalibrationOutboundUnit(unit, options = {}) {
    const normalizedUnit = unit === 'min' ? 'min' : 'package';
    const input = document.getElementById('mobile-calibration-outbound-unit');
    if (input) input.value = normalizedUnit;
    document.querySelectorAll('[data-cal-outbound-unit]').forEach((button) => {
      button.classList.toggle('active', button.dataset.calOutboundUnit === normalizedUnit);
      button.setAttribute('aria-pressed', button.dataset.calOutboundUnit === normalizedUnit ? 'true' : 'false');
    });
    if (!options.skipPreview) {
      this.refreshCalibrationOutboundPreview();
    }
  },

  async refreshCalibrationOutboundPreview() {
    const previewEl = document.getElementById('mobile-calibration-outbound-preview');
    if (!previewEl || !this.calibrationOutboundBatchId || !this.selectedCalibrationPreview) return;
    const batch = this.calibrationOutboundBatches.find((item) => item.id === this.calibrationOutboundBatchId);
    if (!batch) return;
    const quantity = this.normalizePositiveInteger(document.getElementById('mobile-calibration-outbound-quantity')?.value, 1);
    const outboundUnit = document.getElementById('mobile-calibration-outbound-unit')?.value || 'package';
    try {
      const preview = await API.outbound.preview({
        source: 'manual',
        reagent_id: this.selectedCalibrationPreview.target_reagent_id,
        quantity,
        outbound_unit: outboundUnit,
        deduction_mode: 'scanned_batch',
        raw_barcode: `MOBILE::CALIBRATION::${this.selectedCalibrationPreview.target_reagent_id}`,
        scanned_batch_no: batch.batch_no,
        scanned_expiry_date: batch.expiry_date
      });
      previewEl.innerHTML = `
        ${this.renderPreviewLine(`出库 ${preview.requested_quantity}${this.escapeHtml(outboundUnit === 'package' ? preview.package_unit : preview.min_unit)}`, 'warning')}
        ${this.renderPreviewLine(`折合最小单位 ${preview.requested_min_quantity}${this.escapeHtml(preview.min_unit)}`, 'success')}
      `;
    } catch (error) {
      previewEl.innerHTML = this.renderPreviewLine(this.escapeHtml(error.message), 'danger');
    }
  },

  async loadInventory() {
    try {
      this.inventoryData = await API.inventory.get(this.getActiveInstrumentId());
      const currentInstrument = this.inventoryData[0]?.instruments?.[0];
      if (this.getActiveInstrumentId()) {
        this.setInstrumentContextName(currentInstrument?.name || '');
      }
      this.renderInventory();
      this.updateArchiveZeroStockButton();
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
    const resolveGroup = this.buildInventoryGroupResolver(items);
    items.forEach((item) => {
      const resolvedGroup = resolveGroup(item);
      const key = resolvedGroup.name || '未分组';
      if (!groups.has(key)) {
        groups.set(key, {
          name: key,
          projectOrder: resolvedGroup.projectOrder ?? 9999,
          sortOrder: resolvedGroup.sortOrder,
          categoryOrder: resolvedGroup.categoryOrder ?? 0,
          items: [],
        });
      }
      groups.get(key).items.push(item);
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        warningCount: group.items.filter((item) => this.isWarningInventoryItem(item)).length,
        items: [...group.items].sort((left, right) => {
          const priority = { empty: 0, expired: 1, expiring: 2, low: 3, normal: 4 };
          return this.getCustomReagentOrder(left) - this.getCustomReagentOrder(right)
            || (priority[left.status_level] ?? 99) - (priority[right.status_level] ?? 99)
            || (left.nearest_expiry_days ?? 10 ** 9) - (right.nearest_expiry_days ?? 10 ** 9)
            || left.name.localeCompare(right.name, 'zh-CN');
        }),
      }))
      .sort((left, right) => (
        (left.categoryOrder ?? 0) - (right.categoryOrder ?? 0)
        || (left.projectOrder ?? 9999) - (right.projectOrder ?? 9999)
        || (left.projectOrder === 9999 ? Number(right.warningCount > 0) - Number(left.warningCount > 0) : 0)
        || (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999)
        || left.name.localeCompare(right.name, 'zh-CN')
      ));
  },

  hasBatchLowWarning(item) {
    const effectiveWarningStock = Number(item.effective_single_batch_warning_stock ?? item.effective_warning_stock ?? item.warning_stock ?? 0);
    const threshold = Math.max(effectiveWarningStock || 0, 0);
    return (item.batches || []).some((batch) => Number(batch.available_min_quantity ?? 0) <= threshold);
  },

  isWarningInventoryItem(item) {
    return item.status_level !== 'normal' || this.hasBatchLowWarning(item);
  },

  matchesInventoryFilter(item) {
    const keyword = this.inventoryFilters.keyword.toLowerCase();
    if (keyword && !item.name.toLowerCase().includes(keyword)) return false;
    const status = this.inventoryFilters.status;
    if (status === 'batch_low') {
      if (!this.hasBatchLowWarning(item)) {
        return false;
      }
    } else if (status === 'low_or_empty') {
      if (!['low', 'empty'].includes(item.status_level)) return false;
    } else if (status !== 'all' && item.status_level !== status) {
      return false;
    }
    if (this.inventoryFilters.onlyWarnings && !this.isWarningInventoryItem(item)) return false;
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
          <span>${group.items.length} 个试剂${group.warningCount ? ` · ${group.warningCount} 个预警` : ''}</span>
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
                ${this.renderInventoryMetric('预警值', `${item.effective_warning_stock ?? item.warning_stock ?? 0}${this.escapeHtml(item.unit)}`, 'neutral')}
              </div>
              ${this.expandedInventoryIds.has(item.id) ? `<div class="mobile-stock-batches">${(item.batches || []).map((batch) => `
                <div class="mobile-batch-detail ${this.getBatchDetailTone(batch, item.effective_warning_days || item.warning_days || 30)}">
                  <div class="mobile-batch-detail-row mobile-batch-detail-row-primary">
                    <span class="mobile-batch-detail-code">批号 ${this.escapeHtml(batch.batch_no)}</span>
                    <span class="mobile-batch-detail-expiry">效期 ${this.escapeHtml(batch.expiry_date || '-')}</span>
                    ${this.renderInlineTone(this.escapeHtml(this.formatDays(batch.expiry_days_left)), this.getBatchExpiryTone(batch, item.effective_warning_days || item.warning_days || 30))}
                    ${this.renderInlineTone(`库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit)}`, this.getBatchStockTone(batch, item.effective_single_batch_warning_stock ?? item.effective_warning_stock ?? item.warning_stock ?? 0))}
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

  getZeroStockArchiveCount() {
    const summaryCount = Number(this.overview?.pending_tasks?.zero_stock_unarchived_count ?? NaN);
    if (Number.isFinite(summaryCount)) return summaryCount;
    return this.getFlattenedInventoryItems().filter((item) => Number(item.total_min_quantity || 0) <= 0).length;
  },

  updateArchiveZeroStockButton() {
    const button = document.getElementById('mobile-inventory-archive-zero');
    if (!button) return;
    const count = this.getZeroStockArchiveCount();
    button.disabled = this.isArchivingZeroStock || count <= 0;
    button.textContent = this.isArchivingZeroStock
      ? '归档中...'
      : (count > 0 ? `归档零库存 ${count}` : '无零库存');
  },

  async archiveZeroStockReagents() {
    if (this.isArchivingZeroStock) return;
    const count = this.getZeroStockArchiveCount();
    if (count <= 0) {
      Utils.showToast('当前没有可归档的零库存试剂或零库存批号', 'warning');
      this.updateArchiveZeroStockButton();
      return;
    }
    if (!confirm('确定一键归档所有零库存试剂和零库存批号吗？归档后它们将不再出现在库存页面。')) {
      return;
    }

    this.isArchivingZeroStock = true;
    this.updateArchiveZeroStockButton();
    try {
      const result = await API.inventory.archiveZeroStockReagents();
      const reagentCount = result.archived_count || 0;
      const batchCount = result.archived_batch_count || 0;
      if (!reagentCount && !batchCount) {
        Utils.showToast('当前没有可归档的零库存试剂或零库存批号', 'warning');
      } else {
        Utils.showToast(`已归档 ${reagentCount} 个零库存试剂、${batchCount} 个零库存批号`, 'success');
      }
      await Promise.all([this.refreshOverview(), this.loadInventory(), this.loadDefaultQuickLists()]);
      this.renderSearchDefaults();
    } catch (error) {
      Utils.showToast(`归档失败：${error.message}`, 'error');
    } finally {
      this.isArchivingZeroStock = false;
      this.updateArchiveZeroStockButton();
    }
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
