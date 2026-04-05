const outboundPage = {
    currentBarcode: null,
    currentReagentId: null,
    selectedBatchId: null,
    batches: [],
    candidates: [],
    initialized: false,

    async init() {
        if (!this.initialized) {
            this.initialized = true;
            this.setupBarcodeInput();
        }
        await Utils.populateOperatorSelect('outbound-operator', {
            allowEmpty: true,
            emptyLabel: '请选择操作人',
            defaultValue: Utils.getLastOperator()
        });
        document.getElementById('outbound-barcode').focus();
    },

    setupBarcodeInput() {
        document.getElementById('outbound-barcode').addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                this.parseBarcode();
            }
        });
    },

    async parseBarcode() {
        const barcode = document.getElementById('outbound-barcode').value.trim();
        if (!barcode) {
            Utils.showToast('请输入条码', 'warning');
            return;
        }
        this.currentBarcode = barcode;
        try {
            const result = await API.barcode.parse(barcode);
            if (result.match_type === 'none') {
                Utils.showToast('未识别到已建档的试剂', 'error');
                return;
            }
            if (result.match_type === 'prefix' && result.reagent_id === null && result.candidates.length > 0) {
                this.candidates = result.candidates;
                this.showCandidateSelection(result.candidates);
                return;
            }
            this.currentReagentId = result.reagent_id;
            await this.loadBatches(result.reagent_id);
        } catch (error) {
            Utils.showToast(`识别失败：${error.message}`, 'error');
        }
    },

    showCandidateSelection(candidates) {
        document.getElementById('outbound-result').classList.remove('hidden');
        document.getElementById('outbound-form').classList.add('hidden');
        document.getElementById('outbound-batch-list').innerHTML = `
            <h3>选择试剂档案</h3>
            <div class="candidate-list">
                ${candidates.map((item) => `
                    <div class="candidate-item" onclick="outboundPage.selectCandidate(${item.id})">
                        <div>
                            <div class="candidate-name">${item.name}</div>
                            <div class="candidate-meta">${item.work_group_name || '未配置工作组'} / ${item.instrument_name || '未配置仪器'}</div>
                        </div>
                        <button class="btn btn-secondary">选择</button>
                    </div>
                `).join('')}
            </div>
        `;
    },

    async selectCandidate(reagentId) {
        this.currentReagentId = reagentId;
        await this.loadBatches(reagentId);
    },

    async loadBatches(reagentId) {
        try {
            this.batches = await API.outbound.getStock(reagentId);
            this.showBatchList();
        } catch (error) {
            Utils.showToast(`加载库存失败：${error.message}`, 'error');
        }
    },

    showBatchList() {
        const resultSection = document.getElementById('outbound-result');
        const batchList = document.getElementById('outbound-batch-list');
        resultSection.classList.remove('hidden');
        if (!this.batches.length) {
            batchList.innerHTML = '<p class="catalog-empty">该试剂暂无库存</p>';
            return;
        }
        batchList.innerHTML = `<div class="batch-list">${this.batches.map((batch) => {
            const isExpired = Utils.isExpired(batch.expiry_date);
            const daysLeft = Utils.getDaysUntilExpiry(batch.expiry_date);
            const daysText = isExpired ? '已过期' : `剩余 ${daysLeft} 天`;
            return `
                <div class="batch-item ${isExpired ? 'expired' : ''}" data-id="${batch.id}" onclick="outboundPage.selectBatch(${batch.id})">
                    <div class="batch-info">
                        <span><span class="label">批号:</span> ${batch.batch_no}</span>
                        <span><span class="label">效期:</span> ${batch.expiry_date} (${daysText})</span>
                        <span><span class="label">库存:</span> ${batch.quantity} ${batch.package_unit || '盒'}</span>
                    </div>
                </div>
            `;
        }).join('')}</div>`;
    },

    selectBatch(batchId) {
        this.selectedBatchId = batchId;
        document.querySelectorAll('.batch-item').forEach((item) => {
            item.classList.toggle('selected', parseInt(item.dataset.id, 10) === batchId);
        });
        const batch = this.batches.find((item) => item.id === batchId);
        if (!batch) return;
        const isExpired = Utils.isExpired(batch.expiry_date);
        const daysText = isExpired ? '已过期' : `剩余 ${Utils.getDaysUntilExpiry(batch.expiry_date)} 天`;
        document.getElementById('outbound-selected-batch').innerHTML = `
            <div>批号：${batch.batch_no}</div>
            <div>效期：${batch.expiry_date} (${daysText})</div>
            <div>当前库存：${batch.quantity} ${batch.package_unit || '盒'}</div>
        `;
        document.getElementById('outbound-form').classList.remove('hidden');
    },

    async submitOutbound() {
        const quantity = parseInt(document.getElementById('outbound-quantity').value, 10);
        const operator = Utils.getValidOperator(document.getElementById('outbound-operator').value);
        if (!this.selectedBatchId) return Utils.showToast('请先选择批次', 'warning');
        if (!quantity || quantity <= 0) return Utils.showToast('出库数量必须大于 0', 'warning');
        if (!operator) return Utils.showToast('请选择有效的操作人', 'warning');
        try {
            await API.outbound.stockOut({
                batch_stock_id: this.selectedBatchId,
                quantity,
                operator,
                raw_barcode: this.currentBarcode
            });
            Utils.saveLastOperator(operator);
            Utils.showToast('出库成功', 'success');
            await this.resetForm();
        } catch (error) {
            Utils.showToast(`出库失败：${error.message}`, 'error');
        }
    },

    async resetForm() {
        document.getElementById('outbound-barcode').value = '';
        document.getElementById('outbound-result').classList.add('hidden');
        document.getElementById('outbound-form').classList.add('hidden');
        document.getElementById('outbound-quantity').value = '1';
        await Utils.populateOperatorSelect('outbound-operator', {
            allowEmpty: true,
            emptyLabel: '请选择操作人',
            defaultValue: Utils.getLastOperator()
        });
        this.currentBarcode = null;
        this.currentReagentId = null;
        this.selectedBatchId = null;
        this.batches = [];
        this.candidates = [];
    }
};
