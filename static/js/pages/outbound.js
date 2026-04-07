const outboundPage = {
    currentMode: 'scan',
    initialized: false,
    isSubmitting: false,
    scanDraft: null,
    pendingItems: [],
    manualReagents: [],
    manualSearchResults: [],
    selectedManualReagent: null,
    candidateModalContext: null,
    modeContainerSelector: '#dashboard-outbound-panel',

    async init() {
        await Utils.loadOperators();
        await Utils.populateOperatorSelect('outbound-default-operator', {
            allowEmpty: true,
            emptyLabel: '可先选择默认出库人'
        });
        await Utils.populateOperatorSelect('outbound-confirm-operator');

        const lastOperator = Utils.getValidOperator(Utils.getLastOperator());
        if (lastOperator) {
            this.syncOperator(lastOperator);
        }

        if (!this.initialized) {
            this.initialized = true;
            this.setupEventListeners();
        }

        this.switchMode(this.currentMode);
        this.renderScanDraft();
        this.renderPendingItems();
    },

    setupEventListeners() {
        const barcodeInput = document.getElementById('outbound-barcode');
        barcodeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.parseBarcode();
            }
        });

        document.getElementById('outbound-scan-quantity').addEventListener('change', () => {
            this.refreshScanDraftPreview();
        });
        document.getElementById('outbound-manual-quantity').addEventListener('change', () => {
            this.refreshManualPreview();
        });

        const confirmModal = document.getElementById('outbound-confirm-modal');
        confirmModal.addEventListener('click', (event) => {
            if (event.target === confirmModal) {
                this.closeConfirmModal();
            }
        });
    },

    switchMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll(`${this.modeContainerSelector} .mode-tab[data-mode]`).forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });
        document.getElementById('outbound-scan-mode').classList.toggle('hidden', mode !== 'scan');
        document.getElementById('outbound-manual-mode').classList.toggle('hidden', mode !== 'manual');

        if (mode === 'scan') {
            document.getElementById('outbound-barcode').focus();
            return;
        }

        this.loadManualWorkGroups();
    },

    createItemId() {
        return Date.now() + Math.floor(Math.random() * 1000);
    },

    updateUnitSelect(selectId, packageUnit = '盒', minUnit = '瓶', selectedValue = 'min') {
        const select = document.getElementById(selectId);
        if (!select) {
            return;
        }

        const preferredValue = selectedValue === 'package' ? 'package' : 'min';
        select.innerHTML = `
            <option value="min">${this.escapeHtml(minUnit || '瓶')}</option>
            <option value="package">${this.escapeHtml(packageUnit || '盒')}</option>
        `;
        select.value = preferredValue;
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
        if (Number.isNaN(parsed) || parsed <= 0) {
            return fallback;
        }
        return parsed;
    },

    formatPackageRelation(packageUnit, packageToMinQty, minUnit) {
        return `1${packageUnit} = ${packageToMinQty}${minUnit}`;
    },

    formatBatchAvailability(batch, packageUnit, minUnit) {
        const wholePackages = `${batch.package_quantity}${packageUnit}`;
        if (!batch.loose_min_quantity) {
            return wholePackages;
        }
        return `${wholePackages} + ${batch.loose_min_quantity}${minUnit}`;
    },

    formatRequestedQuantity(item) {
        const unit = item.outboundUnit === 'package' ? item.packageUnit : item.minUnit;
        return `${item.requestedQuantity} ${unit}`;
    },

    buildPreviewMessage(preview) {
        const totalPackageText = `${preview.total_package_quantity}${preview.package_unit}`;
        const totalMinText = `${preview.total_min_quantity}${preview.min_unit}`;
        const selectedBatchText = preview.selected_batch_no
            ? `扫码批号：${this.escapeHtml(preview.selected_batch_no)}`
            : '按效期优先扣减';
        const expiredText = preview.contains_expired ? '含过期批次' : '无过期批次';

        return `
            <div class="outbound-preview-title">${this.escapeHtml(preview.reagent_name)}</div>
            <div class="item-card-meta">${this.escapeHtml(preview.work_group_name || '未配置工作组')} / ${this.escapeHtml(preview.instrument_name || '未配置仪器')}</div>
            <div class="item-card-submeta">总库存：${this.escapeHtml(totalPackageText)}，折合 ${this.escapeHtml(totalMinText)} | ${this.escapeHtml(selectedBatchText)} | ${this.escapeHtml(expiredText)}</div>
            <div class="outbound-preview-batches">${preview.deducted_batches.map((batch) => `
                <div class="outbound-preview-batch">
                    <span>批号：${this.escapeHtml(batch.batch_no)}</span>
                    <span>效期：${this.escapeHtml(batch.expiry_date)}</span>
                    <span>可用：${this.escapeHtml(this.formatBatchAvailability(batch, preview.package_unit, preview.min_unit))}</span>
                </div>
            `).join('')}</div>
        `;
    },

    buildPendingItem(preview, extra = {}) {
        return {
            id: extra.id || this.createItemId(),
            source: extra.source || 'manual',
            rawBarcode: extra.rawBarcode || '',
            reagentId: preview.reagent_id,
            reagentName: preview.reagent_name,
            instrumentId: preview.instrument_id,
            instrumentName: preview.instrument_name || '',
            workGroupId: preview.work_group_id,
            workGroupName: preview.work_group_name || '',
            packageUnit: preview.package_unit,
            minUnit: preview.min_unit,
            packageToMinQty: preview.package_to_min_qty,
            requestedQuantity: preview.requested_quantity,
            requestedMinQuantity: preview.requested_min_quantity,
            outboundUnit: preview.outbound_unit,
            deductionMode: preview.deduction_mode,
            scannedBatchNo: preview.selected_batch_no || extra.scannedBatchNo || null,
            scannedExpiryDate: preview.selected_expiry_date || extra.scannedExpiryDate || null,
            containsExpired: preview.contains_expired,
            previewDeduction: preview.deducted_batches,
            totalPackageQuantity: preview.total_package_quantity,
            totalMinQuantity: preview.total_min_quantity
        };
    },

    findMergeTarget(nextItem) {
        return this.pendingItems.find((item) => (
            item.source === nextItem.source
            && item.reagentId === nextItem.reagentId
            && item.deductionMode === nextItem.deductionMode
            && item.outboundUnit === nextItem.outboundUnit
            && (item.scannedBatchNo || '') === (nextItem.scannedBatchNo || '')
        ));
    },

    async queuePendingItem(nextItem) {
        const mergeTarget = this.findMergeTarget(nextItem);
        if (!mergeTarget) {
            this.pendingItems.push({ ...nextItem, id: this.createItemId() });
            this.renderPendingItems();
            return;
        }

        mergeTarget.requestedQuantity += nextItem.requestedQuantity;
        await this.repreviewItem(mergeTarget);
        this.renderPendingItems();
    },

    async parseBarcode() {
        const barcode = document.getElementById('outbound-barcode').value.trim();
        if (!barcode) {
            Utils.showToast('请输入条码', 'warning');
            return;
        }

        try {
            const result = await API.barcode.parse(barcode);
            if (result.match_type === 'none') {
                Utils.showToast('未识别到已建档试剂', 'error');
                return;
            }

            if (result.match_type === 'prefix' && result.reagent_id === null && result.candidates.length > 0) {
                this.showCandidateSelection(result, barcode);
                return;
            }

            await this.prepareScanDraft(result, barcode);
        } catch (error) {
            Utils.showToast('扫码识别失败: ' + error.message, 'error');
        }
    },

    async prepareScanDraft(result, barcode, candidate = null) {
        const selected = candidate || {};
        const previewRequest = {
            source: 'scan',
            reagent_id: selected.id ?? result.reagent_id,
            quantity: this.normalizePositiveInteger(document.getElementById('outbound-scan-quantity').value, 1),
            outbound_unit: document.getElementById('outbound-scan-unit').value || 'min',
            deduction_mode: result.extracted_batch_no ? 'scanned_batch' : 'fefo',
            raw_barcode: barcode,
            scanned_batch_no: result.extracted_batch_no || null,
            scanned_expiry_date: result.extracted_expiry_date || null
        };

        const preview = await API.outbound.preview(previewRequest);

        if (preview.deduction_mode === 'scanned_batch' && preview.has_earlier_expiring_batch) {
            const earliest = preview.earlier_expiring_batches[0];
            const continueCurrent = confirm(
                `当前扫码批号 ${preview.selected_batch_no} 不是最早到期批次。\n` +
                `更早到期批次：${earliest.batch_no}，效期 ${earliest.expiry_date}。\n\n` +
                '确定继续当前批次出库吗？点击“取消”后请重新扫码。'
            );
            if (!continueCurrent) {
                document.getElementById('outbound-barcode').value = '';
                document.getElementById('outbound-barcode').focus();
                this.scanDraft = null;
                this.renderScanDraft();
                return;
            }
        }

        this.scanDraft = this.buildPendingItem(preview, {
            source: 'scan',
            rawBarcode: barcode,
            scannedBatchNo: previewRequest.scanned_batch_no,
            scannedExpiryDate: previewRequest.scanned_expiry_date
        });
        this.renderScanDraft();
    },

    async refreshScanDraftPreview() {
        if (!this.scanDraft) {
            return;
        }

        try {
            const preview = await API.outbound.preview({
                source: 'scan',
                reagent_id: this.scanDraft.reagentId,
                quantity: this.normalizePositiveInteger(document.getElementById('outbound-scan-quantity').value, 1),
                outbound_unit: document.getElementById('outbound-scan-unit').value || 'min',
                deduction_mode: this.scanDraft.deductionMode,
                raw_barcode: this.scanDraft.rawBarcode,
                scanned_batch_no: this.scanDraft.scannedBatchNo,
                scanned_expiry_date: this.scanDraft.scannedExpiryDate
            });

            this.scanDraft = this.buildPendingItem(preview, {
                id: this.scanDraft.id,
                source: 'scan',
                rawBarcode: this.scanDraft.rawBarcode,
                scannedBatchNo: this.scanDraft.scannedBatchNo,
                scannedExpiryDate: this.scanDraft.scannedExpiryDate
            });
            this.renderScanDraft();
        } catch (error) {
            Utils.showToast('更新扫码条目失败: ' + error.message, 'warning');
        }
    },

    renderScanDraft() {
        const section = document.getElementById('outbound-scan-draft');
        const previewEl = document.getElementById('outbound-scan-preview');

        if (!this.scanDraft) {
            section.classList.add('hidden');
            this.updateUnitSelect('outbound-scan-unit', '盒', '瓶', 'min');
            previewEl.innerHTML = '';
            return;
        }

        section.classList.remove('hidden');
        this.updateUnitSelect(
            'outbound-scan-unit',
            this.scanDraft.packageUnit,
            this.scanDraft.minUnit,
            this.scanDraft.outboundUnit
        );
        document.getElementById('outbound-scan-quantity').value = String(this.scanDraft.requestedQuantity);
        previewEl.innerHTML = this.buildPreviewMessage({
            reagent_name: this.scanDraft.reagentName,
            work_group_name: this.scanDraft.workGroupName,
            instrument_name: this.scanDraft.instrumentName,
            total_package_quantity: this.scanDraft.totalPackageQuantity,
            total_min_quantity: this.scanDraft.totalMinQuantity,
            package_unit: this.scanDraft.packageUnit,
            min_unit: this.scanDraft.minUnit,
            selected_batch_no: this.scanDraft.scannedBatchNo,
            contains_expired: this.scanDraft.containsExpired,
            deducted_batches: this.scanDraft.previewDeduction
        });
    },

    clearScanDraft() {
        this.scanDraft = null;
        this.renderScanDraft();
        document.getElementById('outbound-barcode').value = '';
        document.getElementById('outbound-barcode').focus();
    },

    async addScanItem() {
        if (!this.scanDraft) {
            Utils.showToast('请先扫码识别试剂', 'warning');
            return;
        }

        await this.refreshScanDraftPreview();
        if (!this.scanDraft) {
            return;
        }

        await this.queuePendingItem(this.scanDraft);
        Utils.showToast('已加入待出库列表', 'success');
        this.clearScanDraft();
    },

    showCandidateSelection(result, barcode) {
        this.closeCandidateModal();

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'outbound-candidate-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>选择试剂</h3>
                    <button class="modal-close" onclick="outboundPage.closeCandidateModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <p>当前条码匹配到多个试剂，请选择正确项后继续出库。</p>
                    <div class="candidate-list">
                        ${result.candidates.map((candidate) => `
                            <div class="candidate-item" onclick="outboundPage.selectCandidateFromModal(${candidate.id})">
                                <div>
                                    <div class="candidate-name">${this.escapeHtml(candidate.name)}</div>
                                    <div class="candidate-meta">${this.escapeHtml(candidate.work_group_name || '未配置工作组')} / ${this.escapeHtml(candidate.instrument_name || '未配置仪器')}</div>
                                </div>
                                <button class="btn btn-secondary">选择</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.closeCandidateModal();
            }
        });

        this.candidateModalContext = { result, barcode };
        document.body.appendChild(modal);
    },

    closeCandidateModal() {
        const modal = document.getElementById('outbound-candidate-modal');
        if (modal) {
            modal.remove();
        }
        this.candidateModalContext = null;
    },

    async selectCandidateFromModal(candidateId) {
        if (!this.candidateModalContext) {
            return;
        }

        const candidate = this.candidateModalContext.result.candidates.find((item) => item.id === candidateId);
        if (!candidate) {
            return;
        }

        const context = this.candidateModalContext;
        this.closeCandidateModal();
        await this.prepareScanDraft(context.result, context.barcode, candidate);
    },

    async loadManualWorkGroups() {
        try {
            const groups = await API.inventory.getWorkGroups();
            const select = document.getElementById('outbound-manual-work-group');
            const currentValue = select.value;
            select.innerHTML = '<option value="">全部工作组</option>';
            groups.forEach((group) => {
                select.innerHTML += `<option value="${group.id}">${this.escapeHtml(group.name)}</option>`;
            });
            select.value = currentValue;
            await this.loadManualInstruments();
        } catch (error) {
            Utils.showToast('工作组加载失败: ' + error.message, 'error');
        }
    },

    async loadManualInstruments() {
        const workGroupId = document.getElementById('outbound-manual-work-group').value;
        const select = document.getElementById('outbound-manual-instrument');
        select.innerHTML = '<option value="">全部仪器</option>';

        try {
            const instruments = await API.inventory.getInstruments(workGroupId || null);
            instruments.forEach((instrument) => {
                select.innerHTML += `<option value="${instrument.id}">${this.escapeHtml(instrument.name)}</option>`;
            });
            await this.loadManualReagents();
        } catch (error) {
            Utils.showToast('仪器加载失败: ' + error.message, 'error');
        }
    },

    async loadManualReagents() {
        try {
            this.manualReagents = await API.outbound.searchReagents({
                work_group_id: document.getElementById('outbound-manual-work-group').value || null,
                instrument_id: document.getElementById('outbound-manual-instrument').value || null
            });

            const select = document.getElementById('outbound-manual-reagent');
            const currentValue = this.selectedManualReagent ? String(this.selectedManualReagent.reagent_id) : '';
            select.innerHTML = '<option value="">请选择试剂</option>';
            this.manualReagents.forEach((item) => {
                select.innerHTML += `<option value="${item.reagent_id}">${this.escapeHtml(item.reagent_name)}</option>`;
            });
            if (this.manualReagents.some((item) => String(item.reagent_id) === currentValue)) {
                select.value = currentValue;
            }
        } catch (error) {
            Utils.showToast('试剂加载失败: ' + error.message, 'error');
        }
    },

    async searchManualReagents() {
        const keyword = document.getElementById('outbound-manual-search').value.trim();
        const resultList = document.getElementById('outbound-manual-search-results');

        if (!keyword) {
            this.manualSearchResults = [];
            resultList.classList.add('hidden');
            resultList.innerHTML = '';
            return;
        }

        try {
            this.manualSearchResults = await API.outbound.searchReagents({
                q: keyword,
                work_group_id: document.getElementById('outbound-manual-work-group').value || null,
                instrument_id: document.getElementById('outbound-manual-instrument').value || null
            });

            if (this.manualSearchResults.length === 0) {
                resultList.classList.remove('hidden');
                resultList.innerHTML = '<p class="catalog-empty">未搜索到可出库试剂</p>';
                return;
            }

            resultList.classList.remove('hidden');
            resultList.innerHTML = this.manualSearchResults.map((item) => `
                <div class="candidate-item" onclick="outboundPage.selectManualReagent(${item.reagent_id}, true)">
                    <div>
                        <div class="candidate-name">${this.escapeHtml(item.reagent_name)}</div>
                        <div class="candidate-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)} | 库存 ${item.total_package_quantity}${this.escapeHtml(item.package_unit)}，折合 ${item.total_min_quantity}${this.escapeHtml(item.min_unit)}</div>
                    </div>
                    <button class="btn btn-secondary">选择</button>
                </div>
            `).join('');
        } catch (error) {
            Utils.showToast('搜索试剂失败: ' + error.message, 'error');
        }
    },

    selectManualReagentFromDropdown() {
        const reagentId = parseInt(document.getElementById('outbound-manual-reagent').value, 10);
        if (!reagentId) {
            this.selectedManualReagent = null;
            this.renderManualSummary();
            return;
        }
        this.selectManualReagent(reagentId, false);
    },

    selectManualReagent(reagentId, fromSearch) {
        const sourceList = fromSearch ? this.manualSearchResults : this.manualReagents;
        const item = sourceList.find((entry) => entry.reagent_id === reagentId)
            || this.manualReagents.find((entry) => entry.reagent_id === reagentId)
            || this.manualSearchResults.find((entry) => entry.reagent_id === reagentId);

        if (!item) {
            return;
        }

        this.selectedManualReagent = item;
        document.getElementById('outbound-manual-reagent').value = String(item.reagent_id);
        this.renderManualSummary();
    },

    renderManualSummary() {
        const summaryEl = document.getElementById('outbound-manual-summary');
        const searchResults = document.getElementById('outbound-manual-search-results');

        if (!this.selectedManualReagent) {
            summaryEl.classList.add('hidden');
            this.updateUnitSelect('outbound-manual-unit', '盒', '瓶', 'min');
            summaryEl.innerHTML = '';
            return;
        }

        const item = this.selectedManualReagent;
        const currentUnit = document.getElementById('outbound-manual-unit').value || 'min';
        this.updateUnitSelect(
            'outbound-manual-unit',
            item.package_unit,
            item.min_unit,
            currentUnit
        );
        summaryEl.classList.remove('hidden');
        summaryEl.innerHTML = `
            <div class="outbound-preview-title">${this.escapeHtml(item.reagent_name)}</div>
            <div class="item-card-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
            <div class="item-card-submeta">
                当前库存：${item.total_package_quantity}${this.escapeHtml(item.package_unit)}，折合 ${item.total_min_quantity}${this.escapeHtml(item.min_unit)}
                | 最近效期：${this.escapeHtml(item.nearest_expiry_date || '未知')}
                | ${item.contains_expired ? '含过期批次' : '无过期批次'}
            </div>
        `;

        if (searchResults.innerHTML) {
            searchResults.classList.add('hidden');
        }
    },

    async refreshManualPreview() {
        if (!this.selectedManualReagent) {
            return;
        }

        try {
            const preview = await API.outbound.preview({
                source: 'manual',
                reagent_id: this.selectedManualReagent.reagent_id,
                quantity: this.normalizePositiveInteger(document.getElementById('outbound-manual-quantity').value, 1),
                outbound_unit: document.getElementById('outbound-manual-unit').value || 'min',
                deduction_mode: 'fefo',
                raw_barcode: `MANUAL_OUTBOUND::${this.selectedManualReagent.reagent_id}`
            });

            this.selectedManualReagent = {
                ...this.selectedManualReagent,
                total_package_quantity: preview.total_package_quantity,
                total_min_quantity: preview.total_min_quantity,
                contains_expired: preview.contains_expired,
                nearest_expiry_date: preview.deducted_batches.length > 0 ? preview.deducted_batches[0].expiry_date : this.selectedManualReagent.nearest_expiry_date
            };
            this.renderManualSummary();
        } catch (error) {
            Utils.showToast('更新手工预览失败: ' + error.message, 'warning');
        }
    },

    clearManualSelection() {
        this.selectedManualReagent = null;
        document.getElementById('outbound-manual-work-group').value = '';
        document.getElementById('outbound-manual-instrument').innerHTML = '<option value="">全部仪器</option>';
        document.getElementById('outbound-manual-search').value = '';
        document.getElementById('outbound-manual-reagent').innerHTML = '<option value="">请选择试剂</option>';
        document.getElementById('outbound-manual-search-results').innerHTML = '';
        document.getElementById('outbound-manual-search-results').classList.add('hidden');
        document.getElementById('outbound-manual-quantity').value = '1';
        this.updateUnitSelect('outbound-manual-unit', '盒', '瓶', 'min');
        this.renderManualSummary();
        this.loadManualWorkGroups();
    },

    async addManualItem() {
        if (!this.selectedManualReagent) {
            Utils.showToast('请先选择试剂', 'warning');
            return;
        }

        try {
            const preview = await API.outbound.preview({
                source: 'manual',
                reagent_id: this.selectedManualReagent.reagent_id,
                quantity: this.normalizePositiveInteger(document.getElementById('outbound-manual-quantity').value, 1),
                outbound_unit: document.getElementById('outbound-manual-unit').value || 'min',
                deduction_mode: 'fefo',
                raw_barcode: `MANUAL_OUTBOUND::${this.selectedManualReagent.reagent_id}`
            });

            await this.queuePendingItem(this.buildPendingItem(preview, {
                source: 'manual',
                rawBarcode: `MANUAL_OUTBOUND::${this.selectedManualReagent.reagent_id}`
            }));
            Utils.showToast('已加入待出库列表', 'success');
            document.getElementById('outbound-manual-quantity').value = '1';
        } catch (error) {
            Utils.showToast('加入待出库列表失败: ' + error.message, 'error');
        }
    },

    async repreviewItem(item) {
        const preview = await API.outbound.preview({
            source: item.source,
            reagent_id: item.reagentId,
            quantity: item.requestedQuantity,
            outbound_unit: item.outboundUnit,
            deduction_mode: item.deductionMode,
            raw_barcode: item.rawBarcode,
            scanned_batch_no: item.scannedBatchNo,
            scanned_expiry_date: item.scannedExpiryDate
        });

        Object.assign(item, this.buildPendingItem(preview, {
            id: item.id,
            source: item.source,
            rawBarcode: item.rawBarcode,
            scannedBatchNo: item.scannedBatchNo,
            scannedExpiryDate: item.scannedExpiryDate
        }));
    },

    renderPendingItems() {
        const sectionEl = document.getElementById('outbound-items-section');
        const listEl = document.getElementById('outbound-items-list');
        const countEl = document.getElementById('outbound-item-count');

        countEl.textContent = this.pendingItems.length;

        if (this.pendingItems.length === 0) {
            sectionEl.classList.add('hidden');
            listEl.innerHTML = '';
            return;
        }

        sectionEl.classList.remove('hidden');
        listEl.innerHTML = this.pendingItems.map((item) => `
            <div class="item-card">
                <div class="item-card-header">
                    <div>
                        <div class="item-card-title">${this.escapeHtml(item.reagentName)}</div>
                        <div class="item-card-meta">${this.escapeHtml(item.workGroupName)} / ${this.escapeHtml(item.instrumentName)}</div>
                    </div>
                    <span class="item-status ${item.containsExpired ? 'warning' : 'info'}">${item.deductionMode === 'scanned_batch' ? '扫码批次' : 'FEFO 自动扣减'}</span>
                </div>
                <div class="item-card-submeta">
                    ${item.source === 'scan' ? `条码: ${this.escapeHtml(item.rawBarcode)} | ` : ''}
                    库存：${item.totalPackageQuantity}${this.escapeHtml(item.packageUnit)}，折合 ${item.totalMinQuantity}${this.escapeHtml(item.minUnit)}
                    ${item.containsExpired ? ' | 含过期批次' : ''}
                </div>
                <div class="item-grid">
                    <label class="item-field">
                        <span>出库数量</span>
                        <input type="number" min="1" class="form-input" value="${item.requestedQuantity}" onchange="outboundPage.updatePendingQuantity(${item.id}, this.value)">
                    </label>
                    <label class="item-field">
                        <span>出库单位</span>
                        <select class="form-select" onchange="outboundPage.updatePendingUnit(${item.id}, this.value)">
                            <option value="min" ${item.outboundUnit === 'min' ? 'selected' : ''}>${this.escapeHtml(item.minUnit)}</option>
                            <option value="package" ${item.outboundUnit === 'package' ? 'selected' : ''}>${this.escapeHtml(item.packageUnit)}</option>
                        </select>
                    </label>
                    <div class="item-field item-field-readonly">
                        <span>扣减批次</span>
                        <strong>${this.escapeHtml(item.previewDeduction.map((batch) => `${batch.batch_no}(${batch.expiry_date})`).join(' / '))}</strong>
                    </div>
                    <div class="item-field item-field-readonly">
                        <span>包装关系</span>
                        <strong>${this.escapeHtml(this.formatPackageRelation(item.packageUnit, item.packageToMinQty, item.minUnit))}</strong>
                    </div>
                </div>
                <div class="outbound-preview-batches">
                    ${item.previewDeduction.map((batch) => `
                        <div class="outbound-preview-batch">
                            <span>批号：${this.escapeHtml(batch.batch_no)}</span>
                            <span>效期：${this.escapeHtml(batch.expiry_date)}</span>
                            <span>扣减：${batch.deducted_min_quantity}${this.escapeHtml(item.minUnit)}</span>
                            <span>原库存：${this.escapeHtml(this.formatBatchAvailability(batch, item.packageUnit, item.minUnit))}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="item-card-actions">
                    <button class="btn btn-danger" onclick="outboundPage.removePendingItem(${item.id})">删除</button>
                </div>
            </div>
        `).join('');
    },

    async updatePendingQuantity(itemId, value) {
        const item = this.pendingItems.find((current) => current.id === itemId);
        if (!item) {
            return;
        }

        item.requestedQuantity = this.normalizePositiveInteger(value, item.requestedQuantity);
        try {
            await this.repreviewItem(item);
            this.renderPendingItems();
        } catch (error) {
            Utils.showToast('更新出库数量失败: ' + error.message, 'warning');
            this.renderPendingItems();
        }
    },

    async updatePendingUnit(itemId, value) {
        const item = this.pendingItems.find((current) => current.id === itemId);
        if (!item) {
            return;
        }

        item.outboundUnit = value;
        try {
            await this.repreviewItem(item);
            this.renderPendingItems();
        } catch (error) {
            Utils.showToast('更新出库单位失败: ' + error.message, 'warning');
            this.renderPendingItems();
        }
    },

    removePendingItem(itemId) {
        this.pendingItems = this.pendingItems.filter((item) => item.id !== itemId);
        this.renderPendingItems();
    },

    clearPendingItems() {
        if (this.pendingItems.length === 0) {
            return;
        }
        if (confirm('确定要清空当前待出库列表吗？')) {
            this.pendingItems = [];
            this.renderPendingItems();
        }
    },

    showConfirmModal() {
        if (this.pendingItems.length === 0) {
            Utils.showToast('请先添加待出库条目', 'warning');
            return;
        }

        const summaryEl = document.getElementById('outbound-confirm-summary');
        const listEl = document.getElementById('outbound-confirm-items');
        const defaultOperator = Utils.getValidOperator(document.getElementById('outbound-default-operator').value)
            || Utils.getValidOperator(Utils.getLastOperator());

        Utils.populateOperatorSelect('outbound-confirm-operator', {
            defaultValue: defaultOperator
        });

        const totalMin = this.pendingItems.reduce((sum, item) => sum + item.requestedMinQuantity, 0);
        const expiredCount = this.pendingItems.filter((item) => item.containsExpired).length;
        summaryEl.innerHTML = `
            <div class="summary-pill">条目 ${this.pendingItems.length}</div>
            <div class="summary-pill">折合最小单位 ${totalMin}</div>
            <div class="summary-pill">${expiredCount > 0 ? `含过期条目 ${expiredCount}` : '无过期条目'}</div>
        `;

        listEl.innerHTML = this.pendingItems.map((item, index) => `
            <div class="confirm-item">
                <div class="confirm-item-name">${index + 1}. ${this.escapeHtml(item.reagentName)}</div>
                <div class="confirm-item-detail">${this.escapeHtml(item.workGroupName)} / ${this.escapeHtml(item.instrumentName)}</div>
                <div class="confirm-item-detail">出库：${this.escapeHtml(this.formatRequestedQuantity(item))} | 方式：${item.deductionMode === 'scanned_batch' ? '扫码批次' : 'FEFO 自动扣减'}</div>
                <div class="confirm-item-detail">批次：${this.escapeHtml(item.previewDeduction.map((batch) => `${batch.batch_no}(${batch.expiry_date})`).join(' / '))}</div>
                <div class="confirm-item-detail">折算：${this.escapeHtml(this.formatPackageRelation(item.packageUnit, item.packageToMinQty, item.minUnit))}${item.containsExpired ? ' | 含过期批次' : ''}</div>
            </div>
        `).join('');

        document.getElementById('outbound-confirm-modal').classList.remove('hidden');
    },

    closeConfirmModal() {
        document.getElementById('outbound-confirm-modal').classList.add('hidden');
        document.getElementById('outbound-confirm-submit').disabled = false;
        document.getElementById('outbound-confirm-submit').textContent = '正式出库';
        this.isSubmitting = false;
    },

    syncOperator(operator) {
        const normalized = Utils.getValidOperator(operator);
        if (normalized) {
            document.getElementById('outbound-default-operator').value = normalized;
        }
    },

    buildSubmitItems() {
        return this.pendingItems.map((item) => ({
            source: item.source,
            reagent_id: item.reagentId,
            quantity: item.requestedQuantity,
            outbound_unit: item.outboundUnit,
            deduction_mode: item.deductionMode,
            raw_barcode: item.rawBarcode,
            scanned_batch_no: item.scannedBatchNo,
            scanned_expiry_date: item.scannedExpiryDate
        }));
    },

    async submitOutboundBatch() {
        if (this.isSubmitting) {
            return;
        }

        const operator = Utils.getValidOperator(document.getElementById('outbound-confirm-operator').value);
        if (!operator) {
            Utils.showToast('请选择出库人', 'warning');
            return;
        }

        this.isSubmitting = true;
        const submitButton = document.getElementById('outbound-confirm-submit');
        submitButton.disabled = true;
        submitButton.textContent = '提交中...';

        try {
            const result = await API.outbound.stockOutBatch({
                operator,
                items: this.buildSubmitItems()
            });

            Utils.saveLastOperator(operator);
            this.syncOperator(operator);
            this.pendingItems = [];
            this.renderPendingItems();
            this.closeConfirmModal();
            if (typeof dashboardPage !== 'undefined' && typeof dashboardPage.refreshOverview === 'function') {
                dashboardPage.refreshOverview();
            }

            if (result.warnings && result.warnings.length > 0) {
                Utils.showToast(`成功出库 ${result.item_count} 条，其中 ${result.warnings.length} 条包含过期批次`, 'warning', 5000);
            } else {
                Utils.showToast(`成功出库 ${result.item_count} 条试剂`, 'success');
            }
        } catch (error) {
            submitButton.disabled = false;
            submitButton.textContent = '正式出库';
            this.isSubmitting = false;
            Utils.showToast('出库失败: ' + error.message, 'error');
        }
    }
};
