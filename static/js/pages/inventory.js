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
        onlyCalibrators: false,
        sort: 'severity'
    },
    lastLoadedAt: null,
    isExporting: false,
    focusReagentId: null,

    async init() {
        if (!this.initialized) {
            this.bindEvents();
            this.initialized = true;
        }
        await this.loadInventory();
        this.consumeNavigationContext();
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

        document.getElementById('inventory-only-calibrators').addEventListener('change', (event) => {
            this.filters.onlyCalibrators = event.target.checked;
            this.renderInventoryBody();
        });

        document.getElementById('inventory-sort').addEventListener('change', (event) => {
            this.filters.sort = event.target.value || 'severity';
            this.renderInventoryBody();
        });

        document.getElementById('inventory-refresh-btn')?.addEventListener('click', () => this.loadInventory());
        document.getElementById('inventory-export-btn')?.addEventListener('click', () => this.openExportModal());
        document.getElementById('inventory-archive-zero-btn')?.addEventListener('click', () => this.archiveZeroStockReagents());
        document.getElementById('inventory-reagent-modal-close')?.addEventListener('click', () => this.closeReagentModal());
        document.getElementById('inventory-reagent-modal-cancel')?.addEventListener('click', () => this.closeReagentModal());
        document.getElementById('inventory-reagent-modal-save')?.addEventListener('click', () => this.saveReagentSettings());
        document.getElementById('inventory-export-preset')?.addEventListener('change', (event) => this.applyExportPreset(event.target.value));
        document.getElementById('inventory-export-work-group')?.addEventListener('change', () => this.handleExportWorkGroupChange());
        document.getElementById('inventory-export-confirm')?.addEventListener('click', () => this.exportInventory());
        document.getElementById('inventory-export-cancel')?.addEventListener('click', () => this.closeExportModal());
        document.getElementById('inventory-export-modal-close')?.addEventListener('click', () => this.closeExportModal());

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

    consumeNavigationContext() {
        if (typeof app === 'undefined' || !app.navigationContext || app.currentPage !== 'inventory') {
            return;
        }
        this.applyExternalFilters(app.navigationContext);
        app.navigationContext = null;
    },

    applyExternalFilters(context = {}) {
        if (typeof context.keyword === 'string') {
            this.filters.keyword = context.keyword.trim();
        }
        if (typeof context.status === 'string') {
            this.filters.status = context.status;
        }
        if (typeof context.onlyWarnings === 'boolean') {
            this.filters.onlyWarnings = context.onlyWarnings;
        }
        if (typeof context.onlyCalibrators === 'boolean') {
            this.filters.onlyCalibrators = context.onlyCalibrators;
        }
        if (typeof context.sort === 'string') {
            this.filters.sort = context.sort;
        }
        if (context.focusReagentId || context.reagentId) {
            this.focusReagentId = Number(context.focusReagentId || context.reagentId);
        } else if (context.focusFirstMatch) {
            this.focusReagentId = null;
        }

        if (context.workGroupId && context.instrumentId) {
            this.selectedWorkGroupId = Number(context.workGroupId);
            this.selectedInstrumentId = Number(context.instrumentId);
        } else {
            const matched = this.findMatchingInstrument(context);
            if (matched) {
                this.selectedWorkGroupId = matched.workGroupId;
                this.selectedInstrumentId = matched.instrumentId;
            }
        }

        this.syncFilterControls();
        this.render();
    },

    findMatchingInstrument(context = {}) {
        const keyword = String(context.keyword || '').trim().toLowerCase();
        const targetStatus = context.status && context.status !== 'all' ? context.status : null;
        for (const group of this.inventoryData) {
            for (const instrument of (group.instruments || [])) {
                const hasMatch = (instrument.reagents || []).some((reagent) => {
                    if (context.reagentId && reagent.id !== Number(context.reagentId)) {
                        return false;
                    }
                    if (keyword && !reagent.name.toLowerCase().includes(keyword)) {
                        return false;
                    }
                    if (targetStatus && !this.matchesStatusFilter(reagent, targetStatus)) {
                        return false;
                    }
                    if (context.onlyWarnings && reagent.status_level === 'normal') {
                        return false;
                    }
                    return true;
                });
                if (hasMatch) {
                    if (!this.focusReagentId && context.focusFirstMatch) {
                        const firstMatch = (instrument.reagents || []).find((reagent) => {
                            if (context.reagentId && reagent.id !== Number(context.reagentId)) {
                                return false;
                            }
                            if (keyword && !reagent.name.toLowerCase().includes(keyword)) {
                                return false;
                            }
                            if (targetStatus && !this.matchesStatusFilter(reagent, targetStatus)) {
                                return false;
                            }
                            if (context.onlyWarnings && reagent.status_level === 'normal') {
                                return false;
                            }
                            return true;
                        });
                        this.focusReagentId = firstMatch?.id ?? null;
                    }
                    return { workGroupId: group.id, instrumentId: instrument.id };
                }
            }
        }
        return null;
    },

    matchesStatusFilter(reagent, status) {
        if (!status || status === 'all') {
            return true;
        }
        if (status === 'low_or_empty') {
            return reagent.status_level === 'low' || reagent.status_level === 'empty';
        }
        return reagent.status_level === status;
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
        document.getElementById('inventory-only-calibrators').checked = this.filters.onlyCalibrators;
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
            if (!this.matchesStatusFilter(reagent, this.filters.status)) {
                return false;
            }
            if (this.filters.onlyWarnings && reagent.status_level === 'normal') {
                return false;
            }
            if (this.filters.onlyCalibrators && !reagent.is_calibrator) {
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

        refreshed.textContent = this.lastLoadedAt ? `最近刷新：${Utils.formatDateTime(this.lastLoadedAt)}` : '';

        if (!instrument) {
            title.textContent = '暂无可查看的仪器';
            subtitle.textContent = '请先维护工作组和仪器，或切换到有库存的仪器。';
            summaryContainer.innerHTML = '';
            return;
        }

        const group = this.getSelectedWorkGroup();
        const summary = this.getInstrumentSummary(instrument);
        title.textContent = instrument.model ? `${instrument.name} (${instrument.model})` : instrument.name;
        subtitle.textContent = `${group?.name || '未分组'} / 当前库存页优先展示更多试剂；仪器预警请到资料设置中维护。`;
        subtitle.textContent = `${group?.name || '未分组'} · 在这里可以批量设置当前仪器下试剂的预警值，并同步保存为以后新试剂的默认值。`;

        subtitle.textContent = `${group?.name || '未分组'} / 当前库存页优先展示更多试剂；仪器预警请到资料设置中维护。`;
        summaryContainer.innerHTML = `
            <div class="inventory-summary-card">
                <div class="inventory-summary-label">在库试剂数</div>
                <div class="inventory-summary-value inventory-number-strong">${summary.reagentCount}</div>
            </div>
            <div class="inventory-summary-card inventory-summary-warn">
                <div class="inventory-summary-label">近效期数</div>
                <div class="inventory-summary-value inventory-number-strong">${summary.expiringCount}</div>
            </div>
            <div class="inventory-summary-card inventory-summary-caution">
                <div class="inventory-summary-label">低库存数</div>
                <div class="inventory-summary-value inventory-number-strong">${summary.lowStockCount}</div>
            </div>
            <div class="inventory-summary-card inventory-summary-danger">
                <div class="inventory-summary-label">已过期批次数</div>
                <div class="inventory-summary-value inventory-number-strong">${summary.expiredBatchCount}</div>
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

        container.innerHTML = reagents.map((reagent) => this.renderCompactReagentCard(reagent)).join('');
        this.focusTargetReagentCard();
    },

    focusTargetReagentCard() {
        if (!this.focusReagentId) {
            return;
        }

        const targetCard = document.querySelector(`[data-reagent-id="${this.focusReagentId}"]`);
        if (!targetCard) {
            return;
        }

        targetCard.classList.remove('inventory-card-focused');
        targetCard.offsetWidth;
        targetCard.classList.add('inventory-card-focused');
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => {
            targetCard.classList.remove('inventory-card-focused');
        }, 2200);
        this.focusReagentId = null;
    },

    renderCompactReagentCard(reagent) {
        const manufacturerHtml = reagent.manufacturer
            ? `<span class="inventory-card-maker">${this.escapeHtml(reagent.manufacturer)}</span>`
            : '';
        const settingsButtonHtml = `<button class="btn btn-secondary btn-small inventory-card-manage-btn" onclick="inventoryPage.openReagentModal(${reagent.id})">设置试剂信息</button>`;
        const archiveButtonHtml = reagent.status_level === 'empty'
            ? `<button class="btn btn-danger btn-small" onclick="inventoryPage.archiveReagent(${reagent.id})">归档</button>`
            : '';
        const actionButtonsHtml = archiveButtonHtml
            ? `<div class="inventory-card-actions compact inventory-card-actions-inline">${archiveButtonHtml}</div>`
            : '';
        const batchListHtml = reagent.batches.length ? `
            <div class="inventory-batch-list compact">
                ${reagent.batches.map((batch) => `
                    <div class="inventory-batch-row compact ${this.getBatchStatus(batch, reagent)}">
                        <div class="inventory-batch-primary">
                            <span class="inventory-batch-code">批号 ${this.escapeHtml(batch.batch_no)}</span>
                            <span class="inventory-batch-expiry">效期 ${this.escapeHtml(batch.expiry_date)}</span>
                            <span class="inventory-batch-days">${this.escapeHtml(this.formatDaysLabel(batch.expiry_days_left))}</span>
                            <span class="inventory-batch-stock">库存 ${batch.available_min_quantity} ${this.escapeHtml(batch.min_unit || reagent.unit || '瓶')}</span>
                            <span class="inventory-batch-entry">入库 ${this.escapeHtml(Utils.formatDate(batch.created_at) || '')}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : '';

        return `
            <article class="inventory-card inventory-card-compact inventory-card-${reagent.status_level}" data-reagent-id="${reagent.id}">
                <div class="inventory-card-accent"></div>
                <div class="inventory-card-header compact">
                    <div class="inventory-card-main">
                        <div class="inventory-card-title-row compact">
                            <div class="inventory-card-title-main compact">
                                <h4>${this.escapeHtml(reagent.name)}</h4>
                                ${manufacturerHtml}
                                <span class="inventory-status inventory-status-${reagent.status_level}">${this.getStatusLabel(reagent.status_level)}</span>
                                <span class="inventory-inline-meta">批次 ${reagent.batch_count}</span>
                            </div>
                            ${settingsButtonHtml}
                        </div>
                        <div class="inventory-key-metrics compact">
                            <div class="inventory-key-metric compact">
                                <span>总库存</span>
                                <strong class="inventory-number-strong">${reagent.total_min_quantity} ${this.escapeHtml(reagent.unit || '瓶')}</strong>
                            </div>
                            <div class="inventory-key-metric compact">
                                <span>最近效期</span>
                                <strong>${this.escapeHtml(reagent.nearest_expiry_date || '暂无')}</strong>
                            </div>
                            <div class="inventory-key-metric compact">
                                <span>剩余天数</span>
                                <strong>${this.escapeHtml(this.formatDaysLabel(reagent.nearest_expiry_days))}</strong>
                            </div>
                            <div class="inventory-key-metric compact">
                                <span>预警值</span>
                                <strong>${reagent.warning_stock} / ${reagent.warning_days}</strong>
                            </div>
                        </div>
                    </div>
                    ${actionButtonsHtml}
                </div>
                ${batchListHtml}
            </article>
        `;
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
        const settingsButtonHtml = `<button class="btn btn-secondary btn-small inventory-card-manage-btn" onclick="inventoryPage.openReagentModal(${reagent.id})">设置试剂信息</button>`;
        const archiveButtonHtml = reagent.status_level === 'empty'
            ? `<button class="btn btn-danger btn-small" onclick="inventoryPage.archiveReagent(${reagent.id})">归档</button>`
            : '';
        const actionButtonsHtml = archiveButtonHtml
            ? `
            <div class="inventory-card-actions inventory-card-actions-inline">
                ${archiveButtonHtml}
            </div>
        `
            : '';

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
                            <span class="inventory-batch-stock-text">当前库存 ${batch.available_min_quantity} ${this.escapeHtml(batch.min_unit)}</span>
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
                            <div class="inventory-card-title-main">
                                <h4>${this.escapeHtml(reagent.name)}</h4>
                                <span class="inventory-status inventory-status-${reagent.status_level}">${this.getStatusLabel(reagent.status_level)}</span>
                            </div>
                            ${settingsButtonHtml}
                        </div>
                        ${manufacturerHtml}
                        <div class="inventory-key-metrics">
                            <div class="inventory-key-metric">
                                <span>当前总库存</span>
                                <strong class="inventory-number-strong">${reagent.total_min_quantity} ${this.escapeHtml(reagent.unit || '瓶')}</strong>
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
