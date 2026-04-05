// Outbound Page Logic

const outboundPage = {
    currentBarcode: null,
    currentReagentId: null,
    selectedBatchId: null,
    batches: [],
    candidates: [],
    initialized: false,

    init() {
        if (!this.initialized) {
            this.initialized = true;
            this.setupBarcodeInput();
        }

        const lastOperator = Utils.getLastOperator();
        if (lastOperator) {
            document.getElementById('outbound-operator').value = lastOperator;
        }

        document.getElementById('outbound-barcode').focus();
    },

    setupBarcodeInput() {
        const input = document.getElementById('outbound-barcode');
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.parseBarcode();
            }
        });
        input.focus();
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
                Utils.showToast('未识别到已知试剂', 'error');
                return;
            }

            if (result.match_type === 'prefix' && result.reagent_id === null && result.candidates.length > 0) {
                // Multiple candidates
                this.candidates = result.candidates;
                this.showCandidateSelection(result.candidates);
            } else {
                // Single match
                this.currentReagentId = result.reagent_id;
                await this.loadBatches(result.reagent_id);
            }
        } catch (error) {
            Utils.showToast('识别失败: ' + error.message, 'error');
        }
    },

    showCandidateSelection(candidates) {
        const resultSection = document.getElementById('outbound-result');
        const batchList = document.getElementById('outbound-batch-list');
        document.getElementById('outbound-form').classList.add('hidden');

        resultSection.classList.remove('hidden');

        let html = '<h3>选择试剂</h3><div class="candidate-list">';
        candidates.forEach(candidate => {
            html += `
                <div class="candidate-item" onclick="outboundPage.selectCandidate(${candidate.id})">
                    <div>
                        <div class="candidate-name">${candidate.name}</div>
                        <div class="candidate-meta">${candidate.work_group_name || '未配置工作组'} / ${candidate.instrument_name || '未配置仪器'}</div>
                    </div>
                    <button class="btn btn-secondary">选择</button>
                </div>
            `;
        });
        html += '</div>';
        batchList.innerHTML = html;
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
            Utils.showToast('加载库存失败: ' + error.message, 'error');
        }
    },

    showBatchList() {
        const resultSection = document.getElementById('outbound-result');
        const batchList = document.getElementById('outbound-batch-list');

        resultSection.classList.remove('hidden');

        if (this.batches.length === 0) {
            batchList.innerHTML = '<p>该试剂暂无库存</p>';
            return;
        }

        let html = '<div class="batch-list">';
        this.batches.forEach(batch => {
            const isExpired = Utils.isExpired(batch.expiry_date);
            const daysLeft = Utils.getDaysUntilExpiry(batch.expiry_date);
            const expiredClass = isExpired ? 'expired' : '';
            const daysText = isExpired ? '已过期' : `剩余 ${daysLeft} 天`;

            html += `
                <div class="batch-item ${expiredClass}" data-id="${batch.id}" onclick="outboundPage.selectBatch(${batch.id})">
                    <div class="batch-info">
                        <span><span class="label">批号:</span> ${batch.batch_no}</span>
                        <span><span class="label">有效期:</span> ${batch.expiry_date} (${daysText})</span>
                        <span><span class="label">库存:</span> ${batch.quantity} ${batch.package_unit || '盒'}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        batchList.innerHTML = html;
    },

    selectBatch(batchId) {
        this.selectedBatchId = batchId;

        document.querySelectorAll('.batch-item').forEach(item => {
            item.classList.toggle('selected', parseInt(item.dataset.id) === batchId);
        });

        const batch = this.batches.find(b => b.id === batchId);
        if (batch) {
            const isExpired = Utils.isExpired(batch.expiry_date);
            const daysLeft = Utils.getDaysUntilExpiry(batch.expiry_date);
            const daysText = isExpired ? '已过期' : `剩余 ${daysLeft} 天`;

            document.getElementById('outbound-selected-batch').innerHTML = `
                <div>批号: ${batch.batch_no}</div>
                <div>有效期: ${batch.expiry_date} (${daysText})</div>
                <div>当前库存: ${batch.quantity} ${batch.package_unit || '盒'}</div>
            `;
            document.getElementById('outbound-form').classList.remove('hidden');
        }
    },

    async submitOutbound() {
        const quantity = parseInt(document.getElementById('outbound-quantity').value);
        const operator = document.getElementById('outbound-operator').value.trim();

        if (!this.selectedBatchId) {
            Utils.showToast('请选择批次', 'warning');
            return;
        }

        const errors = Utils.validateRequired({
            '出库数量': quantity,
            '操作人': operator
        });

        if (errors.length > 0) {
            Utils.showToast(`请填写: ${errors.join(', ')}`, 'warning');
            return;
        }

        if (quantity <= 0) {
            Utils.showToast('出库数量必须大于0', 'warning');
            return;
        }

        const data = {
            batch_stock_id: this.selectedBatchId,
            quantity: quantity,
            operator: operator,
            raw_barcode: this.currentBarcode
        };

        try {
            const result = await API.outbound.stockOut(data);
            Utils.saveLastOperator(operator);
            Utils.showToast('出库成功', 'success');

            this.resetForm();
        } catch (error) {
            Utils.showToast('出库失败: ' + error.message, 'error');
        }
    },

    resetForm() {
        document.getElementById('outbound-barcode').value = '';
        document.getElementById('outbound-result').classList.add('hidden');
        document.getElementById('outbound-form').classList.add('hidden');
        document.getElementById('outbound-quantity').value = '1';
        this.currentBarcode = null;
        this.currentReagentId = null;
        this.selectedBatchId = null;
        this.batches = [];
        this.candidates = [];
        document.getElementById('outbound-barcode').focus();
    }
};
