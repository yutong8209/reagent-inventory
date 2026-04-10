const reportsPage = {
    initialized: false,
    mode: 'transactions',
    workGroups: [],
    transactionRows: [],
    usageRows: [],
    scopes: {
        transactions: {
            selectedReagentId: null,
            selectedLabel: '',
            reagentInput: '',
            reagentOptions: [],
            visibleOptions: [],
            highlightedIndex: -1,
            dropdownOpen: false
        },
        usage: {
            selectedReagentId: null,
            selectedLabel: '',
            reagentInput: '',
            reagentOptions: [],
            visibleOptions: [],
            highlightedIndex: -1,
            dropdownOpen: false
        }
    },

    async init() {
        try {
            if (!this.initialized) {
                this.bindEvents();
                this.setDefaultDates();
                this.initialized = true;
            }
            await this.loadSelectors();
            await this.loadCurrentMode();
        } catch (error) {
            console.error('Failed to initialize reports page:', error);
            Utils.showToast('报表页面加载失败，请刷新后重试', 'error');
        }
    },

    bindEvents() {
        document.getElementById('reports-transactions-work-group').addEventListener('change', async () => {
            await this.loadInstruments('transactions');
            await this.loadReagents('transactions');
        });
        document.getElementById('reports-transactions-instrument').addEventListener('change', async () => {
            await this.loadReagents('transactions');
        });
        document.getElementById('reports-usage-work-group').addEventListener('change', async () => {
            await this.loadInstruments('usage');
            await this.loadReagents('usage');
        });
        document.getElementById('reports-usage-instrument').addEventListener('change', async () => {
            await this.loadReagents('usage');
        });

        ['transactions', 'usage'].forEach((scope) => {
            document.getElementById(`reports-${scope}-start-date`).addEventListener('change', () => {
                this.syncQuickRangeButtons(scope);
            });
            document.getElementById(`reports-${scope}-end-date`).addEventListener('change', () => {
                this.syncQuickRangeButtons(scope);
            });

            const input = document.getElementById(`reports-${scope}-reagent-input`);
            input.addEventListener('focus', () => this.openReagentDropdown(scope));
            input.addEventListener('click', () => this.openReagentDropdown(scope));
            input.addEventListener('input', (event) => this.handleReagentInput(scope, event.target.value));
            input.addEventListener('keydown', (event) => this.handleReagentKeydown(scope, event));

            const options = document.getElementById(`reports-${scope}-reagent-options`);
            options.addEventListener('mousedown', (event) => {
                const option = event.target.closest('[data-option-index]');
                if (!option) {
                    return;
                }
                event.preventDefault();
                this.selectVisibleOption(scope, Number(option.dataset.optionIndex));
            });
        });

        document.querySelectorAll('[data-report-scope][data-range]').forEach((button) => {
            button.addEventListener('click', () => {
                this.applyQuickRange(button.dataset.reportScope, button.dataset.range);
            });
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.reports-combobox')) {
                this.closeAllReagentDropdowns();
            }
        });

        document.getElementById('reports-transactions-search-btn').addEventListener('click', () => this.loadTransactions());
        document.getElementById('reports-transactions-export-btn').addEventListener('click', () => this.exportTransactions());
        document.getElementById('reports-usage-search-btn').addEventListener('click', () => this.loadUsage());
        document.getElementById('reports-usage-export-btn').addEventListener('click', () => this.exportUsage());
    },

    switchMode(mode) {
        this.mode = mode;
        document.querySelectorAll('[data-report-mode]').forEach((button) => {
            button.classList.toggle('active', button.dataset.reportMode === mode);
        });
        document.getElementById('reports-transactions-panel').classList.toggle('hidden', mode !== 'transactions');
        document.getElementById('reports-usage-panel').classList.toggle('hidden', mode !== 'usage');
        this.loadCurrentMode();
    },

    async loadCurrentMode() {
        if (this.mode === 'usage') {
            await this.loadUsage();
            return;
        }
        await this.loadTransactions();
    },

    getScopeState(scope) {
        return this.scopes[scope];
    },

    getSelectedValues(selectId) {
        const select = document.getElementById(selectId);
        if (!select) {
            return [];
        }
        return [...select.selectedOptions].map((option) => option.value).filter(Boolean);
    },

    selectValues(selectId, values) {
        const select = document.getElementById(selectId);
        if (!select) {
            return;
        }
        const valueSet = new Set((values || []).map(String));
        [...select.options].forEach((option) => {
            option.selected = valueSet.has(option.value);
        });
    },

    formatDateInput(dateValue) {
        const year = dateValue.getFullYear();
        const month = `${dateValue.getMonth() + 1}`.padStart(2, '0');
        const day = `${dateValue.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    getToday() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    },

    getPresetRange(preset) {
        const end = this.getToday();
        const start = new Date(end);

        if (preset === 'year') {
            start.setDate(start.getDate() - 364);
        } else if (preset === 'ytd') {
            start.setMonth(0, 1);
        } else {
            start.setDate(start.getDate() - 29);
        }

        return {
            start: this.formatDateInput(start),
            end: this.formatDateInput(end)
        };
    },

    setDefaultDates() {
        ['transactions', 'usage'].forEach((scope) => {
            this.applyQuickRange(scope, 'month');
        });
    },

    applyQuickRange(scope, preset) {
        const range = this.getPresetRange(preset);
        document.getElementById(`reports-${scope}-start-date`).value = range.start;
        document.getElementById(`reports-${scope}-end-date`).value = range.end;
        this.syncQuickRangeButtons(scope);
    },

    syncQuickRangeButtons(scope) {
        const startDate = document.getElementById(`reports-${scope}-start-date`).value;
        const endDate = document.getElementById(`reports-${scope}-end-date`).value;

        document.querySelectorAll(`[data-report-scope="${scope}"][data-range]`).forEach((button) => {
            const preset = button.dataset.range;
            const range = this.getPresetRange(preset);
            button.classList.toggle('active', range.start === startDate && range.end === endDate);
        });
    },

    async loadSelectors() {
        this.workGroups = await API.inventory.getWorkGroups();
        this.populateWorkGroups('transactions');
        this.populateWorkGroups('usage');
        Utils.syncCheckboxSelect('reports-transactions-type', '全部类型');
        await this.loadInstruments('transactions');
        await this.loadInstruments('usage');
        await this.loadReagents('transactions');
        await this.loadReagents('usage');
    },

    populateWorkGroups(scope) {
        const select = document.getElementById(`reports-${scope}-work-group`);
        const currentValues = this.getSelectedValues(`reports-${scope}-work-group`);
        select.innerHTML = this.workGroups.map((group) => `<option value="${group.id}">${group.name}</option>`).join('');
        this.selectValues(`reports-${scope}-work-group`, currentValues);
        Utils.syncCheckboxSelect(`reports-${scope}-work-group`, '全部工作组');
    },

    async loadInstruments(scope) {
        const workGroupIds = this.getSelectedValues(`reports-${scope}-work-group`);
        let instruments = await API.inventory.getInstruments(null);
        if (workGroupIds.length) {
            const workGroupSet = new Set(workGroupIds.map(String));
            instruments = instruments.filter((instrument) => workGroupSet.has(String(instrument.work_group_id)));
        }
        const select = document.getElementById(`reports-${scope}-instrument`);
        const currentValues = this.getSelectedValues(`reports-${scope}-instrument`);

        select.innerHTML = instruments.map((instrument) => `<option value="${instrument.id}">${instrument.name}</option>`).join('');
        this.selectValues(`reports-${scope}-instrument`, currentValues);
        Utils.syncCheckboxSelect(`reports-${scope}-instrument`, '全部仪器');
    },

    formatReagentLabel(reagent) {
        return reagent.is_archived ? `${reagent.name} [已归档]` : reagent.name;
    },

    getReagentSearchKeyword(scope) {
        const state = this.getScopeState(scope);
        if (state.selectedReagentId && state.selectedLabel === state.reagentInput) {
            return '';
        }
        return state.reagentInput.trim().toLowerCase();
    },

    getVisibleReagentOptions(scope) {
        const state = this.getScopeState(scope);
        const keyword = this.getReagentSearchKeyword(scope);

        if (!keyword) {
            return [{ id: '', label: '全部试剂', isAll: true }, ...state.reagentOptions];
        }

        return state.reagentOptions.filter((option) => option.searchText.includes(keyword));
    },

    renderReagentDropdown(scope) {
        const state = this.getScopeState(scope);
        const container = document.getElementById(`reports-${scope}-reagent-options`);

        if (!state.dropdownOpen) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        state.visibleOptions = this.getVisibleReagentOptions(scope);
        if (!state.visibleOptions.length) {
            state.highlightedIndex = -1;
            container.innerHTML = '<div class="reports-combobox-empty">没有匹配试剂，请继续输入或重新选择范围</div>';
            container.classList.remove('hidden');
            return;
        }

        if (state.highlightedIndex < 0 || state.highlightedIndex >= state.visibleOptions.length) {
            state.highlightedIndex = 0;
        }

        container.innerHTML = state.visibleOptions.map((option, index) => `
            <button
                type="button"
                class="reports-combobox-option ${index === state.highlightedIndex ? 'active' : ''}"
                data-option-index="${index}"
            >
                ${this.escapeHtml(option.label)}
            </button>
        `).join('');
        container.classList.remove('hidden');
    },

    openReagentDropdown(scope) {
        const state = this.getScopeState(scope);
        state.dropdownOpen = true;
        this.renderReagentDropdown(scope);
    },

    closeReagentDropdown(scope) {
        const state = this.getScopeState(scope);
        state.dropdownOpen = false;
        state.highlightedIndex = -1;
        this.renderReagentDropdown(scope);
    },

    closeAllReagentDropdowns() {
        ['transactions', 'usage'].forEach((scope) => this.closeReagentDropdown(scope));
    },

    clearReagentSelection(scope) {
        const state = this.getScopeState(scope);
        state.selectedReagentId = null;
        state.selectedLabel = '';
    },

    handleReagentInput(scope, value) {
        const state = this.getScopeState(scope);
        state.reagentInput = value;
        this.clearReagentSelection(scope);
        state.dropdownOpen = true;
        state.highlightedIndex = 0;
        this.renderReagentDropdown(scope);
    },

    handleReagentKeydown(scope, event) {
        const state = this.getScopeState(scope);
        if (!state.dropdownOpen && ['ArrowDown', 'Enter'].includes(event.key)) {
            this.openReagentDropdown(scope);
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!state.visibleOptions.length) {
                return;
            }
            state.highlightedIndex = Math.min(state.highlightedIndex + 1, state.visibleOptions.length - 1);
            this.renderReagentDropdown(scope);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!state.visibleOptions.length) {
                return;
            }
            state.highlightedIndex = Math.max(state.highlightedIndex - 1, 0);
            this.renderReagentDropdown(scope);
            return;
        }

        if (event.key === 'Enter') {
            if (!state.dropdownOpen) {
                return;
            }
            event.preventDefault();
            if (state.highlightedIndex >= 0) {
                this.selectVisibleOption(scope, state.highlightedIndex);
            }
            return;
        }

        if (event.key === 'Escape') {
            this.closeReagentDropdown(scope);
        }
    },

    selectVisibleOption(scope, index) {
        const state = this.getScopeState(scope);
        const option = state.visibleOptions[index];
        if (!option) {
            return;
        }

        const input = document.getElementById(`reports-${scope}-reagent-input`);
        if (option.isAll) {
            state.reagentInput = '';
            state.selectedLabel = '';
            state.selectedReagentId = null;
            input.value = '';
        } else {
            state.selectedReagentId = option.id;
            state.selectedLabel = option.label;
            state.reagentInput = option.label;
            input.value = option.label;
        }

        this.closeReagentDropdown(scope);
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    async loadReagents(scope) {
        const workGroupIds = this.getSelectedValues(`reports-${scope}-work-group`);
        const instrumentIds = this.getSelectedValues(`reports-${scope}-instrument`);
        const reagents = await API.reports.listReagents({
            work_group_ids: workGroupIds.join(','),
            instrument_ids: instrumentIds.join(',')
        });

        const state = this.getScopeState(scope);
        state.reagentOptions = reagents.map((reagent) => ({
            id: reagent.id,
            label: this.formatReagentLabel(reagent),
            searchText: `${reagent.name} ${reagent.manufacturer || ''}`.toLowerCase()
        }));

        const input = document.getElementById(`reports-${scope}-reagent-input`);
        if (state.selectedReagentId) {
            const current = state.reagentOptions.find((option) => String(option.id) === String(state.selectedReagentId));
            if (!current) {
                this.clearReagentSelection(scope);
                state.reagentInput = '';
                input.value = '';
            } else {
                state.selectedLabel = current.label;
                state.reagentInput = current.label;
                input.value = current.label;
            }
        } else if (!state.reagentInput) {
            input.value = '';
        }

        this.renderReagentDropdown(scope);
    },

    validateDates(scope) {
        const startDate = document.getElementById(`reports-${scope}-start-date`).value;
        const endDate = document.getElementById(`reports-${scope}-end-date`).value;
        if (startDate && endDate && startDate > endDate) {
            Utils.showToast('开始日期不能晚于结束日期', 'warning');
            return false;
        }
        return true;
    },

    getTransactionParams(includeLimit = true) {
        const params = {
            work_group_ids: this.getSelectedValues('reports-transactions-work-group').join(','),
            instrument_ids: this.getSelectedValues('reports-transactions-instrument').join(','),
            reagent_id: this.getScopeState('transactions').selectedReagentId || null,
            types: this.getSelectedValues('reports-transactions-type').join(','),
            start_date: document.getElementById('reports-transactions-start-date').value || null,
            end_date: document.getElementById('reports-transactions-end-date').value || null,
        };
        if (includeLimit) {
            params.limit = document.getElementById('reports-transactions-limit').value || 20;
        }
        return params;
    },

    getUsageParams() {
        return {
            work_group_ids: this.getSelectedValues('reports-usage-work-group').join(','),
            instrument_ids: this.getSelectedValues('reports-usage-instrument').join(','),
            reagent_id: this.getScopeState('usage').selectedReagentId || null,
            start_date: document.getElementById('reports-usage-start-date').value || null,
            end_date: document.getElementById('reports-usage-end-date').value || null
        };
    },

    async loadTransactions() {
        if (!this.validateDates('transactions')) {
            return;
        }
        try {
            this.transactionRows = await API.reports.listTransactions(this.getTransactionParams());
            this.renderTransactions();
        } catch (error) {
            console.error('Failed to load transactions:', error);
            Utils.showToast('流水数据加载失败', 'error');
        }
    },

    async loadUsage() {
        if (!this.validateDates('usage')) {
            return;
        }
        try {
            this.usageRows = await API.reports.listUsage(this.getUsageParams());
            this.renderUsage();
        } catch (error) {
            console.error('Failed to load usage:', error);
            Utils.showToast('用量数据加载失败', 'error');
        }
    },

    async exportTransactions() {
        if (!this.validateDates('transactions')) {
            return;
        }
        try {
            await API.reports.exportTransactions(this.getTransactionParams(false));
        } catch (error) {
            console.error('Failed to export transactions:', error);
            Utils.showToast('导出流水失败', 'error');
        }
    },

    async exportUsage() {
        if (!this.validateDates('usage')) {
            return;
        }
        try {
            await API.reports.exportUsage(this.getUsageParams());
        } catch (error) {
            console.error('Failed to export usage:', error);
            Utils.showToast('导出用量失败', 'error');
        }
    },

    renderTransactions() {
        const body = document.getElementById('reports-transactions-body');
        const meta = document.getElementById('reports-transactions-meta');
        meta.textContent = `共 ${this.transactionRows.length} 条记录`;

        if (!this.transactionRows.length) {
            body.innerHTML = '<tr><td colspan="9" class="reports-empty-cell">当前条件下暂无流水记录</td></tr>';
            return;
        }

        const typeLabel = (value) => ({ IN: '入库', OUT: '出库', CALIBRATION: '校准' }[value] || value);
        const typeClass = (value) => ({ IN: 'success', OUT: 'info', CALIBRATION: 'warning' }[value] || 'info');
        body.innerHTML = this.transactionRows.map((item) => `
            <tr>
                <td>${Utils.formatDateTime(item.created_at)}</td>
                <td><span class="item-status ${typeClass(item.type)}">${typeLabel(item.type)}</span></td>
                <td>${item.work_group_name || '-'}</td>
                <td>${item.instrument_name || '-'}</td>
                <td>${item.reagent_name}</td>
                <td>${item.batch_no || '-'}</td>
                <td>${item.quantity_min} ${item.min_unit || ''}</td>
                <td>${item.operator}</td>
                <td>${item.source === 'scan' ? '扫码' : '手工'}</td>
            </tr>
        `).join('');
    },

    renderUsage() {
        const body = document.getElementById('reports-usage-body');
        const meta = document.getElementById('reports-usage-meta');
        meta.textContent = `共 ${this.usageRows.length} 条汇总`;

        if (!this.usageRows.length) {
            body.innerHTML = '<tr><td colspan="8" class="reports-empty-cell">当前条件下暂无用量数据</td></tr>';
            return;
        }

        body.innerHTML = this.usageRows.map((item) => `
            <tr>
                <td>${item.work_group_name || '-'}</td>
                <td>${item.instrument_name || '-'}</td>
                <td>${item.reagent_name}</td>
                <td>${item.manufacturer || '-'}</td>
                <td>${item.start_date}</td>
                <td>${item.end_date}</td>
                <td>${item.total_usage_min}</td>
                <td>${item.min_unit || ''}</td>
            </tr>
        `).join('');
    }
};
