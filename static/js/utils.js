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
        select.value = preferredValue || '';
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
