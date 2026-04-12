const Utils = {
    operators: [],
    operatorsLoaded: false,
    unitOptions: [],
    unitOptionsLoaded: false,
    OPERATOR_KEY: 'reagent_system_last_operator',

    async loadOperators(force = false) {
        if (this.operatorsLoaded && !force) return this.operators;
        try {
            const operators = await API.operators.list();
            this.operators = operators.filter((item) => item.is_active);
        } catch (error) {
            console.error('Failed to load operators:', error);
            this.operators = [];
        }
        this.operatorsLoaded = true;
        return this.operators;
    },

    async loadUnitOptions(force = false) {
        if (this.unitOptionsLoaded && !force) return this.unitOptions;
        try {
            this.unitOptions = await API.unitOptions.list();
        } catch (error) {
            console.error('Failed to load unit options:', error);
            this.unitOptions = [];
        }
        this.unitOptionsLoaded = true;
        this.syncUnitDataLists();
        return this.unitOptions;
    },

    getUnitOptions(scope = 'all', { includeInactive = false } = {}) {
        const scopeValue = String(scope || 'all');
        return this.unitOptions.filter((item) => {
            if (!includeInactive && !item.is_active) {
                return false;
            }
            if (scopeValue === 'package') {
                return item.scope === 'package' || item.scope === 'both';
            }
            if (scopeValue === 'min') {
                return item.scope === 'min' || item.scope === 'both';
            }
            return true;
        });
    },

    getDefaultUnit(scope, fallback) {
        const items = this.getUnitOptions(scope);
        return items[0]?.name || fallback;
    },

    syncUnitDataLists() {
        const packageList = document.getElementById('package-unit-options');
        const minList = document.getElementById('min-unit-options');
        if (packageList) {
            packageList.innerHTML = this.getUnitOptions('package').map((item) => `<option value="${item.name}"></option>`).join('');
        }
        if (minList) {
            minList.innerHTML = this.getUnitOptions('min').map((item) => `<option value="${item.name}"></option>`).join('');
        }
    },

    isValidOperator(operator) {
        const normalized = String(operator || '').trim();
        return this.operators.some((item) => item.name === normalized);
    },

    getValidOperator(operator) {
        const normalized = String(operator || '').trim();
        return this.isValidOperator(normalized) ? normalized : '';
    },

    async populateOperatorSelect(selectId, {
        allowEmpty = true,
        emptyLabel = '请选择操作人',
        defaultValue = ''
    } = {}) {
        await this.loadOperators();
        const select = document.getElementById(selectId);
        if (!select) return;
        const preferredValue = this.getValidOperator(defaultValue) || this.getValidOperator(select.value);
        const options = [];
        if (allowEmpty) {
            options.push(`<option value="">${emptyLabel}</option>`);
        }
        this.operators.forEach((operator) => {
            options.push(`<option value="${operator.name}">${operator.name}</option>`);
        });
        select.innerHTML = options.join('');
        if (preferredValue) {
            select.value = preferredValue;
            return;
        }
        if (!allowEmpty && this.operators.length) {
            select.value = this.operators[0].name;
            return;
        }
        select.value = '';
    },

    formatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
    },

    formatDateTime(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN');
    },

    isExpired(value) {
        if (!value) return false;
        const expiry = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return expiry < today;
    },

    getDaysUntilExpiry(value) {
        if (!value) return null;
        const expiry = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    },

    storage: {
        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch {
                return defaultValue;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (error) {
                console.error('Storage error:', error);
            }
        }
    },

    getLastOperator() {
        return this.storage.get(this.OPERATOR_KEY, '');
    },

    saveLastOperator(operator) {
        const normalized = String(operator || '').trim();
        if (normalized) {
            this.storage.set(this.OPERATOR_KEY, normalized);
        }
    },

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;
        setTimeout(() => toast.classList.add('hidden'), duration);
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    syncCheckboxSelect(selectId, placeholder = '全部') {
        const select = document.getElementById(selectId);
        if (!select) {
            return;
        }

        select.classList.add('native-checkbox-select');
        let widget = document.getElementById(`${selectId}-checkbox-ui`);
        if (!widget) {
            widget = document.createElement('div');
            widget.id = `${selectId}-checkbox-ui`;
            widget.className = 'checkbox-select';
            widget.innerHTML = `
                <button type="button" class="checkbox-select-trigger" aria-expanded="false">
                    <span class="checkbox-select-label"></span>
                    <span class="checkbox-select-caret">⌄</span>
                </button>
                <div class="checkbox-select-panel hidden"></div>
            `;
            select.insertAdjacentElement('afterend', widget);

            widget.querySelector('.checkbox-select-trigger').addEventListener('click', () => {
                const panel = widget.querySelector('.checkbox-select-panel');
                const isOpening = panel.classList.contains('hidden');
                document.querySelectorAll('.checkbox-select-panel').forEach((item) => item.classList.add('hidden'));
                document.querySelectorAll('.checkbox-select-trigger').forEach((item) => item.setAttribute('aria-expanded', 'false'));
                panel.classList.toggle('hidden', !isOpening);
                widget.querySelector('.checkbox-select-trigger').setAttribute('aria-expanded', String(isOpening));
            });

            widget.addEventListener('change', (event) => {
                const checkbox = event.target.closest('input[type="checkbox"][data-value]');
                if (!checkbox) {
                    return;
                }
                const option = [...select.options].find((item) => item.value === checkbox.dataset.value);
                if (option) {
                    option.selected = checkbox.checked;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                this.syncCheckboxSelect(selectId, placeholder);
            });

            widget.addEventListener('click', (event) => {
                const action = event.target.closest('[data-checkbox-action]')?.dataset.checkboxAction;
                if (!action) {
                    return;
                }
                [...select.options].forEach((option) => {
                    option.selected = action === 'all';
                });
                select.dispatchEvent(new Event('change', { bubbles: true }));
                this.syncCheckboxSelect(selectId, placeholder);
            });
        }

        if (!this.checkboxSelectCloseBound) {
            document.addEventListener('click', (event) => {
                if (event.target.closest('.checkbox-select')) {
                    return;
                }
                document.querySelectorAll('.checkbox-select-panel').forEach((item) => item.classList.add('hidden'));
                document.querySelectorAll('.checkbox-select-trigger').forEach((item) => item.setAttribute('aria-expanded', 'false'));
            });
            this.checkboxSelectCloseBound = true;
        }

        const options = [...select.options];
        const selected = options.filter((option) => option.selected);
        const label = widget.querySelector('.checkbox-select-label');
        if (!selected.length) {
            label.textContent = placeholder;
        } else if (selected.length <= 2) {
            label.textContent = selected.map((option) => option.textContent.trim()).join('、');
        } else {
            label.textContent = `${selected[0].textContent.trim()} 等 ${selected.length} 项`;
        }

        const panel = widget.querySelector('.checkbox-select-panel');
        if (!options.length) {
            panel.innerHTML = '<div class="checkbox-select-empty">暂无可选项</div>';
            return;
        }

        panel.innerHTML = `
            <div class="checkbox-select-tools">
                <button type="button" data-checkbox-action="clear">清空</button>
                <button type="button" data-checkbox-action="all">全选</button>
            </div>
            <div class="checkbox-select-options">
                ${options.map((option) => `
                    <label class="checkbox-select-option">
                        <input type="checkbox" data-value="${this.escapeHtml(option.value)}" ${option.selected ? 'checked' : ''}>
                        <span>${this.escapeHtml(option.textContent.trim())}</span>
                    </label>
                `).join('')}
            </div>
        `;
    },

    validateRequired(fields) {
        const errors = [];
        Object.entries(fields).forEach(([name, value]) => {
            if (!value || (typeof value === 'string' && value.trim() === '')) {
                errors.push(name);
            }
        });
        return errors;
    },

    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }
};
