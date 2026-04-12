const calibrationPage = {
    initialized: false,
    operators: [],
    workGroups: [],
    instruments: [],
    preview: null,
    recentRecords: [],
    editRecordId: null,

    async init() {
        if (!this.initialized) {
            this.bindEvents();
            this.initialized = true;
        }
        await this.loadOperators();
        await this.loadFilterSelectors();
        await this.loadRecentRecords();
        window.setTimeout(() => {
            document.getElementById('calibration-barcode')?.focus();
        }, 0);
    },

    bindEvents() {
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
        document.getElementById('calibration-save-btn')?.addEventListener('click', () => this.saveCalibration());

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
        const sourceLabel = preview.calibration_source === 'reagent' ? '当前扫码试剂' : '当前校准品';
        document.getElementById('calibration-preview-meta').textContent = `${sourceLabel}可用库存 ${preview.calibrator_available_min_quantity} ${preview.calibrator_min_unit || '次'}`;
        document.getElementById('calibration-usage-times').value = String(preview.default_usage_times || 1);

        const targetSelect = document.getElementById('calibration-target-reagent');
        targetSelect.innerHTML = (preview.target_options || []).map((item) => `
            <option value="${item.reagent_id}" ${String(item.reagent_id) === String(preview.target_reagent_id || '') ? 'selected' : ''}>
                ${this.escapeHtml(item.reagent_name)}
            </option>
        `).join('');
        document.getElementById('calibration-result-unit').value = preview.result_unit || 'nmmol/L';
        this.populateBatchSelect('calibration-old-batch', preview.old_batch_candidates || [], preview.default_old_batch_no);
        this.populateBatchSelect('calibration-new-batch', preview.new_batch_candidates || [], preview.default_new_batch_no);
    },

    populateBatchSelect(selectId, candidates, selectedBatchNo) {
        const select = document.getElementById(selectId);
        select.innerHTML = ['<option value="">未选择</option>'].concat(
            (candidates || []).map((item) => `
                <option value="${this.escapeHtml(item.batch_no)}" ${String(item.batch_no) === String(selectedBatchNo || '') ? 'selected' : ''}>
                    ${this.escapeHtml(item.batch_no)} / ${this.escapeHtml(item.expiry_date)} / 库存 ${item.available_min_quantity}${this.escapeHtml(item.min_unit || '')}
                </option>
            `)
        ).join('');
    },

    async loadTargetPreview(targetReagentId, preserveSelection = true) {
        if (!targetReagentId) {
            this.populateBatchSelect('calibration-old-batch', [], '');
            this.populateBatchSelect('calibration-new-batch', [], '');
            document.getElementById('calibration-result-unit').value = '';
            return;
        }

        const oldValue = preserveSelection ? document.getElementById('calibration-old-batch').value : '';
        const newValue = preserveSelection ? document.getElementById('calibration-new-batch').value : '';
        const payload = await API.calibration.targetPreview(targetReagentId);
        document.getElementById('calibration-result-unit').value = payload.result_unit || 'nmmol/L';
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
    },

    async saveCalibration() {
        if (!this.preview) {
            return Utils.showToast('请先扫描校准条码', 'warning');
        }

        const payload = {
            calibrator_reagent_id: this.preview.calibrator_reagent_id,
            calibrator_batch_stock_id: this.preview.calibrator_batch_stock_id,
            target_reagent_id: parseInt(document.getElementById('calibration-target-reagent').value, 10),
            target_old_batch_no: document.getElementById('calibration-old-batch').value || null,
            target_new_batch_no: document.getElementById('calibration-new-batch').value || null,
            usage_times: Math.max(parseInt(document.getElementById('calibration-usage-times').value, 10) || 1, 1),
            result_unit: document.getElementById('calibration-result-unit').value || 'nmmol/L',
            operator: document.getElementById('calibration-operator').value || '',
            raw_barcode: this.preview.raw_barcode,
            auto_outbound_package: false,
        };

        if (!payload.target_reagent_id || !payload.operator) {
            return Utils.showToast('请先确认被校准试剂和操作人', 'warning');
        }

        if (this.preview.calibration_source === 'reagent') {
            const packageUnit = '盒';
            payload.auto_outbound_package = window.confirm(
                `是否同时出库 1${packageUnit}该试剂？\n\n` +
                `试剂：${this.preview.calibrator_name || ''}\n` +
                `批号：${this.preview.calibrator_batch_no || ''}\n` +
                `操作人：${payload.operator}\n\n` +
                '确认后会保存本次校准记录，并同步生成一条出库流水。'
            );
        }

        try {
            await API.calibration.createRecord(payload);
            Utils.showToast(payload.auto_outbound_package ? '校准记录已保存，并已同步出库 1 盒' : '校准记录已保存', 'success');
            document.getElementById('calibration-barcode').value = '';
            document.getElementById('calibration-form-panel').classList.add('hidden');
            this.preview = null;
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
