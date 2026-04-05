const inventoryPage = {
    inventoryData: [],
    initialized: false,
    selectedWorkGroupId: null,
    selectedInstrumentId: null,
    editReagentId: null,
    filters: {
        keyword: '',
        status: 'all',
        onlyWarnings: false,
        sort: 'severity'
    },
    lastLoadedAt: null,
    isExporting: false,

    async init() {
        if (!this.initialized) {
            this.bindEvents();
            this.initialized = true;
        }
        await this.loadInventory();
    },

    bindEvents() {
        document.getElementById('inventory-search').addEventListener('input', Utils.debounce((event) => {
            this.filters.keyword = event.target.value.trim();
            this.renderInventoryBody();
        }, 180));

        document.getElementById('inventory-status-filter').addEventListener('change', (event) => {
            this.filters.status = event.target.value || 'all';
            this.renderInventoryBody();
        });

        document.getElementById('inventory-only-warnings').addEventListener('change', (event) => {
            this.filters.onlyWarnings = event.target.checked;
            this.renderInventoryBody();
        });

        document.getElementById('inventory-sort').addEventListener('change', (event) => {
            this.filters.sort = event.target.value || 'severity';
            this.renderInventoryBody();
        });

        document.getElementById('inventory-refresh-btn').addEventListener('click', () => this.loadInventory());
        document.getElementById('inventory-export-btn').addEventListener('click', () => this.openExportModal());
        document.getElementById('inventory-archive-zero-btn').addEventListener('click', () => this.archiveZeroStockReagents());
        document.getElementById('inventory-batch-warning-btn').addEventListener('click', () => this.batchUpdateInstrumentWarnings());
        document.getElementById('inventory-reagent-modal-close').addEventListener('click', () => this.closeReagentModal());
        document.getElementById('inventory-reagent-modal-cancel').addEventListener('click', () => this.closeReagentModal());
        document.getElementById('inventory-reagent-modal-save').addEventListener('click', () => this.saveReagentSettings());
        document.getElementById('inventory-export-preset').addEventListener('change', (event) => this.applyExportPreset(event.target.value));
        document.getElementById('inventory-export-work-group').addEventListener('change', () => this.handleExportWorkGroupChange());
        document.getElementById('inventory-export-confirm').addEventListener('click', () => this.exportInventory());
        document.getElementById('inventory-export-cancel').addEventListener('click', () => this.closeExportModal());
        document.getElementById('inventory-export-modal-close').addEventListener('click', () => this.closeExportModal());

        const modal = document.getElementById('inventory-reagent-modal');
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.closeReagentModal();
            }
        });

        const exportModal = document.getElementById('inventory-export-modal');
        exportModal.addEventListener('click', (event) => {
            if (event.target === exportModal) {
                this.closeExportModal();
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

    async loadInventory() {
        this.inventoryData = await API.inventory.get();
        this.lastLoadedAt = new Date();
        this.ensureSelection();
        this.syncFilterControls();
        this.render();
    },

    ensureSelection() {
        const allInstruments = this.inventoryData.flatMap((group) => group.instruments || []);
        if (!allInstruments.length) {
            this.selectedWorkGroupId = null;
            this.selectedInstrumentId = null;
            return;
        }

        if (!this.inventoryData.some((group) => group.id === this.selectedWorkGroupId)) {
            const firstGroup = this.inventoryData.find((group) => (group.instruments || []).length > 0) || this.inventoryData[0];
            this.selectedWorkGroupId = firstGroup?.id ?? null;
        }

        const selectedGroup = this.getSelectedWorkGroup();
        const groupInstruments = selectedGroup?.instruments || [];
        if (!groupInstruments.some((item) => item.id === this.selectedInstrumentId)) {
            this.selectedInstrumentId = groupInstruments[0]?.id ?? null;
        }
    },

    syncFilterControls() {
        document.getElementById('inventory-search').value = this.filters.keyword;
        document.getElementById('inventory-status-filter').value = this.filters.status;
        document.getElementById('inventory-only-warnings').checked = this.filters.onlyWarnings;
        document.getElementById('inventory-sort').value = this.filters.sort;
    },

    getSelectedWorkGroup() {
        return this.inventoryData.find((group) => group.id === this.selectedWorkGroupId) || null;
    },

    getSelectedInstrument() {
        const group = this.getSelectedWorkGroup();
        return (group?.instruments || []).find((instrument) => instrument.id === this.selectedInstrumentId) || null;
    },

    getGroupWarningCount(group) {
        return (group.instruments || []).reduce((sum, instrument) => sum + this.getInstrumentWarningCount(instrument), 0);
    },

    getInstrumentWarningCount(instrument) {
        return (instrument.reagents || []).filter((item) => item.status_level !== 'normal').length;
    },

    getInstrumentSummary(instrument) {
        const reagents = instrument?.reagents || [];
        return {
            reagentCount: reagents.length,
            expiringCount: reagents.filter((item) => item.status_level === 'expiring').length,
            lowStockCount: reagents.filter((item) => item.status_level === 'low' || item.status_level === 'empty').length,
            expiredBatchCount: reagents.reduce((sum, item) => sum + item.batches.filter((batch) => batch.is_expired).length, 0)
        };
    },

    getSortedReagents(reagents) {
        const levelPriority = { empty: 0, expired: 1, expiring: 2, low: 3, normal: 4 };
        const next = [...reagents];
        next.sort((left, right) => {
            if (this.filters.sort === 'name') {
                return left.name.localeCompare(right.name, 'zh-CN');
            }
            if (this.filters.sort === 'stock') {
                return (
                    left.total_min_quantity - right.total_min_quantity
                    || left.name.localeCompare(right.name, 'zh-CN')
                );
            }
            if (this.filters.sort === 'expiry') {
                return (
                    (left.nearest_expiry_days ?? Number.MAX_SAFE_INTEGER) - (right.nearest_expiry_days ?? Number.MAX_SAFE_INTEGER)
                    || levelPriority[left.status_level] - levelPriority[right.status_level]
                    || left.name.localeCompare(right.name, 'zh-CN')
                );
            }
            return (
                levelPriority[left.status_level] - levelPriority[right.status_level]
                || (left.nearest_expiry_days ?? Number.MAX_SAFE_INTEGER) - (right.nearest_expiry_days ?? Number.MAX_SAFE_INTEGER)
                || left.name.localeCompare(right.name, 'zh-CN')
            );
        });
        return next;
    },

    getFilteredReagents(instrument) {
        const keyword = this.filters.keyword.toLowerCase();
        return this.getSortedReagents((instrument?.reagents || []).filter((reagent) => {
            if (keyword && !reagent.name.toLowerCase().includes(keyword)) {
                return false;
            }
            if (this.filters.status !== 'all' && reagent.status_level !== this.filters.status) {
                return false;
            }
            if (this.filters.onlyWarnings && reagent.status_level === 'normal') {
                return false;
            }
            return true;
        }));
    },

    selectWorkGroup(groupId) {
        this.selectedWorkGroupId = groupId;
        const group = this.getSelectedWorkGroup();
        this.selectedInstrumentId = group?.instruments?.[0]?.id ?? null;
        this.render();
    },

    selectInstrument(instrumentId) {
        this.selectedInstrumentId = instrumentId;
        this.render();
    },

    readBatchWarningInputs() {
        return {
            default_warning_days: Math.max(parseInt(document.getElementById('inventory-default-warning-days').value, 10) || 0, 0),
            default_warning_stock: Math.max(parseInt(document.getElementById('inventory-default-warning-stock').value, 10) || 0, 0)
        };
    },

    populateExportWorkGroupOptions(selectedValue = '') {
        const select = document.getElementById('inventory-export-work-group');
        const currentValue = String(selectedValue || '');
        select.innerHTML = `
            <option value="">全部工作组</option>
            ${this.inventoryData.map((group) => `
                <option value="${group.id}" ${String(group.id) === currentValue ? 'selected' : ''}>${this.escapeHtml(group.name)}</option>
            `).join('')}
        `;
    },

    populateExportInstrumentOptions(workGroupId, selectedValue = '') {
        const select = document.getElementById('inventory-export-instrument');
        const group = this.inventoryData.find((item) => item.id === Number(workGroupId));
        const instruments = group?.instruments || [];
        const currentValue = String(selectedValue || '');

        select.innerHTML = `
            <option value="">全部仪器</option>
            ${instruments.map((instrument) => `
                <option value="${instrument.id}" ${String(instrument.id) === currentValue ? 'selected' : ''}>${this.escapeHtml(instrument.name)}</option>
            `).join('')}
        `;
        select.disabled = !workGroupId;
    },

    applyExportPreset(preset) {
        const workGroupSelect = document.getElementById('inventory-export-work-group');
        const instrumentSelect = document.getElementById('inventory-export-instrument');

        if (preset === 'current-instrument' && this.selectedWorkGroupId && this.selectedInstrumentId) {
            workGroupSelect.value = String(this.selectedWorkGroupId);
            this.populateExportInstrumentOptions(this.selectedWorkGroupId, this.selectedInstrumentId);
            instrumentSelect.value = String(this.selectedInstrumentId);
            return;
        }

        if (preset === 'current-group' && this.selectedWorkGroupId) {
            workGroupSelect.value = String(this.selectedWorkGroupId);
            this.populateExportInstrumentOptions(this.selectedWorkGroupId, '');
            instrumentSelect.value = '';
            return;
        }

        workGroupSelect.value = '';
        this.populateExportInstrumentOptions('', '');
        instrumentSelect.value = '';
    },

    handleExportWorkGroupChange() {
        const workGroupId = document.getElementById('inventory-export-work-group').value;
        this.populateExportInstrumentOptions(workGroupId, '');
    },

    openExportModal() {
        this.populateExportWorkGroupOptions();
        this.populateExportInstrumentOptions('', '');
        const defaultPreset = this.selectedInstrumentId ? 'current-instrument' : 'all';
        document.getElementById('inventory-export-preset').value = defaultPreset;
        this.applyExportPreset(defaultPreset);
        this.setExportButtonLoading(false);
        document.getElementById('inventory-export-modal').classList.remove('hidden');
    },

    closeExportModal(force = false) {
        if (this.isExporting && !force) {
            return;
        }
        document.getElementById('inventory-export-modal').classList.add('hidden');
    },

    setExportButtonLoading(loading) {
        this.isExporting = loading;
        const button = document.getElementById('inventory-export-confirm');
        button.disabled = loading;
        button.textContent = loading ? '导出中...' : '开始导出';
    },

    findReagentById(reagentId) {
        for (const group of this.inventoryData) {
            for (const instrument of group.instruments || []) {
                const reagent = (instrument.reagents || []).find((item) => item.id === reagentId);
                if (reagent) {
                    return reagent;
                }
            }
        }
        return null;
    },

    findInstrumentById(instrumentId) {
        for (const group of this.inventoryData) {
            const instrument = (group.instruments || []).find((item) => item.id === instrumentId);
            if (instrument) {
                return { group, instrument };
            }
        }
        return null;
    },

    async batchUpdateInstrumentWarnings() {
        const instrument = this.getSelectedInstrument();
        if (!instrument) {
            return;
        }

        const payload = this.readBatchWarningInputs();
        if (!confirm(`确定批量设置“${instrument.name}”下全部试剂的预警值吗？`)) {
            return;
        }

        const result = await API.inventory.batchUpdateInstrumentWarnings(instrument.id, payload);
        Utils.showToast(`已批量更新 ${result.updated_count} 个试剂，并同步保存为当前仪器默认值`, 'success');
        await this.loadInventory();
    },

    async archiveReagent(reagentId) {
        const reagent = this.findReagentById(reagentId);
        if (!reagent || reagent.total_min_quantity > 0) {
            return;
        }
        if (!confirm(`确定归档零库存试剂“${reagent.name}”吗？归档后它将不再出现在库存页面。`)) {
            return;
        }

        await API.inventory.archiveReagent(reagentId);
        Utils.showToast('试剂已归档', 'success');
        await this.loadInventory();
    },

    async archiveZeroStockReagents() {
        if (!confirm('确定一键归档所有零库存试剂吗？归档后它们将不再出现在库存页面。')) {
            return;
        }

        const result = await API.inventory.archiveZeroStockReagents();
        if (!result.archived_count) {
            Utils.showToast('当前没有可归档的零库存试剂', 'warning');
            return;
        }

        Utils.showToast(`已归档 ${result.archived_count} 个零库存试剂`, 'success');
        await this.loadInventory();
    },

    async exportInventory() {
        if (this.isExporting) {
            return;
        }

        const workGroupId = document.getElementById('inventory-export-work-group').value;
        const instrumentId = document.getElementById('inventory-export-instrument').value;
        const params = {
            work_group_id: workGroupId || null,
            instrument_id: instrumentId || null
        };

        this.setExportButtonLoading(true);
        try {
            const { blob, filename } = await API.inventory.exportExcel(params);
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(downloadUrl);
            this.closeExportModal(true);
            Utils.showToast('库存 Excel 已开始下载', 'success');
        } catch (error) {
            Utils.showToast(error.message || '导出失败，请稍后重试', 'error');
        } finally {
            this.setExportButtonLoading(false);
        }
    },

    openReagentModal(reagentId) {
        const reagent = this.findReagentById(reagentId);
        if (!reagent) {
            return;
        }

        this.editReagentId = reagentId;
        document.getElementById('inventory-reagent-modal-title').textContent = `设置试剂信息 · ${reagent.name}`;
        document.getElementById('inventory-reagent-name').value = reagent.name;
        document.getElementById('inventory-reagent-warning-days').value = String(reagent.warning_days);
        document.getElementById('inventory-reagent-warning-stock').value = String(reagent.warning_stock);

        const instrumentSelect = document.getElementById('inventory-reagent-instrument');
        instrumentSelect.innerHTML = this.inventoryData.map((group) => `
            <optgroup label="${this.escapeHtml(group.name)}">
                ${(group.instruments || []).map((instrument) => `
                    <option value="${instrument.id}" ${instrument.id === reagent.instrument_id ? 'selected' : ''}>
                        ${this.escapeHtml(instrument.name)}
                    </option>
                `).join('')}
            </optgroup>
        `).join('');

        document.getElementById('inventory-reagent-modal').classList.remove('hidden');
    },

    closeReagentModal() {
        this.editReagentId = null;
        document.getElementById('inventory-reagent-modal').classList.add('hidden');
    },

    async saveReagentSettings() {
        if (!this.editReagentId) {
            return;
        }

        const reagent = this.findReagentById(this.editReagentId);
        if (!reagent) {
            return;
        }

        const payload = {
            instrument_id: parseInt(document.getElementById('inventory-reagent-instrument').value, 10),
            name: document.getElementById('inventory-reagent-name').value.trim(),
            manufacturer: reagent.manufacturer,
            unit: reagent.unit,
            package_unit: reagent.package_unit,
            package_to_min_qty: reagent.package_to_min_qty,
            warning_days: Math.max(parseInt(document.getElementById('inventory-reagent-warning-days').value, 10) || 0, 0),
            warning_stock: Math.max(parseInt(document.getElementById('inventory-reagent-warning-stock').value, 10) || 0, 0),
            follow_instrument: false
        };

        if (!payload.instrument_id || !payload.name) {
            return Utils.showToast('请完整填写试剂名称和所属仪器', 'warning');
        }

        await API.reagents.update(this.editReagentId, payload);
        this.closeReagentModal();
        Utils.showToast('试剂信息已更新', 'success');
        await this.loadInventory();
    },

    render() {
        this.renderWorkGroupTabs();
        this.renderInstrumentTabs();
        this.renderInventoryHeader();
        this.renderInventoryBody();
    },

    renderWorkGroupTabs() {
        const container = document.getElementById('inventory-work-group-tabs');
        if (!this.inventoryData.length) {
            container.innerHTML = '<p class="catalog-empty">暂无工作组</p>';
            return;
        }

        container.innerHTML = this.inventoryData.map((group) => {
            const warningCount = this.getGroupWarningCount(group);
            return `
                <button class="inventory-tab ${group.id === this.selectedWorkGroupId ? 'active' : ''}" onclick="inventoryPage.selectWorkGroup(${group.id})">
                    <span>${this.escapeHtml(group.name)}</span>
                    ${warningCount ? `<span class="inventory-tab-badge">${warningCount}</span>` : ''}
                </button>
            `;
        }).join('');
    },

    renderInstrumentTabs() {
        const container = document.getElementById('inventory-instrument-tabs');
        const group = this.getSelectedWorkGroup();
        const instruments = group?.instruments || [];
        if (!instruments.length) {
            container.innerHTML = '<p class="catalog-empty">当前工作组下暂无仪器</p>';
            return;
        }

        container.innerHTML = instruments.map((instrument) => {
            const warningCount = this.getInstrumentWarningCount(instrument);
            return `
                <button class="inventory-subtab ${instrument.id === this.selectedInstrumentId ? 'active' : ''}" onclick="inventoryPage.selectInstrument(${instrument.id})">
                    <span>${this.escapeHtml(instrument.name)}</span>
                    ${warningCount ? `<span class="inventory-tab-badge">${warningCount}</span>` : ''}
                </button>
            `;
        }).join('');
    },

    renderInventoryHeader() {
        const instrument = this.getSelectedInstrument();
        const title = document.getElementById('inventory-current-title');
        const subtitle = document.getElementById('inventory-current-subtitle');
        const refreshed = document.getElementById('inventory-last-refreshed');
        const summaryContainer = document.getElementById('inventory-summary-cards');
        const daysInput = document.getElementById('inventory-default-warning-days');
        const stockInput = document.getElementById('inventory-default-warning-stock');

        refreshed.textContent = this.lastLoadedAt ? `最近刷新：${Utils.formatDateTime(this.lastLoadedAt)}` : '';

        if (!instrument) {
            title.textContent = '暂无可查看的仪器';
            subtitle.textContent = '请先维护工作组和仪器，或切换到有库存的仪器。';
            summaryContainer.innerHTML = '';
            daysInput.value = '30';
            stockInput.value = '5';
            return;
        }

        const group = this.getSelectedWorkGroup();
        const summary = this.getInstrumentSummary(instrument);
        title.textContent = instrument.model ? `${instrument.name} (${instrument.model})` : instrument.name;
        subtitle.textContent = `${group?.name || '未分组'} · 在这里可以批量设置当前仪器下试剂的预警值，并同步保存为以后新试剂的默认值。`;
        daysInput.value = String(instrument.default_warning_days ?? 30);
        stockInput.value = String(instrument.default_warning_stock ?? 5);

        summaryContainer.innerHTML = `
            <div class="inventory-summary-card">
                <div class="inventory-summary-label">在库试剂数</div>
                <div class="inventory-summary-value">${summary.reagentCount}</div>
            </div>
            <div class="inventory-summary-card inventory-summary-warn">
                <div class="inventory-summary-label">近效期数</div>
                <div class="inventory-summary-value">${summary.expiringCount}</div>
            </div>
            <div class="inventory-summary-card inventory-summary-caution">
                <div class="inventory-summary-label">低库存数</div>
                <div class="inventory-summary-value">${summary.lowStockCount}</div>
            </div>
            <div class="inventory-summary-card inventory-summary-danger">
                <div class="inventory-summary-label">已过期批次数</div>
                <div class="inventory-summary-value">${summary.expiredBatchCount}</div>
            </div>
        `;
    },

    renderInventoryBody() {
        const instrument = this.getSelectedInstrument();
        const container = document.getElementById('inventory-reagent-list');
        const resultMeta = document.getElementById('inventory-result-meta');

        if (!instrument) {
            resultMeta.textContent = '';
            container.innerHTML = '<div class="inventory-empty">当前没有可展示的库存数据。</div>';
            return;
        }

        const reagents = this.getFilteredReagents(instrument);
        resultMeta.textContent = `显示 ${reagents.length} / ${instrument.reagents.length} 个试剂`;

        if (!reagents.length) {
            container.innerHTML = '<div class="inventory-empty">当前筛选条件下没有匹配的库存试剂。</div>';
            return;
        }

        container.innerHTML = reagents.map((reagent) => this.renderReagentCard(reagent)).join('');
    },

    getStatusLabel(level) {
        if (level === 'empty') {
            return '零库存';
        }
        return {
            expired: '已过期',
            expiring: '近效期',
            low: '低库存',
            normal: '正常'
        }[level] || '正常';
    },

    formatDaysLabel(days) {
        if (days === null || days === undefined) {
            return '未知';
        }
        if (days < 0) {
            return `已过期 ${Math.abs(days)} 天`;
        }
        if (days === 0) {
            return '今天到期';
        }
        return `剩余 ${days} 天`;
    },

    getBatchStatus(batch, reagent) {
        if (batch.available_min_quantity <= 0 || batch.is_expired) {
            return 'expired';
        }
        if (batch.expiry_days_left <= reagent.effective_warning_days) {
            return 'expiring';
        }
        return 'normal';
    },

    renderReagentCard(reagent) {
        const manufacturerHtml = reagent.manufacturer
            ? `<div class="inventory-card-maker">${this.escapeHtml(reagent.manufacturer)}</div>`
            : '';
        const archiveButtonHtml = reagent.status_level === 'empty'
            ? `<button class="btn btn-danger btn-small" onclick="inventoryPage.archiveReagent(${reagent.id})">归档</button>`
            : '';
        const actionButtonsHtml = `
            <div class="inventory-card-actions">
                ${archiveButtonHtml}
                <button class="btn btn-secondary btn-small" onclick="inventoryPage.openReagentModal(${reagent.id})">设置试剂信息</button>
            </div>
        `;

        const batchListHtml = reagent.batches.length > 1 ? `
            <div class="inventory-batch-list">
                ${reagent.batches.map((batch) => `
                    <div class="inventory-batch-row ${this.getBatchStatus(batch, reagent)}">
                        <div class="inventory-batch-primary">
                            <span class="inventory-batch-code">批号 ${this.escapeHtml(batch.batch_no)}</span>
                            <span class="inventory-batch-expiry">有效期 ${this.escapeHtml(batch.expiry_date)}</span>
                            <span class="inventory-batch-days">${this.escapeHtml(this.formatDaysLabel(batch.expiry_days_left))}</span>
                        </div>
                        <div class="inventory-batch-secondary">
                            <span>当前库存 ${batch.available_min_quantity} ${this.escapeHtml(batch.min_unit)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : '';

        return `
            <article class="inventory-card inventory-card-${reagent.status_level}">
                <div class="inventory-card-accent"></div>
                <div class="inventory-card-header">
                    <div class="inventory-card-main">
                        <div class="inventory-card-title-row">
                            <h4>${this.escapeHtml(reagent.name)}</h4>
                            <span class="inventory-status inventory-status-${reagent.status_level}">${this.getStatusLabel(reagent.status_level)}</span>
                        </div>
                        ${manufacturerHtml}
                        <div class="inventory-key-metrics">
                            <div class="inventory-key-metric">
                                <span>当前总库存</span>
                                <strong>${reagent.total_min_quantity} ${this.escapeHtml(reagent.unit || '瓶')}</strong>
                            </div>
                            <div class="inventory-key-metric">
                                <span>最近效期</span>
                                <strong>${this.escapeHtml(reagent.nearest_expiry_date || '暂无')}</strong>
                            </div>
                            <div class="inventory-key-metric">
                                <span>离失效剩余</span>
                                <strong>${this.escapeHtml(this.formatDaysLabel(reagent.nearest_expiry_days))}</strong>
                            </div>
                            <div class="inventory-key-metric">
                                <span>批次数</span>
                                <strong>${reagent.batch_count}</strong>
                            </div>
                        </div>
                    </div>
                    ${actionButtonsHtml}
                </div>
                ${batchListHtml}
            </article>
        `;
    }
};
