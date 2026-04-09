const calibrationPage = {
    initialized: false,
    operators: [],
    preview: null,
    recentRecords: [],
    editRecordId: null,

    async init() {
        if (!this.initialized) {
            this.bindEvents();
            this.initialized = true;
        }
        await this.loadOperators();
        await this.loadRecentRecords();
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

    async loadRecentRecords() {
        this.recentRecords = await API.calibration.listRecords(20);
        this.renderRecentRecords();
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
                            <h4>${this.escapeHtml(record.calibrator_name)}</h4>
                            <span class="inventory-inline-meta">被校准 ${this.escapeHtml(record.target_reagent_name)}</span>
                        </div>
                        <div class="inventory-key-metrics compact">
                            <div class="inventory-key-metric compact"><span>校准品批号</span><strong>${this.escapeHtml(record.calibrator_batch_no)}</strong></div>
                            <div class="inventory-key-metric compact"><span>旧批号</span><strong>${this.escapeHtml(record.target_old_batch_no || '未填')}</strong></div>
                            <div class="inventory-key-metric compact"><span>新批号</span><strong>${this.escapeHtml(record.target_new_batch_no || '未填')}</strong></div>
                            <div class="inventory-key-metric compact"><span>校准用量</span><strong>${record.usage_times}</strong></div>
                        </div>
                        <div class="catalog-item-meta">${Utils.formatDateTime(record.created_at)} / ${this.escapeHtml(record.operator)}</div>
                    </div>
                    <div class="inventory-card-actions compact">
                        <button class="btn btn-secondary btn-small" onclick="calibrationPage.openRecordModal(${record.id})">编辑结果</button>
                    </div>
                </div>
            </article>
        `).join('');
    },

    async scanPreview() {
        const barcode = document.getElementById('calibration-barcode').value.trim();
        if (!barcode) {
            return Utils.showToast('请先扫描校准品条码', 'warning');
        }

        try {
            const preview = await API.calibration.scanPreview(barcode);
            this.preview = preview;
            this.applyPreview(preview);
            Utils.showToast('已识别校准品，可继续填写本次校准信息', 'success');
        } catch (error) {
            Utils.showToast(error.message || '校准品识别失败', 'error');
        }
    },

    applyPreview(preview) {
        document.getElementById('calibration-form-panel').classList.remove('hidden');
        document.getElementById('calibration-calibrator-name').value = preview.calibrator_name || '';
        document.getElementById('calibration-calibrator-batch').value = preview.calibrator_batch_no || '';
        document.getElementById('calibration-preview-meta').textContent = `当前校准品可用库存 ${preview.calibrator_available_min_quantity} ${preview.calibrator_min_unit || '次'}`;
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
            return Utils.showToast('请先扫描校准品', 'warning');
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
        };

        if (!payload.target_reagent_id || !payload.operator) {
            return Utils.showToast('请先确认被校准试剂和操作人', 'warning');
        }

        try {
            await API.calibration.createRecord(payload);
            Utils.showToast('校准记录已保存', 'success');
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
        this.populateBatchSelect('calibration-edit-old-batch', payload.old_batch_candidates || [], payload.default_old_batch_no);
        this.populateBatchSelect('calibration-edit-new-batch', payload.new_batch_candidates || [], payload.default_new_batch_no);
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
