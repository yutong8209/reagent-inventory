// Main application - router and navigation only

const app = {
    currentPage: 'dashboard',

    init() {
        this.bindNavigation();
        Utils.loadUnitOptions();
        this.loadPage('dashboard');
    },

    bindNavigation() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigate(page);
            });
        });
    },

    navigate(page) {
        this.currentPage = page;
        this.loadPage(page);

        // Update nav active state
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });
    },

    loadPage(page) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
        });

        // Show target page
        const targetPage = document.getElementById(`page-${page}`);
        if (targetPage) {
            targetPage.classList.add('active');
        }

        // Initialize page-specific logic
        if (page === 'inbound' && typeof inboundPage !== 'undefined') {
            inboundPage.init();
        } else if (page === 'outbound' && typeof outboundPage !== 'undefined') {
            outboundPage.init();
        } else if (page === 'inventory' && typeof inventoryPage !== 'undefined') {
            inventoryPage.init();
        } else if (page === 'reports' && typeof reportsPage !== 'undefined') {
            reportsPage.init();
        } else if (page === 'catalog' && typeof catalogPage !== 'undefined') {
            catalogPage.init();
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
