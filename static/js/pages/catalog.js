const catalogPage = {
    initialized: false,
    activeModule: 'structure',
    catalog: [],
    reagents: [],
    reagentGroups: [],
    operators: [],
    unitOptions: [],
    structureEditor: {
        type: 'workGroup',
        id: null,
        mode: 'create'
    },
    selectedReagentId: null,
    selectedReagentGroupId: null,
    selectedOperatorId: null,
    selectedUnitOptionId: null,
    qrInstrumentId: null,
    mobilePreferredOrigin: 'http://192.168.31.32:8000',
    reagentFilters: {
        workGroupId: '',
        instrumentId: '',
        keyword: '',
        status: 'active'
    },
    maintenanceFilters: {
        workGroupId: '',
        instrumentId: '',
        reagentId: '',
        startDate: '',
        endDate: ''
    },
    maintenanceReagents: [],
    stockAdjustmentState: {
        unlocked: false,
        password: '',
        inventory: [],
        selectedWorkGroupId: null,
        selectedInstrumentId: null,
        drafts: {}
    },
    unitFilterScope: 'all',
    moduleCopy: {
        structure: {
            title: '工作组与仪器',
            copy: '维护工作组和仪器结构，预警默认值仍留在库存页现场调整。'
        },
        reagents: {
            title: '试剂档案',
            copy: '这里是试剂主档案入口，可统一修改归属、包装关系、预警值和归档状态。'
        },
        groups: {
            title: '项目分组',
            copy: '维护手机仪器模式下的默认试剂分组和排序。'
        },
        operators: {
            title: '操作人',
            copy: '入库、出库等业务页面使用这里的启用名单。'
        },
        units: {
            title: '常用单位与选项',
            copy: '包装单位和最小单位都从这里维护，所有页面统一读取。'
        },
        system: {
            title: '系统维护',
            copy: '危险操作集中放在这里，避免和日常资料维护混在一起。'
        }
    },

    async init() {
        if (!this.initialized) {
            this.bindModuleNav();
            this.initialized = true;
        }

        await this.reloadBaseData();
        if (this.activeModule === 'reagents') {
            await this.loadReagents();
        }
        this.ensureSelections();
        this.render();
    },

    bindModuleNav() {
        document.querySelectorAll('#catalog-module-nav .settings-nav-item').forEach((button) => {
            button.addEventListener('click', async () => {
                const module = button.dataset.module || 'structure';
                if (module === this.activeModule) {
                    return;
                }
                this.activeModule = module;
                if (module === 'reagents') {
                    await this.loadReagents();
                }
                if (module === 'system') {
                    await this.loadMaintenanceReagents();
                }
                this.ensureSelections();
                this.render();
            });
        });
    },

    async reloadBaseData() {
        await Promise.all([
            this.loadCatalog(),
            this.loadReagentGroups(),
            this.loadOperators(),
            this.loadUnitOptions()
        ]);
    },

    async loadCatalog() {
        this.catalog = await API.inventory.getWorkGroupCatalog();
    },

    async loadOperators() {
        this.operators = await API.operators.list();
    },

    async loadReagentGroups() {
        this.reagentGroups = await API.reagentGroups.list({ include_inactive: true });
    },

    async loadUnitOptions() {
        this.unitOptions = await API.unitOptions.list({ include_inactive: true });
        await Utils.loadUnitOptions(true);
    },

    async loadReagents() {
        const params = {
            work_group_id: this.reagentFilters.workGroupId || null,
            instrument_id: this.reagentFilters.instrumentId || null,
            keyword: this.reagentFilters.keyword || null,
            status: this.reagentFilters.status || 'active'
        };
        this.reagents = await API.reagents.list(params);
    },

    async loadMaintenanceReagents() {
        const params = {
            status: 'all',
            work_group_id: this.maintenanceFilters.workGroupId || null,
            instrument_id: this.maintenanceFilters.instrumentId || null
        };
        this.maintenanceReagents = await API.reagents.list(params);
    },

    ensureSelections() {
        this.ensureStructureSelection();
        this.ensureReagentSelection();
        this.ensureReagentGroupSelection();
        this.ensureOperatorSelection();
        this.ensureUnitSelection();
    },

    ensureStructureSelection() {
        if (this.structureEditor.id) {
            if (this.structureEditor.type === 'workGroup' && this.getWorkGroupById(this.structureEditor.id)) {
                return;
            }
            if (this.structureEditor.type === 'instrument' && this.getInstrumentById(this.structureEditor.id)) {
                return;
            }
        }
        const firstGroup = this.catalog[0] || null;
        if (firstGroup) {
            this.structureEditor = {
                type: 'workGroup',
                id: firstGroup.id,
                mode: 'edit'
            };
            return;
        }
        this.structureEditor = {
            type: 'workGroup',
            id: null,
            mode: 'create'
        };
    },

    ensureReagentSelection() {
        if (this.selectedReagentId && this.reagents.some((item) => item.id === this.selectedReagentId)) {
            return;
        }
        this.selectedReagentId = this.reagents[0]?.id || null;
    },

    ensureReagentGroupSelection() {
        if (this.selectedReagentGroupId && this.reagentGroups.some((item) => item.id === this.selectedReagentGroupId)) {
            return;
        }
        this.selectedReagentGroupId = this.reagentGroups[0]?.id || null;
    },

    ensureOperatorSelection() {
        if (this.selectedOperatorId && this.operators.some((item) => item.id === this.selectedOperatorId)) {
            return;
        }
        this.selectedOperatorId = this.operators[0]?.id || null;
    },

    ensureUnitSelection() {
        const filtered = this.getFilteredUnitOptions();
        if (this.selectedUnitOptionId && filtered.some((item) => item.id === this.selectedUnitOptionId)) {
            return;
        }
        this.selectedUnitOptionId = filtered[0]?.id || null;
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    normalizeText(value) {
        return String(value ?? '').trim();
    },

    parseNonNegative(value, fallback = 0) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    },

    promptAdminPassword(actionLabel) {
        const password = window.prompt(`执行“${actionLabel}”需要输入密码：`);
        if (password === null) {
            return null;
        }
        const normalized = this.normalizeText(password);
        if (!normalized) {
            Utils.showToast('未输入密码，操作已取消', 'warning');
            return null;
        }
        return normalized;
    },

    formatRelation(packageUnit, qty, minUnit) {
        const packageLabel = this.normalizeText(packageUnit) || Utils.getDefaultUnit('package', '盒');
        const minLabel = this.normalizeText(minUnit) || Utils.getDefaultUnit('min', '瓶');
        const ratio = Math.max(parseInt(qty, 10) || 1, 1);
        return `1${packageLabel} = ${ratio}${minLabel}`;
    },

    getMobileTargetOrigin() {
        const currentOrigin = window.location.origin;
        return ['http://127.0.0.1:8000', 'http://localhost:8000'].includes(currentOrigin)
            ? this.mobilePreferredOrigin
            : currentOrigin;
    },

    getMobileAppVersion() {
        return '20260413-7';
    },

    buildMobileUrl(params = {}) {
        const search = new URLSearchParams({
            ...params,
            appv: this.getMobileAppVersion(),
        });
        return `${this.getMobileTargetOrigin()}/mobile.html?${search.toString()}`;
    },

    getInstrumentMobileUrl(instrumentId) {
        const normalizedId = Number(instrumentId);
        if (!normalizedId) {
            return this.buildMobileUrl();
        }
        return this.buildMobileUrl({ instrument_id: normalizedId });
    },

    getWorkGroupById(id) {
        return this.catalog.find((group) => group.id === Number(id)) || null;
    },

    getInstrumentById(id) {
        for (const group of this.catalog) {
            const instrument = (group.instruments || []).find((item) => item.id === Number(id));
            if (instrument) {
                return { instrument, group };
            }
        }
        return null;
    },

    getInstrumentPackagingDefaults(instrumentId) {
        const bundle = this.getInstrumentById(instrumentId);
        const instrument = bundle?.instrument;
        const label = `${instrument?.name || ''} ${instrument?.model || ''}`;
        if (/DXI800/i.test(label)) {
            return {
                packageUnit: '盒',
                minUnit: '瓶',
                ratio: 2,
            };
        }
        return null;
    },

    ensureStockAdjustmentSelection() {
        const state = this.stockAdjustmentState;
        const groups = state.inventory || [];
        if (!groups.length) {
            state.selectedWorkGroupId = null;
            state.selectedInstrumentId = null;
            return;
        }

        const currentGroup = groups.find((group) => group.id === Number(state.selectedWorkGroupId)) || groups[0];
        state.selectedWorkGroupId = currentGroup.id;

        const instruments = currentGroup.instruments || [];
        if (!instruments.length) {
            state.selectedInstrumentId = null;
            return;
        }

        const currentInstrument = instruments.find((item) => item.id === Number(state.selectedInstrumentId)) || instruments[0];
        state.selectedInstrumentId = currentInstrument.id;
    },

    getStockAdjustmentSelectedGroup() {
        return (this.stockAdjustmentState.inventory || []).find(
            (group) => group.id === Number(this.stockAdjustmentState.selectedWorkGroupId)
        ) || null;
    },

    getStockAdjustmentSelectedInstrument() {
        const group = this.getStockAdjustmentSelectedGroup();
        return (group?.instruments || []).find(
            (instrument) => instrument.id === Number(this.stockAdjustmentState.selectedInstrumentId)
        ) || null;
    },

    getStockAdjustmentDraftValue(batch) {
        const stored = this.stockAdjustmentState.drafts[String(batch.id)];
        if (stored === undefined || stored === null || stored === '') {
            return String(batch.available_min_quantity ?? 0);
        }
        return String(stored);
    },

    getStockAdjustmentGroupLabel(reagent) {
        return this.normalizeText(reagent?.reagent_group_name) || '未分组';
    },

    getStockAdjustmentGroupedReagents(instrument) {
        const reagents = [...(instrument?.reagents || [])];
        reagents.sort((left, right) => {
            return (left.reagent_group_sort_order ?? 9999) - (right.reagent_group_sort_order ?? 9999)
                || this.getStockAdjustmentGroupLabel(left).localeCompare(this.getStockAdjustmentGroupLabel(right), 'zh-CN')
                || (left.name || '').localeCompare(right.name || '', 'zh-CN');
        });

        const groups = [];
        for (const reagent of reagents) {
            const groupLabel = this.getStockAdjustmentGroupLabel(reagent);
            const existing = groups.find((item) => item.label === groupLabel);
            if (existing) {
                existing.reagents.push(reagent);
            } else {
                groups.push({ label: groupLabel, reagents: [reagent] });
            }
        }
        return groups;
    },

    getChangedStockAdjustmentItems() {
        const selectedInstrument = this.getStockAdjustmentSelectedInstrument();
        const changedItems = [];
        for (const reagent of (selectedInstrument?.reagents || [])) {
            for (const batch of (reagent.batches || [])) {
                const rawValue = this.stockAdjustmentState.drafts[String(batch.id)];
                if (rawValue === undefined || rawValue === null || rawValue === '') {
                    continue;
                }
                const targetMinQuantity = this.parseNonNegative(rawValue, batch.available_min_quantity ?? 0);
                if (targetMinQuantity === Number(batch.available_min_quantity ?? 0)) {
                    continue;
                }
                changedItems.push({
                    batch_stock_id: batch.id,
                    target_min_quantity: targetMinQuantity
                });
            }
        }
        return changedItems;
    },

    getSelectedReagent() {
        return this.reagents.find((item) => item.id === this.selectedReagentId) || null;
    },

    getSelectedReagentGroup() {
        return this.reagentGroups.find((item) => item.id === this.selectedReagentGroupId) || null;
    },

    getSelectedOperator() {
        return this.operators.find((item) => item.id === this.selectedOperatorId) || null;
    },

    getSelectedUnitOption() {
        return this.unitOptions.find((item) => item.id === this.selectedUnitOptionId) || null;
    },

    getFilteredUnitOptions() {
        const scope = this.unitFilterScope || 'all';
        return [...this.unitOptions]
            .filter((item) => {
                if (scope === 'all') return true;
                if (scope === 'package') return item.scope === 'package' || item.scope === 'both';
                if (scope === 'min') return item.scope === 'min' || item.scope === 'both';
                return true;
            })
            .sort((left, right) => {
                return (
                    (left.sort_order ?? 100) - (right.sort_order ?? 100)
                    || left.name.localeCompare(right.name, 'zh-CN')
                );
            });
    },

    getUnitSelectOptions(scope, selectedValue = '') {
        const normalizedSelected = this.normalizeText(selectedValue);
        const options = Utils.getUnitOptions(scope);
        const optionNames = new Set(options.map((item) => item.name));
        const values = [];
        if (normalizedSelected && !optionNames.has(normalizedSelected)) {
            values.push({ name: normalizedSelected, suffix: '当前值' });
        }
        options.forEach((item) => values.push({ name: item.name, suffix: '' }));

        return values.map((item) => `
            <option value="${this.escapeHtml(item.name)}" ${item.name === normalizedSelected ? 'selected' : ''}>
                ${this.escapeHtml(item.name)}${item.suffix ? `（${item.suffix}）` : ''}
            </option>
        `).join('');
    },

    getWorkGroupOptions(selectedValue = '') {
        return ['<option value="">请选择工作组</option>'].concat(
            this.catalog.map((group) => (
                `<option value="${group.id}" ${String(group.id) === String(selectedValue) ? 'selected' : ''}>${this.escapeHtml(group.name)}</option>`
            ))
        ).join('');
    },

    getInstrumentOptions(workGroupId = '', selectedValue = '') {
        const instruments = workGroupId
            ? (this.getWorkGroupById(workGroupId)?.instruments || [])
            : this.catalog.flatMap((group) => group.instruments || []);

        return ['<option value="">请选择仪器</option>'].concat(
            instruments.map((instrument) => (
                `<option value="${instrument.id}" ${String(instrument.id) === String(selectedValue) ? 'selected' : ''}>${this.escapeHtml(instrument.name)}</option>`
            ))
        ).join('');
    },

    getReagentGroupOptions(selectedValue = '', { includeInactive = true } = {}) {
        const normalizedValue = selectedValue === null || selectedValue === undefined ? '' : String(selectedValue);
        const groups = this.reagentGroups
            .filter((group) => includeInactive || group.is_active)
            .sort((left, right) => {
                return (left.sort_order ?? 100) - (right.sort_order ?? 100)
                    || left.name.localeCompare(right.name, 'zh-CN');
            });

        return ['<option value="">未分组</option>'].concat(
            groups.map((group) => (
                `<option value="${group.id}" ${String(group.id) === normalizedValue ? 'selected' : ''}>${this.escapeHtml(group.name)}</option>`
            ))
        ).join('');
    },

    getScopeLabel(scope) {
        if (scope === 'package') return '包装单位';
        if (scope === 'min') return '最小单位';
        return '包装/最小都可用';
    },

    getReagentStatusLabel(item) {
        return item.is_archived ? '已归档' : '启用中';
    },

    setModuleHeader() {
        const current = this.moduleCopy[this.activeModule];
        document.getElementById('catalog-module-title').textContent = current.title;
        document.getElementById('catalog-module-copy').textContent = current.copy;
        document.querySelectorAll('#catalog-module-nav .settings-nav-item').forEach((button) => {
            button.classList.toggle('active', button.dataset.module === this.activeModule);
        });
    },

    render() {
        this.setModuleHeader();
        const body = document.getElementById('catalog-module-body');
        if (this.activeModule === 'structure') {
            body.innerHTML = this.renderStructureModule();
            return;
        }
        if (this.activeModule === 'reagents') {
            body.innerHTML = this.renderReagentModule();
            this.refreshReagentRelationPreview();
            return;
        }
        if (this.activeModule === 'groups') {
            body.innerHTML = this.renderReagentGroupModule();
            return;
        }
        if (this.activeModule === 'operators') {
            body.innerHTML = this.renderOperatorModule();
            return;
        }
        if (this.activeModule === 'units') {
            body.innerHTML = this.renderUnitModule();
            return;
        }
        body.innerHTML = this.renderSystemModule();
    },

    renderStructureModule() {
        const selectedGroup = this.structureEditor.type === 'workGroup'
            ? this.getWorkGroupById(this.structureEditor.id)
            : this.getInstrumentById(this.structureEditor.id)?.group || this.getWorkGroupById(this.structureEditor.parentWorkGroupId);
        const selectedInstrumentBundle = this.structureEditor.type === 'instrument'
            ? this.getInstrumentById(this.structureEditor.id)
            : null;
        const selectedInstrument = selectedInstrumentBundle?.instrument || null;
        const defaultGroupId = selectedInstrument?.work_group_id || selectedGroup?.id || '';
        const qrTarget = selectedInstrument ? this.getInstrumentMobileUrl(selectedInstrument.id) : this.buildMobileUrl();

        const editorHtml = this.structureEditor.type === 'instrument'
            ? `
                <div class="settings-editor-header">
                    <h4>${selectedInstrument ? '编辑仪器' : '新建仪器'}</h4>
                    <p class="hint">这里同时维护仪器结构和当前仪器的批量预警设置，保存仪器信息不会自动覆盖已有试剂。</p>
                </div>
                <div class="form-group">
                    <label for="catalog-structure-instrument-work-group">所属工作组</label>
                    <select id="catalog-structure-instrument-work-group" class="form-select">
                        ${this.getWorkGroupOptions(defaultGroupId)}
                    </select>
                </div>
                <div class="form-group">
                    <label for="catalog-structure-instrument-name">仪器名称</label>
                    <input type="text" id="catalog-structure-instrument-name" class="form-input" placeholder="例如：DXI800" value="${this.escapeHtml(selectedInstrument?.name || '')}">
                </div>
                <div class="form-group">
                    <label for="catalog-structure-instrument-model">型号</label>
                    <input type="text" id="catalog-structure-instrument-model" class="form-input" placeholder="可选" value="${this.escapeHtml(selectedInstrument?.model || '')}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="catalog-structure-instrument-warning-days">失效预警天数</label>
                        <input type="number" id="catalog-structure-instrument-warning-days" class="form-input" min="0" value="${selectedInstrument?.default_warning_days ?? 30}">
                    </div>
                    <div class="form-group">
                        <label for="catalog-structure-instrument-warning-stock">库存预警最小单位数</label>
                        <input type="number" id="catalog-structure-instrument-warning-stock" class="form-input" min="0" value="${selectedInstrument?.default_warning_stock ?? 5}">
                    </div>
                </div>
                <div class="button-group">
                    <button class="btn btn-primary" onclick="catalogPage.submitInstrument()">保存仪器</button>
                    ${selectedInstrument ? '<button class="btn btn-secondary" onclick="catalogPage.batchUpdateStructureInstrumentWarnings()">批量设置当前仪器预警</button>' : ''}
                    ${selectedInstrument ? '<button class="btn btn-secondary" onclick="catalogPage.openInstrumentQrModal()">手机二维码</button>' : ''}
                    <button class="btn btn-secondary" onclick="catalogPage.startCreateInstrument(${defaultGroupId || 'null'})">新建仪器</button>
                    <button class="btn btn-secondary" onclick="catalogPage.selectWorkGroup(${defaultGroupId || 'null'})">返回工作组</button>
                </div>
            `
            : `
                <div class="settings-editor-header">
                    <h4>${selectedGroup ? '编辑工作组' : '新建工作组'}</h4>
                    <p class="hint">工作组用于组织仪器和试剂档案，是资料设置页的第一层结构。</p>
                </div>
                <div class="form-group">
                    <label for="catalog-structure-work-group-name">工作组名称</label>
                    <input type="text" id="catalog-structure-work-group-name" class="form-input" placeholder="例如：免疫组" value="${this.escapeHtml(selectedGroup?.name || '')}">
                </div>
                <div class="button-group">
                    <button class="btn btn-primary" onclick="catalogPage.submitWorkGroup()">保存工作组</button>
                    <button class="btn btn-secondary" onclick="catalogPage.startCreateWorkGroup()">新建工作组</button>
                    <button class="btn btn-secondary" onclick="catalogPage.startCreateInstrument(${selectedGroup?.id || 'null'})">在此组下新建仪器</button>
                </div>
            `;

        return `
            <div class="settings-module-grid">
                <div class="settings-panel">
                    <div class="settings-panel-head">
                        <h4>结构树</h4>
                        <div class="button-group">
                            <button class="btn btn-secondary btn-small" onclick="catalogPage.startCreateWorkGroup()">新建工作组</button>
                            <button class="btn btn-secondary btn-small" onclick="catalogPage.startCreateInstrument(${selectedGroup?.id || 'null'})">新建仪器</button>
                        </div>
                    </div>
                    <div class="settings-tree">
                        ${this.catalog.length ? this.catalog.map((group) => `
                            <div class="settings-tree-group">
                                <button class="settings-tree-item ${this.structureEditor.type === 'workGroup' && group.id === this.structureEditor.id ? 'active' : ''}" onclick="catalogPage.selectWorkGroup(${group.id})">
                                    <span class="settings-item-head">
                                        <span class="settings-list-title">${this.escapeHtml(group.name)}</span>
                                        <span class="settings-item-badge">${(group.instruments || []).length} 台仪器</span>
                                    </span>
                                </button>
                                <div class="settings-tree-children">
                                    ${(group.instruments || []).length ? group.instruments.map((instrument) => `
                                        <button class="settings-tree-item child ${this.structureEditor.type === 'instrument' && instrument.id === this.structureEditor.id ? 'active' : ''}" onclick="catalogPage.selectInstrument(${instrument.id})">
                                            <span class="settings-item-head">
                                                <span class="settings-list-title">${this.escapeHtml(instrument.name)}</span>
                                                <span class="settings-tree-meta">${this.escapeHtml(instrument.model || '未填写型号')}</span>
                                            </span>
                                        </button>
                                    `).join('') : '<p class="catalog-empty">该工作组下还没有仪器</p>'}
                                </div>
                            </div>
                        `).join('') : '<p class="catalog-empty">还没有工作组，请先新建。</p>'}
                    </div>
                </div>
                <div class="settings-panel">
                    ${editorHtml}
                </div>
            </div>
            ${selectedInstrument ? `
                <div class="settings-modal-backdrop ${this.qrInstrumentId === selectedInstrument.id ? '' : 'hidden'}" onclick="catalogPage.closeInstrumentQrModal()">
                    <div class="settings-modal-card" onclick="event.stopPropagation()">
                        <div class="settings-editor-header">
                            <h4>${this.escapeHtml(selectedInstrument.name)} 手机二维码</h4>
                            <p class="hint">扫码后会直接进入该仪器的手机工作台，默认只展示本仪器信息。</p>
                        </div>
                        <div class="settings-qr-block">
                            <img class="settings-qr-image" src="/api/mobile/qr?target=${encodeURIComponent(qrTarget)}" alt="${this.escapeHtml(selectedInstrument.name)} 手机二维码">
                            <div class="settings-inline-note">链接：${this.escapeHtml(qrTarget)}</div>
                        </div>
                        <div class="button-group">
                            <button class="btn btn-primary" onclick="catalogPage.copyInstrumentQrLink()">复制链接</button>
                            <button class="btn btn-secondary" onclick="catalogPage.closeInstrumentQrModal()">关闭</button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    },

    renderReagentModule() {
        const selected = this.getSelectedReagent();
        const workGroupId = selected?.work_group_id || '';
        const instrumentId = selected?.instrument_id || '';
        const packageOptions = Utils.getUnitOptions('package');
        const minOptions = Utils.getUnitOptions('min');
        const packageValue = selected?.package_unit || packageOptions[0]?.name || '盒';
        const minValue = selected?.unit || minOptions[0]?.name || '瓶';

        return `
            <div class="form-section">
                <div class="form-row">
                    <div class="form-group">
                        <label for="catalog-reagent-filter-work-group">工作组</label>
                        <select id="catalog-reagent-filter-work-group" class="form-select" onchange="catalogPage.handleReagentFilterGroupChange()">
                            <option value="">全部工作组</option>
                            ${this.catalog.map((group) => `
                                <option value="${group.id}" ${String(group.id) === String(this.reagentFilters.workGroupId) ? 'selected' : ''}>${this.escapeHtml(group.name)}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="catalog-reagent-filter-instrument">仪器</label>
                        <select id="catalog-reagent-filter-instrument" class="form-select">
                            <option value="">全部仪器</option>
                            ${this.getReagentFilterInstruments().map((instrument) => `
                                <option value="${instrument.id}" ${String(instrument.id) === String(this.reagentFilters.instrumentId) ? 'selected' : ''}>${this.escapeHtml(instrument.name)}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="catalog-reagent-filter-keyword">关键词</label>
                        <input type="text" id="catalog-reagent-filter-keyword" class="form-input" placeholder="输入试剂名称关键词" value="${this.escapeHtml(this.reagentFilters.keyword)}">
                    </div>
                    <div class="form-group">
                        <label for="catalog-reagent-filter-status">状态</label>
                        <select id="catalog-reagent-filter-status" class="form-select">
                            <option value="active" ${this.reagentFilters.status === 'active' ? 'selected' : ''}>启用中</option>
                            <option value="archived" ${this.reagentFilters.status === 'archived' ? 'selected' : ''}>已归档</option>
                            <option value="all" ${this.reagentFilters.status === 'all' ? 'selected' : ''}>全部</option>
                        </select>
                    </div>
                </div>
                <div class="button-group">
                    <button class="btn btn-primary" onclick="catalogPage.applyReagentFilters()">查询试剂档案</button>
                    <button class="btn btn-secondary" onclick="catalogPage.resetReagentFilters()">重置筛选</button>
                </div>
            </div>
            <div class="settings-module-grid">
                <div class="settings-panel">
                    <div class="settings-panel-head">
                        <h4>试剂档案列表</h4>
                        <span class="catalog-item-meta">${this.reagents.length} 条结果</span>
                    </div>
                    <div class="settings-list">
                        ${this.reagents.length ? this.reagents.map((item) => `
                            <button class="settings-list-item ${item.id === this.selectedReagentId ? 'active' : ''}" onclick="catalogPage.selectReagent(${item.id})">
                                <span class="settings-item-head">
                                    <span class="settings-list-title">${this.escapeHtml(item.name)}</span>
                                    <span class="settings-item-badge">${this.getReagentStatusLabel(item)}</span>
                                </span>
                                <span class="settings-list-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)} · ${this.escapeHtml(item.reagent_group_name || '未分组')} · ${this.escapeHtml(this.formatRelation(item.package_unit, item.package_to_min_qty, item.unit))}</span>
                            </button>
                        `).join('') : '<p class="catalog-empty">当前筛选下没有试剂档案。</p>'}
                    </div>
                </div>
                <div class="settings-panel">
                    ${selected ? `
                        <div class="settings-editor-header">
                            <h4>编辑试剂档案</h4>
                            <p class="hint">库存页里的“设置试剂信息”只是快捷入口，改的是同一份试剂主档案。</p>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="catalog-reagent-work-group">工作组</label>
                                <select id="catalog-reagent-work-group" class="form-select" onchange="catalogPage.handleReagentWorkGroupChange()">
                                    ${this.getWorkGroupOptions(workGroupId)}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="catalog-reagent-instrument">仪器</label>
                                <select id="catalog-reagent-instrument" class="form-select" onchange="catalogPage.handleReagentInstrumentChange()">
                                    ${this.getInstrumentOptions(workGroupId, instrumentId)}
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="catalog-reagent-name">试剂名称</label>
                                <input type="text" id="catalog-reagent-name" class="form-input" value="${this.escapeHtml(selected.name)}">
                            </div>
                            <div class="form-group">
                                <label for="catalog-reagent-manufacturer">厂家</label>
                                <input type="text" id="catalog-reagent-manufacturer" class="form-input" value="${this.escapeHtml(selected.manufacturer || '')}" placeholder="可选">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="catalog-reagent-group">项目分组</label>
                                <select id="catalog-reagent-group" class="form-select">
                                    ${this.getReagentGroupOptions(selected.reagent_group_id)}
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="catalog-reagent-package-unit">包装单位</label>
                                <select id="catalog-reagent-package-unit" class="form-select" onchange="catalogPage.refreshReagentRelationPreview()">
                                    ${this.getUnitSelectOptions('package', packageValue)}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="catalog-reagent-min-unit">最小单位</label>
                                <select id="catalog-reagent-min-unit" class="form-select" onchange="catalogPage.refreshReagentRelationPreview()">
                                    ${this.getUnitSelectOptions('min', minValue)}
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="catalog-reagent-package-to-min-qty">包装关系</label>
                                <input type="number" id="catalog-reagent-package-to-min-qty" class="form-input" min="1" value="${selected.package_to_min_qty}" oninput="catalogPage.refreshReagentRelationPreview()">
                                <div id="catalog-reagent-package-relation-preview" class="field-hint"></div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="catalog-reagent-warning-days">失效预警天数</label>
                                <input type="number" id="catalog-reagent-warning-days" class="form-input" min="0" value="${selected.warning_days}">
                            </div>
                            <div class="form-group">
                                <label for="catalog-reagent-warning-stock">库存预警最小单位数</label>
                                <input type="number" id="catalog-reagent-warning-stock" class="form-input" min="0" value="${selected.warning_stock}">
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="checkbox-row">
                                <input type="checkbox" id="catalog-reagent-is-calibrator" ${selected.is_calibrator ? 'checked' : ''}>
                                <span>是否校准品</span>
                            </label>
                            <div class="form-group">
                                <label for="catalog-reagent-calibration-result-unit">校准结果默认单位</label>
                                <input type="text" id="catalog-reagent-calibration-result-unit" class="form-input" value="${this.escapeHtml(selected.calibration_result_unit || 'nmmol/L')}" placeholder="例如 nmmol/L">
                            </div>
                        </div>
                        <div class="settings-inline-note">${selected.is_archived ? '当前试剂已归档，不会出现在库存页。' : '当前试剂处于启用中。'}</div>
                        <div class="button-group">
                            <button class="btn btn-primary" onclick="catalogPage.submitReagent()">保存试剂档案</button>
                            ${selected.is_archived
                                ? '<button class="btn btn-secondary" onclick="catalogPage.restoreSelectedReagent()">恢复归档</button>'
                                : ''}
                        </div>
                    ` : `
                        <div class="settings-empty-state">
                            <h4>还没有选中试剂</h4>
                            <p class="hint">先从左侧列表选择一个试剂档案，再在这里维护详细资料。</p>
                        </div>
                    `}
                </div>
            </div>
        `;
    },

    renderReagentGroupModule() {
        const selected = this.getSelectedReagentGroup();
        const sortedGroups = [...this.reagentGroups].sort((left, right) => {
            return (left.sort_order ?? 100) - (right.sort_order ?? 100)
                || left.name.localeCompare(right.name, 'zh-CN');
        });

        return `
            <div class="settings-module-grid">
                <div class="settings-panel">
                    <div class="settings-panel-head">
                        <h4>项目分组列表</h4>
                        <button class="btn btn-secondary btn-small" onclick="catalogPage.startCreateReagentGroup()">新建分组</button>
                    </div>
                    <div class="settings-list">
                        ${sortedGroups.length ? sortedGroups.map((item) => `
                            <button class="settings-list-item ${item.id === this.selectedReagentGroupId ? 'active' : ''}" onclick="catalogPage.selectReagentGroup(${item.id})">
                                <span class="settings-item-head">
                                    <span class="settings-list-title">${this.escapeHtml(item.name)}</span>
                                    <span class="settings-item-badge">${item.is_active ? '启用中' : '已停用'}</span>
                                </span>
                                <span class="settings-list-meta">排序 ${item.sort_order ?? 100}</span>
                            </button>
                        `).join('') : '<p class="catalog-empty">还没有项目分组。</p>'}
                    </div>
                </div>
                <div class="settings-panel">
                    <div class="settings-editor-header">
                        <h4>${selected ? '编辑项目分组' : '新建项目分组'}</h4>
                        <p class="hint">手机端仪器模式下的默认试剂按钮会按这里的分组和排序显示。</p>
                    </div>
                    <div class="form-group">
                        <label for="catalog-reagent-group-name">分组名称</label>
                        <input type="text" id="catalog-reagent-group-name" class="form-input" placeholder="例如：甲功" value="${this.escapeHtml(selected?.name || '')}">
                    </div>
                    <div class="form-group">
                        <label for="catalog-reagent-group-sort-order">排序</label>
                        <input type="number" id="catalog-reagent-group-sort-order" class="form-input" min="0" value="${selected?.sort_order ?? 100}">
                    </div>
                    <label class="checkbox-row">
                        <input type="checkbox" id="catalog-reagent-group-active" ${selected ? (selected.is_active ? 'checked' : '') : 'checked'}>
                        <span>启用状态</span>
                    </label>
                    <div class="button-group">
                        <button class="btn btn-primary" onclick="catalogPage.submitReagentGroup()">保存项目分组</button>
                        <button class="btn btn-secondary" onclick="catalogPage.startCreateReagentGroup()">新建项目分组</button>
                    </div>
                </div>
            </div>
        `;
    },

    renderOperatorModule() {
        const selected = this.getSelectedOperator();
        return `
            <div class="settings-module-grid">
                <div class="settings-panel">
                    <div class="settings-panel-head">
                        <h4>操作人列表</h4>
                        <button class="btn btn-secondary btn-small" onclick="catalogPage.startCreateOperator()">新建操作人</button>
                    </div>
                    <div class="settings-list">
                        ${this.operators.length ? this.operators.map((item) => `
                            <button class="settings-list-item ${item.id === this.selectedOperatorId ? 'active' : ''}" onclick="catalogPage.selectOperator(${item.id})">
                                <span class="settings-item-head">
                                    <span class="settings-list-title">${this.escapeHtml(item.name)}</span>
                                    <span class="settings-item-badge">${item.is_active ? '启用中' : '已停用'}</span>
                                </span>
                            </button>
                        `).join('') : '<p class="catalog-empty">还没有操作人。</p>'}
                    </div>
                </div>
                <div class="settings-panel">
                    <div class="settings-editor-header">
                        <h4>${selected ? '编辑操作人' : '新建操作人'}</h4>
                    </div>
                    <div class="form-group">
                        <label for="catalog-operator-name">姓名</label>
                        <input type="text" id="catalog-operator-name" class="form-input" placeholder="输入操作人姓名" value="${this.escapeHtml(selected?.name || '')}">
                    </div>
                    <label class="checkbox-row">
                        <input type="checkbox" id="catalog-operator-active" ${selected ? (selected.is_active ? 'checked' : '') : 'checked'}>
                        <span>启用状态</span>
                    </label>
                    <div class="button-group">
                        <button class="btn btn-primary" onclick="catalogPage.submitOperator()">保存操作人</button>
                        <button class="btn btn-secondary" onclick="catalogPage.startCreateOperator()">新建操作人</button>
                        ${selected ? '<button class="btn btn-danger" onclick="catalogPage.deleteOperator()">删除操作人</button>' : ''}
                    </div>
                </div>
            </div>
        `;
    },

    renderUnitModule() {
        const selected = this.getSelectedUnitOption();
        return `
            <div class="form-section">
                <div class="form-row">
                    <div class="form-group">
                        <label for="catalog-unit-filter-scope">查看范围</label>
                        <select id="catalog-unit-filter-scope" class="form-select" onchange="catalogPage.changeUnitFilterScope(this.value)">
                            <option value="all" ${this.unitFilterScope === 'all' ? 'selected' : ''}>全部</option>
                            <option value="package" ${this.unitFilterScope === 'package' ? 'selected' : ''}>包装单位</option>
                            <option value="min" ${this.unitFilterScope === 'min' ? 'selected' : ''}>最小单位</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="settings-module-grid">
                <div class="settings-panel">
                    <div class="settings-panel-head">
                        <h4>单位选项</h4>
                        <button class="btn btn-secondary btn-small" onclick="catalogPage.startCreateUnitOption()">新建单位</button>
                    </div>
                    <div class="settings-list">
                        ${this.getFilteredUnitOptions().length ? this.getFilteredUnitOptions().map((item) => `
                            <button class="settings-list-item ${item.id === this.selectedUnitOptionId ? 'active' : ''}" onclick="catalogPage.selectUnitOption(${item.id})">
                                <span class="settings-item-head">
                                    <span class="settings-list-title">${this.escapeHtml(item.name)}</span>
                                    <span class="settings-item-badge">${this.getScopeLabel(item.scope)}</span>
                                </span>
                                <span class="settings-list-meta">${item.is_active ? '启用中' : '已停用'} · 排序 ${item.sort_order}</span>
                            </button>
                        `).join('') : '<p class="catalog-empty">当前范围下还没有单位选项。</p>'}
                    </div>
                </div>
                <div class="settings-panel">
                    <div class="settings-editor-header">
                        <h4>${selected ? '编辑单位选项' : '新建单位选项'}</h4>
                    </div>
                    <div class="form-group">
                        <label for="catalog-unit-name">名称</label>
                        <input type="text" id="catalog-unit-name" class="form-input" placeholder="例如：盒、瓶、人份" value="${this.escapeHtml(selected?.name || '')}">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="catalog-unit-scope">适用类型</label>
                            <select id="catalog-unit-scope" class="form-select">
                                <option value="both" ${selected?.scope === 'both' || !selected ? 'selected' : ''}>包装/最小都可用</option>
                                <option value="package" ${selected?.scope === 'package' ? 'selected' : ''}>仅包装单位</option>
                                <option value="min" ${selected?.scope === 'min' ? 'selected' : ''}>仅最小单位</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="catalog-unit-sort-order">排序</label>
                            <input type="number" id="catalog-unit-sort-order" class="form-input" min="0" value="${selected?.sort_order ?? 100}">
                        </div>
                    </div>
                    <label class="checkbox-row">
                        <input type="checkbox" id="catalog-unit-active" ${selected ? (selected.is_active ? 'checked' : '') : 'checked'}>
                        <span>启用状态</span>
                    </label>
                    <div class="button-group">
                        <button class="btn btn-primary" onclick="catalogPage.submitUnitOption()">保存单位选项</button>
                        <button class="btn btn-secondary" onclick="catalogPage.startCreateUnitOption()">新建单位</button>
                    </div>
                </div>
            </div>
        `;
    },

    renderSystemModule() {
        const stockAdjustmentState = this.stockAdjustmentState;
        const stockAdjustmentGroup = this.getStockAdjustmentSelectedGroup();
        const stockAdjustmentInstrument = this.getStockAdjustmentSelectedInstrument();
        const stockAdjustmentGroups = this.getStockAdjustmentGroupedReagents(stockAdjustmentInstrument);
        const changedItems = this.getChangedStockAdjustmentItems();
        const maintenanceInstruments = this.maintenanceFilters.workGroupId
            ? (this.getWorkGroupById(this.maintenanceFilters.workGroupId)?.instruments || [])
            : this.catalog.flatMap((group) => group.instruments || []);
        return `
            <div class="settings-system-stack">
                <div class="settings-panel">
                    <div class="settings-editor-header">
                        <div>
                            <h4>调整试剂库存</h4>
                            <p class="hint">进入前必须输入密码。按工作组和仪器快速切换，直接修改未归档试剂各批号的当前库存最小单位数。</p>
                        </div>
                        ${stockAdjustmentState.unlocked ? '<span class="settings-item-badge">已进入维护页</span>' : '<span class="settings-item-badge">密码保护</span>'}
                    </div>
                    ${stockAdjustmentState.unlocked ? `
                        <div class="stock-adjustment-shell">
                            <div class="stock-adjustment-toolbar">
                                <div class="stock-adjustment-toolbar-copy">
                                    <strong>${this.escapeHtml(stockAdjustmentInstrument?.name || '请选择仪器')}</strong>
                                    <span>当前仅显示该仪器下未归档试剂的批次库存，可分别调整每个批号。</span>
                                </div>
                                <div class="button-group">
                                    <button class="btn btn-primary" onclick="catalogPage.saveStockAdjustments()" ${changedItems.length ? '' : 'disabled'}>保存当前仪器修改${changedItems.length ? `（${changedItems.length}项）` : ''}</button>
                                    <button class="btn btn-secondary" onclick="catalogPage.resetStockAdjustmentDrafts()">恢复当前页原值</button>
                                    <button class="btn btn-secondary" onclick="catalogPage.closeStockAdjustmentWorkspace()">退出库存调整</button>
                                </div>
                            </div>
                            <div class="stock-adjustment-tab-section">
                                <div class="stock-adjustment-tab-label">工作组</div>
                                <div class="inventory-tab-strip">
                                    ${(stockAdjustmentState.inventory || []).map((group) => `
                                        <button class="inventory-tab ${group.id === stockAdjustmentState.selectedWorkGroupId ? 'active' : ''}" onclick="catalogPage.selectStockAdjustmentWorkGroup(${group.id})">
                                            <span>${this.escapeHtml(group.name)}</span>
                                            <span class="inventory-tab-badge">${(group.instruments || []).length}</span>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="stock-adjustment-tab-section">
                                <div class="stock-adjustment-tab-label">仪器</div>
                                <div class="inventory-subtab-strip">
                                    ${(stockAdjustmentGroup?.instruments || []).map((instrument) => `
                                        <button class="inventory-subtab ${instrument.id === stockAdjustmentState.selectedInstrumentId ? 'active' : ''}" onclick="catalogPage.selectStockAdjustmentInstrument(${instrument.id})">
                                            <span>${this.escapeHtml(instrument.name)}</span>
                                            <span class="inventory-tab-badge">${(instrument.reagents || []).length}</span>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="stock-adjustment-groups">
                                ${stockAdjustmentGroups.length ? stockAdjustmentGroups.map((group) => `
                                    <section class="stock-adjustment-group">
                                        <div class="stock-adjustment-group-head">
                                            <h5>${this.escapeHtml(group.label)}</h5>
                                            <span>${group.reagents.reduce((count, reagent) => count + ((reagent.batches || []).length || 0), 0)} 个批次</span>
                                        </div>
                                        <div class="stock-adjustment-table-head compact">
                                            ${Array.from({ length: 3 }).map(() => `
                                                <div class="stock-adjustment-head-item">
                                                    <span>名称</span>
                                                    <span>当前</span>
                                                    <span>调整后</span>
                                                    <span>单位</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                        <div class="stock-adjustment-grid">
                                            ${group.reagents.flatMap((reagent) => (reagent.batches || []).map((batch) => {
                                                const originalValue = Number(batch.available_min_quantity ?? 0);
                                                const currentValue = this.parseNonNegative(this.getStockAdjustmentDraftValue(batch), originalValue);
                                                const changed = currentValue !== originalValue;
                                                return `
                                                    <div class="stock-adjustment-grid-item ${changed ? 'is-changed' : ''}">
                                                        <div class="stock-adjustment-name-cell">
                                                            <strong>${this.escapeHtml(reagent.name)}</strong>
                                                            <span>${this.escapeHtml(batch.batch_no)}</span>
                                                        </div>
                                                        <div class="stock-adjustment-value-cell">${originalValue}</div>
                                                        <div class="stock-adjustment-input-cell">
                                                            <input
                                                                type="number"
                                                                id="stock-adjustment-batch-${batch.id}"
                                                                class="form-input"
                                                                min="0"
                                                                value="${this.escapeHtml(this.getStockAdjustmentDraftValue(batch))}"
                                                                onchange="catalogPage.updateStockAdjustmentDraft(${batch.id}, this.value)"
                                                                oninput="catalogPage.updateStockAdjustmentDraft(${batch.id}, this.value, true)"
                                                            >
                                                        </div>
                                                        <div class="stock-adjustment-unit-cell">${this.escapeHtml(batch.min_unit || reagent.unit || '')}</div>
                                                    </div>
                                                `;
                                            })).join('')}
                                        </div>
                                    </section>
                                `).join('') : '<div class="settings-empty-state">当前仪器下暂无可调整的未归档试剂批次。</div>'}
                            </div>
                        </div>
                    ` : `
                        <div class="stock-adjustment-entry">
                            <p class="settings-inline-note">适合盘点后一次性校正库存。每个批号单独输入目标最小单位数，保存后立即生效。</p>
                            <div class="button-group">
                                <button class="btn btn-primary" onclick="catalogPage.openStockAdjustmentWorkspace()">进入库存调整</button>
                            </div>
                        </div>
                    `}
                </div>
                <div class="settings-panel danger-section">
                    <div class="settings-editor-header">
                        <h4>清空库存</h4>
                        <p class="hint">只清空所有试剂库存批次，不删除试剂档案，也不影响已保存的条码识别信息。</p>
                    </div>
                    <div class="button-group">
                        <button class="btn btn-danger" onclick="catalogPage.clearStock()">清空所有库存</button>
                    </div>
                </div>
                <div class="settings-panel danger-section">
                    <div class="settings-editor-header">
                        <h4>清空流水</h4>
                        <p class="hint">只删除流水记录，不回滚库存。可按工作组、仪器、试剂和时间范围清空，也可全部清空。</p>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="catalog-maintenance-work-group">工作组</label>
                            <select id="catalog-maintenance-work-group" class="form-select" onchange="catalogPage.handleMaintenanceGroupChange()">
                                <option value="">全部工作组</option>
                                ${this.catalog.map((group) => `
                                    <option value="${group.id}" ${String(group.id) === String(this.maintenanceFilters.workGroupId) ? 'selected' : ''}>${this.escapeHtml(group.name)}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="catalog-maintenance-instrument">仪器</label>
                            <select id="catalog-maintenance-instrument" class="form-select" onchange="catalogPage.handleMaintenanceInstrumentChange()">
                                <option value="">全部仪器</option>
                                ${maintenanceInstruments.map((instrument) => `
                                    <option value="${instrument.id}" ${String(instrument.id) === String(this.maintenanceFilters.instrumentId) ? 'selected' : ''}>${this.escapeHtml(instrument.name)}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="catalog-maintenance-reagent">试剂</label>
                            <select id="catalog-maintenance-reagent" class="form-select">
                                <option value="">全部试剂</option>
                                ${this.maintenanceReagents.map((item) => `
                                    <option value="${item.id}" ${String(item.id) === String(this.maintenanceFilters.reagentId) ? 'selected' : ''}>${this.escapeHtml(item.name)}</option>
                                `).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="catalog-maintenance-start-date">开始日期</label>
                            <input type="date" id="catalog-maintenance-start-date" class="form-input" value="${this.escapeHtml(this.maintenanceFilters.startDate)}">
                        </div>
                        <div class="form-group">
                            <label for="catalog-maintenance-end-date">结束日期</label>
                            <input type="date" id="catalog-maintenance-end-date" class="form-input" value="${this.escapeHtml(this.maintenanceFilters.endDate)}">
                        </div>
                    </div>
                    <div class="button-group">
                        <button class="btn btn-danger" onclick="catalogPage.clearTransactions()">按当前条件清空流水</button>
                        <button class="btn btn-secondary" onclick="catalogPage.resetMaintenanceFilters()">重置流水筛选</button>
                    </div>
                </div>
                <div class="settings-panel danger-section">
                    <div class="settings-editor-header">
                        <h4>重置试剂与库存数据</h4>
                        <p class="hint">会清空试剂档案、批次库存、出入库流水和条码解析日志，但保留工作组、仪器、操作人和常用单位选项。</p>
                    </div>
                    <button class="btn btn-danger" onclick="catalogPage.resetReagentData()">执行重置</button>
                </div>
            </div>
        `;
    },

    getReagentFilterInstruments() {
        if (!this.reagentFilters.workGroupId) {
            return this.catalog.flatMap((group) => group.instruments || []);
        }
        return this.getWorkGroupById(this.reagentFilters.workGroupId)?.instruments || [];
    },

    selectWorkGroup(id) {
        if (!id) {
            this.startCreateWorkGroup();
            return;
        }
        this.structureEditor = { type: 'workGroup', id: Number(id), mode: 'edit' };
        this.render();
    },

    selectInstrument(id) {
        this.structureEditor = { type: 'instrument', id: Number(id), mode: 'edit' };
        this.render();
    },

    startCreateWorkGroup() {
        this.structureEditor = { type: 'workGroup', id: null, mode: 'create' };
        this.render();
    },

    startCreateInstrument(workGroupId = null) {
        this.structureEditor = {
            type: 'instrument',
            id: null,
            mode: 'create',
            parentWorkGroupId: workGroupId ? Number(workGroupId) : null
        };
        this.render();
    },

    async submitWorkGroup() {
        const name = this.normalizeText(document.getElementById('catalog-structure-work-group-name')?.value);
        if (!name) {
            return Utils.showToast('请输入工作组名称', 'warning');
        }
        if (this.structureEditor.id) {
            const updated = await API.inventory.updateWorkGroup(this.structureEditor.id, { name });
            this.structureEditor = { type: 'workGroup', id: updated.id, mode: 'edit' };
            Utils.showToast('工作组已更新', 'success');
        } else {
            const created = await API.inventory.createWorkGroup({ name });
            this.structureEditor = { type: 'workGroup', id: created.id, mode: 'edit' };
            Utils.showToast('工作组已新增', 'success');
        }
        await this.loadCatalog();
        this.ensureSelections();
        this.render();
    },

    async submitInstrument() {
        const selectedBundle = this.structureEditor.id ? this.getInstrumentById(this.structureEditor.id) : null;
        const payload = {
            work_group_id: parseInt(document.getElementById('catalog-structure-instrument-work-group')?.value, 10),
            name: this.normalizeText(document.getElementById('catalog-structure-instrument-name')?.value),
            model: this.normalizeText(document.getElementById('catalog-structure-instrument-model')?.value) || null,
            default_warning_days: this.parseNonNegative(document.getElementById('catalog-structure-instrument-warning-days')?.value, selectedBundle?.instrument?.default_warning_days ?? 30),
            default_warning_stock: this.parseNonNegative(document.getElementById('catalog-structure-instrument-warning-stock')?.value, selectedBundle?.instrument?.default_warning_stock ?? 5)
        };
        if (!payload.work_group_id || !payload.name) {
            return Utils.showToast('请完整填写所属工作组和仪器名称', 'warning');
        }
        if (this.structureEditor.id) {
            const updated = await API.inventory.updateInstrument(this.structureEditor.id, payload);
            this.structureEditor = { type: 'instrument', id: updated.id, mode: 'edit' };
            Utils.showToast('仪器已更新', 'success');
        } else {
            const created = await API.inventory.createInstrument(payload);
            this.structureEditor = { type: 'instrument', id: created.id, mode: 'edit' };
            Utils.showToast('仪器已新增', 'success');
        }
        await this.loadCatalog();
        this.ensureSelections();
        this.render();
    },

    async batchUpdateStructureInstrumentWarnings() {
        if (!this.structureEditor.id) {
            return;
        }
        const instrumentBundle = this.getInstrumentById(this.structureEditor.id);
        if (!instrumentBundle?.instrument) {
            return;
        }
        const payload = {
            default_warning_days: this.parseNonNegative(document.getElementById('catalog-structure-instrument-warning-days')?.value, instrumentBundle.instrument.default_warning_days ?? 30),
            default_warning_stock: this.parseNonNegative(document.getElementById('catalog-structure-instrument-warning-stock')?.value, instrumentBundle.instrument.default_warning_stock ?? 5)
        };
        if (!confirm(`确定批量更新“${instrumentBundle.instrument.name}”下全部试剂的预警值吗？`)) {
            return;
        }
        const result = await API.inventory.batchUpdateInstrumentWarnings(instrumentBundle.instrument.id, payload);
        Utils.showToast(`已批量更新 ${result.updated_count} 个试剂，并同步保存为当前仪器默认值`, 'success');
        await this.loadCatalog();
        this.ensureSelections();
        this.render();
    },

    openInstrumentQrModal(instrumentId = null) {
        const targetId = Number(instrumentId || this.structureEditor.id);
        if (!targetId) {
            return;
        }
        this.qrInstrumentId = targetId;
        this.render();
    },

    closeInstrumentQrModal() {
        if (!this.qrInstrumentId) {
            return;
        }
        this.qrInstrumentId = null;
        this.render();
    },

    async copyInstrumentQrLink() {
        const instrumentBundle = this.getInstrumentById(this.qrInstrumentId || this.structureEditor.id);
        const instrument = instrumentBundle?.instrument;
        if (!instrument) {
            return Utils.showToast('请先选择仪器', 'warning');
        }

        const target = this.getInstrumentMobileUrl(instrument.id);
        try {
            await navigator.clipboard.writeText(target);
            Utils.showToast('仪器手机链接已复制', 'success');
        } catch (error) {
            Utils.showToast('复制失败，请手动复制链接', 'warning');
        }
    },

    async applyReagentFilters() {
        this.reagentFilters.workGroupId = document.getElementById('catalog-reagent-filter-work-group')?.value || '';
        this.reagentFilters.instrumentId = document.getElementById('catalog-reagent-filter-instrument')?.value || '';
        this.reagentFilters.keyword = this.normalizeText(document.getElementById('catalog-reagent-filter-keyword')?.value);
        this.reagentFilters.status = document.getElementById('catalog-reagent-filter-status')?.value || 'active';
        await this.loadReagents();
        this.ensureSelections();
        this.render();
    },

    handleReagentFilterGroupChange() {
        this.reagentFilters.workGroupId = document.getElementById('catalog-reagent-filter-work-group')?.value || '';
        this.reagentFilters.instrumentId = '';
        this.render();
    },

    async resetReagentFilters() {
        this.reagentFilters = {
            workGroupId: '',
            instrumentId: '',
            keyword: '',
            status: 'active'
        };
        await this.loadReagents();
        this.ensureSelections();
        this.render();
    },

    selectReagent(id) {
        this.selectedReagentId = Number(id);
        this.render();
    },

    startCreateReagentGroup() {
        this.selectedReagentGroupId = null;
        this.render();
    },

    selectReagentGroup(id) {
        this.selectedReagentGroupId = Number(id);
        this.render();
    },

    handleReagentWorkGroupChange() {
        const workGroupId = document.getElementById('catalog-reagent-work-group')?.value || '';
        const instrumentSelect = document.getElementById('catalog-reagent-instrument');
        if (instrumentSelect) {
            instrumentSelect.innerHTML = this.getInstrumentOptions(workGroupId, '');
        }
        this.applyReagentInstrumentDefaults();
    },

    handleReagentInstrumentChange() {
        this.applyReagentInstrumentDefaults();
    },

    applyReagentInstrumentDefaults() {
        const instrumentId = parseInt(document.getElementById('catalog-reagent-instrument')?.value, 10);
        const defaults = this.getInstrumentPackagingDefaults(instrumentId);
        if (!defaults) return;

        const packageUnitInput = document.getElementById('catalog-reagent-package-unit');
        const minUnitInput = document.getElementById('catalog-reagent-min-unit');
        const ratioInput = document.getElementById('catalog-reagent-package-to-min-qty');
        if (!packageUnitInput || !minUnitInput || !ratioInput) return;

        packageUnitInput.value = defaults.packageUnit;
        minUnitInput.value = defaults.minUnit;
        ratioInput.value = String(defaults.ratio);
        this.refreshReagentRelationPreview();
    },

    refreshReagentRelationPreview() {
        const preview = document.getElementById('catalog-reagent-package-relation-preview');
        if (!preview) return;
        preview.textContent = this.formatRelation(
            document.getElementById('catalog-reagent-package-unit')?.value,
            document.getElementById('catalog-reagent-package-to-min-qty')?.value,
            document.getElementById('catalog-reagent-min-unit')?.value
        );
    },

    async submitReagent() {
        const selected = this.getSelectedReagent();
        if (!selected) {
            return Utils.showToast('请先选择一个试剂档案', 'warning');
        }

        const payload = {
            instrument_id: parseInt(document.getElementById('catalog-reagent-instrument')?.value, 10),
            reagent_group_id: (() => {
                const value = document.getElementById('catalog-reagent-group')?.value;
                return value ? parseInt(value, 10) : null;
            })(),
            name: this.normalizeText(document.getElementById('catalog-reagent-name')?.value),
            manufacturer: this.normalizeText(document.getElementById('catalog-reagent-manufacturer')?.value) || null,
            package_unit: this.normalizeText(document.getElementById('catalog-reagent-package-unit')?.value),
            unit: this.normalizeText(document.getElementById('catalog-reagent-min-unit')?.value),
            package_to_min_qty: Math.max(parseInt(document.getElementById('catalog-reagent-package-to-min-qty')?.value, 10) || 1, 1),
            warning_days: this.parseNonNegative(document.getElementById('catalog-reagent-warning-days')?.value, 30),
            warning_stock: this.parseNonNegative(document.getElementById('catalog-reagent-warning-stock')?.value, 5),
            follow_instrument: false,
            is_calibrator: Boolean(document.getElementById('catalog-reagent-is-calibrator')?.checked),
            calibration_result_unit: this.normalizeText(document.getElementById('catalog-reagent-calibration-result-unit')?.value) || 'nmmol/L'
        };

        if (!payload.instrument_id || !payload.name || !payload.package_unit || !payload.unit) {
            return Utils.showToast('请完整填写试剂档案信息', 'warning');
        }

        await API.reagents.update(selected.id, payload);
        Utils.showToast('试剂档案已更新，库存批次单位已同步', 'success');
        await Promise.all([this.loadCatalog(), this.loadReagents()]);
        this.ensureSelections();
        this.render();
        if (typeof inventoryPage !== 'undefined' && inventoryPage.initialized) {
            inventoryPage.loadInventory();
        }
    },

    async submitReagentGroup() {
        const payload = {
            name: this.normalizeText(document.getElementById('catalog-reagent-group-name')?.value),
            sort_order: this.parseNonNegative(document.getElementById('catalog-reagent-group-sort-order')?.value, 100),
            is_active: Boolean(document.getElementById('catalog-reagent-group-active')?.checked)
        };
        if (!payload.name) {
            return Utils.showToast('请输入项目分组名称', 'warning');
        }

        if (this.selectedReagentGroupId) {
            const updated = await API.reagentGroups.update(this.selectedReagentGroupId, payload);
            this.selectedReagentGroupId = updated.id;
            Utils.showToast('项目分组已更新', 'success');
        } else {
            const created = await API.reagentGroups.create(payload);
            this.selectedReagentGroupId = created.id;
            Utils.showToast('项目分组已新增', 'success');
        }

        await Promise.all([this.loadReagentGroups(), this.loadReagents()]);
        this.ensureSelections();
        this.render();
    },

    async restoreSelectedReagent() {
        const selected = this.getSelectedReagent();
        if (!selected || !selected.is_archived) {
            return;
        }
        await API.inventory.restoreReagent(selected.id);
        Utils.showToast('试剂已恢复归档', 'success');
        await this.loadReagents();
        this.ensureSelections();
        this.render();
    },

    startCreateOperator() {
        this.selectedOperatorId = null;
        this.render();
    },

    selectOperator(id) {
        this.selectedOperatorId = Number(id);
        this.render();
    },

    async submitOperator() {
        const name = this.normalizeText(document.getElementById('catalog-operator-name')?.value);
        const isActive = Boolean(document.getElementById('catalog-operator-active')?.checked);
        if (!name) {
            return Utils.showToast('请输入操作人姓名', 'warning');
        }
        if (this.selectedOperatorId) {
            const updated = await API.operators.update(this.selectedOperatorId, { name, is_active: isActive });
            this.selectedOperatorId = updated.id;
            Utils.showToast('操作人已更新', 'success');
        } else {
            const created = await API.operators.create({ name, is_active: isActive });
            this.selectedOperatorId = created.id;
            Utils.showToast('操作人已新增', 'success');
        }
        Utils.operatorsLoaded = false;
        await Promise.all([this.loadOperators(), Utils.loadOperators(true)]);
        this.ensureSelections();
        this.render();
    },

    async deleteOperator() {
        const selected = this.getSelectedOperator();
        if (!selected) {
            return Utils.showToast('请先选择要删除的操作人', 'warning');
        }
        if (!confirm(`确定删除操作人“${selected.name}”吗？`)) {
            return;
        }

        await API.operators.remove(selected.id);
        this.selectedOperatorId = null;
        Utils.operatorsLoaded = false;
        await Promise.all([this.loadOperators(), Utils.loadOperators(true)]);
        this.ensureSelections();
        this.render();
        Utils.showToast('操作人已删除', 'success');
    },

    changeUnitFilterScope(value) {
        this.unitFilterScope = value || 'all';
        this.ensureUnitSelection();
        this.render();
    },

    startCreateUnitOption() {
        this.selectedUnitOptionId = null;
        this.render();
    },

    selectUnitOption(id) {
        this.selectedUnitOptionId = Number(id);
        this.render();
    },

    async submitUnitOption() {
        const payload = {
            name: this.normalizeText(document.getElementById('catalog-unit-name')?.value),
            scope: document.getElementById('catalog-unit-scope')?.value || 'both',
            is_active: Boolean(document.getElementById('catalog-unit-active')?.checked),
            sort_order: this.parseNonNegative(document.getElementById('catalog-unit-sort-order')?.value, 100)
        };
        if (!payload.name) {
            return Utils.showToast('请输入单位名称', 'warning');
        }
        if (this.selectedUnitOptionId) {
            const updated = await API.unitOptions.update(this.selectedUnitOptionId, payload);
            this.selectedUnitOptionId = updated.id;
            Utils.showToast('单位选项已更新', 'success');
        } else {
            const created = await API.unitOptions.create(payload);
            this.selectedUnitOptionId = created.id;
            Utils.showToast('单位选项已新增', 'success');
        }
        await this.loadUnitOptions();
        this.ensureSelections();
        this.render();
    },

    async resetReagentData() {
        if (!confirm('此操作会清空所有试剂、库存和流水记录，确定继续吗？')) {
            return;
        }
        const password = this.promptAdminPassword('重置试剂与库存数据');
        if (!password) {
            return;
        }
        await API.inventory.resetReagentData(password);
        Utils.showToast('试剂与库存数据已重置', 'success');
        this.selectedReagentId = null;
        await Promise.all([
            this.loadCatalog(),
            this.loadReagents()
        ]);
        this.stockAdjustmentState = {
            unlocked: false,
            password: '',
            inventory: [],
            selectedWorkGroupId: null,
            selectedInstrumentId: null,
            drafts: {}
        };
        this.ensureSelections();
        this.render();
        if (typeof inventoryPage !== 'undefined' && inventoryPage.initialized) {
            await inventoryPage.loadInventory();
        }
    },

    async openStockAdjustmentWorkspace() {
        const password = this.promptAdminPassword('库存调整');
        if (!password) {
            return;
        }
        const inventory = await API.inventory.stockAdjustmentAccess(password);
        this.stockAdjustmentState = {
            unlocked: true,
            password,
            inventory,
            selectedWorkGroupId: this.stockAdjustmentState.selectedWorkGroupId,
            selectedInstrumentId: this.stockAdjustmentState.selectedInstrumentId,
            drafts: {}
        };
        this.ensureStockAdjustmentSelection();
        this.render();
    },

    closeStockAdjustmentWorkspace() {
        this.stockAdjustmentState = {
            unlocked: false,
            password: '',
            inventory: [],
            selectedWorkGroupId: null,
            selectedInstrumentId: null,
            drafts: {}
        };
        this.render();
    },

    selectStockAdjustmentWorkGroup(groupId) {
        this.stockAdjustmentState.selectedWorkGroupId = Number(groupId);
        this.stockAdjustmentState.selectedInstrumentId = null;
        this.ensureStockAdjustmentSelection();
        this.render();
    },

    selectStockAdjustmentInstrument(instrumentId) {
        this.stockAdjustmentState.selectedInstrumentId = Number(instrumentId);
        this.ensureStockAdjustmentSelection();
        this.render();
    },

    updateStockAdjustmentDraft(batchId, value, skipRender = false) {
        this.stockAdjustmentState.drafts[String(batchId)] = value;
        if (!skipRender) {
            this.render();
        }
    },

    resetStockAdjustmentDrafts() {
        this.stockAdjustmentState.drafts = {};
        this.render();
    },

    async saveStockAdjustments() {
        const items = this.getChangedStockAdjustmentItems();
        if (!items.length) {
            return Utils.showToast('当前仪器没有需要保存的库存修改', 'warning');
        }

        const instrument = this.getStockAdjustmentSelectedInstrument();
        const result = await API.inventory.applyStockAdjustments({
            password: this.stockAdjustmentState.password,
            items
        });
        const inventory = await API.inventory.stockAdjustmentAccess(this.stockAdjustmentState.password);
        this.stockAdjustmentState.inventory = inventory;
        this.stockAdjustmentState.drafts = {};
        this.ensureStockAdjustmentSelection();
        this.render();

        if (typeof inventoryPage !== 'undefined' && inventoryPage.initialized) {
            await inventoryPage.loadInventory();
        }
        if (typeof dashboardPage !== 'undefined' && dashboardPage.initialized) {
            await dashboardPage.refreshOverview();
        }

        Utils.showToast(
            `已更新 ${result.updated_batch_count} 个批次${instrument ? ` · ${instrument.name}` : ''}`,
            'success'
        );
    },

    async handleMaintenanceGroupChange() {
        this.maintenanceFilters.workGroupId = document.getElementById('catalog-maintenance-work-group')?.value || '';
        this.maintenanceFilters.instrumentId = '';
        this.maintenanceFilters.reagentId = '';
        await this.loadMaintenanceReagents();
        this.render();
    },

    async handleMaintenanceInstrumentChange() {
        this.maintenanceFilters.instrumentId = document.getElementById('catalog-maintenance-instrument')?.value || '';
        this.maintenanceFilters.reagentId = '';
        await this.loadMaintenanceReagents();
        this.render();
    },

    async resetMaintenanceFilters() {
        this.maintenanceFilters = {
            workGroupId: '',
            instrumentId: '',
            reagentId: '',
            startDate: '',
            endDate: ''
        };
        await this.loadMaintenanceReagents();
        this.render();
    },

    async clearStock() {
        if (!confirm('确定清空所有试剂库存吗？这不会删除试剂档案，也不会影响条码识别信息。')) {
            return;
        }
        const password = this.promptAdminPassword('清空库存');
        if (!password) {
            return;
        }
        const result = await API.inventory.clearStock(password);
        Utils.showToast(`已清空 ${result.cleared_batch_count} 条库存批次`, 'success');
        if (this.stockAdjustmentState.unlocked) {
            this.stockAdjustmentState.inventory = await API.inventory.stockAdjustmentAccess(this.stockAdjustmentState.password);
            this.stockAdjustmentState.drafts = {};
            this.ensureStockAdjustmentSelection();
            this.render();
        }
        if (typeof inventoryPage !== 'undefined' && inventoryPage.initialized) {
            await inventoryPage.loadInventory();
        }
    },

    async clearTransactions() {
        const payload = {
            work_group_id: document.getElementById('catalog-maintenance-work-group')?.value || null,
            instrument_id: document.getElementById('catalog-maintenance-instrument')?.value || null,
            reagent_id: document.getElementById('catalog-maintenance-reagent')?.value || null,
            start_date: document.getElementById('catalog-maintenance-start-date')?.value || null,
            end_date: document.getElementById('catalog-maintenance-end-date')?.value || null
        };
        const hasFilters = Object.values(payload).some((value) => value);
        const confirmMessage = hasFilters
            ? '确定按当前筛选条件清空流水吗？此操作只删除流水记录，不会回滚库存。'
            : '确定清空全部流水吗？此操作只删除流水记录，不会回滚库存。';
        if (!confirm(confirmMessage)) {
            return;
        }
        const password = this.promptAdminPassword('清空流水');
        if (!password) {
            return;
        }
        payload.password = password;
        const result = await API.inventory.clearTransactions(payload);
        Utils.showToast(result.deleted_count ? `已清空 ${result.deleted_count} 条流水` : '当前条件下没有可清空的流水', result.deleted_count ? 'success' : 'warning');
    }
};
