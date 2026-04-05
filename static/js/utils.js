// Utility functions

const Utils = {
    OPERATOR_OPTIONS: [
        '陈茜',
        '刘进文',
        '徐元庆',
        '杨振华',
        '刘亚平',
        '周雨桐',
        '嵇婷',
        '陈慧',
        '张萱'
    ],

    isValidOperator(operator) {
        return this.OPERATOR_OPTIONS.includes(String(operator || '').trim());
    },

    getValidOperator(operator) {
        const normalized = String(operator || '').trim();
        return this.isValidOperator(normalized) ? normalized : '';
    },

    populateOperatorSelect(selectId, {
        allowEmpty = true,
        emptyLabel = '请选择操作人',
        defaultValue = ''
    } = {}) {
        const select = document.getElementById(selectId);
        if (!select) {
            return;
        }

        const preferredValue = this.getValidOperator(defaultValue) || this.getValidOperator(select.value);
        const options = [];

        if (allowEmpty) {
            options.push(`<option value="">${emptyLabel}</option>`);
        }

        this.OPERATOR_OPTIONS.forEach((name) => {
            options.push(`<option value="${name}">${name}</option>`);
        });

        select.innerHTML = options.join('');
        select.value = preferredValue || '';
    },

    // Format date to YYYY-MM-DD
    formatDate(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toISOString().split('T')[0];
    },

    // Format datetime
    formatDateTime(datetime) {
        if (!datetime) return '';
        const d = new Date(datetime);
        return d.toLocaleString('zh-CN');
    },

    // Check if date is expired
    isExpired(date) {
        if (!date) return false;
        const expiry = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return expiry < today;
    },

    // Get days until expiry
    getDaysUntilExpiry(date) {
        if (!date) return null;
        const expiry = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diff = expiry - today;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    },

    // LocalStorage helpers
    storage: {
        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error('Storage error:', e);
            }
        },
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.error('Storage error:', e);
            }
        }
    },

    // Operator storage key
    OPERATOR_KEY: 'reagent_system_last_operator',

    // Get last operator
    getLastOperator() {
        return this.storage.get(this.OPERATOR_KEY, '');
    },

    // Save last operator
    saveLastOperator(operator) {
        const normalized = this.getValidOperator(operator);
        if (normalized) {
            this.storage.set(this.OPERATOR_KEY, normalized);
        }
    },

    // Show toast message
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;

        setTimeout(() => {
            toast.classList.add('hidden');
        }, duration);
    },

    // Validate required fields
    validateRequired(fields) {
        const errors = [];
        for (const [name, value] of Object.entries(fields)) {
            if (!value || (typeof value === 'string' && value.trim() === '')) {
                errors.push(name);
            }
        }
        return errors;
    },

    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};
