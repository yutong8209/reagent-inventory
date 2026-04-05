const inventoryPage = {
    catalog: [],
    reagents: [],
    operators: [],
    editingWorkGroupId: null,
    editingInstrumentId: null,
    editingOperatorId: null,
    editingReagentId: null,

    async init() {
        this.refreshReagentRelationPreview();
        await this.loadCatalog();
        await this.loadOperators();
        await this.loadInstruments();
        await this.loadReagents();
        await this.loadInventory();
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    formatRelation(packageUnit, qty, minUnit) {
        const p = String(packageUnit || '盒').trim() || '盒';
        const m = String(minUnit || '瓶').trim() || '瓶';
        const q = Math.max(parseInt(qty, 10) || 1, 1);
        return `1${p} = ${q}${m}`;
    },

    refreshReagentRelationPreview() {
        const preview = document.getElementById('catalog-reagent-package-relation-preview');
        if (!preview) return;
        preview.textContent = this.formatRelation(
            document.getElementById('catalog-reagent-package-unit').value,
            document.getElementById('catalog-reagent-package-to-min-qty').value,
            document.getElementById('catalog-reagent-min-unit').value
        );
    },

    async loadCatalog() {
        this.catalog = await API.inventory.getWorkGroupCatalog();
        this.renderCatalog();
    },

    renderCatalog() {
        this.renderWorkGroupList();
        this.renderInstrumentGroupSelect();
        this.renderInstrumentList();
        this.renderReagentSelectors();
    },

    renderWorkGroupList() {
        const list = document.getElementById('catalog-work-group-list');
        list.innerHTML = this.catalog.length
            ? this.catalog.map((group) => `
                <div class="catalog-item">
                    <div><div class="catalog-item-title">${this.escapeHtml(group.name)}</div><div class="catalog-item-meta">仪器 ${group.instruments.length} 台</div></div>
                    <button class="btn btn-secondary" onclick="inventoryPage.editWorkGroup(${group.id})">编辑</button>
                </div>
            `).join('')
            : '<p class="catalog-empty">暂无工作组</p>';
    },

    renderInstrumentGroupSelect() {
        const html = ['<option value="">请选择工作组</option>'].concat(
            this.catalog.map((group) => `<option value="${group.id}">${this.escapeHtml(group.name)}</option>`)
        ).join('');
        ['catalog-instrument-work-group', 'catalog-reagent-filter-work-group', 'catalog-reagent-work-group'].forEach((id) => {
            const select = document.getElementById(id);
            const current = select.value;
            select.innerHTML = id === 'catalog-reagent-filter-work-group'
                ? html.replace('请选择工作组', '全部工作组')
                : html;
            if ([...select.options].some((option) => option.value === current)) {
                select.value = current;
            }
        });
    },

    renderInstrumentList() {
        const list = document.getElementById('catalog-instrument-list');
        list.innerHTML = this.catalog.length
            ? this.catalog.map((group) => `
                <div class="catalog-group">
                    <div class="catalog-group-title">${this.escapeHtml(group.name)}</div>
                    ${(group.instruments || []).length
                        ? group.instruments.map((instrument) => `
                            <div class="catalog-item">
                                <div><div class="catalog-item-title">${this.escapeHtml(instrument.name)}</div><div class="catalog-item-meta">${this.escapeHtml(instrument.model || '未填写型号')}</div></div>
                                <button class="btn btn-secondary" onclick="inventoryPage.editInstrument(${instrument.id})">编辑</button>
                            </div>
                        `).join('')
                        : '<p class="catalog-empty">该工作组暂无仪器</p>'}
                </div>
            `).join('')
            : '<p class="catalog-empty">暂无仪器</p>';
    },

    renderReagentSelectors() {
        this.loadReagentFilterInstruments();
        this.loadReagentFormInstruments();
    },

    async loadReagentFilterInstruments() {
        const workGroupId = document.getElementById('catalog-reagent-filter-work-group').value;
        const select = document.getElementById('catalog-reagent-filter-instrument');
        select.innerHTML = '<option value="">全部仪器</option>';
        const instruments = await API.inventory.getInstruments(workGroupId || null).catch(() => []);
        select.innerHTML += instruments.map((item) => `<option value="${item.id}">${this.escapeHtml(item.name)}</option>`).join('');
    },

    async loadReagentFormInstruments(selectedValue = '') {
        const workGroupId = document.getElementById('catalog-reagent-work-group').value;
        const select = document.getElementById('catalog-reagent-instrument');
        select.innerHTML = '<option value="">请选择仪器</option>';
        if (!workGroupId) return;
        const instruments = await API.inventory.getInstruments(workGroupId).catch(() => []);
        select.innerHTML += instruments.map((item) => `<option value="${item.id}">${this.escapeHtml(item.name)}</option>`).join('');
        if (selectedValue) select.value = String(selectedValue);
    },

    async loadOperators() {
        this.operators = await API.operators.list();
        const list = document.getElementById('catalog-operator-list');
        list.innerHTML = this.operators.map((item) => `
            <div class="catalog-item">
                <div><div class="catalog-item-title">${this.escapeHtml(item.name)}</div><div class="catalog-item-meta">${item.is_active ? '启用中' : '已停用'}</div></div>
                <button class="btn btn-secondary" onclick="inventoryPage.editOperator(${item.id})">编辑</button>
            </div>
        `).join('') || '<p class="catalog-empty">暂无操作人</p>';
    },

    async loadInstruments() {
        const instruments = await API.inventory.getInstruments();
        const select = document.getElementById('inventory-instrument');
        const current = select.value;
        select.innerHTML = '<option value="">全部仪器</option>' + instruments.map((item) => `<option value="${item.id}">${this.escapeHtml(item.name)}</option>`).join('');
        if ([...select.options].some((option) => option.value === current)) {
            select.value = current;
        }
    },

    async loadReagents() {
        const params = {
            work_group_id: document.getElementById('catalog-reagent-filter-work-group').value || null,
            instrument_id: document.getElementById('catalog-reagent-filter-instrument').value || null,
            keyword: document.getElementById('catalog-reagent-filter-keyword').value.trim() || null
        };
        this.reagents = await API.reagents.list(params);
        const list = document.getElementById('catalog-reagent-list');
        list.innerHTML = this.reagents.length
            ? this.reagents.map((item) => `
                <div class="catalog-item">
                    <div>
                        <div class="catalog-item-title">${this.escapeHtml(item.name)}</div>
                        <div class="catalog-item-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
                        <div class="catalog-item-meta">${this.escapeHtml(this.formatRelation(item.package_unit, item.package_to_min_qty, item.unit))}</div>
                        <div class="catalog-item-meta">低库存预警：${item.warning_stock} ${this.escapeHtml(item.unit || '瓶')}</div>
                    </div>
                    <button class="btn btn-secondary" onclick="inventoryPage.editReagent(${item.id})">编辑</button>
                </div>
            `).join('')
            : '<p class="catalog-empty">没有找到试剂档案</p>';
    },

    async loadInventory() {
        const instrumentId = document.getElementById('inventory-instrument').value;
        const data = await API.inventory.get(instrumentId || null);
        const resultDiv = document.getElementById('inventory-result');
        if (!data.length) {
            resultDiv.innerHTML = '<p class="catalog-empty">暂无库存数据</p>';
            return;
        }
        resultDiv.innerHTML = data.map((group) => `
            <div class="tree-group">
                <div class="tree-group-header">${this.escapeHtml(group.name)}</div>
                ${group.instruments.map((instrument) => `
                    <div class="tree-instrument">
                        <div class="tree-instrument-header">${this.escapeHtml(instrument.name)}${instrument.model ? ` (${this.escapeHtml(instrument.model)})` : ''}</div>
                        ${instrument.reagents.map((reagent) => `
                            <div class="tree-reagent">
                                <div class="tree-reagent-header">
                                    <span>${this.escapeHtml(reagent.name)}</span>
                                    <span>${reagent.batches.reduce((sum, batch) => sum + batch.quantity, 0)} ${this.escapeHtml(reagent.package_unit || '盒')}</span>
                                </div>
                                <div class="tree-batches">
                                    ${reagent.batches.map((batch) => `
                                        <div class="tree-batch ${Utils.isExpired(batch.expiry_date) ? 'expired' : ''}">
                                            <span>批号：${this.escapeHtml(batch.batch_no)}</span>
                                            <span>效期：${this.escapeHtml(batch.expiry_date)} | 数量：${batch.quantity} ${this.escapeHtml(batch.package_unit || reagent.package_unit || '盒')}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `).join('');
    },

    resetWorkGroupForm() {
        this.editingWorkGroupId = null;
        document.getElementById('catalog-work-group-name').value = '';
    },

    editWorkGroup(id) {
        const item = this.catalog.find((group) => group.id === id);
        if (!item) return;
        this.editingWorkGroupId = id;
        document.getElementById('catalog-work-group-name').value = item.name;
    },

    async submitWorkGroup() {
        const name = document.getElementById('catalog-work-group-name').value.trim();
        if (!name) return Utils.showToast('请输入工作组名称', 'warning');
        this.editingWorkGroupId
            ? await API.inventory.updateWorkGroup(this.editingWorkGroupId, { name })
            : await API.inventory.createWorkGroup({ name });
        Utils.showToast(this.editingWorkGroupId ? '工作组已更新' : '工作组已新增', 'success');
        this.resetWorkGroupForm();
        await this.loadCatalog();
        await this.loadInstruments();
    },

    resetInstrumentForm() {
        this.editingInstrumentId = null;
        document.getElementById('catalog-instrument-work-group').value = '';
        document.getElementById('catalog-instrument-name').value = '';
        document.getElementById('catalog-instrument-model').value = '';
    },

    editInstrument(id) {
        for (const group of this.catalog) {
            const instrument = (group.instruments || []).find((item) => item.id === id);
            if (!instrument) continue;
            this.editingInstrumentId = id;
            document.getElementById('catalog-instrument-work-group').value = String(instrument.work_group_id);
            document.getElementById('catalog-instrument-name').value = instrument.name;
            document.getElementById('catalog-instrument-model').value = instrument.model || '';
            return;
        }
    },

    async submitInstrument() {
        const payload = {
            work_group_id: parseInt(document.getElementById('catalog-instrument-work-group').value, 10),
            name: document.getElementById('catalog-instrument-name').value.trim(),
            model: document.getElementById('catalog-instrument-model').value.trim() || null
        };
        if (!payload.work_group_id || !payload.name) {
            return Utils.showToast('请填写所属工作组和仪器名称', 'warning');
        }
        this.editingInstrumentId
            ? await API.inventory.updateInstrument(this.editingInstrumentId, payload)
            : await API.inventory.createInstrument(payload);
        Utils.showToast(this.editingInstrumentId ? '仪器已更新' : '仪器已新增', 'success');
        this.resetInstrumentForm();
        await this.loadCatalog();
        await this.loadInstruments();
    },

    resetOperatorForm() {
        this.editingOperatorId = null;
        document.getElementById('catalog-operator-name').value = '';
        document.getElementById('catalog-operator-active').checked = true;
    },

    editOperator(id) {
        const item = this.operators.find((operator) => operator.id === id);
        if (!item) return;
        this.editingOperatorId = id;
        document.getElementById('catalog-operator-name').value = item.name;
        document.getElementById('catalog-operator-active').checked = item.is_active;
    },

    async submitOperator() {
        const name = document.getElementById('catalog-operator-name').value.trim();
        const isActive = document.getElementById('catalog-operator-active').checked;
        if (!name) return Utils.showToast('请输入操作人姓名', 'warning');
        if (this.editingOperatorId) {
            await API.operators.update(this.editingOperatorId, { name, is_active: isActive });
        } else {
            await API.operators.create({ name });
        }
        Utils.operatorsLoaded = false;
        await Utils.loadOperators(true);
        await this.loadOperators();
        this.resetOperatorForm();
        Utils.showToast(this.editingOperatorId ? '操作人已更新' : '操作人已新增', 'success');
    },

    clearReagentFilters() {
        document.getElementById('catalog-reagent-filter-work-group').value = '';
        document.getElementById('catalog-reagent-filter-instrument').innerHTML = '<option value="">全部仪器</option>';
        document.getElementById('catalog-reagent-filter-keyword').value = '';
        this.loadReagents();
    },

    resetReagentForm() {
        this.editingReagentId = null;
        document.getElementById('catalog-reagent-work-group').value = '';
        document.getElementById('catalog-reagent-instrument').innerHTML = '<option value="">请选择仪器</option>';
        document.getElementById('catalog-reagent-name').value = '';
        document.getElementById('catalog-reagent-manufacturer').value = '';
        document.getElementById('catalog-reagent-package-unit').value = '盒';
        document.getElementById('catalog-reagent-min-unit').value = '瓶';
        document.getElementById('catalog-reagent-package-to-min-qty').value = '1';
        document.getElementById('catalog-reagent-warning-days').value = '30';
        document.getElementById('catalog-reagent-warning-stock').value = '5';
        this.refreshReagentRelationPreview();
    },

    async editReagent(id) {
        const item = this.reagents.find((reagent) => reagent.id === id);
        if (!item) return;
        this.editingReagentId = id;
        document.getElementById('catalog-reagent-work-group').value = String(item.work_group_id);
        await this.loadReagentFormInstruments(item.instrument_id);
        document.getElementById('catalog-reagent-name').value = item.name;
        document.getElementById('catalog-reagent-manufacturer').value = item.manufacturer || '';
        document.getElementById('catalog-reagent-package-unit').value = item.package_unit;
        document.getElementById('catalog-reagent-min-unit').value = item.unit;
        document.getElementById('catalog-reagent-package-to-min-qty').value = String(item.package_to_min_qty);
        document.getElementById('catalog-reagent-warning-days').value = String(item.warning_days);
        document.getElementById('catalog-reagent-warning-stock').value = String(item.warning_stock);
        this.refreshReagentRelationPreview();
    },

    async submitReagent() {
        if (!this.editingReagentId) {
            return Utils.showToast('请先从左侧选择一个试剂档案进行编辑', 'warning');
        }
        const payload = {
            instrument_id: parseInt(document.getElementById('catalog-reagent-instrument').value, 10),
            name: document.getElementById('catalog-reagent-name').value.trim(),
            manufacturer: document.getElementById('catalog-reagent-manufacturer').value.trim() || null,
            package_unit: document.getElementById('catalog-reagent-package-unit').value.trim(),
            unit: document.getElementById('catalog-reagent-min-unit').value.trim(),
            package_to_min_qty: parseInt(document.getElementById('catalog-reagent-package-to-min-qty').value, 10),
            warning_days: parseInt(document.getElementById('catalog-reagent-warning-days').value, 10),
            warning_stock: parseInt(document.getElementById('catalog-reagent-warning-stock').value, 10)
        };
        if (!payload.instrument_id || !payload.name || !payload.package_unit || !payload.unit || !payload.package_to_min_qty) {
            return Utils.showToast('请完整填写试剂档案信息', 'warning');
        }
        await API.reagents.update(this.editingReagentId, payload);
        Utils.showToast('试剂档案已更新', 'success');
        await this.loadReagents();
        await this.loadInventory();
    },

    async resetReagentData() {
        if (!confirm('该操作会清空所有试剂、库存和流水记录，确定继续吗？')) return;
        await API.inventory.resetReagentData();
        Utils.showToast('试剂与库存数据已重置', 'success');
        this.resetReagentForm();
        await this.loadReagents();
        await this.loadInventory();
    }
};
