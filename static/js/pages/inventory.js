// Inventory Page Logic

const inventoryPage = {
    catalog: [],
    editingWorkGroupId: null,
    editingInstrumentId: null,

    async init() {
        await this.loadCatalog();
        await this.loadInstruments();
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

    async loadCatalog() {
        try {
            this.catalog = await API.inventory.getWorkGroupCatalog();
            this.renderCatalog();
        } catch (error) {
            console.error('Failed to load catalog:', error);
            Utils.showToast('基础资料加载失败: ' + error.message, 'error');
        }
    },

    renderCatalog() {
        this.renderWorkGroupList();
        this.renderInstrumentGroupSelect();
        this.renderInstrumentList();
    },

    renderWorkGroupList() {
        const list = document.getElementById('catalog-work-group-list');
        if (this.catalog.length === 0) {
            list.innerHTML = '<p class="catalog-empty">暂无工作组</p>';
            return;
        }

        list.innerHTML = this.catalog.map(group => `
            <div class="catalog-item">
                <div>
                    <div class="catalog-item-title">${this.escapeHtml(group.name)}</div>
                    <div class="catalog-item-meta">仪器 ${group.instruments.length} 台</div>
                </div>
                <button class="btn btn-secondary" onclick="inventoryPage.editWorkGroup(${group.id})">编辑</button>
            </div>
        `).join('');
    },

    renderInstrumentGroupSelect() {
        const select = document.getElementById('catalog-instrument-work-group');
        const currentValue = select.value;
        select.innerHTML = '<option value="">请选择工作组</option>';
        this.catalog.forEach(group => {
            select.innerHTML += `<option value="${group.id}">${this.escapeHtml(group.name)}</option>`;
        });
        if (this.catalog.some(group => String(group.id) === currentValue)) {
            select.value = currentValue;
        }
    },

    renderInstrumentList() {
        const list = document.getElementById('catalog-instrument-list');
        if (this.catalog.length === 0) {
            list.innerHTML = '<p class="catalog-empty">暂无仪器</p>';
            return;
        }

        list.innerHTML = this.catalog.map(group => `
            <div class="catalog-group">
                <div class="catalog-group-title">${this.escapeHtml(group.name)}</div>
                ${(group.instruments || []).length > 0 ? group.instruments.map(instrument => `
                    <div class="catalog-item">
                        <div>
                            <div class="catalog-item-title">${this.escapeHtml(instrument.name)}</div>
                            <div class="catalog-item-meta">${this.escapeHtml(instrument.model || '未设置型号')}</div>
                        </div>
                        <button class="btn btn-secondary" onclick="inventoryPage.editInstrument(${instrument.id})">编辑</button>
                    </div>
                `).join('') : '<p class="catalog-empty">该工作组暂无仪器</p>'}
            </div>
        `).join('');
    },

    async loadInstruments() {
        try {
            const instruments = await API.inventory.getInstruments();
            const select = document.getElementById('inventory-instrument');
            const currentValue = select.value;
            select.innerHTML = '<option value="">全部仪器</option>';
            instruments.forEach(i => {
                select.innerHTML += `<option value="${i.id}">${this.escapeHtml(i.name)}</option>`;
            });
            if (instruments.some(i => String(i.id) === currentValue)) {
                select.value = currentValue;
            }
        } catch (error) {
            console.error('Failed to load instruments:', error);
        }
    },

    async loadInventory() {
        const instrumentId = document.getElementById('inventory-instrument').value;
        const resultDiv = document.getElementById('inventory-result');

        try {
            const data = await API.inventory.get(instrumentId || null);
            this.renderInventory(data);
        } catch (error) {
            resultDiv.innerHTML = '<p>加载失败: ' + this.escapeHtml(error.message) + '</p>';
        }
    },

    renderInventory(data) {
        const resultDiv = document.getElementById('inventory-result');

        if (data.length === 0) {
            resultDiv.innerHTML = '<p>暂无库存数据</p>';
            return;
        }

        let html = '';
        data.forEach(group => {
            html += `
                <div class="tree-group">
                    <div class="tree-group-header">${this.escapeHtml(group.name)}</div>
            `;

            group.instruments.forEach(inst => {
                html += `
                    <div class="tree-instrument">
                        <div class="tree-instrument-header">${this.escapeHtml(inst.name)} ${inst.model ? '(' + this.escapeHtml(inst.model) + ')' : ''}</div>
                `;

                inst.reagents.forEach(reagent => {
                    const totalQty = reagent.batches.reduce((sum, b) => sum + b.quantity, 0);
                    const displayPackageUnit = reagent.package_unit || '盒';
                    html += `
                        <div class="tree-reagent">
                            <div class="tree-reagent-header">
                                <span>${this.escapeHtml(reagent.name)}（最小单位：${this.escapeHtml(reagent.unit)}）</span>
                                <span>总库存: ${totalQty} ${this.escapeHtml(displayPackageUnit)}</span>
                            </div>
                            <div class="tree-batches">
                    `;

                    reagent.batches.forEach(batch => {
                        const isExpired = Utils.isExpired(batch.expiry_date);
                        const expiredClass = isExpired ? 'expired' : '';
                        const statusText = isExpired ? ' [已过期]' : '';

                        html += `
                            <div class="tree-batch ${expiredClass}">
                                <span>批号: ${this.escapeHtml(batch.batch_no)}${statusText}</span>
                                <span>有效期: ${this.escapeHtml(batch.expiry_date)} | 数量: ${batch.quantity} ${this.escapeHtml(batch.package_unit || displayPackageUnit)}</span>
                            </div>
                        `;
                    });

                    html += '</div></div>';
                });

                html += '</div>';
            });

            html += '</div>';
        });

        resultDiv.innerHTML = html;
    },

    resetWorkGroupForm() {
        this.editingWorkGroupId = null;
        document.getElementById('catalog-work-group-name').value = '';
    },

    editWorkGroup(workGroupId) {
        const group = this.catalog.find(item => item.id === workGroupId);
        if (!group) {
            return;
        }

        this.editingWorkGroupId = workGroupId;
        document.getElementById('catalog-work-group-name').value = group.name;
        document.getElementById('catalog-work-group-name').focus();
    },

    async submitWorkGroup() {
        const name = document.getElementById('catalog-work-group-name').value.trim();
        if (!name) {
            Utils.showToast('请输入工作组名称', 'warning');
            return;
        }

        try {
            if (this.editingWorkGroupId) {
                await API.inventory.updateWorkGroup(this.editingWorkGroupId, { name });
                Utils.showToast('工作组已更新', 'success');
            } else {
                await API.inventory.createWorkGroup({ name });
                Utils.showToast('工作组已新增', 'success');
            }

            this.resetWorkGroupForm();
            await this.loadCatalog();
            await this.loadInstruments();
        } catch (error) {
            Utils.showToast('保存工作组失败: ' + error.message, 'error');
        }
    },

    resetInstrumentForm() {
        this.editingInstrumentId = null;
        document.getElementById('catalog-instrument-work-group').value = '';
        document.getElementById('catalog-instrument-name').value = '';
        document.getElementById('catalog-instrument-model').value = '';
    },

    findInstrument(instrumentId) {
        for (const group of this.catalog) {
            const instrument = (group.instruments || []).find(item => item.id === instrumentId);
            if (instrument) {
                return instrument;
            }
        }
        return null;
    },

    editInstrument(instrumentId) {
        const instrument = this.findInstrument(instrumentId);
        if (!instrument) {
            return;
        }

        this.editingInstrumentId = instrumentId;
        document.getElementById('catalog-instrument-work-group').value = String(instrument.work_group_id);
        document.getElementById('catalog-instrument-name').value = instrument.name;
        document.getElementById('catalog-instrument-model').value = instrument.model || '';
        document.getElementById('catalog-instrument-name').focus();
    },

    async submitInstrument() {
        const workGroupId = document.getElementById('catalog-instrument-work-group').value;
        const name = document.getElementById('catalog-instrument-name').value.trim();
        const model = document.getElementById('catalog-instrument-model').value.trim();

        const errors = [];
        if (!workGroupId) errors.push('所属工作组');
        if (!name) errors.push('仪器名称');
        if (errors.length > 0) {
            Utils.showToast(`请填写: ${errors.join(', ')}`, 'warning');
            return;
        }

        const payload = {
            work_group_id: parseInt(workGroupId, 10),
            name,
            model: model || null
        };

        try {
            if (this.editingInstrumentId) {
                await API.inventory.updateInstrument(this.editingInstrumentId, payload);
                Utils.showToast('仪器已更新', 'success');
            } else {
                await API.inventory.createInstrument(payload);
                Utils.showToast('仪器已新增', 'success');
            }

            this.resetInstrumentForm();
            await this.loadCatalog();
            await this.loadInstruments();
        } catch (error) {
            Utils.showToast('保存仪器失败: ' + error.message, 'error');
        }
    }
};
