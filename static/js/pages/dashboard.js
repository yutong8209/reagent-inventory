const dashboardPage = {
    initialized: false,
    overview: null,
    isLoading: false,
    refreshTimer: null,
    mobilePreferredOrigin: 'http://192.168.31.32:8000',

    async init() {
        if (!this.initialized) {
            this.bindEvents();
            this.renderMobileQr();
            this.startAutoRefresh();
            this.initialized = true;
        }
        await outboundPage.init();
        await this.refreshOverview();
    },

    bindEvents() {
        document.getElementById('dashboard-refresh-btn')?.addEventListener('click', () => {
            this.refreshOverview();
        });
        document.getElementById('dashboard-open-inventory-btn')?.addEventListener('click', () => {
            this.openInventory();
        });
    },

    renderMobileQr() {
        const qrImage = document.getElementById('dashboard-mobile-qr');
        if (!qrImage) {
            return;
        }
        const currentOrigin = window.location.origin;
        const targetOrigin = ['http://127.0.0.1:8000', 'http://localhost:8000'].includes(currentOrigin)
            ? this.mobilePreferredOrigin
            : currentOrigin;
    const target = `${targetOrigin}/mobile.html?appv=20260501-3`;
        qrImage.src = `/api/mobile/qr?target=${encodeURIComponent(target)}`;
    },

    startAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        this.refreshTimer = setInterval(() => {
            if (typeof app !== 'undefined' && app.currentPage === 'dashboard') {
                this.refreshOverview();
            }
        }, 15000);
    },

    async refreshOverview() {
        if (this.isLoading) {
            return;
        }
        this.isLoading = true;
        try {
            this.overview = await API.dashboard.overview();
            this.render();
        } catch (error) {
            console.error('Failed to load dashboard overview:', error);
            Utils.showToast('首页数据加载失败，请稍后重试', 'error');
        } finally {
            this.isLoading = false;
        }
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    getStatusLabel(status) {
        const labels = {
            empty: '零库存',
            expired: '已过期',
            expiring: '近效期',
            low: '低库存',
            normal: '正常'
        };
        return labels[status] || '正常';
    },

    formatDaysLabel(days) {
        if (days === null || days === undefined) {
            return '无效期';
        }
        if (days < 0) {
            return `已过期 ${Math.abs(days)} 天`;
        }
        if (days === 0) {
            return '今天到期';
        }
        return `剩余 ${days} 天`;
    },

    getSourceLabel(source) {
        const normalized = String(source || '').trim().toLowerCase();
        if (!normalized) return '-';
        if (normalized === 'scan') return '扫码';
        if (normalized === 'manual') return '手工';
        if (normalized === 'mobile') return '手机';
        return this.escapeHtml(source);
    },

    render() {
        this.renderPendingTasks();
        this.renderWarnings();
        this.renderRecentOutbounds();
    },

    renderPendingTasks() {
        const container = document.getElementById('dashboard-pending-tasks');
        const pending = this.overview?.pending_tasks;
        if (!container) {
            return;
        }
        if (!pending) {
            container.innerHTML = '<div class="inventory-empty">\u6682\u65e0\u9996\u9875\u6570\u636e\u3002</div>';
            return;
        }

        const cards = [
            { label: '\u5df2\u8fc7\u671f\u6279\u6b21', value: pending.expired_batch_count, type: 'danger', status: 'expired' },
            { label: '\u8fd1\u6548\u671f\u8bd5\u5242', value: pending.expiring_reagent_count, type: 'warning', status: 'expiring' },
            { label: '\u603b\u5e93\u5b58\u9884\u8b66', value: pending.low_stock_reagent_count, type: 'warning', status: 'low' },
            { label: '\u5355\u6279\u53f7\u9884\u8b66', value: pending.low_stock_batch_count, type: 'batch-warning', status: 'batch_low' },
            { label: '\u96f6\u5e93\u5b58\u672a\u5f52\u6863', value: pending.zero_stock_unarchived_count, type: 'danger', status: 'empty' }
        ];

        container.innerHTML = cards.map((item) => `
            <article
                class="dashboard-task-card dashboard-task-${item.type}"
                role="button"
                tabindex="0"
                onclick="dashboardPage.openInventoryForPending('${item.status}')"
                onkeydown="dashboardPage.handleCardKeydown(event, () => dashboardPage.openInventoryForPending('${item.status}'))"
            >
                <div class="dashboard-task-copy">
                    <span class="dashboard-task-label">${item.label}</span>
                    <strong class="dashboard-task-value">${item.value}</strong>
                </div>
            </article>
        `).join('');
    },

    renderWarnings() {
        const container = document.getElementById('dashboard-warning-list');
        const warnings = this.overview?.warning_reagents || [];
        if (!container) {
            return;
        }
        if (!warnings.length) {
            container.innerHTML = '<div class="inventory-empty">当前没有需要优先处理的预警试剂。</div>';
            return;
        }

        container.innerHTML = warnings.map((item) => `
            <article
                class="dashboard-warning-card dashboard-warning-${item.status_level}"
                role="button"
                tabindex="0"
                onclick="dashboardPage.openInventoryForReagent(${item.reagent_id})"
                onkeydown="dashboardPage.handleCardKeydown(event, () => dashboardPage.openInventoryForReagent(${item.reagent_id}))"
            >
                <div class="dashboard-warning-head">
                    <div class="dashboard-warning-copy">
                        <div class="dashboard-warning-title">${this.escapeHtml(item.reagent_name)}</div>
                        <div class="dashboard-warning-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
                    </div>
                    <span class="inventory-status inventory-status-${item.status_level} dashboard-warning-status">${this.getStatusLabel(item.status_level)}</span>
                </div>
                <div class="dashboard-warning-foot">
                    <span class="dashboard-warning-stock">库存 ${item.total_min_quantity}${this.escapeHtml(item.min_unit)}</span>
                    <div class="dashboard-warning-metrics">
                        <span>${item.nearest_expiry_date ? `最近效期 ${this.escapeHtml(item.nearest_expiry_date)}` : '最近效期 -'}</span>
                        <span>${this.escapeHtml(this.formatDaysLabel(item.nearest_expiry_days))}</span>
                    </div>
                </div>
            </article>
        `).join('');
    },

    renderRecentOutbounds() {
        const container = document.getElementById('dashboard-recent-outbounds');
        const rows = this.overview?.recent_outbounds || [];
        if (!container) {
            return;
        }
        if (!rows.length) {
            container.innerHTML = '<div class="inventory-empty">\u6700\u8fd1\u6682\u65e0\u51fa\u5e93\u8bb0\u5f55\u3002</div>';
            return;
        }

        container.innerHTML = rows.map((item) => `
            <article class="dashboard-recent-item">
                <div class="dashboard-recent-head">
                    <strong>${this.escapeHtml(item.reagent_name)}</strong>
                    <span>${this.escapeHtml(Utils.formatDateTime(item.created_at))}</span>
                </div>
                <div class="dashboard-recent-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
                <div class="dashboard-recent-foot">
                    <div class="dashboard-recent-meta">\u6279\u53f7 ${this.escapeHtml(item.batch_no || '-')} \u00b7 ${item.quantity_min}${this.escapeHtml(item.min_unit)} \u00b7 ${this.escapeHtml(item.operator)}</div>
                    <span class="dashboard-recent-source">${this.getSourceLabel(item.source)}</span>
                </div>
            </article>
        `).join('');
    },

    handleCardKeydown(event, callback) {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.preventDefault();
        callback();
    },

    openInventory() {
        app.navigate('inventory', {
            status: 'all',
            onlyWarnings: true,
            sort: 'severity'
        });
    },

    openInventoryForPending(status) {
        app.navigate('inventory', {
            status,
            onlyWarnings: status !== 'empty',
            sort: 'severity',
            focusFirstMatch: true
        });
    },

    openInventoryForReagent(reagentId) {
        app.navigate('inventory', {
            reagentId,
            focusReagentId: reagentId,
            sort: 'severity'
        });
    }
};
