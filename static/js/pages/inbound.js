const inboundPage = {
    currentMode: 'scan',
    scanItems: [],
    manualItems: [],
    pendingItems: [],
    pendingSource: null,
    initialized: false,
    isSubmitting: false,
    candidateContext: null,
    newReagentContext: null,
    defaultPackageUnit: '盒',
    defaultMinUnit: '瓶',

    init() {
        Utils.populateOperatorSelect('scan-operator', {
            allowEmpty: true,
            emptyLabel: '可先选择默认操作人'
        });
        Utils.populateOperatorSelect('manual-operator', {
            allowEmpty: true,
            emptyLabel: '可先选择默认操作人'
        });
        Utils.populateOperatorSelect('confirm-operator');

        const lastOperator = Utils.getValidOperator(Utils.getLastOperator());
        if (lastOperator) {
            this.syncOperator(lastOperator);
        }

        if (!this.initialized) {
            this.initialized = true;
            this.setupEventListeners();
        }

        this.refreshManualRelationPreview();
        this.refreshNewReagentRelationPreview();
        this.switchMode(this.currentMode);
        this.renderScanItems();
        this.renderManualItems();
    },

    setupEventListeners() {
        const scanInput = document.getElementById('scan-barcode');
        scanInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.addScanItem();
            }
        });

        const confirmModal = document.getElementById('inbound-confirm-modal');
        confirmModal.addEventListener('click', (event) => {
            if (event.target === confirmModal) {
                this.closeConfirmModal();
            }
        });

        const newReagentModal = document.getElementById('new-reagent-modal');
        newReagentModal.addEventListener('click', (event) => {
            if (event.target === newReagentModal) {
                this.closeNewReagentModal();
            }
        });
    },

    switchMode(mode) {
        this.currentMode = mode;

        document.querySelectorAll('.mode-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });

        document.getElementById('inbound-scan-mode').classList.toggle('hidden', mode !== 'scan');
        document.getElementById('inbound-manual-mode').classList.toggle('hidden', mode !== 'manual');

        if (mode === 'scan') {
            document.getElementById('scan-barcode').focus();
            return;
        }

        this.loadManualWorkGroups();
    },

    createItemId() {
        return Date.now() + Math.floor(Math.random() * 1000);
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    normalizeDate(value) {
        return value ? Utils.formatDate(value) : '';
    },

    normalizeProductCode(value) {
        const cleaned = String(value || '').trim().replace(/\s+/g, '');
        if (!cleaned) {
            return '';
        }

        if (cleaned.startsWith('01') && cleaned.length > 14) {
            return cleaned.slice(2);
        }

        return cleaned;
    },

    buildMatchPattern(barcode, productCode) {
        const normalizedCode = this.normalizeProductCode(productCode);
        if (!normalizedCode) {
            return {
                matchMode: 'exact',
                matchPattern: barcode
            };
        }

        return {
            matchMode: 'prefix',
            matchPattern: normalizedCode.startsWith('01') ? normalizedCode : `01${normalizedCode}`
        };
    },

    normalizeText(value, fallback = '') {
        const cleaned = String(value ?? '').trim();
        return cleaned || fallback;
    },

    normalizePositiveInteger(value, fallback = 1) {
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            return fallback;
        }
        return parsed;
    },

    formatPackageRelation(packageUnit, packageToMinQty, minUnit) {
        const finalPackageUnit = this.normalizeText(packageUnit, this.defaultPackageUnit);
        const finalMinUnit = this.normalizeText(minUnit, this.defaultMinUnit);
        const finalQty = this.normalizePositiveInteger(packageToMinQty, 1);
        return `1${finalPackageUnit} = ${finalQty}${finalMinUnit}`;
    },

    refreshRelationPreview(previewId, packageUnitId, minUnitId, packageQtyId) {
        const preview = document.getElementById(previewId);
        if (!preview) {
            return;
        }

        const packageUnit = document.getElementById(packageUnitId)?.value;
        const minUnit = document.getElementById(minUnitId)?.value;
        const packageToMinQty = document.getElementById(packageQtyId)?.value;
        preview.textContent = this.formatPackageRelation(packageUnit, packageToMinQty, minUnit);
    },

    refreshManualRelationPreview() {
        this.refreshRelationPreview(
            'manual-package-relation-preview',
            'manual-package-unit',
            'manual-min-unit',
            'manual-package-to-min-qty'
        );
    },

    refreshNewReagentRelationPreview() {
        this.refreshRelationPreview(
            'new-reagent-package-relation-preview',
            'new-reagent-package-unit',
            'new-reagent-min-unit',
            'new-reagent-package-to-min-qty'
        );
    },
    buildScanMergeKey(item) {
        return [
            item.reagentId || '',
            item.barcode || '',
            item.batchNo || '',
            item.expiryDate || '',
            item.packageUnit || '',
            item.minUnit || '',
            item.packageToMinQty || 1
        ].join('|');
    },

    buildManualMergeKey(item) {
        return [
            item.instrumentId || '',
            item.reagentName || '',
            item.batchNo || '',
            item.expiryDate || '',
            item.packageUnit || '',
            item.minUnit || '',
            item.packageToMinQty || 1
        ].join('|');
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

    getItemStatus(item) {
        if (!item.batchNo || !item.expiryDate || !item.packageUnit || !item.minUnit || !item.quantity || !item.packageToMinQty) {
            return { text: '待补全', className: 'warning' };
        }

        if (Utils.isExpired(item.expiryDate)) {
            return { text: '已过期', className: 'danger' };
        }

        if (item.matchType === 'created') {
            return { text: '已建档', className: 'info' };
        }

        if (item.matchType === 'prefix') {
            return { text: '前缀匹配', className: 'info' };
        }

        if (item.source === 'manual') {
            return { text: '手工录入', className: 'info' };
        }

        return { text: '可入库', className: 'success' };
    },

    calculateTotalMinUnits(items) {
        return items.reduce((sum, item) => {
            return sum + (this.normalizePositiveInteger(item.quantity, 0) * this.normalizePositiveInteger(item.packageToMinQty, 1));
        }, 0);
    },

    buildScanItem(result, barcode, candidate = null) {
        const chosen = candidate || {};
        return {
            id: this.createItemId(),
            source: 'scan',
            barcode,
            reagentId: chosen.id ?? result.reagent_id,
            reagentName: chosen.name ?? result.reagent_name ?? '未识别试剂',
            workGroupId: chosen.work_group_id ?? result.work_group_id ?? null,
            workGroupName: chosen.work_group_name ?? result.work_group_name ?? '未配置工作组',
            instrumentId: chosen.instrument_id ?? result.instrument_id ?? null,
            instrumentName: chosen.instrument_name ?? result.instrument_name ?? '未配置仪器',
            productCode: result.extracted_product_code || '',
            productionDate: this.normalizeDate(result.extracted_production_date),
            batchNo: this.normalizeText(result.extracted_batch_no),
            expiryDate: this.normalizeDate(result.extracted_expiry_date),
            packageUnit: this.normalizeText(chosen.package_unit ?? result.package_unit, this.defaultPackageUnit),
            minUnit: this.normalizeText(chosen.min_unit ?? result.min_unit, this.defaultMinUnit),
            packageToMinQty: this.normalizePositiveInteger(chosen.package_to_min_qty ?? result.package_to_min_qty, 1),
            quantity: 1,
            matchType: result.match_type,
            confidence: result.confidence || 'high'
        };
    },

    getManualFormSelection(selectId) {
        const select = document.getElementById(selectId);
        const option = select.options[select.selectedIndex];
        return option ? option.text : '';
    },

    getSelectValueAndText(selectId) {
        const select = document.getElementById(selectId);
        const option = select.options[select.selectedIndex];
        return {
            value: select.value,
            text: option ? option.text : ''
        };
    },

    async addScanItem() {
        const barcodeInput = document.getElementById('scan-barcode');
        const barcode = barcodeInput.value.trim();

        if (!barcode) {
            Utils.showToast('请输入条码', 'warning');
            return;
        }

        try {
            const result = await API.barcode.parse(barcode);

            if (result.match_type === 'prefix' && result.reagent_id === null && result.candidates.length > 0) {
                this.showCandidateSelection(result, barcode);
                return;
            }

            if (!result.reagent_id) {
                barcodeInput.value = '';
                await this.showNewReagentModal(barcode, result);
                return;
            }

            const item = this.buildScanItem(result, barcode);
            const merged = this.appendOrMerge(this.scanItems, item, this.buildScanMergeKey);
            this.renderScanItems();

            barcodeInput.value = '';
            barcodeInput.focus();
            Utils.showToast(merged ? '重复扫码已合并到原有记录' : '已添加到待入库列表', 'success');
        } catch (error) {
            Utils.showToast(`识别失败: ${error.message}`, 'error');
        }
    },
    showCandidateSelection(result, barcode) {
        this.closeCandidateModal();
        this.candidateContext = {
            barcode,
            parseResult: result,
            candidates: result.candidates || []
        };

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'candidate-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>选择试剂</h3>
                    <button class="modal-close" onclick="inboundPage.closeCandidateModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <p>当前条码匹配到多个试剂，请先确认正确的试剂档案。</p>
                    <div class="candidate-list">
                        ${this.candidateContext.candidates.map((candidate) => `
                            <div class="candidate-item" onclick="inboundPage.selectCandidate(${candidate.id})">
                                <div>
                                    <div class="candidate-name">${this.escapeHtml(candidate.name)}</div>
                                    <div class="candidate-meta">${this.escapeHtml(candidate.work_group_name || '未配置工作组')} / ${this.escapeHtml(candidate.instrument_name || '未配置仪器')}</div>
                                    <div class="candidate-meta">${this.escapeHtml(this.formatPackageRelation(candidate.package_unit, candidate.package_to_min_qty, candidate.min_unit))}</div>
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
        const modal = document.getElementById('candidate-modal');
        if (modal) {
            modal.remove();
        }
        this.candidateContext = null;
    },

    selectCandidate(reagentId) {
        if (!this.candidateContext) {
            return;
        }

        const candidate = this.candidateContext.candidates.find((item) => item.id === reagentId);
        if (!candidate) {
            return;
        }

        const item = this.buildScanItem(this.candidateContext.parseResult, this.candidateContext.barcode, candidate);
        const merged = this.appendOrMerge(this.scanItems, item, this.buildScanMergeKey);

        this.closeCandidateModal();
        this.renderScanItems();
        document.getElementById('scan-barcode').value = '';
        document.getElementById('scan-barcode').focus();
        Utils.showToast(merged ? '重复扫码已合并到原有记录' : '已添加到待入库列表', 'success');
    },

    async showNewReagentModal(barcode, result) {
        this.newReagentContext = { barcode, parseResult: result };

        document.getElementById('new-reagent-barcode').value = barcode;
        document.getElementById('new-reagent-product-code').value = result.extracted_product_code || '';
        document.getElementById('new-reagent-production-date').value = this.normalizeDate(result.extracted_production_date);
        document.getElementById('new-reagent-name').value = '';
        document.getElementById('new-reagent-manufacturer').value = '';
        document.getElementById('new-reagent-batch-no').value = this.normalizeText(result.extracted_batch_no);
        document.getElementById('new-reagent-expiry-date').value = this.normalizeDate(result.extracted_expiry_date);
        document.getElementById('new-reagent-package-unit').value = this.defaultPackageUnit;
        document.getElementById('new-reagent-min-unit').value = this.defaultMinUnit;
        document.getElementById('new-reagent-package-to-min-qty').value = '1';
        document.getElementById('new-reagent-quantity').value = '1';
        document.getElementById('new-reagent-work-group').value = '';
        document.getElementById('new-reagent-instrument').innerHTML = '<option value="">请选择仪器</option>';
        document.getElementById('new-reagent-instrument').value = '';

        await this.loadNewReagentWorkGroups();
        this.refreshNewReagentRelationPreview();
        document.getElementById('new-reagent-modal').classList.remove('hidden');
        document.getElementById('new-reagent-name').focus();
    },

    closeNewReagentModal() {
        document.getElementById('new-reagent-modal').classList.add('hidden');
        document.getElementById('new-reagent-submit-btn').disabled = false;
        document.getElementById('new-reagent-submit-btn').textContent = '保存并加入列表';
        this.newReagentContext = null;
        document.getElementById('scan-barcode').focus();
    },

    async loadNewReagentWorkGroups() {
        try {
            const groups = await API.inventory.getWorkGroups();
            const select = document.getElementById('new-reagent-work-group');
            const currentValue = select.value;
            select.innerHTML = '<option value="">请选择工作组</option>';
            groups.forEach((group) => {
                select.innerHTML += `<option value="${group.id}">${this.escapeHtml(group.name)}</option>`;
            });
            select.value = currentValue;
        } catch (error) {
            console.error('Failed to load work groups:', error);
            Utils.showToast('工作组加载失败', 'error');
        }
    },

    async loadNewReagentInstruments() {
        const workGroupId = document.getElementById('new-reagent-work-group').value;
        const select = document.getElementById('new-reagent-instrument');
        select.innerHTML = '<option value="">请选择仪器</option>';

        if (!workGroupId) {
            return;
        }

        try {
            const instruments = await API.inventory.getInstruments(workGroupId);
            instruments.forEach((instrument) => {
                select.innerHTML += `<option value="${instrument.id}">${this.escapeHtml(instrument.name)}</option>`;
            });
        } catch (error) {
            console.error('Failed to load instruments:', error);
            Utils.showToast('仪器加载失败', 'error');
        }
    },

    buildCreatedScanItem(reagent, payload) {
        return {
            id: this.createItemId(),
            source: 'scan',
            barcode: payload.barcode,
            reagentId: reagent.id,
            reagentName: reagent.name,
            workGroupId: payload.workGroupId,
            workGroupName: payload.workGroupName,
            instrumentId: payload.instrumentId,
            instrumentName: payload.instrumentName,
            productCode: payload.productCode,
            productionDate: payload.productionDate,
            batchNo: payload.batchNo,
            expiryDate: payload.expiryDate,
            packageUnit: payload.packageUnit,
            minUnit: payload.minUnit,
            packageToMinQty: payload.packageToMinQty,
            quantity: payload.quantity,
            matchType: 'created',
            confidence: 'manual'
        };
    },
    async submitNewReagentFromScan() {
        if (!this.newReagentContext) {
            return;
        }

        const workGroup = this.getSelectValueAndText('new-reagent-work-group');
        const instrument = this.getSelectValueAndText('new-reagent-instrument');
        const reagentName = this.normalizeText(document.getElementById('new-reagent-name').value);
        const manufacturer = this.normalizeText(document.getElementById('new-reagent-manufacturer').value);
        const productCode = this.normalizeText(document.getElementById('new-reagent-product-code').value);
        const productionDate = document.getElementById('new-reagent-production-date').value;
        const batchNo = this.normalizeText(document.getElementById('new-reagent-batch-no').value);
        const expiryDate = document.getElementById('new-reagent-expiry-date').value;
        const packageUnit = this.normalizeText(document.getElementById('new-reagent-package-unit').value);
        const minUnit = this.normalizeText(document.getElementById('new-reagent-min-unit').value);
        const packageToMinQty = this.normalizePositiveInteger(document.getElementById('new-reagent-package-to-min-qty').value, 0);
        const quantity = this.normalizePositiveInteger(document.getElementById('new-reagent-quantity').value, 0);
        const barcode = this.newReagentContext.barcode;

        const errors = [];
        if (!workGroup.value) errors.push('工作组');
        if (!instrument.value) errors.push('仪器');
        if (!reagentName) errors.push('试剂名称');
        if (!batchNo) errors.push('批号');
        if (!expiryDate) errors.push('有效期');
        if (!packageUnit) errors.push('包装单位');
        if (!minUnit) errors.push('最小单位');
        if (!packageToMinQty) errors.push('包装关系');
        if (!quantity) errors.push('入库数量');

        if (errors.length > 0) {
            Utils.showToast(`请填写: ${errors.join(', ')}`, 'warning');
            return;
        }

        const submitButton = document.getElementById('new-reagent-submit-btn');
        submitButton.disabled = true;
        submitButton.textContent = '保存中...';

        const payload = {
            barcode,
            workGroupId: parseInt(workGroup.value, 10),
            workGroupName: workGroup.text,
            instrumentId: parseInt(instrument.value, 10),
            instrumentName: instrument.text,
            productCode: this.normalizeProductCode(productCode),
            productionDate,
            batchNo,
            expiryDate,
            packageUnit,
            minUnit,
            packageToMinQty,
            quantity
        };

        const matchConfig = this.buildMatchPattern(barcode, payload.productCode);

        try {
            const reagent = await API.reagents.create({
                instrument_id: payload.instrumentId,
                name: reagentName,
                match_mode: matchConfig.matchMode,
                match_pattern: matchConfig.matchPattern,
                raw_barcode_sample: barcode,
                manufacturer: manufacturer || null,
                unit: minUnit,
                package_unit: packageUnit,
                package_to_min_qty: packageToMinQty
            });

            const item = this.buildCreatedScanItem(reagent, payload);
            const merged = this.appendOrMerge(this.scanItems, item, this.buildScanMergeKey);
            this.renderScanItems();
            this.closeNewReagentModal();
            Utils.showToast(merged ? '建档完成，已合并到待入库列表' : '建档完成，已加入待入库列表', 'success');
        } catch (error) {
            if (error.message.includes('已存在使用相同完整匹配模式的试剂')) {
                try {
                    const result = await API.barcode.parse(barcode);
                    if (result.reagent_id) {
                        const item = this.buildScanItem(result, barcode);
                        const merged = this.appendOrMerge(this.scanItems, item, this.buildScanMergeKey);
                        this.renderScanItems();
                        this.closeNewReagentModal();
                        Utils.showToast(merged ? '条码已存在，已合并到待入库列表' : '条码已存在，已加入待入库列表', 'success');
                        return;
                    }
                } catch (parseError) {
                    console.error('Re-parse failed:', parseError);
                }
            }

            submitButton.disabled = false;
            submitButton.textContent = '保存并加入列表';
            Utils.showToast(`建档失败: ${error.message}`, 'error', 4000);
        }
    },

    updateScanField(itemId, field, value) {
        const item = this.scanItems.find((current) => current.id === itemId);
        if (!item) {
            return;
        }

        if (field === 'quantity' || field === 'packageToMinQty') {
            item[field] = this.normalizePositiveInteger(value, 1);
        } else {
            item[field] = this.normalizeText(value);
        }

        this.renderScanItems();
    },

    renderScanItems() {
        const listEl = document.getElementById('scan-items-list');
        const countEl = document.getElementById('scan-item-count');
        const sectionEl = document.getElementById('scan-items-section');

        countEl.textContent = this.scanItems.length;

        if (this.scanItems.length === 0) {
            sectionEl.classList.add('hidden');
            listEl.innerHTML = '';
            return;
        }

        sectionEl.classList.remove('hidden');

        listEl.innerHTML = this.scanItems.map((item) => {
            const status = this.getItemStatus(item);
            const relationText = this.formatPackageRelation(item.packageUnit, item.packageToMinQty, item.minUnit);
            return `
                <div class="item-card">
                    <div class="item-card-header">
                        <div>
                            <div class="item-card-title">${this.escapeHtml(item.reagentName)}</div>
                            <div class="item-card-meta">${this.escapeHtml(item.workGroupName)} / ${this.escapeHtml(item.instrumentName)}</div>
                        </div>
                        <span class="item-status ${status.className}">${status.text}</span>
                    </div>
                    <div class="item-card-submeta">
                        条码: ${this.escapeHtml(item.barcode)}
                        ${item.productCode ? ` | 编码: ${this.escapeHtml(item.productCode)}` : ''}
                        ${item.productionDate ? ` | 生产日期: ${this.escapeHtml(item.productionDate)}` : ''}
                        | 识别可信度: ${this.escapeHtml(item.confidence || 'high')}
                    </div>
                    <div class="item-grid">
                        <label class="item-field">
                            <span>批号</span>
                            <input type="text" class="form-input" value="${this.escapeHtml(item.batchNo)}" onchange="inboundPage.updateScanField(${item.id}, 'batchNo', this.value)">
                        </label>
                        <label class="item-field">
                            <span>有效期</span>
                            <input type="date" class="form-input" value="${this.escapeHtml(item.expiryDate)}" onchange="inboundPage.updateScanField(${item.id}, 'expiryDate', this.value)">
                        </label>
                        <label class="item-field">
                            <span>包装单位</span>
                            <input type="text" class="form-input" list="package-unit-options" value="${this.escapeHtml(item.packageUnit)}" onchange="inboundPage.updateScanField(${item.id}, 'packageUnit', this.value)">
                        </label>
                        <label class="item-field">
                            <span>最小单位</span>
                            <input type="text" class="form-input" list="min-unit-options" value="${this.escapeHtml(item.minUnit)}" onchange="inboundPage.updateScanField(${item.id}, 'minUnit', this.value)">
                        </label>
                        <label class="item-field">
                            <span>包装关系</span>
                            <input type="number" min="1" class="form-input" value="${item.packageToMinQty}" onchange="inboundPage.updateScanField(${item.id}, 'packageToMinQty', this.value)">
                            <small class="field-hint">${this.escapeHtml(relationText)}</small>
                        </label>
                        <label class="item-field">
                            <span>入库数量</span>
                            <input type="number" min="1" class="form-input" value="${item.quantity}" onchange="inboundPage.updateScanField(${item.id}, 'quantity', this.value)">
                        </label>
                    </div>
                    <div class="item-card-actions">
                        <button class="btn btn-danger" onclick="inboundPage.removeScanItem(${item.id})">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    removeScanItem(itemId) {
        this.scanItems = this.scanItems.filter((item) => item.id !== itemId);
        this.renderScanItems();
    },

    clearScanItems() {
        if (this.scanItems.length === 0) {
            return;
        }

        if (confirm('确定要清空当前扫码列表吗？')) {
            this.scanItems = [];
            this.renderScanItems();
        }
    },

    validateItemsBeforeConfirm(items) {
        const invalidItem = items.find((item) => {
            if (!item.reagentName || !item.batchNo || !item.expiryDate || !item.packageUnit || !item.minUnit) {
                return true;
            }

            if (!item.quantity || item.quantity <= 0 || !item.packageToMinQty || item.packageToMinQty <= 0) {
                return true;
            }

            if (item.source === 'manual' && (!item.instrumentId || !item.workGroupId)) {
                return true;
            }

            return false;
        });

        return invalidItem ? (invalidItem.reagentName || '未命名试剂') : null;
    },

    showScanConfirm() {
        if (this.scanItems.length === 0) {
            Utils.showToast('请先扫描试剂条码', 'warning');
            return;
        }

        const invalidName = this.validateItemsBeforeConfirm(this.scanItems);
        if (invalidName) {
            Utils.showToast(`试剂“${invalidName}”仍有信息未补全，请先确认批号、效期、单位和包装关系`, 'warning', 4000);
            return;
        }

        this.pendingItems = this.scanItems.map((item) => ({ ...item }));
        this.showConfirmModal('scan');
    },
    async loadManualWorkGroups() {
        try {
            const groups = await API.inventory.getWorkGroups();
            const select = document.getElementById('manual-work-group');
            const currentValue = select.value;
            select.innerHTML = '<option value="">请选择工作组</option>';
            groups.forEach((group) => {
                select.innerHTML += `<option value="${group.id}">${this.escapeHtml(group.name)}</option>`;
            });
            select.value = currentValue;
        } catch (error) {
            console.error('Failed to load work groups:', error);
            Utils.showToast('工作组加载失败', 'error');
        }
    },

    async loadManualInstruments() {
        const workGroupId = document.getElementById('manual-work-group').value;
        const select = document.getElementById('manual-instrument');
        select.innerHTML = '<option value="">请选择仪器</option>';

        if (!workGroupId) {
            return;
        }

        try {
            const instruments = await API.inventory.getInstruments(workGroupId);
            instruments.forEach((instrument) => {
                select.innerHTML += `<option value="${instrument.id}">${this.escapeHtml(instrument.name)}</option>`;
            });
        } catch (error) {
            console.error('Failed to load instruments:', error);
            Utils.showToast('仪器加载失败', 'error');
        }
    },

    addManualItem() {
        const workGroupId = document.getElementById('manual-work-group').value;
        const instrumentId = document.getElementById('manual-instrument').value;
        const reagentName = this.normalizeText(document.getElementById('manual-reagent-name').value);
        const batchNo = this.normalizeText(document.getElementById('manual-batch-no').value);
        const expiryDate = document.getElementById('manual-expiry-date').value;
        const packageUnit = this.normalizeText(document.getElementById('manual-package-unit').value);
        const minUnit = this.normalizeText(document.getElementById('manual-min-unit').value);
        const packageToMinQty = this.normalizePositiveInteger(document.getElementById('manual-package-to-min-qty').value, 0);
        const quantity = this.normalizePositiveInteger(document.getElementById('manual-quantity').value, 0);

        const errors = [];
        if (!workGroupId) errors.push('工作组');
        if (!instrumentId) errors.push('仪器');
        if (!reagentName) errors.push('试剂名称');
        if (!batchNo) errors.push('批号');
        if (!expiryDate) errors.push('有效期');
        if (!packageUnit) errors.push('包装单位');
        if (!minUnit) errors.push('最小单位');
        if (!packageToMinQty) errors.push('包装关系');
        if (!quantity) errors.push('入库数量');

        if (errors.length > 0) {
            Utils.showToast(`请填写: ${errors.join(', ')}`, 'warning');
            return;
        }

        const item = {
            id: this.createItemId(),
            source: 'manual',
            workGroupId: parseInt(workGroupId, 10),
            workGroupName: this.getManualFormSelection('manual-work-group'),
            instrumentId: parseInt(instrumentId, 10),
            instrumentName: this.getManualFormSelection('manual-instrument'),
            reagentName,
            batchNo,
            expiryDate,
            packageUnit,
            minUnit,
            packageToMinQty,
            quantity
        };

        const merged = this.appendOrMerge(this.manualItems, item, this.buildManualMergeKey);
        this.renderManualItems();
        this.clearManualForm(false, false);
        Utils.showToast(merged ? '相同试剂批次已自动合并数量' : '已添加到待入库列表', 'success');
    },

    renderManualItems() {
        const listEl = document.getElementById('manual-items-list');
        const countEl = document.getElementById('manual-item-count');
        const sectionEl = document.getElementById('manual-items-section');

        countEl.textContent = this.manualItems.length;

        if (this.manualItems.length === 0) {
            sectionEl.classList.add('hidden');
            listEl.innerHTML = '';
            return;
        }

        sectionEl.classList.remove('hidden');

        listEl.innerHTML = this.manualItems.map((item) => {
            const status = this.getItemStatus(item);
            return `
                <div class="item-card">
                    <div class="item-card-header">
                        <div>
                            <div class="item-card-title">${this.escapeHtml(item.reagentName)}</div>
                            <div class="item-card-meta">${this.escapeHtml(item.workGroupName)} / ${this.escapeHtml(item.instrumentName)}</div>
                        </div>
                        <span class="item-status ${status.className}">${status.text}</span>
                    </div>
                    <div class="item-grid item-grid-readonly">
                        <div class="item-field">
                            <span>批号</span>
                            <strong>${this.escapeHtml(item.batchNo)}</strong>
                        </div>
                        <div class="item-field">
                            <span>有效期</span>
                            <strong>${this.escapeHtml(item.expiryDate)}</strong>
                        </div>
                        <div class="item-field">
                            <span>包装单位</span>
                            <strong>${this.escapeHtml(item.packageUnit)}</strong>
                        </div>
                        <div class="item-field">
                            <span>最小单位</span>
                            <strong>${this.escapeHtml(item.minUnit)}</strong>
                        </div>
                        <div class="item-field">
                            <span>包装关系</span>
                            <strong>${this.escapeHtml(this.formatPackageRelation(item.packageUnit, item.packageToMinQty, item.minUnit))}</strong>
                        </div>
                        <div class="item-field">
                            <span>入库数量</span>
                            <strong>${this.escapeHtml(item.quantity)}</strong>
                        </div>
                    </div>
                    <div class="item-card-actions">
                        <button class="btn btn-secondary" onclick="inboundPage.editManualItem(${item.id})">回填编辑</button>
                        <button class="btn btn-danger" onclick="inboundPage.removeManualItem(${item.id})">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    editManualItem(itemId) {
        const item = this.manualItems.find((current) => current.id === itemId);
        if (!item) {
            return;
        }

        document.getElementById('manual-work-group').value = String(item.workGroupId);
        this.loadManualInstruments().then(() => {
            document.getElementById('manual-instrument').value = String(item.instrumentId);
        });
        document.getElementById('manual-reagent-name').value = item.reagentName;
        document.getElementById('manual-batch-no').value = item.batchNo;
        document.getElementById('manual-expiry-date').value = item.expiryDate;
        document.getElementById('manual-package-unit').value = item.packageUnit;
        document.getElementById('manual-min-unit').value = item.minUnit;
        document.getElementById('manual-package-to-min-qty').value = String(item.packageToMinQty);
        document.getElementById('manual-quantity').value = String(item.quantity);
        this.refreshManualRelationPreview();

        this.removeManualItem(itemId);
        document.getElementById('manual-reagent-name').focus();
    },

    removeManualItem(itemId) {
        this.manualItems = this.manualItems.filter((item) => item.id !== itemId);
        this.renderManualItems();
    },

    clearManualItems() {
        if (this.manualItems.length === 0) {
            return;
        }

        if (confirm('确定要清空当前手工入库列表吗？')) {
            this.manualItems = [];
            this.renderManualItems();
        }
    },

    clearManualForm(clearOperator = true, clearSelection = true) {
        if (clearSelection) {
            document.getElementById('manual-work-group').value = '';
            document.getElementById('manual-instrument').innerHTML = '<option value="">请选择仪器</option>';
            document.getElementById('manual-instrument').value = '';
        }

        document.getElementById('manual-reagent-name').value = '';
        document.getElementById('manual-batch-no').value = '';
        document.getElementById('manual-expiry-date').value = '';
        document.getElementById('manual-package-unit').value = this.defaultPackageUnit;
        document.getElementById('manual-min-unit').value = this.defaultMinUnit;
        document.getElementById('manual-package-to-min-qty').value = '1';
        document.getElementById('manual-quantity').value = '1';
        this.refreshManualRelationPreview();

        if (clearOperator) {
            document.getElementById('manual-operator').value = '';
        }
    },
    showManualConfirm() {
        if (this.manualItems.length === 0) {
            Utils.showToast('请先添加手工入库试剂', 'warning');
            return;
        }

        const invalidName = this.validateItemsBeforeConfirm(this.manualItems);
        if (invalidName) {
            Utils.showToast(`试剂“${invalidName}”信息不完整，请先检查`, 'warning');
            return;
        }

        this.pendingItems = this.manualItems.map((item) => ({ ...item }));
        this.showConfirmModal('manual');
    },

    showConfirmModal(source) {
        this.pendingSource = source;
        const modal = document.getElementById('inbound-confirm-modal');
        const listEl = document.getElementById('confirm-items-list');
        const summaryEl = document.getElementById('confirm-summary');
        const defaultOperator = source === 'scan'
            ? document.getElementById('scan-operator').value
            : document.getElementById('manual-operator').value;

        Utils.populateOperatorSelect('confirm-operator', {
            defaultValue: Utils.getValidOperator(defaultOperator) || Utils.getValidOperator(Utils.getLastOperator())
        });

        const totalPackageQuantity = this.pendingItems.reduce((sum, item) => sum + item.quantity, 0);
        summaryEl.innerHTML = `
            <div class="summary-pill">入库条目 ${this.pendingItems.length}</div>
            <div class="summary-pill">包装总数 ${totalPackageQuantity}</div>
            <div class="summary-pill">${source === 'scan' ? '扫码确认' : '手工确认'}</div>
        `;

        listEl.innerHTML = this.pendingItems.map((item, index) => `
            <div class="confirm-item">
                <div class="confirm-item-name">${index + 1}. ${this.escapeHtml(item.reagentName)}</div>
                <div class="confirm-item-detail">${this.escapeHtml(item.workGroupName || '未配置工作组')} / ${this.escapeHtml(item.instrumentName || '未配置仪器')}</div>
                <div class="confirm-item-detail">批号: ${this.escapeHtml(item.batchNo)} | 效期: ${this.escapeHtml(item.expiryDate)}</div>
                <div class="confirm-item-detail">数量: ${this.escapeHtml(item.quantity)} ${this.escapeHtml(item.packageUnit)}</div>
                <div class="confirm-item-detail">规格: ${this.escapeHtml(this.formatPackageRelation(item.packageUnit, item.packageToMinQty, item.minUnit))}</div>
            </div>
        `).join('');

        modal.classList.remove('hidden');
    },

    closeConfirmModal() {
        document.getElementById('inbound-confirm-modal').classList.add('hidden');
        document.getElementById('confirm-submit-btn').disabled = false;
        document.getElementById('confirm-submit-btn').textContent = '正式入库';
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
            batch_no: item.batchNo,
            expiry_date: item.expiryDate,
            quantity: item.quantity,
            package_unit: item.packageUnit,
            min_unit: item.minUnit,
            package_to_min_qty: item.packageToMinQty,
            raw_barcode: item.barcode || `MANUAL::${item.instrumentId || 'UNKNOWN'}::${item.batchNo}`
        }));
    },

    syncOperator(operator) {
        const normalized = Utils.getValidOperator(operator);
        document.getElementById('scan-operator').value = normalized;
        document.getElementById('manual-operator').value = normalized;
    },

    async submitInbound() {
        if (this.isSubmitting) {
            return;
        }

        const operator = Utils.getValidOperator(document.getElementById('confirm-operator').value);
        if (!operator) {
            Utils.showToast('请选择入库操作人', 'warning');
            return;
        }

        this.isSubmitting = true;
        const submitButton = document.getElementById('confirm-submit-btn');
        submitButton.disabled = true;
        submitButton.textContent = '提交中...';

        try {
            const result = await API.inbound.stockInBatch({
                operator,
                items: this.buildSubmitItems()
            });

            Utils.saveLastOperator(operator);
            this.syncOperator(operator);

            if (this.pendingSource === 'scan') {
                this.scanItems = [];
                this.renderScanItems();
            } else {
                this.manualItems = [];
                this.renderManualItems();
            }

            const warningCount = result.warnings ? result.warnings.length : 0;
            this.closeConfirmModal();

            if (warningCount > 0) {
                Utils.showToast(`已入库 ${result.item_count} 条试剂，其中 ${warningCount} 条需要关注效期`, 'warning', 5000);
            } else {
                Utils.showToast(`成功入库 ${result.item_count} 条试剂`, 'success');
            }
        } catch (error) {
            submitButton.disabled = false;
            submitButton.textContent = '正式入库';
            this.isSubmitting = false;
            Utils.showToast(`入库失败: ${error.message}`, 'error', 4000);
        }
    }
};
