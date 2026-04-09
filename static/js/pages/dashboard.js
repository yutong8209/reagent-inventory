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
        const target = `${targetOrigin}/m`;
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
            container.innerHTML = '<div class="inventory-empty">暂无首页数据。</div>';
            return;
        }

        const cards = [
            { label: '已过期批次', value: pending.expired_batch_count, type: 'danger', status: 'expired' },
            { label: '近效期试剂', value: pending.expiring_reagent_count, type: 'warning', status: 'expiring' },
            { label: '低库存/零库存', value: pending.low_or_empty_reagent_count, type: 'warning', status: 'low_or_empty' },
            { label: '零库存未归档', value: pending.zero_stock_unarchived_count, type: 'danger', status: 'empty' }
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
                    <div>
                        <div class="dashboard-warning-title">${this.escapeHtml(item.reagent_name)}</div>
                        <div class="dashboard-warning-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
                    </div>
                    <span class="inventory-status inventory-status-${item.status_level}">${this.getStatusLabel(item.status_level)}</span>
                </div>
                <div class="dashboard-warning-metrics">
                    <span>库存 ${item.total_min_quantity}${this.escapeHtml(item.min_unit)}</span>
                    <span>${item.nearest_expiry_date ? `最近效期 ${this.escapeHtml(item.nearest_expiry_date)}` : '最近效期 -'}</span>
                    <span>${this.escapeHtml(this.formatDaysLabel(item.nearest_expiry_days))}</span>
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
            container.innerHTML = '<div class="inventory-empty">最近暂无出库记录。</div>';
            return;
        }

        container.innerHTML = rows.map((item) => `
            <article class="dashboard-recent-item">
                <div class="dashboard-recent-head">
                    <strong>${this.escapeHtml(item.reagent_name)}</strong>
                    <span>${this.escapeHtml(Utils.formatDateTime(item.created_at))}</span>
                </div>
                <div class="dashboard-recent-meta">${this.escapeHtml(item.work_group_name)} / ${this.escapeHtml(item.instrument_name)}</div>
                <div class="dashboard-recent-meta">批号 ${this.escapeHtml(item.batch_no || '-')} · ${item.quantity_min}${this.escapeHtml(item.min_unit)} · ${this.escapeHtml(item.operator)}</div>
                <div class="dashboard-recent-meta">来源 ${this.escapeHtml(item.source || '-')}</div>
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
