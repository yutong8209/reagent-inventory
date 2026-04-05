// API client

const API_BASE = '/api';

const API = {
    // Helper for fetch requests
    async request(url, options = {}) {
        const response = await fetch(`${API_BASE}${url}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        return response.json();
    },

    // Barcode
    barcode: {
        parse(barcode) {
            return API.request('/barcode/parse', {
                method: 'POST',
                body: JSON.stringify({ barcode })
            });
        }
    },

    // Reagents
    reagents: {
        create(data) {
            return API.request('/reagents', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        get(id) {
            return API.request(`/reagents/${id}`);
        },
        list(params = {}) {
            const query = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                if (value !== null && value !== undefined && String(value).trim() !== '') {
                    query.set(key, value);
                }
            });
            const suffix = query.toString() ? `?${query.toString()}` : '';
            return API.request(`/reagents${suffix}`);
        },
        update(id, data) {
            return API.request(`/reagents/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        }
    },

    // Inbound
    inbound: {
        stockIn(data) {
            return API.request('/inbound', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        stockInBatch(data) {
            return API.request('/inbound/batch', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }
    },

    // Outbound
    outbound: {
        getStock(reagentId) {
            return API.request(`/stock/${reagentId}`);
        },
        searchReagents(params = {}) {
            const searchParams = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                if (value !== null && value !== undefined && value !== '') {
                    searchParams.set(key, value);
                }
            });
            const query = searchParams.toString();
            return API.request(`/outbound/reagents${query ? `?${query}` : ''}`);
        },
        preview(data) {
            return API.request('/outbound/preview', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        stockOutBatch(data) {
            return API.request('/outbound/batch', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        stockOut(data) {
            return API.request('/outbound', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }
    },

    // Inventory
    inventory: {
        get(instrumentId = null) {
            const params = instrumentId ? `?instrument_id=${instrumentId}` : '';
            return API.request(`/inventory${params}`);
        },
        async exportExcel(params = {}) {
            const query = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
                if (value !== null && value !== undefined && String(value).trim() !== '') {
                    query.set(key, value);
                }
            });

            const suffix = query.toString() ? `?${query.toString()}` : '';
            const response = await fetch(`${API_BASE}/inventory/export${suffix}`);
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || `HTTP ${response.status}`);
            }

            const blob = await response.blob();
            const contentDisposition = response.headers.get('Content-Disposition') || '';
            const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
            const filename = match ? decodeURIComponent(match[1]) : '库存导出.xlsx';
            return { blob, filename };
        },
        getWorkGroups() {
            return API.request('/work-groups');
        },
        getWorkGroupCatalog() {
            return API.request('/catalog/work-groups');
        },
        createWorkGroup(data) {
            return API.request('/work-groups', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        updateWorkGroup(id, data) {
            return API.request(`/work-groups/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },
        getInstruments(workGroupId = null) {
            const params = workGroupId ? `?work_group_id=${workGroupId}` : '';
            return API.request(`/instruments${params}`);
        },
        createInstrument(data) {
            return API.request('/instruments', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        updateInstrument(id, data) {
            return API.request(`/instruments/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },
        updateInstrumentWarningDefaults(id, data) {
            return API.request(`/instruments/${id}/warning-defaults`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },
        batchUpdateInstrumentWarnings(id, data) {
            return API.request(`/instruments/${id}/warning-batch-update`, {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        applyInstrumentWarningDefaults(id) {
            return API.request(`/instruments/${id}/warning-defaults/apply`, {
                method: 'POST'
            });
        },
        updateReagentWarningSettings(id, data) {
            return API.request(`/reagents/${id}/warning-settings`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },
        archiveReagent(id) {
            return API.request(`/reagents/${id}/archive`, {
                method: 'POST'
            });
        },
        archiveZeroStockReagents() {
            return API.request('/reagents/archive-zero-stock', {
                method: 'POST'
            });
        },
        resetReagentData() {
            return API.request('/admin/reset-reagent-data', {
                method: 'POST'
            });
        }
    },

    operators: {
        list() {
            return API.request('/operators');
        },
        create(data) {
            return API.request('/operators', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        update(id, data) {
            return API.request(`/operators/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        }
    }
};
