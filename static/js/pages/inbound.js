const inboundPage = {
    currentMode: 'scan',
    manualMode: 'browse',
    scanItems: [],
    manualItems: [],
    pendingItems: [],
    pendingSource: null,
    selectedManualReagent: null,
    manualSearchResults: [],
    candidateContext: null,
    newReagentContext: null,
    initialized: false,
    isSubmitting: false,
    scanAutoSubmitTimer: null,
    defaultPackageUnit: '盒',
    defaultMinUnit: '瓶',

    async init() {
        if (!this.initialized) {
            this.initialized = true;
            this.setupEventListeners();
        }

        await Utils.loadOperators();
        await Utils.loadUnitOptions();
        this.defaultPackageUnit = Utils.getDefaultUnit('package', '盒');
        this.defaultMinUnit = Utils.getDefaultUnit('min', '瓶');
        this.populateUnitSelects();
        await Promise.all([
            Utils.populateOperatorSelect('scan-operator', { allowEmpty: true, emptyLabel: '可先选择默认操作人', defaultValue: Utils.getLastOperator() }),
            Utils.populateOperatorSelect('manual-operator', { allowEmpty: true, emptyLabel: '可先选择默认操作人', defaultValue: Utils.getLastOperator() }),
            Utils.populateOperatorSelect('confirm-operator', { allowEmpty: false, defaultValue: Utils.getLastOperator() })
        ]);

        this.switchMode(this.currentMode);
        this.refreshManualCreateRelationPreview();
        this.refreshNewReagentRelationPreview();
        this.renderScanItems();
        this.renderManualItems();
    },

    setupEventListeners() {
        const scanInput = this.el('scan-barcode');
        scanInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                window.clearTimeout(this.scanAutoSubmitTimer);
                this.addScanItem();
            }
        });
        scanInput.addEventListener('input', () => {
            this.scheduleScanAutoSubmit();
        });

        this.el('manual-search-keyword').addEventListener('input', Utils.debounce(() => {
            this.searchManualReagents();
        }, 250));
        this.el('new-reagent-instrument')?.addEventListener('change', () => {
            this.applyNewReagentInstrumentDefaults();
        });
        this.el('manual-create-instrument')?.addEventListener('change', () => {
            this.applyManualCreateInstrumentDefaults();
        });

        this.el('inbound-confirm-modal').addEventListener('click', (event) => {
            if (event.target.id === 'inbound-confirm-modal') {
                this.closeConfirmModal();
            }
        });
    },

    el(id) {
        return document.getElementById(id);
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    normalizeText(value, fallback = '') {
        const cleaned = String(value ?? '').trim();
        return cleaned || fallback;
    },

    normalizePositiveInteger(value, fallback = 1) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    },

    normalizeOptionalInteger(value, fallback = 0) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    },

    normalizeDate(value) {
        return value ? Utils.formatDate(value) : '';
    },

    createItemId() {
        return Date.now() + Math.floor(Math.random() * 1000);
    },

    scheduleScanAutoSubmit() {
        window.clearTimeout(this.scanAutoSubmitTimer);
        if (this.currentMode !== 'scan') return;

        const input = this.el('scan-barcode');
        const value = this.normalizeText(input.value);
        if (!value || value.length < 12) return;

        this.scanAutoSubmitTimer = window.setTimeout(() => {
            const latestValue = this.normalizeText(input.value);
            const newReagentHidden = this.el('new-reagent-modal')?.classList.contains('hidden');
            if (
                this.currentMode !== 'scan' ||
                !latestValue ||
                latestValue !== value ||
                !newReagentHidden ||
                document.getElementById('candidate-modal')
            ) {
                return;
            }
            this.addScanItem();
        }, 180);
    },

    formatRelation(packageUnit, qty, minUnit) {
        return `1${this.normalizeText(packageUnit, this.defaultPackageUnit)} = ${this.normalizePositiveInteger(qty, 1)}${this.normalizeText(minUnit, this.defaultMinUnit)}`;
    },

    getUnitSelectOptions(scope, selectedValue = '', fallback = '') {
        const normalizedSelected = this.normalizeText(selectedValue, fallback);
        const options = Utils.getUnitOptions(scope);
        const fallbackNames = scope === 'package'
            ? ['盒', '瓶', '支', '袋', '箱', '套']
            : ['瓶', '支', '次', '人份', '测试', 'ml', '片'];
        const optionNames = new Set(options.map((item) => item.name));
        const values = [];
        if (normalizedSelected && !optionNames.has(normalizedSelected)) {
            values.push({ name: normalizedSelected, suffix: '当前值' });
        }
        options.forEach((item) => values.push({ name: item.name, suffix: '' }));
        if (!options.length) {
            fallbackNames.forEach((name) => {
                if (!values.some((item) => item.name === name)) {
                    values.push({ name, suffix: '' });
                }
            });
        }

        return values.map((item) => `
            <option value="${this.escapeHtml(item.name)}" ${item.name === normalizedSelected ? 'selected' : ''}>
                ${this.escapeHtml(item.name)}${item.suffix ? `（${item.suffix}）` : ''}
            </option>
        `).join('');
    },

    populateUnitSelect(selectId, scope, selectedValue = '', fallback = '') {
        const select = this.el(selectId);
        if (!select) return;
        const current = this.normalizeText(selectedValue || select.value, fallback);
        select.innerHTML = this.getUnitSelectOptions(scope, current, fallback);
        if (current) {
            select.value = current;
        }
    },

    populateUnitSelects() {
        this.populateUnitSelect('manual-create-package-unit', 'package', '', this.defaultPackageUnit);
        this.populateUnitSelect('manual-create-min-unit', 'min', '', this.defaultMinUnit);
        this.populateUnitSelect('new-reagent-package-unit', 'package', '', this.defaultPackageUnit);
        this.populateUnitSelect('new-reagent-min-unit', 'min', '', this.defaultMinUnit);
    },

    getSelectedInstrumentProfile(selectId) {
        const select = this.el(selectId);
        const selectedText = select?.selectedOptions?.[0]?.textContent || '';
        if (/DXI800/i.test(selectedText)) {
            return {
                packageUnit: '盒',
                minUnit: '瓶',
                ratio: 2,
            };
        }
        if (/X8/i.test(selectedText)) {
            return {
                packageUnit: '盒',
                minUnit: '盒',
                ratio: 1,
            };
        }
        return null;
    },

    applyInstrumentUnitDefaults(selectId, packageSelectId, minSelectId, ratioInputId, refreshCallback) {
        const profile = this.getSelectedInstrumentProfile(selectId);
        if (!profile) return;
        this.populateUnitSelect(packageSelectId, 'package', profile.packageUnit, this.defaultPackageUnit);
        this.populateUnitSelect(minSelectId, 'min', profile.minUnit, this.defaultMinUnit);
        this.el(ratioInputId).value = String(profile.ratio);
        refreshCallback.call(this);
    },

    applyNewReagentInstrumentDefaults() {
        this.applyInstrumentUnitDefaults(
            'new-reagent-instrument',
            'new-reagent-package-unit',
            'new-reagent-min-unit',
            'new-reagent-package-to-min-qty',
            this.refreshNewReagentRelationPreview
        );
    },

    applyManualCreateInstrumentDefaults() {
        this.applyInstrumentUnitDefaults(
            'manual-create-instrument',
            'manual-create-package-unit',
            'manual-create-min-unit',
            'manual-create-package-to-min-qty',
            this.refreshManualCreateRelationPreview
        );
    },

    refreshRelationPreview(previewId, packageUnitId, minUnitId, qtyId) {
        const preview = this.el(previewId);
        if (!preview) return;
        preview.textContent = this.formatRelation(this.el(packageUnitId).value, this.el(qtyId).value, this.el(minUnitId).value);
    },

    refreshManualCreateRelationPreview() {
        this.refreshRelationPreview('manual-create-package-relation-preview', 'manual-create-package-unit', 'manual-create-min-unit', 'manual-create-package-to-min-qty');
    },

    refreshNewReagentRelationPreview() {
        this.refreshRelationPreview('new-reagent-package-relation-preview', 'new-reagent-package-unit', 'new-reagent-min-unit', 'new-reagent-package-to-min-qty');
    },

    syncOperator(operator) {
        const normalized = Utils.getValidOperator(operator);
        ['scan-operator', 'manual-operator', 'confirm-operator'].forEach((id) => {
            const select = this.el(id);
            if (select && normalized) {
                select.value = normalized;
            }
        });
    },

    switchMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-tab[data-mode]').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });
        this.el('inbound-scan-mode').classList.toggle('hidden', mode !== 'scan');
        this.el('inbound-manual-mode').classList.toggle('hidden', mode !== 'manual');
        if (mode === 'manual') {
            this.loadManualBaseOptions();
        } else {
            this.el('scan-barcode').focus();
        }
    },

    switchManualMode(mode) {
        this.manualMode = mode;
        document.querySelectorAll('.mode-tab[data-manual-mode]').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.manualMode === mode);
        });
        this.el('manual-browse-panel').classList.toggle('hidden', mode !== 'browse');
        this.el('manual-search-panel').classList.toggle('hidden', mode !== 'search');
        this.el('manual-existing-mode').classList.toggle('hidden', mode === 'create');
        this.el('manual-create-mode').classList.toggle('hidden', mode !== 'create');
        if (mode === 'create') {
            this.clearManualSelection();
        } else {
            this.loadManualBaseOptions();
        }
    },

    async loadManualBaseOptions() {
        const groups = await API.inventory.getWorkGroups().catch(() => []);
        this.fillSimpleSelect('manual-browse-work-group', groups, '请选择工作组');
        this.fillSimpleSelect('manual-create-work-group', groups, '请选择工作组');
    },

    fillSimpleSelect(id, items, placeholder, selectedValue = '') {
        const select = this.el(id);
        if (!select) return;
        const current = selectedValue || select.value;
        const options = [`<option value="">${placeholder}</option>`].concat(
            items.map((item) => `<option value="${item.id}">${this.escapeHtml(item.name)}</option>`)
        );
        select.innerHTML = options.join('');
        if (current && items.some((item) => String(item.id) === String(current))) {
            select.value = String(current);
        }
    },

    async loadInstrumentsForSelect(selectId, workGroupId, placeholder, selectedValue = '') {
        const select = this.el(selectId);
        select.innerHTML = `<option value="">${placeholder}</option>`;
        if (!workGroupId) return;
        const items = await API.inventory.getInstruments(workGroupId).catch(() => []);
        this.fillSimpleSelect(selectId, items, placeholder, selectedValue);
    },

    async loadManualBrowseInstruments() {
        await this.loadInstrumentsForSelect('manual-browse-instrument', this.el('manual-browse-work-group').value, '请选择仪器');
        this.el('manual-browse-reagent').innerHTML = '<option value="">请选择试剂</option>';
        this.clearManualSelection();
    },

    async loadManualBrowseReagents(selectedValue = '') {
        const instrumentId = this.el('manual-browse-instrument').value;
        const select = this.el('manual-browse-reagent');
        select.innerHTML = '<option value="">请选择试剂</option>';
        this.clearManualSelection();
        if (!instrumentId) return;
        const reagents = await API.reagents.list({ instrument_id: instrumentId, status: 'active' }).catch(() => []);
        select.innerHTML = ['<option value="">请选择试剂</option>'].concat(
            reagents.map((item) => `<option value="${item.id}">${this.escapeHtml(item.name)}</option>`)
        ).join('');
        if (selectedValue) {
            select.value = String(selectedValue);
            this.selectManualBrowseReagent();
        }
    },

    async loadManualCreateInstruments() {
        await this.loadInstrumentsForSelect('manual-create-instrument', this.el('manual-create-work-group').value, '请选择仪器');
        this.applyManualCreateInstrumentDefaults();
    },

    async searchManualReagents() {
        const keyword = this.normalizeText(this.el('manual-search-keyword').value);
        const resultEl = this.el('manual-search-results');
        if (!keyword) {
            this.manualSearchResults = [];
            resultEl.innerHTML = '';
            return;
        }

        try {
            this.manualSearchResults = await API.reagents.list({ keyword, status: 'active' });
            if (this.manualSearchResults.length === 0) {
                resultEl.innerHTML = '<p class="catalog-empty">没有找到匹配的试剂档案</p>';
                return;
            }
            resultEl.innerHTML = this.manualSearchResults.map((item) => `
                <button type="button" class="search-result-item" onclick="inboundPage.selectManualSearchReagent(${item.id})">
                    <strong>${this.escapeHtml(item.name)}</strong>
                    <span>${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</span>
                    <span>${this.escapeHtml(this.formatRelation(item.package_unit, item.package_to_min_qty, item.unit))}</span>
                </button>
            `).join('');
        } catch (error) {
            resultEl.innerHTML = `<p class="catalog-empty">查询失败：${this.escapeHtml(error.message)}</p>`;
        }
    },

    selectManualBrowseReagent() {
        const reagentId = parseInt(this.el('manual-browse-reagent').value, 10);
        if (!reagentId) {
            this.clearManualSelection();
            return;
        }
        API.reagents.get(reagentId).then((reagent) => {
            this.selectedManualReagent = {
                id: reagent.id,
                name: reagent.name,
                manufacturer: reagent.manufacturer,
                unit: reagent.unit,
                package_unit: reagent.package_unit,
                package_to_min_qty: reagent.package_to_min_qty,
                instrument_id: reagent.instrument_id,
                instrument_name: this.el('manual-browse-instrument').selectedOptions[0]?.textContent || '',
                work_group_id: parseInt(this.el('manual-browse-work-group').value, 10) || null,
                work_group_name: this.el('manual-browse-work-group').selectedOptions[0]?.textContent || ''
            };
            this.renderManualSelection();
        }).catch((error) => Utils.showToast(`加载试剂档案失败：${error.message}`, 'error'));
    },

    selectManualSearchReagent(reagentId) {
        const item = this.manualSearchResults.find((current) => current.id === reagentId);
        if (!item) return;
        this.selectedManualReagent = {
            id: item.id,
            name: item.name,
            manufacturer: item.manufacturer,
            unit: item.unit,
            package_unit: item.package_unit,
            package_to_min_qty: item.package_to_min_qty,
            instrument_id: item.instrument_id,
            instrument_name: item.instrument_name,
            work_group_id: item.work_group_id,
            work_group_name: item.work_group_name
        };
        this.renderManualSelection();
    },

    clearManualSelection() {
        this.selectedManualReagent = null;
        const summary = this.el('manual-selected-reagent');
        summary.classList.add('hidden');
        summary.innerHTML = '';
    },

    renderManualSelection() {
        const summary = this.el('manual-selected-reagent');
        if (!this.selectedManualReagent) {
            summary.classList.add('hidden');
            summary.innerHTML = '';
            return;
        }
        const item = this.selectedManualReagent;
        summary.classList.remove('hidden');
        summary.innerHTML = `
            <div class="catalog-summary-title">${this.escapeHtml(item.name)}</div>
            <div class="catalog-summary-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
            <div class="catalog-summary-meta">${this.escapeHtml(item.manufacturer || '未填写厂家')}</div>
            <div class="catalog-summary-meta">规格：${this.escapeHtml(this.formatRelation(item.package_unit, item.package_to_min_qty, item.unit))}</div>
        `;
    },

    buildMatchPattern(barcode, productCode) {
        const code = this.normalizeText(productCode).replace(/\s+/g, '');
        if (!code) return { match_mode: 'exact', match_pattern: barcode };
        return { match_mode: 'prefix', match_pattern: code.startsWith('01') ? code : `01${code}` };
    },

    buildScanItem(result, barcode, candidate = null) {
        const picked = candidate || {};
        return {
            id: this.createItemId(),
            source: 'scan',
            manualEntryMode: null,
            barcode,
            reagentId: picked.id ?? result.reagent_id,
            reagentName: picked.name ?? result.reagent_name ?? '未识别试剂',
            workGroupId: picked.work_group_id ?? result.work_group_id ?? null,
            workGroupName: picked.work_group_name ?? result.work_group_name ?? '',
            instrumentId: picked.instrument_id ?? result.instrument_id ?? null,
            instrumentName: picked.instrument_name ?? result.instrument_name ?? '',
            manufacturer: picked.manufacturer ?? null,
            productCode: result.extracted_product_code || '',
            productionDate: this.normalizeDate(result.extracted_production_date),
            parsedBatchNo: this.normalizeText(result.extracted_batch_no),
            batchNo: this.normalizeText(result.extracted_batch_no),
            expiryDate: this.normalizeDate(result.extracted_expiry_date),
            packageUnit: this.normalizeText(picked.package_unit ?? result.package_unit, this.defaultPackageUnit),
            minUnit: this.normalizeText(picked.min_unit ?? result.min_unit, this.defaultMinUnit),
            packageToMinQty: this.normalizePositiveInteger(picked.package_to_min_qty ?? result.package_to_min_qty, 1),
            quantity: 1,
            matchType: result.match_type,
            confidence: result.confidence || 'high'
        };
    },

    buildScanMergeKey(item) {
        return [item.reagentId || '', item.batchNo, item.expiryDate, item.packageUnit, item.minUnit, item.packageToMinQty].join('|');
    },

    buildManualMergeKey(item) {
        return [item.reagentId || `${item.instrumentId}:${item.reagentName}`, item.batchNo, item.expiryDate, item.packageUnit, item.minUnit, item.packageToMinQty].join('|');
    },

    appendOrMerge(list, item, keyBuilder) {
        const key = keyBuilder.call(this, item);
        const existing = list.find((current) => keyBuilder.call(this, current) === key);
        if (existing) {
            existing.quantity += item.quantity;
            return true;
        }
        list.push(item);
        return false;
    },

    async addScanItem() {
        const barcode = this.normalizeText(this.el('scan-barcode').value);
        if (!barcode) {
            Utils.showToast('请输入条码', 'warning');
            return;
        }
        try {
            const result = await API.barcode.parse(barcode);
            if (result.match_type === 'prefix' && !result.reagent_id && result.candidates.length > 0) {
                this.showCandidateSelection(result, barcode);
                return;
            }
            if (!result.reagent_id) {
                this.el('scan-barcode').value = '';
                await this.showNewReagentModal(barcode, result);
                return;
            }
            const merged = this.appendOrMerge(this.scanItems, this.buildScanItem(result, barcode), this.buildScanMergeKey);
            this.renderScanItems();
            this.el('scan-barcode').value = '';
            this.el('scan-barcode').focus();
            Utils.showToast(merged ? '重复扫码已合并数量' : '已加入待入库列表', 'success');
        } catch (error) {
            Utils.showToast(`扫码识别失败：${error.message}`, 'error');
        }
    },

    showCandidateSelection(result, barcode) {
        this.closeCandidateModal();
        this.candidateContext = { result, barcode };
        const modal = document.createElement('div');
        modal.id = 'candidate-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header"><h3>选择试剂档案</h3><button class="modal-close" onclick="inboundPage.closeCandidateModal()">&times;</button></div>
                <div class="modal-body">
                    <div class="candidate-list">
                        ${result.candidates.map((item) => `
                            <div class="candidate-item" onclick="inboundPage.selectCandidate(${item.id})">
                                <div>
                                    <div class="candidate-name">${this.escapeHtml(item.name)}</div>
                                    <div class="candidate-meta">${this.escapeHtml(item.work_group_name || '')} / ${this.escapeHtml(item.instrument_name || '')}</div>
                                    <div class="candidate-meta">${this.escapeHtml(this.formatRelation(item.package_unit, item.package_to_min_qty, item.min_unit))}</div>
                                </div>
                                <button class="btn btn-secondary">选择</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    closeCandidateModal() {
        document.getElementById('candidate-modal')?.remove();
        this.candidateContext = null;
    },

    selectCandidate(reagentId) {
        if (!this.candidateContext) return;
        const candidate = this.candidateContext.result.candidates.find((item) => item.id === reagentId);
        if (!candidate) return;
        const merged = this.appendOrMerge(
            this.scanItems,
            this.buildScanItem(this.candidateContext.result, this.candidateContext.barcode, candidate),
            this.buildScanMergeKey
        );
        this.closeCandidateModal();
        this.renderScanItems();
        this.el('scan-barcode').value = '';
        this.el('scan-barcode').focus();
        Utils.showToast(merged ? '重复扫码已合并数量' : '已加入待入库列表', 'success');
    },

    async showNewReagentModal(barcode, result) {
        this.newReagentContext = { barcode, result };
        this.el('new-reagent-barcode').value = barcode;
        this.el('new-reagent-product-code').value = result.extracted_product_code || '';
        this.el('new-reagent-production-date').value = this.normalizeDate(result.extracted_production_date);
        this.el('new-reagent-name').value = '';
        this.el('new-reagent-manufacturer').value = '';
        this.el('new-reagent-batch-no').value = this.normalizeText(result.extracted_batch_no);
        this.el('new-reagent-expiry-date').value = this.normalizeDate(result.extracted_expiry_date);
        this.populateUnitSelect('new-reagent-package-unit', 'package', this.defaultPackageUnit, this.defaultPackageUnit);
        this.populateUnitSelect('new-reagent-min-unit', 'min', this.defaultMinUnit, this.defaultMinUnit);
        this.el('new-reagent-package-to-min-qty').value = '1';
        this.el('new-reagent-quantity').value = '1';
        const groups = await API.inventory.getWorkGroups().catch(() => []);
        this.fillSimpleSelect('new-reagent-work-group', groups, '请选择工作组');
        this.el('new-reagent-instrument').innerHTML = '<option value="">请选择仪器</option>';
        this.refreshNewReagentRelationPreview();
        this.el('new-reagent-modal').classList.remove('hidden');
        if (result.work_group_id) {
            this.el('new-reagent-work-group').value = String(result.work_group_id);
            await this.loadInstrumentsForSelect(
                'new-reagent-instrument',
                result.work_group_id,
                '请选择仪器',
                result.instrument_id ? String(result.instrument_id) : ''
            );
            this.applyNewReagentInstrumentDefaults();
        }
    },

    closeNewReagentModal() {
        this.el('new-reagent-modal').classList.add('hidden');
        this.newReagentContext = null;
        this.el('new-reagent-submit-btn').disabled = false;
        this.el('new-reagent-submit-btn').textContent = '保存并加入列表';
        this.el('scan-barcode').focus();
    },

    async loadNewReagentInstruments() {
        await this.loadInstrumentsForSelect('new-reagent-instrument', this.el('new-reagent-work-group').value, '请选择仪器');
        this.applyNewReagentInstrumentDefaults();
    },

    async submitNewReagentFromScan() {
        if (!this.newReagentContext) return;
        const workGroupId = parseInt(this.el('new-reagent-work-group').value, 10);
        const instrumentId = parseInt(this.el('new-reagent-instrument').value, 10);
        const name = this.normalizeText(this.el('new-reagent-name').value);
        const manufacturer = this.normalizeText(this.el('new-reagent-manufacturer').value);
        const batchNo = this.normalizeText(this.el('new-reagent-batch-no').value);
        const expiryDate = this.el('new-reagent-expiry-date').value;
        const packageUnit = this.normalizeText(this.el('new-reagent-package-unit').value, this.defaultPackageUnit);
        const minUnit = this.normalizeText(this.el('new-reagent-min-unit').value, this.defaultMinUnit);
        const packageToMinQty = this.normalizePositiveInteger(this.el('new-reagent-package-to-min-qty').value, 0);
        const quantity = this.normalizePositiveInteger(this.el('new-reagent-quantity').value, 0);
        const errors = [];
        if (!workGroupId) errors.push('工作组');
        if (!instrumentId) errors.push('仪器');
        if (!name) errors.push('试剂名称');
        if (!batchNo) errors.push('批号');
        if (!expiryDate) errors.push('有效期');
        if (!packageUnit) errors.push('包装单位');
        if (!minUnit) errors.push('最小单位');
        if (!packageToMinQty) errors.push('包装关系');
        if (!quantity) errors.push('入库量');
        if (errors.length) {
            Utils.showToast(`请填写：${errors.join('、')}`, 'warning');
            return;
        }

        const submitButton = this.el('new-reagent-submit-btn');
        submitButton.disabled = true;
        submitButton.textContent = '保存中...';
        try {
            const match = this.buildMatchPattern(this.newReagentContext.barcode, this.el('new-reagent-product-code').value);
            const reagent = await API.reagents.create({
                instrument_id: instrumentId,
                name,
                manufacturer: manufacturer || null,
                unit: minUnit,
                package_unit: packageUnit,
                package_to_min_qty: packageToMinQty,
                raw_barcode_sample: this.newReagentContext.barcode,
                ...match
            });
            const merged = this.appendOrMerge(this.scanItems, {
                id: this.createItemId(),
                source: 'scan',
                barcode: this.newReagentContext.barcode,
                reagentId: reagent.id,
                reagentName: reagent.name,
                workGroupId,
                workGroupName: this.el('new-reagent-work-group').selectedOptions[0]?.textContent || '',
                instrumentId,
                instrumentName: this.el('new-reagent-instrument').selectedOptions[0]?.textContent || '',
                manufacturer: reagent.manufacturer,
                productCode: this.el('new-reagent-product-code').value.trim(),
                productionDate: this.el('new-reagent-production-date').value,
                parsedBatchNo: this.normalizeText(this.newReagentContext.result?.extracted_batch_no),
                batchNo,
                expiryDate,
                packageUnit: reagent.package_unit,
                minUnit: reagent.unit,
                packageToMinQty: reagent.package_to_min_qty,
                quantity,
                matchType: 'created',
                confidence: 'manual'
            }, this.buildScanMergeKey);
            this.renderScanItems();
            this.closeNewReagentModal();
            Utils.showToast(merged ? '已合并到现有扫码条目' : '扫码建档成功，已加入待入库列表', 'success');
        } catch (error) {
            submitButton.disabled = false;
            submitButton.textContent = '保存并加入列表';
            Utils.showToast(`保存试剂档案失败：${error.message}`, 'error');
        }
    },

    renderScanItems() {
        const section = this.el('scan-items-section');
        const list = this.el('scan-items-list');
        this.el('scan-item-count').textContent = String(this.scanItems.length);
        if (this.scanItems.length === 0) {
            section.classList.add('hidden');
            list.innerHTML = '';
            return;
        }
        section.classList.remove('hidden');
        list.innerHTML = this.scanItems.map((item) => {
            const locked = Boolean(item.reagentId);
            const relationText = this.formatRelation(item.packageUnit, item.packageToMinQty, item.minUnit);
            const specSummary = locked
                ? `
                    <div class="item-field item-field-spec scan-item-spec-field">
                        <span>规格</span>
                        <strong>${this.escapeHtml(item.packageUnit)} / ${this.escapeHtml(item.minUnit)} / ${this.escapeHtml(relationText)}</strong>
                    </div>
                `
                : '';
            const packageControl = locked
                ? `<div class="item-field item-field-package"><span>包装单位</span><strong>${this.escapeHtml(item.packageUnit)}</strong></div>`
                : `<label class="item-field item-field-package"><span>包装单位</span><select class="form-select" onchange="inboundPage.updateScanField(${item.id}, 'packageUnit', this.value)">${this.getUnitSelectOptions('package', item.packageUnit, this.defaultPackageUnit)}</select></label>`;
            const minControl = locked
                ? `<div class="item-field item-field-min"><span>最小单位</span><strong>${this.escapeHtml(item.minUnit)}</strong></div>`
                : `<label class="item-field item-field-min"><span>最小单位</span><select class="form-select" onchange="inboundPage.updateScanField(${item.id}, 'minUnit', this.value)">${this.getUnitSelectOptions('min', item.minUnit, this.defaultMinUnit)}</select></label>`;
            const relationControl = locked
                ? `<div class="item-field item-field-relation"><span>包装关系</span><strong>${this.escapeHtml(relationText)}</strong></div>`
                : `<label class="item-field item-field-relation"><span>包装关系</span><input type="number" min="1" class="form-input" value="${item.packageToMinQty}" onchange="inboundPage.updateScanField(${item.id}, 'packageToMinQty', this.value)"><small class="field-hint">${this.escapeHtml(relationText)}</small></label>`;
            return `
                <div class="item-card scan-item-card scan-item-card-compact">
                    <div class="scan-item-topline">
                        <div class="scan-item-title-wrap">
                            <div class="item-card-title">${this.escapeHtml(item.reagentName)}</div>
                            <div class="item-card-meta">${this.escapeHtml(item.workGroupName || '')} / ${this.escapeHtml(item.instrumentName || '')}</div>
                        </div>
                        <div class="scan-item-top-actions">
                            <span class="item-status ${locked ? 'info' : 'warning'}">${locked ? '沿用档案' : '待补全'}</span>
                            <button class="btn btn-danger btn-small" onclick="inboundPage.removeScanItem(${item.id})">删除</button>
                        </div>
                    </div>
                    <div class="item-card-submeta item-card-submeta-wrap scan-item-meta-row">
                        <span>条码：${this.escapeHtml(item.barcode)}</span>
                        ${item.productCode ? `<span>编码：${this.escapeHtml(item.productCode)}</span>` : ''}
                        ${item.productionDate ? `<span>生产日期：${this.escapeHtml(item.productionDate)}</span>` : ''}
                    </div>
                    <div class="item-grid scan-item-grid ${locked ? 'scan-item-grid-locked' : ''}">
                        <label class="item-field item-field-batch"><span>批号</span><input type="text" class="form-input" value="${this.escapeHtml(item.batchNo)}" onchange="inboundPage.updateScanField(${item.id}, 'batchNo', this.value)"></label>
                        <label class="item-field item-field-expiry"><span>有效期</span><input type="date" class="form-input" value="${this.escapeHtml(item.expiryDate)}" onchange="inboundPage.updateScanField(${item.id}, 'expiryDate', this.value)"></label>
                        <label class="item-field item-field-quantity"><span>入库量</span><input type="number" min="1" class="form-input" value="${item.quantity}" onchange="inboundPage.updateScanField(${item.id}, 'quantity', this.value)"></label>
                        ${locked ? specSummary : packageControl}
                        ${locked ? '' : minControl}
                        ${locked ? '' : relationControl}
                    </div>
                </div>
            `;
        }).join('');
    },

    updateScanField(itemId, field, value) {
        const item = this.scanItems.find((current) => current.id === itemId);
        if (!item) return;
        if (item.reagentId && ['packageUnit', 'minUnit', 'packageToMinQty'].includes(field)) return;
        if (field === 'quantity' || field === 'packageToMinQty') {
            item[field] = this.normalizePositiveInteger(value, 1);
        } else {
            item[field] = this.normalizeText(value);
        }
        this.renderScanItems();
    },

    removeScanItem(itemId) {
        this.scanItems = this.scanItems.filter((item) => item.id !== itemId);
        this.renderScanItems();
    },

    clearScanItems() {
        if (this.scanItems.length && confirm('确定要清空当前扫码列表吗？')) {
            this.scanItems = [];
            this.renderScanItems();
        }
    },

    addManualItem() {
        const batchNo = this.normalizeText(this.el('manual-batch-no').value);
        const expiryDate = this.el('manual-expiry-date').value;
        const quantity = this.normalizePositiveInteger(this.el('manual-quantity').value, 0);
        if (!batchNo || !expiryDate || !quantity) {
            Utils.showToast('请填写批号、有效期和入库量', 'warning');
            return;
        }

        let item;
        if (this.manualMode === 'create') {
            const workGroupId = parseInt(this.el('manual-create-work-group').value, 10);
            const instrumentId = parseInt(this.el('manual-create-instrument').value, 10);
            const reagentName = this.normalizeText(this.el('manual-create-reagent-name').value);
            const manufacturer = this.normalizeText(this.el('manual-create-manufacturer').value);
            const packageUnit = this.normalizeText(this.el('manual-create-package-unit').value, this.defaultPackageUnit);
            const minUnit = this.normalizeText(this.el('manual-create-min-unit').value, this.defaultMinUnit);
            const packageToMinQty = this.normalizePositiveInteger(this.el('manual-create-package-to-min-qty').value, 0);
            const errors = [];
            if (!workGroupId) errors.push('工作组');
            if (!instrumentId) errors.push('仪器');
            if (!reagentName) errors.push('试剂名称');
            if (!packageUnit) errors.push('包装单位');
            if (!minUnit) errors.push('最小单位');
            if (!packageToMinQty) errors.push('包装关系');
            if (errors.length) {
                Utils.showToast(`请填写：${errors.join('、')}`, 'warning');
                return;
            }
            item = {
                id: this.createItemId(),
                source: 'manual',
                manualEntryMode: 'create',
                reagentId: null,
                reagentName,
                manufacturer: manufacturer || null,
                workGroupId,
                workGroupName: this.el('manual-create-work-group').selectedOptions[0]?.textContent || '',
                instrumentId,
                instrumentName: this.el('manual-create-instrument').selectedOptions[0]?.textContent || '',
                batchNo,
                expiryDate,
                quantity,
                packageUnit,
                minUnit,
                packageToMinQty
            };
        } else {
            if (!this.selectedManualReagent) {
                Utils.showToast('请先选择试剂档案', 'warning');
                return;
            }
            item = {
                id: this.createItemId(),
                source: 'manual',
                manualEntryMode: 'existing',
                reagentId: this.selectedManualReagent.id,
                reagentName: this.selectedManualReagent.name,
                manufacturer: this.selectedManualReagent.manufacturer,
                workGroupId: this.selectedManualReagent.work_group_id,
                workGroupName: this.selectedManualReagent.work_group_name,
                instrumentId: this.selectedManualReagent.instrument_id,
                instrumentName: this.selectedManualReagent.instrument_name,
                batchNo,
                expiryDate,
                quantity,
                packageUnit: this.selectedManualReagent.package_unit,
                minUnit: this.selectedManualReagent.unit,
                packageToMinQty: this.selectedManualReagent.package_to_min_qty
            };
        }

        const merged = this.appendOrMerge(this.manualItems, item, this.buildManualMergeKey);
        this.renderManualItems();
        this.clearManualBatchFields();
        if (this.manualMode === 'create') {
            this.el('manual-create-reagent-name').value = '';
            this.el('manual-create-manufacturer').value = '';
        }
        Utils.showToast(merged ? '相同批次已自动合并数量' : '已加入待入库列表', 'success');
    },

    clearManualBatchFields() {
        this.el('manual-batch-no').value = '';
        this.el('manual-expiry-date').value = '';
        this.el('manual-quantity').value = '1';
    },

    clearManualForm(clearOperator = true, clearSelection = true) {
        this.clearManualBatchFields();
        if (clearSelection) {
            ['manual-browse-work-group', 'manual-browse-instrument', 'manual-browse-reagent', 'manual-create-work-group', 'manual-create-instrument'].forEach((id) => {
                if (this.el(id)) this.el(id).value = '';
            });
            this.el('manual-browse-instrument').innerHTML = '<option value="">请选择仪器</option>';
            this.el('manual-browse-reagent').innerHTML = '<option value="">请选择试剂</option>';
            this.el('manual-create-instrument').innerHTML = '<option value="">请选择仪器</option>';
            this.el('manual-search-keyword').value = '';
            this.el('manual-search-results').innerHTML = '';
            this.clearManualSelection();
        }
        this.el('manual-create-reagent-name').value = '';
        this.el('manual-create-manufacturer').value = '';
        this.populateUnitSelect('manual-create-package-unit', 'package', this.defaultPackageUnit, this.defaultPackageUnit);
        this.populateUnitSelect('manual-create-min-unit', 'min', this.defaultMinUnit, this.defaultMinUnit);
        this.el('manual-create-package-to-min-qty').value = '1';
        this.refreshManualCreateRelationPreview();
        if (clearOperator) {
            this.el('manual-operator').value = '';
        }
    },

    renderManualItems() {
        const section = this.el('manual-items-section');
        const list = this.el('manual-items-list');
        this.el('manual-item-count').textContent = String(this.manualItems.length);
        if (this.manualItems.length === 0) {
            section.classList.add('hidden');
            list.innerHTML = '';
            return;
        }
        section.classList.remove('hidden');
        list.innerHTML = this.manualItems.map((item) => `
            <div class="item-card">
                <div class="item-card-header">
                    <div>
                        <div class="item-card-title">${this.escapeHtml(item.reagentName)}</div>
                        <div class="item-card-meta">${this.escapeHtml(item.workGroupName)} / ${this.escapeHtml(item.instrumentName)}</div>
                        <div class="item-card-submeta">${item.manualEntryMode === 'create' ? '首次建档入库' : '已有试剂快速入库'}</div>
                    </div>
                    <span class="item-status info">${item.manualEntryMode === 'create' ? '建档中' : '沿用档案'}</span>
                </div>
                <div class="item-grid item-grid-readonly">
                    <div class="item-field"><span>批号</span><strong>${this.escapeHtml(item.batchNo)}</strong></div>
                    <div class="item-field"><span>有效期</span><strong>${this.escapeHtml(item.expiryDate)}</strong></div>
                    <div class="item-field"><span>入库量</span><strong>${item.quantity}</strong></div>
                    <div class="item-field"><span>规格</span><strong>${this.escapeHtml(this.formatRelation(item.packageUnit, item.packageToMinQty, item.minUnit))}</strong></div>
                    <div class="item-field"><span>厂家</span><strong>${this.escapeHtml(item.manufacturer || '未填写')}</strong></div>
                </div>
                <div class="item-card-actions">
                    <button class="btn btn-secondary" onclick="inboundPage.editManualItem(${item.id})">回填编辑</button>
                    <button class="btn btn-danger" onclick="inboundPage.removeManualItem(${item.id})">删除</button>
                </div>
            </div>
        `).join('');
    },

    async editManualItem(itemId) {
        const item = this.manualItems.find((current) => current.id === itemId);
        if (!item) return;
        this.removeManualItem(itemId);
        this.el('manual-batch-no').value = item.batchNo;
        this.el('manual-expiry-date').value = item.expiryDate;
        this.el('manual-quantity').value = String(item.quantity);
        if (item.manualEntryMode === 'create') {
            this.switchManualMode('create');
            this.el('manual-create-work-group').value = String(item.workGroupId);
            await this.loadManualCreateInstruments();
            this.el('manual-create-instrument').value = String(item.instrumentId);
            this.el('manual-create-reagent-name').value = item.reagentName;
            this.el('manual-create-manufacturer').value = item.manufacturer || '';
            this.populateUnitSelect('manual-create-package-unit', 'package', item.packageUnit, this.defaultPackageUnit);
            this.populateUnitSelect('manual-create-min-unit', 'min', item.minUnit, this.defaultMinUnit);
            this.el('manual-create-package-to-min-qty').value = String(item.packageToMinQty);
            this.refreshManualCreateRelationPreview();
        } else {
            this.switchManualMode('browse');
            this.selectedManualReagent = {
                id: item.reagentId,
                name: item.reagentName,
                manufacturer: item.manufacturer,
                unit: item.minUnit,
                package_unit: item.packageUnit,
                package_to_min_qty: item.packageToMinQty,
                instrument_id: item.instrumentId,
                instrument_name: item.instrumentName,
                work_group_id: item.workGroupId,
                work_group_name: item.workGroupName
            };
            this.renderManualSelection();
            this.el('manual-browse-work-group').value = String(item.workGroupId);
            await this.loadManualBrowseInstruments();
            this.el('manual-browse-instrument').value = String(item.instrumentId);
            await this.loadManualBrowseReagents(item.reagentId);
        }
    },

    removeManualItem(itemId) {
        this.manualItems = this.manualItems.filter((item) => item.id !== itemId);
        this.renderManualItems();
    },

    clearManualItems() {
        if (this.manualItems.length && confirm('确定要清空当前手工入库列表吗？')) {
            this.manualItems = [];
            this.renderManualItems();
        }
    },

    validateItemsBeforeConfirm(items) {
        return items.find((item) => !item.reagentName || !item.batchNo || !item.expiryDate || !item.quantity || !item.packageUnit || !item.minUnit || !item.packageToMinQty);
    },

    async showScanConfirm() {
        if (!this.scanItems.length) {
            Utils.showToast('请先扫描试剂条码', 'warning');
            return;
        }
        const invalidItem = this.validateItemsBeforeConfirm(this.scanItems);
        if (invalidItem) {
            Utils.showToast(`试剂“${invalidItem.reagentName}”仍有信息未补全`, 'warning');
            return;
        }
        this.pendingItems = this.scanItems.map((item) => ({ ...item }));
        await this.showConfirmModal('scan');
    },

    async showManualConfirm() {
        if (!this.manualItems.length) {
            Utils.showToast('请先添加手工入库条目', 'warning');
            return;
        }
        const invalidItem = this.validateItemsBeforeConfirm(this.manualItems);
        if (invalidItem) {
            Utils.showToast(`试剂“${invalidItem.reagentName}”信息不完整`, 'warning');
            return;
        }
        this.pendingItems = this.manualItems.map((item) => ({ ...item }));
        await this.showConfirmModal('manual');
    },

    async showConfirmModal(source) {
        this.pendingSource = source;
        await Utils.populateOperatorSelect('confirm-operator', {
            allowEmpty: false,
            defaultValue: this.el(source === 'scan' ? 'scan-operator' : 'manual-operator').value || Utils.getLastOperator()
        });
        const totalQty = this.pendingItems.reduce((sum, item) => sum + item.quantity, 0);
        const totalMinQty = this.pendingItems.reduce((sum, item) => sum + (item.quantity * item.packageToMinQty), 0);
        this.el('confirm-summary').innerHTML = `
            <div class="summary-pill">条目 ${this.pendingItems.length}</div>
            <div class="summary-pill">包装总数 ${totalQty}</div>
            <div class="summary-pill">最小单位总量 ${totalMinQty}</div>
        `;
        this.el('confirm-items-list').innerHTML = this.pendingItems.map((item, index) => `
            <div class="confirm-item">
                <div class="confirm-item-name">${index + 1}. ${this.escapeHtml(item.reagentName)}</div>
                <div class="confirm-item-detail">${this.escapeHtml(item.workGroupName || '')} / ${this.escapeHtml(item.instrumentName || '')}</div>
                <div class="confirm-item-detail">批号：${this.escapeHtml(item.batchNo)} | 效期：${this.escapeHtml(item.expiryDate)}</div>
                <div class="confirm-item-detail">数量：${item.quantity} ${this.escapeHtml(item.packageUnit)} | 规格：${this.escapeHtml(this.formatRelation(item.packageUnit, item.packageToMinQty, item.minUnit))}</div>
            </div>
        `).join('');
        this.el('inbound-confirm-modal').classList.remove('hidden');
    },

    closeConfirmModal() {
        this.el('inbound-confirm-modal').classList.add('hidden');
        this.el('confirm-submit-btn').disabled = false;
        this.el('confirm-submit-btn').textContent = '正式入库';
        this.pendingItems = [];
        this.pendingSource = null;
        this.isSubmitting = false;
    },

    buildSubmitItems() {
        return this.pendingItems.map((item) => ({
            source: item.source,
            reagent_id: item.reagentId || null,
            work_group_id: item.workGroupId || null,
            instrument_id: item.instrumentId || null,
            reagent_name: item.reagentName,
            manufacturer: item.manufacturer || null,
            batch_no: item.batchNo,
            expiry_date: item.expiryDate,
            quantity: item.quantity,
            package_unit: item.packageUnit,
            min_unit: item.minUnit,
            package_to_min_qty: item.packageToMinQty,
            raw_barcode: item.barcode || `MANUAL::${item.instrumentId || 'UNKNOWN'}::${item.batchNo}`,
            parsed_batch_no: item.parsedBatchNo || null
        }));
    },

    async submitInbound() {
        if (this.isSubmitting) return;
        const operator = Utils.getValidOperator(this.el('confirm-operator').value);
        if (!operator) {
            Utils.showToast('请选择有效的操作人', 'warning');
            return;
        }
        this.isSubmitting = true;
        this.el('confirm-submit-btn').disabled = true;
        this.el('confirm-submit-btn').textContent = '提交中...';
        try {
            const result = await API.inbound.stockInBatch({ operator, items: this.buildSubmitItems() });
            Utils.saveLastOperator(operator);
            this.syncOperator(operator);
            if (this.pendingSource === 'scan') {
                this.scanItems = [];
                this.renderScanItems();
            } else {
                this.manualItems = [];
                this.renderManualItems();
            }
            this.closeConfirmModal();
            Utils.showToast(
                result.warnings?.length
                    ? `已入库 ${result.item_count} 条，其中 ${result.warnings.length} 条需要关注效期`
                    : `成功入库 ${result.item_count} 条试剂`,
                result.warnings?.length ? 'warning' : 'success'
            );
        } catch (error) {
            this.el('confirm-submit-btn').disabled = false;
            this.el('confirm-submit-btn').textContent = '正式入库';
            this.isSubmitting = false;
            Utils.showToast(`入库失败：${error.message}`, 'error');
        }
    }
};
