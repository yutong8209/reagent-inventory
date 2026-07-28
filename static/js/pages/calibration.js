const calibrationPage = {
    initialized: false,
    operators: [],
    workGroups: [],
    instruments: [],
    preview: null,
    manualCalibrators: [],
    manualBatches: [],
    manualSearchResults: [],
    manualSourceType: 'calibrator',
    outboundBatches: [],
    recentRecords: [],
    editRecordId: null,

    async init() {
        if (!this.initialized) {
            this.bindEvents();
            this.initialized = true;
        }
        await this.loadOperators();
        await this.loadFilterSelectors();
        await this.loadManualSelectors();
        await this.loadRecentRecords();
        this.switchMode('manual', { preserveForm: true });
        window.setTimeout(() => {
            document.getElementById('calibration-manual-search')?.focus();
        }, 0);
    },

    bindEvents() {
        document.querySelectorAll('[data-calibration-mode]').forEach((button) => {
            button.addEventListener('click', () => this.switchMode(button.dataset.calibrationMode || 'scan'));
        });
        document.addEventListener('pointerdown', (event) => {
            const results = document.getElementById('calibration-manual-search-results');
            const input = document.getElementById('calibration-manual-search');
            if (results && !results.contains(event.target) && event.target !== input) {
                results.style.display = 'none';
            }
        });
        document.getElementById('calibration-preview-btn')?.addEventListener('click', () => this.scanPreview());
        document.getElementById('calibration-barcode')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.scanPreview();
            }
        });
        document.getElementById('calibration-target-reagent')?.addEventListener('change', (event) => {
            this.loadTargetPreview(event.target.value, false);
        });
        document.getElementById('calibration-result-unit')?.addEventListener('input', (event) => {
            this.syncCreateResultUnitNotes(event.target.value);
        });
        document.getElementById('calibration-save-btn')?.addEventListener('click', () => this.saveCalibration());
        document.getElementById('calibration-manual-work-group')?.addEventListener('change', async () => {
            await this.loadManualInstruments();
            await this.loadManualCalibrators();
        });
        document.getElementById('calibration-manual-instrument')?.addEventListener('change', () => this.loadManualCalibrators());
        document.getElementById('calibration-manual-calibrator')?.addEventListener('change', () => this.selectManualCalibrator());
        document.getElementById('calibration-manual-search')?.addEventListener('input', () => this.searchManualCalibrators());
        document.getElementById('calibration-manual-batch')?.addEventListener('change', () => this.renderManualSummary());
        document.getElementById('calibration-manual-preview-btn')?.addEventListener('click', () => this.generateManualPreview());
        document.getElementById('calibration-manual-clear-btn')?.addEventListener('click', () => this.clearManualSelection());
        document.getElementById('calibration-outbound-enabled')?.addEventListener('change', () => this.toggleOutboundControls());
        document.getElementById('calibration-outbound-batch')?.addEventListener('change', () => {
            this.updateOutboundUnitOptions();
            this.refreshOutboundPreview();
        });
        document.getElementById('calibration-outbound-quantity')?.addEventListener('change', () => this.refreshOutboundPreview());
        document.getElementById('calibration-outbound-unit')?.addEventListener('change', () => this.refreshOutboundPreview());

        document.getElementById('calibration-record-modal-close')?.addEventListener('click', () => this.closeRecordModal());
        document.getElementById('calibration-record-modal-cancel')?.addEventListener('click', () => this.closeRecordModal());
        document.getElementById('calibration-record-modal-save')?.addEventListener('click', () => this.saveRecordModal());
        document.getElementById('calibration-edit-target-reagent')?.addEventListener('change', (event) => {
            this.loadEditTargetPreview(event.target.value);
        });
        document.getElementById('calibration-edit-result-unit')?.addEventListener('input', (event) => {
            this.syncEditResultUnitNotes(event.target.value);
        });
        document.getElementById('calibration-filter-work-group')?.addEventListener('change', async () => {
            await this.loadFilterInstruments();
        });
        document.getElementById('calibration-record-search-btn')?.addEventListener('click', () => this.loadRecentRecords());
        document.getElementById('calibration-record-export-btn')?.addEventListener('click', () => this.exportRecords());

        const modal = document.getElementById('calibration-record-modal');
        modal?.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.closeRecordModal();
            }
        });
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    async loadOperators() {
        this.operators = await API.operators.list();
        const options = this.operators
            .filter((item) => item.is_active)
            .map((item) => `<option value="${item.name}">${this.escapeHtml(item.name)}</option>`)
            .join('');
        document.getElementById('calibration-operator').innerHTML = options;
        document.getElementById('calibration-edit-operator').innerHTML = options;
    },

    getSelectedValues(selectId) {
        const select = document.getElementById(selectId);
        if (!select) {
            return [];
        }
        return [...select.selectedOptions].map((option) => option.value).filter(Boolean);
    },

    selectValues(selectId, values) {
        const select = document.getElementById(selectId);
        if (!select) {
            return;
        }
        const valueSet = new Set((values || []).map(String));
        [...select.options].forEach((option) => {
            option.selected = valueSet.has(option.value);
        });
    },

    switchMode(mode, options = {}) {
        const nextMode = mode === 'manual' ? 'manual' : 'scan';
        document.querySelectorAll('[data-calibration-mode]').forEach((button) => {
            button.classList.toggle('active', button.dataset.calibrationMode === nextMode);
        });
        document.getElementById('calibration-scan-mode')?.classList.toggle('hidden', nextMode !== 'scan');
        document.getElementById('calibration-manual-mode')?.classList.toggle('hidden', nextMode !== 'manual');
        document.getElementById('calibration-manual-search').value = '';
        document.getElementById('calibration-manual-search-results').innerHTML = '';
        document.getElementById('calibration-manual-search-results').style.display = 'none';
        if (!options.preserveForm) {
            document.getElementById('calibration-form-panel')?.classList.add('hidden');
            this.preview = null;
            this.resetOutboundControls();
        }
        if (nextMode === 'manual') {
            this.loadManualSelectors();
        } else {
            window.setTimeout(() => document.getElementById('calibration-barcode')?.focus(), 0);
        }
    },

    async loadFilterSelectors() {
        this.workGroups = await API.inventory.getWorkGroups();
        const workGroupSelect = document.getElementById('calibration-filter-work-group');
        if (workGroupSelect) {
            const selected = this.getSelectedValues('calibration-filter-work-group');
            workGroupSelect.innerHTML = this.workGroups
                .map((group) => `<option value="${group.id}">${this.escapeHtml(group.name)}</option>`)
                .join('');
            this.selectValues('calibration-filter-work-group', selected);
            Utils.syncCheckboxSelect('calibration-filter-work-group', '全部工作组');
        }
        await this.loadFilterInstruments();
    },

    async loadFilterInstruments() {
        const selectedGroups = this.getSelectedValues('calibration-filter-work-group');
        const selectedInstruments = this.getSelectedValues('calibration-filter-instrument');
        let instruments = await API.inventory.getInstruments(null);
        if (selectedGroups.length) {
            const selectedGroupSet = new Set(selectedGroups.map(String));
            instruments = instruments.filter((instrument) => selectedGroupSet.has(String(instrument.work_group_id)));
        }
        this.instruments = instruments;

        const instrumentSelect = document.getElementById('calibration-filter-instrument');
        if (!instrumentSelect) {
            return;
        }
        instrumentSelect.innerHTML = instruments
            .map((instrument) => `<option value="${instrument.id}">${this.escapeHtml(instrument.name)}</option>`)
            .join('');
        this.selectValues('calibration-filter-instrument', selectedInstruments);
        Utils.syncCheckboxSelect('calibration-filter-instrument', '全部仪器');
    },

    async loadManualSelectors() {
        const workGroupSelect = document.getElementById('calibration-manual-work-group');
        if (!workGroupSelect) return;
        const selectedWorkGroup = workGroupSelect.value || '';
        if (!this.workGroups.length) {
            this.workGroups = await API.inventory.getWorkGroups();
        }
        workGroupSelect.innerHTML = '<option value="">全部工作组</option>' + this.workGroups
            .map((group) => `<option value="${group.id}">${this.escapeHtml(group.name)}</option>`)
            .join('');
        workGroupSelect.value = selectedWorkGroup;
        await this.loadManualInstruments(false);
        await this.loadManualCalibrators();
    },

    async loadManualInstruments(resetCalibrator = true) {
        const workGroupId = document.getElementById('calibration-manual-work-group')?.value || '';
        const instrumentSelect = document.getElementById('calibration-manual-instrument');
        if (!instrumentSelect) return;
        const selectedInstrument = resetCalibrator ? '' : instrumentSelect.value || '';
        const instruments = await API.inventory.getInstruments(workGroupId || null);
        instrumentSelect.innerHTML = '<option value="">全部仪器</option>' + instruments
            .map((instrument) => `<option value="${instrument.id}">${this.escapeHtml(instrument.name)}</option>`)
            .join('');
        if (selectedInstrument && instruments.some((item) => String(item.id) === String(selectedInstrument))) {
            instrumentSelect.value = selectedInstrument;
        }
    },

    switchManualSourceType(sourceType) {
        this.manualSourceType = sourceType === 'reagent' ? 'reagent' : 'calibrator';
        const select = document.getElementById('calibration-manual-source-type');
        if (select) select.value = this.manualSourceType;
        const isReagent = this.manualSourceType === 'reagent';
        const calibratorLabel = document.getElementById('calibration-manual-calibrator-label');
        const batchLabel = document.getElementById('calibration-manual-batch-label');
        const searchInput = document.getElementById('calibration-manual-search');
        if (calibratorLabel) calibratorLabel.textContent = isReagent ? '试剂' : '校准品';
        if (batchLabel) batchLabel.textContent = isReagent ? '试剂批号' : '校准品批号';
        if (searchInput) searchInput.placeholder = isReagent ? '输入试剂、仪器或工作组关键词' : '输入校准品、仪器或工作组关键词';
        document.getElementById('calibration-form-panel')?.classList.add('hidden');
        this.preview = null;
        this.resetOutboundControls();
        this.loadManualCalibrators();
    },

    async loadManualCalibrators() {
        const calibratorSelect = document.getElementById('calibration-manual-calibrator');
        const batchSelect = document.getElementById('calibration-manual-batch');
        if (!calibratorSelect || !batchSelect) return;
        const previousCalibrator = calibratorSelect.value || '';
        const isReagent = this.manualSourceType === 'reagent';
        const reagents = await API.reagents.list({
            status: 'active',
            work_group_id: document.getElementById('calibration-manual-work-group')?.value || null,
            instrument_id: document.getElementById('calibration-manual-instrument')?.value || null,
        });
        this.manualCalibrators = isReagent
            ? reagents.filter((item) => !item.is_calibrator)
            : reagents.filter((item) => item.is_calibrator);
        const placeholder = isReagent ? '请选择试剂' : '请选择校准品';
        calibratorSelect.innerHTML = `<option value="">${placeholder}</option>` + this.manualCalibrators
            .map((item) => `<option value="${item.id}">${this.escapeHtml(item.name)} / ${this.escapeHtml(item.instrument_name || '')}</option>`)
            .join('');
        if (previousCalibrator && this.manualCalibrators.some((item) => String(item.id) === String(previousCalibrator))) {
            calibratorSelect.value = previousCalibrator;
            await this.selectManualCalibrator(false);
            return;
        }
        this.manualBatches = [];
        batchSelect.innerHTML = `<option value="">${isReagent ? '请先选择试剂' : '请先选择校准品'}</option>`;
        this.renderManualSummary();
    },

    async selectManualCalibrator(clearBatch = true) {
        const calibratorId = document.getElementById('calibration-manual-calibrator')?.value || '';
        const batchSelect = document.getElementById('calibration-manual-batch');
        if (!batchSelect) return;
        const isReagent = this.manualSourceType === 'reagent';
        if (!calibratorId) {
            this.manualBatches = [];
            batchSelect.innerHTML = `<option value="">${isReagent ? '请先选择试剂' : '请先选择校准品'}</option>`;
            this.renderManualSummary();
            return;
        }
        try {
            const previousBatch = clearBatch ? '' : batchSelect.value || '';
            const batches = await API.outbound.getStock(calibratorId);
            this.manualBatches = batches.filter((item) => Number(item.available_min_quantity || 0) > 0);
            if (!this.manualBatches.length) {
                batchSelect.innerHTML = '<option value="">暂无可用库存批号</option>';
                this.renderManualSummary();
                return;
            }
            batchSelect.innerHTML = this.manualBatches.map((batch) => `
                <option value="${batch.id}">
                    ${this.escapeHtml(batch.batch_no)} / ${this.escapeHtml(batch.expiry_date || '-')} / 库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit || '')}
                </option>
            `).join('');
            if (previousBatch && this.manualBatches.some((item) => String(item.id) === String(previousBatch))) {
                batchSelect.value = previousBatch;
            }
            this.renderManualSummary();
        } catch (error) {
            Utils.showToast(error.message || '校准品批号加载失败', 'error');
        }
    },

    renderManualSummary() {
        const summary = document.getElementById('calibration-manual-summary');
        if (!summary) return;
        const calibratorId = document.getElementById('calibration-manual-calibrator')?.value || '';
        const batchId = document.getElementById('calibration-manual-batch')?.value || '';
        const calibrator = this.manualCalibrators.find((item) => String(item.id) === String(calibratorId));
        const batch = this.manualBatches.find((item) => String(item.id) === String(batchId));
        if (!calibrator || !batch) {
            summary.classList.add('hidden');
            summary.innerHTML = '';
            return;
        }
        summary.classList.remove('hidden');
        summary.innerHTML = `
            <div class="outbound-preview-title">${this.escapeHtml(calibrator.name)}</div>
            <div class="item-card-meta">${this.escapeHtml(calibrator.work_group_name || '')} / ${this.escapeHtml(calibrator.instrument_name || '')}</div>
            <div class="item-card-submeta">批号 ${this.escapeHtml(batch.batch_no)} / 有效期 ${this.escapeHtml(batch.expiry_date || '-')} / 可用 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit || '')}</div>
        `;
    },

    searchManualCalibrators() {
        const input = document.getElementById('calibration-manual-search');
        const results = document.getElementById('calibration-manual-search-results');
        if (!input || !results) return;
        const keyword = input.value.trim().toLowerCase();
        if (!keyword) {
            this.manualSearchResults = [];
            results.innerHTML = '';
            results.style.display = 'none';
            return;
        }
        this.manualSearchResults = this.manualCalibrators
            .filter((item) => [item.name, item.work_group_name, item.instrument_name]
                .some((value) => String(value || '').toLowerCase().includes(keyword)))
            .slice(0, 8);
        if (!this.manualSearchResults.length) {
            const emptyText = this.manualSourceType === 'reagent' ? '没有匹配的试剂' : '没有匹配的校准品';
            results.innerHTML = `<div class="inventory-empty">${emptyText}</div>`;
            results.style.display = 'block';
            return;
        }
        results.innerHTML = this.manualSearchResults.map((item) => `
            <button class="candidate-item" type="button" onpointerdown="event.preventDefault();calibrationPage.selectManualCalibratorFromSearch(${item.id})">
                <span>${this.escapeHtml(item.name)}</span>
                <small>${this.escapeHtml(item.work_group_name || '')} / ${this.escapeHtml(item.instrument_name || '')}</small>
            </button>
        `).join('');
        results.style.display = 'block';
    },

    async selectManualCalibratorFromSearch(calibratorId) {
        const select = document.getElementById('calibration-manual-calibrator');
        if (!select) return;
        select.value = String(calibratorId);
        document.getElementById('calibration-manual-search-results').style.display = 'none';
        await this.selectManualCalibrator();
        const firstBatch = this.manualBatches[0];
        if (firstBatch) {
            document.getElementById('calibration-manual-batch').value = String(firstBatch.id);
            this.renderManualSummary();
        }
    },

    clearManualSelection() {
        this.manualSourceType = 'calibrator';
        const sourceTypeSelect = document.getElementById('calibration-manual-source-type');
        if (sourceTypeSelect) sourceTypeSelect.value = 'calibrator';
        const calibratorLabel = document.getElementById('calibration-manual-calibrator-label');
        const batchLabel = document.getElementById('calibration-manual-batch-label');
        const searchInput = document.getElementById('calibration-manual-search');
        if (calibratorLabel) calibratorLabel.textContent = '校准品';
        if (batchLabel) batchLabel.textContent = '校准品批号';
        if (searchInput) searchInput.placeholder = '输入校准品、仪器或工作组关键词';
        document.getElementById('calibration-manual-work-group').value = '';
        document.getElementById('calibration-manual-instrument').innerHTML = '<option value="">全部仪器</option>';
        document.getElementById('calibration-manual-calibrator').innerHTML = '<option value="">请选择校准品</option>';
        document.getElementById('calibration-manual-batch').innerHTML = '<option value="">请先选择校准品</option>';
        document.getElementById('calibration-manual-search').value = '';
        document.getElementById('calibration-manual-search-results').innerHTML = '';
        document.getElementById('calibration-manual-search-results').style.display = 'none';
        document.getElementById('calibration-form-panel')?.classList.add('hidden');
        this.preview = null;
        this.resetOutboundControls();
        this.manualCalibrators = [];
        this.manualBatches = [];
        this.renderManualSummary();
        this.loadManualSelectors();
    },

    async generateManualPreview() {
        const calibratorId = document.getElementById('calibration-manual-calibrator')?.value || '';
        const batchId = document.getElementById('calibration-manual-batch')?.value || '';
        if (!calibratorId || !batchId) {
            const msg = this.manualSourceType === 'reagent' ? '请先选择试剂和试剂批号' : '请先选择校准品和校准品批号';
            return Utils.showToast(msg, 'warning');
        }
        try {
            const preview = await API.calibration.manualPreview({
                calibrator_reagent_id: calibratorId,
                calibrator_batch_stock_id: batchId,
            });
            this.preview = preview;
            this.applyPreview(preview);
            Utils.showToast('已生成校准表单，可继续填写本次校准信息', 'success');
        } catch (error) {
            Utils.showToast(error.message || '生成校准表单失败', 'error');
        }
    },

    getRecordFilterParams(includeLimit = true) {
        const params = {
            work_group_ids: this.getSelectedValues('calibration-filter-work-group').join(','),
            instrument_ids: this.getSelectedValues('calibration-filter-instrument').join(','),
            keyword: document.getElementById('calibration-filter-keyword')?.value.trim() || '',
            source: document.getElementById('calibration-filter-source')?.value || '',
            start_date: document.getElementById('calibration-filter-start-date')?.value || '',
            end_date: document.getElementById('calibration-filter-end-date')?.value || '',
        };
        if (includeLimit) {
            params.limit = 50;
        }
        return params;
    },

    validateRecordFilterDates() {
        const startDate = document.getElementById('calibration-filter-start-date')?.value || '';
        const endDate = document.getElementById('calibration-filter-end-date')?.value || '';
        if (startDate && endDate && startDate > endDate) {
            Utils.showToast('开始日期不能晚于结束日期', 'warning');
            return false;
        }
        return true;
    },

    async loadRecentRecords() {
        if (!this.validateRecordFilterDates()) {
            return;
        }
        this.recentRecords = await API.calibration.listRecords(this.getRecordFilterParams(true));
        this.renderRecentRecords();
    },

    async exportRecords() {
        if (!this.validateRecordFilterDates()) {
            return;
        }
        try {
            await API.calibration.exportRecords(this.getRecordFilterParams(false));
            Utils.showToast('校准记录 Excel 已开始下载', 'success');
        } catch (error) {
            Utils.showToast(error.message || '导出校准记录失败', 'error');
        }
    },

    renderRecentRecords() {
        const list = document.getElementById('calibration-record-list');
        const meta = document.getElementById('calibration-record-meta');
        meta.textContent = `最近 ${this.recentRecords.length} 条`;

        if (!this.recentRecords.length) {
            list.innerHTML = '<div class="inventory-empty">暂时还没有校准记录。</div>';
            return;
        }

        list.innerHTML = this.recentRecords.map((record) => `
            <article class="inventory-card inventory-card-compact inventory-card-normal">
                <div class="inventory-card-accent"></div>
                <div class="inventory-card-header compact">
                    <div class="inventory-card-main">
                        <div class="inventory-card-title-row compact">
                            <div class="inventory-card-title-main compact">
                                <h4>${this.escapeHtml(record.calibrator_name)}</h4>
                                <span class="inventory-inline-meta">被校准 ${this.escapeHtml(record.target_reagent_name)}</span>
                            </div>
                            <button class="btn btn-secondary btn-small inventory-card-manage-btn" onclick="calibrationPage.openRecordModal(${record.id})">编辑结果</button>
                        </div>
                        <div class="inventory-key-metrics compact">
                            <div class="inventory-key-metric compact"><span>来源批号</span><strong>${this.escapeHtml(record.calibrator_batch_no)}</strong></div>
                            <div class="inventory-key-metric compact"><span>旧批号</span><strong>${this.escapeHtml(record.target_old_batch_no || '未填')}</strong></div>
                            <div class="inventory-key-metric compact"><span>新批号</span><strong>${this.escapeHtml(record.target_new_batch_no || '未填')}</strong></div>
                            <div class="inventory-key-metric compact"><span>校准用量</span><strong class="inventory-number-strong">${record.usage_times}</strong></div>
                        </div>
                        <div class="catalog-item-meta calibration-record-meta-row">${Utils.formatDateTime(record.created_at)} · ${this.escapeHtml(record.operator)} · ${this.escapeHtml(record.result_unit || '-')}</div>
                    </div>
                </div>
            </article>
        `).join('');
    },

    async scanPreview() {
        const barcode = document.getElementById('calibration-barcode').value.trim();
        if (!barcode) {
            return Utils.showToast('请先扫描校准条码', 'warning');
        }

        try {
            const preview = await API.calibration.scanPreview(barcode);
            this.preview = preview;
            this.applyPreview(preview);
            Utils.showToast('已识别校准来源，可继续填写本次校准信息', 'success');
        } catch (error) {
            Utils.showToast(error.message || '校准条码识别失败', 'error');
        }
    },

    applyPreview(preview) {
        document.getElementById('calibration-form-panel').classList.remove('hidden');
        document.getElementById('calibration-calibrator-name').value = preview.calibrator_name || '';
        document.getElementById('calibration-calibrator-batch').value = preview.calibrator_batch_no || '';
        const sourceLabel = preview.raw_barcode?.startsWith('MANUAL::')
            ? (preview.calibration_source === 'reagent' ? '手动选择试剂' : '手动选择校准品')
            : preview.calibration_source === 'reagent'
                ? '当前扫码试剂'
                : '当前校准品';
        document.getElementById('calibration-preview-meta').textContent = `${sourceLabel}可用库存 ${preview.calibrator_available_min_quantity} ${preview.calibrator_min_unit || '次'}`;
        document.getElementById('calibration-usage-times').value = String(preview.default_usage_times || 1);

        const targetSelect = document.getElementById('calibration-target-reagent');
        targetSelect.innerHTML = (preview.target_options || []).map((item) => `
            <option value="${item.reagent_id}" ${String(item.reagent_id) === String(preview.target_reagent_id || '') ? 'selected' : ''}>
                ${this.escapeHtml(item.reagent_name)}
            </option>
        `).join('');
        document.getElementById('calibration-result-unit').value = preview.result_unit || 'nmmol/L';
        this.syncCreateResultUnitNotes(preview.result_unit || 'nmmol/L');
        this.clearCreateResults();
        this.populateBatchSelect('calibration-old-batch', preview.old_batch_candidates || [], preview.default_old_batch_no);
        this.populateBatchSelect('calibration-new-batch', preview.new_batch_candidates || [], preview.default_new_batch_no);
        this.resetOutboundControls();
        this.loadOutboundBatches(preview.target_reagent_id);
    },

    populateBatchSelect(selectId, candidates, selectedBatchNo) {
        const select = document.getElementById(selectId);
        const normalizedSelected = selectedBatchNo || '';
        const hasSelected = !normalizedSelected || (candidates || []).some((item) => String(item.batch_no) === String(normalizedSelected));
        select.innerHTML = ['<option value="">未选择</option>'].concat(
            !hasSelected ? [`<option value="${this.escapeHtml(normalizedSelected)}">${this.escapeHtml(normalizedSelected)}</option>`] : [],
            (candidates || []).map((item) => `
                <option value="${this.escapeHtml(item.batch_no)}" ${String(item.batch_no) === String(selectedBatchNo || '') ? 'selected' : ''}>
                    ${this.escapeHtml(item.batch_no)} / ${this.escapeHtml(item.expiry_date)} / 库存 ${item.available_min_quantity}${this.escapeHtml(item.min_unit || '')}${item.is_archived ? ' / 已归档' : ''}
                </option>
            `)
        ).join('');
        select.value = normalizedSelected;
    },

    syncCreateResultUnitNotes(unitValue) {
        const unit = String(unitValue ?? '').trim() || '-';
        const text = `录入单位：${unit}`;
        const oldNote = document.getElementById('calibration-old-result-unit-note');
        const newNote = document.getElementById('calibration-new-result-unit-note');
        if (oldNote) oldNote.textContent = text;
        if (newNote) newNote.textContent = text;
    },

    clearCreateResults() {
        for (let i = 1; i <= 5; i += 1) {
            const oldInput = document.getElementById(`calibration-old-result-${i}`);
            const newInput = document.getElementById(`calibration-new-result-${i}`);
            if (oldInput) oldInput.value = '';
            if (newInput) newInput.value = '';
        }
    },

    normalizePositiveInteger(value, fallback = 1) {
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            return fallback;
        }
        return parsed;
    },

    resetOutboundControls() {
        this.outboundBatches = [];
        const checkbox = document.getElementById('calibration-outbound-enabled');
        if (checkbox) checkbox.checked = false;
        document.getElementById('calibration-outbound-controls')?.classList.add('hidden');
        const batchSelect = document.getElementById('calibration-outbound-batch');
        if (batchSelect) batchSelect.innerHTML = '<option value="">请先选择被校准试剂</option>';
        const quantityInput = document.getElementById('calibration-outbound-quantity');
        if (quantityInput) quantityInput.value = '1';
        const unitSelect = document.getElementById('calibration-outbound-unit');
        if (unitSelect) unitSelect.innerHTML = '<option value="package">盒</option><option value="min">最小单位</option>';
        const preview = document.getElementById('calibration-outbound-preview');
        if (preview) {
            preview.innerHTML = '';
            preview.classList.add('hidden');
        }
    },

    toggleOutboundControls() {
        const enabled = Boolean(document.getElementById('calibration-outbound-enabled')?.checked);
        document.getElementById('calibration-outbound-controls')?.classList.toggle('hidden', !enabled);
        if (enabled) {
            const targetId = document.getElementById('calibration-target-reagent')?.value;
            if (targetId && !this.outboundBatches.length) {
                this.loadOutboundBatches(targetId);
            } else {
                this.refreshOutboundPreview();
            }
        }
    },

    async loadOutboundBatches(targetReagentId) {
        const batchSelect = document.getElementById('calibration-outbound-batch');
        if (!batchSelect || !targetReagentId) return;
        try {
            const batches = await API.outbound.getStock(targetReagentId);
            this.outboundBatches = batches.filter((item) => Number(item.available_min_quantity || 0) > 0);
            if (!this.outboundBatches.length) {
                batchSelect.innerHTML = '<option value="">暂无可出库库存</option>';
                this.updateOutboundUnitOptions();
                return;
            }
            batchSelect.innerHTML = this.outboundBatches.map((batch) => `
                <option value="${batch.id}">
                    ${this.escapeHtml(batch.batch_no)} / ${this.escapeHtml(batch.expiry_date || '-')} / 库存 ${batch.available_min_quantity}${this.escapeHtml(batch.min_unit || '')}
                </option>
            `).join('');
            this.updateOutboundUnitOptions();
            this.refreshOutboundPreview();
        } catch (error) {
            Utils.showToast(error.message || '出库批号加载失败', 'warning');
        }
    },

    updateOutboundUnitOptions() {
        const unitSelect = document.getElementById('calibration-outbound-unit');
        const batchId = document.getElementById('calibration-outbound-batch')?.value || '';
        if (!unitSelect) return;
        const batch = this.outboundBatches.find((item) => String(item.id) === String(batchId));
        const selected = unitSelect.value || 'package';
        unitSelect.innerHTML = `
            <option value="package">${this.escapeHtml(batch?.package_unit || '盒')}</option>
            <option value="min">${this.escapeHtml(batch?.min_unit || '最小单位')}</option>
        `;
        unitSelect.value = selected === 'min' ? 'min' : 'package';
    },

    async refreshOutboundPreview() {
        const enabled = Boolean(document.getElementById('calibration-outbound-enabled')?.checked);
        const previewEl = document.getElementById('calibration-outbound-preview');
        if (!enabled || !previewEl) return;
        const batchId = document.getElementById('calibration-outbound-batch')?.value || '';
        const targetId = document.getElementById('calibration-target-reagent')?.value || '';
        const batch = this.outboundBatches.find((item) => String(item.id) === String(batchId));
        if (!targetId || !batch) {
            previewEl.innerHTML = '';
            previewEl.classList.add('hidden');
            return;
        }
        try {
            const outboundPreview = await API.outbound.preview({
                source: 'manual',
                reagent_id: targetId,
                quantity: this.normalizePositiveInteger(document.getElementById('calibration-outbound-quantity')?.value, 1),
                outbound_unit: document.getElementById('calibration-outbound-unit')?.value || 'package',
                deduction_mode: 'scanned_batch',
                raw_barcode: `DESKTOP_CALIBRATION_OUTBOUND::${targetId}`,
                scanned_batch_no: batch.batch_no,
                scanned_expiry_date: batch.expiry_date || null,
            });
            previewEl.innerHTML = `
                <div class="outbound-preview-title">${this.escapeHtml(outboundPreview.reagent_name || '')}</div>
                <div class="item-card-meta">将同步出库 ${this.escapeHtml(String(outboundPreview.requested_quantity))}${this.escapeHtml(outboundPreview.outbound_unit === 'package' ? outboundPreview.package_unit : outboundPreview.min_unit)}</div>
                <div class="item-card-submeta">批号 ${this.escapeHtml(outboundPreview.selected_batch_no || batch.batch_no)} / 剩余库存将按当前批号扣减</div>
            `;
            previewEl.classList.remove('hidden');
        } catch (error) {
            previewEl.innerHTML = `<div class="item-card-submeta">${this.escapeHtml(error.message || '出库预览失败')}</div>`;
            previewEl.classList.remove('hidden');
        }
    },

    async loadTargetPreview(targetReagentId, preserveSelection = true) {
        if (!targetReagentId) {
            this.populateBatchSelect('calibration-old-batch', [], '');
            this.populateBatchSelect('calibration-new-batch', [], '');
            document.getElementById('calibration-result-unit').value = '';
            this.syncCreateResultUnitNotes('');
            this.resetOutboundControls();
            return;
        }

        const oldValue = preserveSelection ? document.getElementById('calibration-old-batch').value : '';
        const newValue = preserveSelection ? document.getElementById('calibration-new-batch').value : '';
        const payload = await API.calibration.targetPreview(targetReagentId);
        document.getElementById('calibration-result-unit').value = payload.result_unit || 'nmmol/L';
        this.syncCreateResultUnitNotes(payload.result_unit || 'nmmol/L');
        this.populateBatchSelect(
            'calibration-old-batch',
            payload.old_batch_candidates || [],
            oldValue || payload.default_old_batch_no
        );
        this.populateBatchSelect(
            'calibration-new-batch',
            payload.new_batch_candidates || [],
            newValue || payload.default_new_batch_no
        );
        this.resetOutboundControls();
        await this.loadOutboundBatches(targetReagentId);
    },

    async saveCalibration() {
        if (!this.preview) {
            return Utils.showToast('请先扫码识别或手动生成校准表单', 'warning');
        }

        const payload = {
            calibrator_reagent_id: this.preview.calibrator_reagent_id,
            calibrator_batch_stock_id: this.preview.calibrator_batch_stock_id,
            target_reagent_id: parseInt(document.getElementById('calibration-target-reagent').value, 10),
            target_old_batch_no: document.getElementById('calibration-old-batch').value || null,
            target_new_batch_no: document.getElementById('calibration-new-batch').value || null,
            usage_times: this.normalizePositiveInteger(document.getElementById('calibration-usage-times').value, 1),
            result_unit: document.getElementById('calibration-result-unit').value || 'nmmol/L',
            operator: document.getElementById('calibration-operator').value || '',
            raw_barcode: this.preview.raw_barcode,
            auto_outbound_package: false,
        };

        for (let i = 1; i <= 5; i += 1) {
            payload[`old_result_${i}`] = document.getElementById(`calibration-old-result-${i}`)?.value.trim() || null;
            payload[`new_result_${i}`] = document.getElementById(`calibration-new-result-${i}`)?.value.trim() || null;
        }

        if (!payload.target_reagent_id || !payload.operator) {
            return Utils.showToast('请先确认被校准试剂和操作人', 'warning');
        }

        if (document.getElementById('calibration-outbound-enabled')?.checked) {
            const outboundBatchId = document.getElementById('calibration-outbound-batch')?.value || '';
            if (!outboundBatchId) {
                return Utils.showToast('请选择要同步出库的试剂批号', 'warning');
            }
            payload.auto_outbound_package = true;
            payload.outbound_batch_stock_id = parseInt(outboundBatchId, 10);
            payload.outbound_quantity = this.normalizePositiveInteger(document.getElementById('calibration-outbound-quantity')?.value, 1);
            payload.outbound_unit = document.getElementById('calibration-outbound-unit')?.value || 'package';
        }

        try {
            await API.calibration.createRecord(payload);
            Utils.showToast(payload.auto_outbound_package ? '校准记录已保存，并已同步出库' : '校准记录已保存', 'success');
            document.getElementById('calibration-barcode').value = '';
            document.getElementById('calibration-form-panel').classList.add('hidden');
            this.preview = null;
            this.resetOutboundControls();
            await this.loadRecentRecords();
            if (typeof inventoryPage !== 'undefined' && inventoryPage.initialized) {
                inventoryPage.loadInventory();
            }
        } catch (error) {
            Utils.showToast(error.message || '保存校准记录失败', 'error');
        }
    },

    async openRecordModal(recordId) {
        try {
            const record = await API.calibration.getRecord(recordId);
            this.editRecordId = recordId;
            this.fillRecordModal(record);
            document.getElementById('calibration-record-modal').classList.remove('hidden');
        } catch (error) {
            Utils.showToast(error.message || '加载校准记录失败', 'error');
        }
    },

    fillRecordModal(record) {
        const targetSelect = document.getElementById('calibration-edit-target-reagent');
        targetSelect.innerHTML = (record.target_options || []).map((item) => `
            <option value="${item.reagent_id}" ${String(item.reagent_id) === String(record.target_reagent_id) ? 'selected' : ''}>
                ${this.escapeHtml(item.reagent_name)}
            </option>
        `).join('');
        document.getElementById('calibration-edit-result-unit').value = record.result_unit || 'nmmol/L';
        this.syncEditResultUnitNotes(record.result_unit || 'nmmol/L');
        document.getElementById('calibration-edit-usage-times').value = String(record.usage_times || 1);
        document.getElementById('calibration-edit-operator').value = record.operator || '';
        this.populateBatchSelect('calibration-edit-old-batch', record.old_batch_candidates || [], record.target_old_batch_no);
        this.populateBatchSelect('calibration-edit-new-batch', record.new_batch_candidates || [], record.target_new_batch_no);
        for (let i = 1; i <= 5; i += 1) {
            document.getElementById(`calibration-edit-old-result-${i}`).value = record[`old_result_${i}`] || '';
            document.getElementById(`calibration-edit-new-result-${i}`).value = record[`new_result_${i}`] || '';
        }
    },

    async loadEditTargetPreview(targetReagentId) {
        if (!targetReagentId) {
            return;
        }
        const payload = await API.calibration.targetPreview(targetReagentId);
        document.getElementById('calibration-edit-result-unit').value = payload.result_unit || 'nmmol/L';
        this.syncEditResultUnitNotes(payload.result_unit || 'nmmol/L');
        this.populateBatchSelect('calibration-edit-old-batch', payload.old_batch_candidates || [], payload.default_old_batch_no);
        this.populateBatchSelect('calibration-edit-new-batch', payload.new_batch_candidates || [], payload.default_new_batch_no);
    },

    syncEditResultUnitNotes(unitValue) {
        const unit = String(unitValue ?? '').trim() || '-';
        const text = `录入单位：${unit}`;
        const oldNote = document.getElementById('calibration-edit-old-result-unit-note');
        const newNote = document.getElementById('calibration-edit-new-result-unit-note');
        if (oldNote) oldNote.textContent = text;
        if (newNote) newNote.textContent = text;
    },

    closeRecordModal() {
        this.editRecordId = null;
        document.getElementById('calibration-record-modal').classList.add('hidden');
    },

    async saveRecordModal() {
        if (!this.editRecordId) {
            return;
        }

        const payload = {
            target_reagent_id: parseInt(document.getElementById('calibration-edit-target-reagent').value, 10),
            target_old_batch_no: document.getElementById('calibration-edit-old-batch').value || null,
            target_new_batch_no: document.getElementById('calibration-edit-new-batch').value || null,
            usage_times: Math.max(parseInt(document.getElementById('calibration-edit-usage-times').value, 10) || 1, 1),
            result_unit: document.getElementById('calibration-edit-result-unit').value || 'nmmol/L',
            operator: document.getElementById('calibration-edit-operator').value || '',
        };
        for (let i = 1; i <= 5; i += 1) {
            payload[`old_result_${i}`] = document.getElementById(`calibration-edit-old-result-${i}`).value || null;
            payload[`new_result_${i}`] = document.getElementById(`calibration-edit-new-result-${i}`).value || null;
        }

        if (!payload.target_reagent_id || !payload.operator) {
            return Utils.showToast('请先完整填写校准记录主信息', 'warning');
        }

        try {
            await API.calibration.updateRecord(this.editRecordId, payload);
            Utils.showToast('校准记录已更新', 'success');
            this.closeRecordModal();
            await this.loadRecentRecords();
        } catch (error) {
            Utils.showToast(error.message || '更新校准记录失败', 'error');
        }
    }
};

window.calibrationPage = calibrationPage;
