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
