// Dashboard State Management
const STATE = {
    sessionId: null,
    filename: '',
    sheets: [],
    columns: [], // Array of {sheet, column, label}
    suggestedMappings: {},
    previews: {}, // Dictionary of sheet previews
    
    // UI selections
    activeMappings: {
        vendor: null,
        accuracy: null,
        document_id: null,
        relationship_key_parent: null,
        relationship_key_child: null,
        column_name: null,
        matching_percentage: null,
        start_time: null,
        end_time: null
    },
    
    // Cleaned/Aggregated Data
    overviewStats: {},
    vendorAnalysis: { bins: {}, vendors: [] },
    columnAnalysis: [],
    timeAnalysis: {
        segments: [],
        has_time_data: false,
        has_duration_data: false,
        overall_duration_stats: null
    },
    
    // Filters & Sorting
    activeRangeFilters: ['0-20', '20-40', '40-60', '60-80', '80-100'],
    vendorSearchQuery: '',
    columnSearchQuery: '',
    vendorSort: { field: 'avg_accuracy', direction: 'desc' },
    columnSort: { field: 'avg_matching', direction: 'desc' },
    timeSegmentCount: 8,
    timeReferenceCol: 'start_time',
    
    // Collapsible states
    previewCollapsed: false
};

// ECharts Instance
let vendorChartInstance = null;
let timeVolumeChartInstance = null;
let timeAccuracyChartInstance = null;

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    
    // Bind Popstate to navigate client pages safely when Back/Forward is clicked
    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.pageId) {
            showPage(event.state.pageId, false);
        } else {
            // Default fallback
            resolveRouteFromPath(false);
        }
    });

    resolveRouteFromPath(true);
});

// Resolve the initial view route based on path name (safe against stale paths or reloads)
async function resolveRouteFromPath(isInitial = true) {
    const path = window.location.pathname;
    const savedSessionId = sessionStorage.getItem('session_id');

    if (!savedSessionId) {
        // No session, always default to upload view path
        if (path !== '/') {
            history.replaceState({ pageId: 'page-upload' }, '', '/');
        }
        showPage('page-upload', false);
        return;
    }

    // Validate if session is still alive on backend
    try {
        const res = await fetch(`/api/check-session?session_id=${savedSessionId}`);
        const data = await res.json();
        if (data.active) {
            STATE.sessionId = savedSessionId;
            STATE.filename = data.filename;
            showFileIndicator(data.filename);

            if (data.has_mappings) {
                // If dashboard path was requested, show dashboard.
                if (path === '/dashboard') {
                    showPage('page-dashboard', false);
                    await loadDashboard();
                } else if (path === '/mapping') {
                    // Navigate to mapping
                    showPage('page-mapping', false);
                    // To render previews we need to fetch previews, but since it is SPA shell,
                    // we default back to dashboard or restart mappings. Redirect to dashboard for safety
                    history.replaceState({ pageId: 'page-dashboard' }, '', '/dashboard');
                    showPage('page-dashboard', false);
                    await loadDashboard();
                } else {
                    // Default to dashboard if we have a valid session with mappings
                    history.replaceState({ pageId: 'page-dashboard' }, '', '/dashboard');
                    showPage('page-dashboard', false);
                    await loadDashboard();
                }
            } else {
                // Mappings not yet complete/confirmed
                if (path === '/mapping') {
                    // If no mappings confirmed but active session, we need previews. Reset session to reload safely.
                    resetSession();
                } else {
                    resetSession();
                }
            }
        } else {
            resetSession();
        }
    } catch (e) {
        resetSession();
    }
}




// Reset Session
function resetSession() {
    sessionStorage.removeItem('session_id');
    STATE.sessionId = null;
    STATE.filename = '';
    STATE.sheets = [];
    STATE.columns = [];
    STATE.suggestedMappings = {};
    STATE.previews = {};
    hideFileIndicator();
    showPage('page-upload');
    // Reset file input so same file can be re-selected
    const fi = document.getElementById('file-input');
    if (fi) fi.value = '';
}

// Show active file indicator in global header
function showFileIndicator(filename) {
    const indicator = document.getElementById('active-file-indicator');
    const filenameEl = document.getElementById('active-filename');
    if (indicator && filenameEl) {
        filenameEl.textContent = filename;
        indicator.classList.remove('hidden');
    }
}

function hideFileIndicator() {
    const indicator = document.getElementById('active-file-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
    }
}

// Show specific page view in SPA layout with History state updates
function showPage(pageId, pushToHistory = true) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
    });
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }

    if (pushToHistory) {
        let routePath = '/';
        if (pageId === 'page-mapping') routePath = '/mapping';
        else if (pageId === 'page-dashboard') routePath = '/dashboard';
        
        // Push state safely so browser back/forward tracks client page states without reloading files
        if (window.location.pathname !== routePath) {
            history.pushState({ pageId }, '', routePath);
        }
    }
}

// Toast helper
function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }
}

// Set up UI Event Listeners
function initEventListeners() {
    // File upload elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const resetBtn = document.getElementById('btn-reset-upload');
    
    if (dropZone && fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetSession();
        });
    }

    // Mapping confirm
    const confirmMappingBtn = document.getElementById('btn-confirm-mapping');
    if (confirmMappingBtn) {
        confirmMappingBtn.addEventListener('click', () => {
            submitMappings();
        });
    }

    // Preview Collapsible Header
    const previewHeader = document.getElementById('preview-header');
    const previewCard = document.querySelector('.preview-card');
    if (previewHeader && previewCard) {
        previewHeader.addEventListener('click', () => {
            STATE.previewCollapsed = !STATE.previewCollapsed;
            if (STATE.previewCollapsed) {
                previewCard.classList.add('collapsed');
            } else {
                previewCard.classList.remove('collapsed');
            }
        });
    }

    // Dashboard Sub-navigation Tabs
    document.querySelectorAll('.dash-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.dash-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            const targetContent = document.getElementById(tabId);
            if (targetContent) {
                targetContent.classList.remove('hidden');
            }
            
            // Resize ECharts bar chart if switching back to Vendor Analysis
            if (tabId === 'tab-vendor' && vendorChartInstance) {
                vendorChartInstance.resize();
            }
            if (tabId === 'tab-time') {
                if (timeVolumeChartInstance) timeVolumeChartInstance.resize();
                if (timeAccuracyChartInstance) timeAccuracyChartInstance.resize();
            }
        });
    });

    // Checkbox Range Filter Toggles directly below chart
    document.querySelectorAll('.range-filter').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateActiveFilters();
        });
    });

    // Search input filters
    const vendorSearch = document.getElementById('vendor-search');
    if (vendorSearch) {
        vendorSearch.addEventListener('input', (e) => {
            STATE.vendorSearchQuery = e.target.value.toLowerCase().trim();
            filterAndRenderVendors();
        });
    }

    const columnSearch = document.getElementById('column-search');
    if (columnSearch) {
        columnSearch.addEventListener('input', (e) => {
            STATE.columnSearchQuery = e.target.value.toLowerCase().trim();
            filterAndRenderColumns();
        });
    }

    // Sorting event listeners for Vendor Table
    document.querySelectorAll('#table-vendors th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.getAttribute('data-sort');
            if (STATE.vendorSort.field === field) {
                STATE.vendorSort.direction = STATE.vendorSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                STATE.vendorSort.field = field;
                STATE.vendorSort.direction = 'desc'; // default sort descending
            }
            filterAndRenderVendors();
        });
    });

    // Sorting event listeners for Column Table
    document.querySelectorAll('#table-columns th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.getAttribute('data-sort');
            if (STATE.columnSort.field === field) {
                STATE.columnSort.direction = STATE.columnSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                STATE.columnSort.field = field;
                STATE.columnSort.direction = 'desc'; // default sort descending
            }
            filterAndRenderColumns();
        });
    });

    // Side panel drill-down controls
    const panelCloseBtn = document.getElementById('panel-close-btn');
    const panelBackdrop = document.getElementById('panel-backdrop');
    if (panelCloseBtn) panelCloseBtn.addEventListener('click', closeSidePanel);
    if (panelBackdrop) panelBackdrop.addEventListener('click', closeSidePanel);

    // Dynamic resize of ECharts
    window.addEventListener('resize', () => {
        if (vendorChartInstance) {
            vendorChartInstance.resize();
        }
        if (timeVolumeChartInstance) {
            timeVolumeChartInstance.resize();
        }
        if (timeAccuracyChartInstance) {
            timeAccuracyChartInstance.resize();
        }
    });

    // Time segment count selector listener
    const timeSegmentCountSelect = document.getElementById('time-segment-count');
    if (timeSegmentCountSelect) {
        timeSegmentCountSelect.addEventListener('change', async (e) => {
            STATE.timeSegmentCount = parseInt(e.target.value, 10);
            await loadTimeAnalysis();
        });
    }

    // Time reference column selector listener
    const timeReferenceColSelect = document.getElementById('time-reference-col');
    if (timeReferenceColSelect) {
        timeReferenceColSelect.addEventListener('change', async (e) => {
            STATE.timeReferenceCol = e.target.value;
            await loadTimeAnalysis();
        });
    }

    // Time segment drill-down side panel controls
    const timePanelCloseBtn = document.getElementById('time-panel-close-btn');
    const timePanelBackdrop = document.getElementById('time-panel-backdrop');
    if (timePanelCloseBtn) timePanelCloseBtn.addEventListener('click', closeTimeSidePanel);
    if (timePanelBackdrop) timePanelBackdrop.addEventListener('click', closeTimeSidePanel);

    // Empty state go-to-mapping redirect
    const btnGoToMapping = document.getElementById('btn-go-to-mapping');
    if (btnGoToMapping) {
        btnGoToMapping.addEventListener('click', () => {
            showPage('page-mapping');
        });
    }
}

// Upload file to Backend with Progress bar
function handleFileUpload(file) {
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressStatus = document.getElementById('upload-status');

    if (progressContainer && progressBar && progressStatus) {
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressStatus.textContent = 'Uploading dataset file...';
    }

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    // Animate upload progress
    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            // Upload is 0-70% of the overall bar
            const pct = Math.round((e.loaded / e.total) * 70);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressStatus) progressStatus.textContent = `Uploading... ${Math.round((e.loaded / e.total) * 100)}%`;
        }
    };

    xhr.upload.onloadend = () => {
        // Upload done — now animate 70→90% while server parses
        if (progressBar) progressBar.style.width = '75%';
        if (progressStatus) progressStatus.textContent = 'Parsing worksheets on server...';
        let pseudo = 75;
        const parseInterval = setInterval(() => {
            pseudo = Math.min(pseudo + 2, 92);
            if (progressBar) progressBar.style.width = `${pseudo}%`;
        }, 400);
        xhr._parseInterval = parseInterval;
    };

    xhr.onload = () => {
        clearInterval(xhr._parseInterval);
        if (progressBar) progressBar.style.width = '100%';

        if (xhr.status === 200) {
            if (progressStatus) progressStatus.textContent = 'Processing complete!';
            try {
                const response = JSON.parse(xhr.responseText);
                STATE.sessionId = response.session_id;
                STATE.filename = response.filename;
                STATE.sheets = response.sheets;
                STATE.columns = response.columns;
                STATE.suggestedMappings = response.suggested_mappings;
                STATE.previews = response.previews;

                sessionStorage.setItem('session_id', response.session_id);
                showFileIndicator(response.filename);
                showToast(`Loaded ${response.sheets.length} sheet(s) successfully!`);

                // Short delay so user sees 100%
                setTimeout(() => {
                    showPage('page-mapping');
                    renderMappingDropdowns();
                    renderSheetPreviews();
                }, 400);
            } catch (err) {
                showToast('Failed to parse server response.');
                resetSession();
            }
        } else {
            let errMsg = 'Failed to upload or parse file.';
            try {
                const errRes = JSON.parse(xhr.responseText);
                errMsg = errRes.error || errMsg;
            } catch(e) {}
            showToast(errMsg);
            if (progressStatus) progressStatus.textContent = `Error: ${errMsg}`;
            resetSession();
        }
    };

    xhr.onerror = () => {
        clearInterval(xhr._parseInterval);
        showToast('Network error during file upload.');
        resetSession();
    };

    xhr.send(formData);
}

// Populate Dropdowns in Column Mapping Page (Page 2)
function renderMappingDropdowns() {
    const fields = [
        { id: 'map-vendor', key: 'vendor', required: true },
        { id: 'map-accuracy', key: 'accuracy', required: true },
        { id: 'map-document-id', key: 'document_id', required: true },
        { id: 'map-rel-parent', key: 'relationship_key_parent', required: false },
        { id: 'map-rel-child', key: 'relationship_key_child', required: false },
        { id: 'map-column-name', key: 'column_name', required: false },
        { id: 'map-match-percent', key: 'matching_percentage', required: false },
        { id: 'map-start-time', key: 'start_time', required: false },
        { id: 'map-end-time', key: 'end_time', required: false }
    ];
    
    fields.forEach(f => {
        const select = document.getElementById(f.id);
        if (!select) return;
        
        select.innerHTML = '';
        
        // Add empty default choice if optional
        if (!f.required) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- Not Applicable / Ignore --';
            select.appendChild(opt);
        } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- Select Column --';
            select.appendChild(opt);
        }
        
        // Add all columns from all sheets
        STATE.columns.forEach(col => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ sheet: col.sheet, column: col.column });
            opt.textContent = col.label;
            select.appendChild(opt);
        });
        
        // Try to pre-select matching detected column
        const suggested = STATE.suggestedMappings[f.key];
        if (suggested) {
            const valStr = JSON.stringify({ sheet: suggested.sheet, column: suggested.column });
            // check if choice exists in options
            let found = false;
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === valStr) {
                    select.selectedIndex = i;
                    found = true;
                    break;
                }
            }
        }
    });
}

// Render dynamic previews of worksheets
function renderSheetPreviews() {
    const tabsContainer = document.getElementById('preview-tabs');
    const tableContainer = document.getElementById('preview-table-container');
    if (!tabsContainer || !tableContainer) return;
    
    tabsContainer.innerHTML = '';
    tableContainer.innerHTML = '';
    
    if (STATE.sheets.length === 0) return;
    
    STATE.sheets.forEach((sheet, idx) => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${idx === 0 ? 'active' : ''}`;
        btn.textContent = sheet;
        btn.addEventListener('click', () => {
            tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderPreviewTable(sheet);
        });
        tabsContainer.appendChild(btn);
    });
    
    // Show first sheet by default
    renderPreviewTable(STATE.sheets[0]);
}

function renderPreviewTable(sheetName) {
    const tableContainer = document.getElementById('preview-table-container');
    if (!tableContainer) return;
    
    const rows = STATE.previews[sheetName] || [];
    if (rows.length === 0) {
        tableContainer.innerHTML = '<p class="group-desc">No preview rows available for this sheet.</p>';
        return;
    }
    
    const cols = Object.keys(rows[0]);
    let html = `<table class="data-table"><thead><tr>`;
    cols.forEach(c => {
        html += `<th>${c}</th>`;
    });
    html += `</tr></thead><tbody>`;
    rows.forEach(r => {
        html += `<tr>`;
        cols.forEach(c => {
            const val = r[c];
            html += `<td>${val !== null && val !== undefined ? val : ''}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    tableContainer.innerHTML = html;
}

// POST mappings override to server
async function submitMappings() {
    const mappingPayload = {};
    const fields = [
        { key: 'vendor', id: 'map-vendor', required: true },
        { key: 'accuracy', id: 'map-accuracy', required: true },
        { key: 'document_id', id: 'map-document-id', required: true },
        { key: 'relationship_key_parent', id: 'map-rel-parent', required: false },
        { key: 'relationship_key_child', id: 'map-rel-child', required: false },
        { key: 'column_name', id: 'map-column-name', required: false },
        { key: 'matching_percentage', id: 'map-match-percent', required: false },
        { key: 'start_time', id: 'map-start-time', required: false },
        { key: 'end_time', id: 'map-end-time', required: false }
    ];
    
    let valid = true;
    fields.forEach(f => {
        const select = document.getElementById(f.id);
        const val = select.value;
        
        if (f.required && !val) {
            valid = false;
            select.style.borderColor = 'var(--danger)';
        } else {
            select.style.borderColor = 'var(--border-color)';
        }
        
        if (val) {
            mappingPayload[f.key] = JSON.parse(val);
        } else {
            mappingPayload[f.key] = null;
        }
    });
    
    if (!valid) {
        showToast('Please specify all required columns.');
        return;
    }

    try {
        const btn = document.getElementById('btn-confirm-mapping');
        btn.textContent = 'Cleaning & processing...';
        btn.disabled = true;
        
        const res = await fetch('/api/confirm-mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: STATE.sessionId,
                mappings: mappingPayload
            })
        });
        
        const response = await res.json();
        btn.textContent = 'Analyze & Load Dashboard';
        btn.disabled = false;
        
        if (res.status === 200 && response.status === 'success') {
            showToast('Dataset ready!');
            showPage('page-dashboard');
            await loadDashboard();
        } else {
            showToast(response.error || 'Failed to process mappings.');
        }
    } catch(err) {
        showToast('Network error while processing mapping.');
        console.error(err);
    }
}

// Load dynamic data for Dashboard views
async function loadDashboard() {
    try {
        // Fetch Overview stats
        const overviewRes = await fetch(`/api/overview?session_id=${STATE.sessionId}`);
        STATE.overviewStats = await overviewRes.json();
        renderOverview(STATE.overviewStats);
        
        // Fetch Vendor analysis
        const vendorRes = await fetch(`/api/vendor-analysis?session_id=${STATE.sessionId}`);
        STATE.vendorAnalysis = await vendorRes.json();
        renderVendorChart(STATE.vendorAnalysis);
        filterAndRenderVendors();
        
        // Fetch Column analysis
        const columnRes = await fetch(`/api/column-analysis?session_id=${STATE.sessionId}`);
        STATE.columnAnalysis = await columnRes.json();
        filterAndRenderColumns();
        
        // Fetch Time analysis
        await loadTimeAnalysis();
        
    } catch (err) {
        showToast('Error loading dashboard metrics.');
        console.error(err);
    }
}

// Populate stats cards
function renderOverview(stats) {
    document.getElementById('stat-total').textContent = stats.total_records.toLocaleString() || '0';
    document.getElementById('stat-avg').textContent = stats.avg_accuracy !== null ? `${stats.avg_accuracy}%` : '-';
    document.getElementById('stat-min').textContent = stats.min_accuracy !== null ? `${stats.min_accuracy}%` : '-';
    document.getElementById('stat-max').textContent = stats.max_accuracy !== null ? `${stats.max_accuracy}%` : '-';
}

// Render ECharts Bar Chart
function renderVendorChart(data) {
    const chartDom = document.getElementById('vendor-chart');
    if (!chartDom) return;
    
    if (!vendorChartInstance) {
        vendorChartInstance = echarts.init(chartDom);
    }
    
    const bins = ['0-20', '20-40', '40-60', '60-80', '80-100'];
    const counts = bins.map(b => data.bins[b] || 0);
    
    const option = {
        grid: {
            top: 20,
            bottom: 30,
            left: 50,
            right: 20
        },
        tooltip: {
            trigger: 'axis',
            formatter: '{b} Accuracy: {c} Vendors',
            backgroundColor: '#0f172a',
            textStyle: {
                color: '#ffffff',
                fontFamily: 'Inter',
                fontSize: 11
            }
        },
        xAxis: {
            type: 'category',
            data: bins,
            axisLabel: {
                color: '#475569',
                fontFamily: 'Inter',
                fontSize: 11
            },
            axisLine: {
                lineStyle: {
                    color: '#e2e8f0'
                }
            }
        },
        yAxis: {
            type: 'value',
            minInterval: 1,
            name: 'Vendors Count',
            nameTextStyle: {
                color: '#64748b',
                fontFamily: 'Inter',
                fontSize: 10
            },
            axisLabel: {
                color: '#475569',
                fontFamily: 'Inter',
                fontSize: 11
            },
            splitLine: {
                lineStyle: {
                    color: '#f1f5f9'
                }
            }
        },
        series: [{
            data: counts,
            type: 'bar',
            barWidth: '40%',
            itemStyle: {
                color: '#0284c7', // Sky 600
                borderRadius: [3, 3, 0, 0]
            },
            emphasis: {
                itemStyle: {
                    color: '#0369a1'
                }
            }
        }]
    };
    
    vendorChartInstance.setOption(option);
}

// Update range filter lists based on checkboxes
function updateActiveFilters() {
    const checked = [];
    document.querySelectorAll('.range-filter').forEach(cb => {
        if (cb.checked) {
            checked.push(cb.value);
        }
    });
    STATE.activeRangeFilters = checked;
    filterAndRenderVendors();
}

// Filters & Sorts the vendor list, then draws the HTML table rows
function filterAndRenderVendors() {
    const tableBody = document.querySelector('#table-vendors tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    let filtered = STATE.vendorAnalysis.vendors.filter(v => {
        // 1. Accuracy Range Checkbox filter
        const inRange = STATE.activeRangeFilters.includes(v.bin);
        // 2. Search Text filter
        const matchesSearch = v.name.toLowerCase().includes(STATE.vendorSearchQuery);
        return inRange && matchesSearch;
    });
    
    // Sort
    const sortField = STATE.vendorSort.field;
    const sortDir = STATE.vendorSort.direction === 'asc' ? 1 : -1;
    
    filtered.sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];
        
        if (typeof valA === 'string') {
            return valA.localeCompare(valB) * sortDir;
        } else {
            return (valA - valB) * sortDir;
        }
    });
    
    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: var(--text-light); padding: 24px;">No vendors match the active filters.</td></tr>`;
        return;
    }
    
    filtered.forEach(v => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${v.name}</strong></td>
            <td class="text-right font-medium">${v.avg_accuracy}%</td>
            <td class="text-right" style="color: var(--text-muted);">${v.doc_count.toLocaleString()}</td>
            <td class="text-center">
                <button class="btn btn-secondary btn-sm btn-view-details" data-vendor="${encodeURIComponent(v.name)}">View Details</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
    
    // Rebind action buttons
    tableBody.querySelectorAll('.btn-view-details').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const vName = decodeURIComponent(btn.getAttribute('data-vendor'));
            showVendorDetails(vName);
        });
    });
}

// Filters & Sorts columns list, then draws the grouped collapsible cards
function filterAndRenderColumns() {
    const container = document.getElementById('columns-grouped-container');
    if (!container) return;

    container.innerHTML = '';

    // Apply search query filter
    const query = STATE.columnSearchQuery.trim().toLowerCase();
    const filtered = STATE.columnAnalysis.filter(c => {
        return c.name.toLowerCase().includes(query);
    });

    const ranges = [
        { label: '80-100', min: 80, max: 100, color: 'var(--success)' },
        { label: '60-80', min: 60, max: 80, color: 'var(--primary)' },
        { label: '40-60', min: 40, max: 60, color: 'var(--warning)' },
        { label: '20-40', min: 20, max: 40, color: '#f97316' },
        { label: '0-20', min: 0, max: 20, color: 'var(--danger)' }
    ];

    ranges.forEach(range => {
        const bucketCols = filtered.filter(c => {
            const val = c.avg_matching;
            // Handle edge case logic exactly like vendor binning
            if (range.label === '80-100') {
                return val > 80 && val <= 100;
            }
            return val > range.min && val <= range.max;
        });

        // Sort columns in the bucket by avg_matching desc, then name asc
        bucketCols.sort((a, b) => b.avg_matching - a.avg_matching || a.name.localeCompare(b.name));

        const bucketCard = document.createElement('div');
        bucketCard.className = 'card';
        bucketCard.style.marginBottom = '0';
        bucketCard.style.border = '1px solid var(--border-light)';

        const header = document.createElement('div');
        header.className = 'card-header';
        header.style.padding = '12px 16px';
        header.style.display = 'flex';
        header.style.justifyContent = 'between';
        header.style.alignItems = 'center';
        header.style.cursor = 'pointer';
        header.style.backgroundColor = 'var(--card-bg-subtle)';
        header.style.userSelect = 'none';

        header.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="chevron" style="display: inline-block; transition: transform 0.2s; transform: rotate(90deg); font-size: 12px; color: var(--text-light);">▶</span>
                <span class="badge-accuracy" style="background-color: ${range.color}15; color: ${range.color}; border: 1px solid ${range.color}30;">
                    ${range.label}% Accuracy
                </span>
                <span style="font-size: 12.5px; color: var(--text-muted); font-weight: 500;">
                    (${bucketCols.length} ${bucketCols.length === 1 ? 'column' : 'columns'})
                </span>
            </div>
        `;

        const body = document.createElement('div');
        body.className = 'bucket-body';
        body.style.borderTop = '1px solid var(--border-light)';
        body.style.backgroundColor = 'var(--card-bg)';
        body.style.transition = 'max-height 0.2s ease-out';
        body.style.overflow = 'hidden';

        if (bucketCols.length === 0) {
            body.innerHTML = `<div style="padding: 16px; font-size: 13px; color: var(--text-light); text-align: center; font-style: italic;">No columns in this range.</div>`;
        } else {
            const table = document.createElement('table');
            table.className = 'data-table';
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';

            table.innerHTML = `
                <thead>
                    <tr>
                        <th style="padding: 8px 16px; text-align: left;">Column Name</th>
                        <th style="padding: 8px 16px; text-align: right; width: 150px;">Avg Accuracy</th>
                        <th style="padding: 8px 16px; text-align: right; width: 120px;">Failure Rate</th>
                        <th style="padding: 8px 16px; text-align: right; width: 120px;">Missing Rate</th>
                    </tr>
                </thead>
                <tbody>
                </tbody>
            `;

            const tbody = table.querySelector('tbody');
            bucketCols.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 10px 16px;"><strong>${c.name}</strong></td>
                    <td style="padding: 10px 16px; text-align: right;" class="font-medium">${c.avg_matching}%</td>
                    <td style="padding: 10px 16px; text-align: right; color: ${c.failure_percent > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${c.failure_percent}%</td>
                    <td style="padding: 10px 16px; text-align: right; color: ${c.missing_percent > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${c.missing_percent}%</td>
                `;
                tbody.appendChild(tr);
            });
            body.appendChild(table);
        }

        bucketCard.appendChild(header);
        bucketCard.appendChild(body);
        container.appendChild(bucketCard);

        // Click handler to toggle collapse
        header.addEventListener('click', () => {
            const chev = header.querySelector('.chevron');
            if (body.style.display === 'none') {
                body.style.display = 'block';
                chev.style.transform = 'rotate(90deg)';
            } else {
                body.style.display = 'none';
                chev.style.transform = 'rotate(0deg)';
            }
        });
    });
}

// Side Panel Drill-Down
async function showVendorDetails(vendorName) {
    const panel = document.getElementById('side-panel');
    if (!panel) return;
    
    // Clear old values and show panel
    document.getElementById('panel-vendor-name').textContent = vendorName;
    document.getElementById('panel-doc-count').textContent = '-';
    document.getElementById('panel-avg-acc').textContent = '-';
    document.getElementById('panel-min-acc').textContent = '-';
    document.getElementById('panel-max-acc').textContent = '-';
    
    const handledBody = document.querySelector('#panel-table-handled tbody');
    const errorsBody = document.querySelector('#panel-table-errors tbody');
    handledBody.innerHTML = `<tr><td colspan="4" class="text-center">Loading...</td></tr>`;
    errorsBody.innerHTML = `<tr><td colspan="4" class="text-center">Loading...</td></tr>`;
    
    panel.classList.remove('hidden');
    
    try {
        const res = await fetch(`/api/vendor-detail/${encodeURIComponent(vendorName)}?session_id=${STATE.sessionId}`);
        if (res.status === 200) {
            const detail = await res.json();
            
            // Populate overview
            document.getElementById('panel-doc-count').textContent = detail.doc_count.toLocaleString();
            document.getElementById('panel-avg-acc').textContent = `${detail.avg_accuracy}%`;
            document.getElementById('panel-min-acc').textContent = `${detail.min_accuracy}%`;
            document.getElementById('panel-max-acc').textContent = `${detail.max_accuracy}%`;
            
            // Populate Handled table
            handledBody.innerHTML = '';
            if (detail.columns_handled.length === 0) {
                handledBody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: var(--text-light);">No column analytics available. (Check join configuration)</td></tr>`;
            } else {
                detail.columns_handled.forEach(c => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${c.name}</strong></td>
                        <td class="text-right">${c.total_checks.toLocaleString()}</td>
                        <td class="text-right font-medium">${c.avg_matching}%</td>
                        <td class="text-right" style="color: ${c.failure_count > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${c.failure_percent}%</td>
                    `;
                    handledBody.appendChild(tr);
                });
            }
            
            // Populate Error table
            errorsBody.innerHTML = '';
            if (detail.columns_with_errors.length === 0) {
                errorsBody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: var(--success); font-weight: 500; padding: 10px 0;">🎉 No failures detected for this vendor!</td></tr>`;
            } else {
                detail.columns_with_errors.forEach(c => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${c.name}</strong></td>
                        <td class="text-right font-medium">${c.avg_matching}%</td>
                        <td class="text-right font-medium">${c.failure_count.toLocaleString()}</td>
                        <td class="text-right" style="color: var(--danger)">${c.failure_percent}%</td>
                    `;
                    errorsBody.appendChild(tr);
                });
            }
            
        } else {
            showToast('Failed to load vendor details.');
            closeSidePanel();
        }
    } catch(err) {
        showToast('Error loading vendor details.');
        console.error(err);
        closeSidePanel();
    }
}

function closeSidePanel() {
    const panel = document.getElementById('side-panel');
    if (panel) {
        panel.classList.add('hidden');
    }
}

// Fetch Time Analysis
async function loadTimeAnalysis() {
    try {
        const res = await fetch(`/api/time-analysis?session_id=${STATE.sessionId}&segments=${STATE.timeSegmentCount}&reference_column=${STATE.timeReferenceCol}`);
        STATE.timeAnalysis = await res.json();
        renderTimeAnalysis();
    } catch (err) {
        showToast('Error loading time analysis metrics.');
        console.error(err);
    }
}

// Render Time Analysis Content
function renderTimeAnalysis() {
    const emptyContainer = document.getElementById('time-analysis-empty');
    const contentContainer = document.getElementById('time-analysis-content');
    
    if (!STATE.timeAnalysis.has_time_data) {
        emptyContainer.style.display = 'block';
        contentContainer.style.display = 'none';
        return;
    }
    
    emptyContainer.style.display = 'none';
    contentContainer.style.display = 'block';
    
    const data = STATE.timeAnalysis;
    
    // 1. Render charts
    renderTimeVolumeChart(data.segments);
    renderTimeAccuracyChart(data.segments);
    
    // 2. Render Overall Duration Stats Card
    const durationCard = document.getElementById('time-duration-summary-card');
    const durationHeaders = document.querySelectorAll('.duration-header');
    
    if (data.has_duration_data && data.overall_duration_stats) {
        durationCard.style.display = 'block';
        durationHeaders.forEach(el => el.style.display = 'table-cell');
        
        document.getElementById('time-dur-avg').textContent = `${data.overall_duration_stats.avg.toLocaleString()}s`;
        document.getElementById('time-dur-median').textContent = `${data.overall_duration_stats.median.toLocaleString()}s`;
        document.getElementById('time-dur-min').textContent = `${data.overall_duration_stats.min.toLocaleString()}s`;
        document.getElementById('time-dur-max').textContent = `${data.overall_duration_stats.max.toLocaleString()}s`;
    } else {
        durationCard.style.display = 'none';
        durationHeaders.forEach(el => el.style.display = 'none');
    }
    
    // 3. Render Table
    const tableBody = document.querySelector('#table-time-segments tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    data.segments.forEach((seg, index) => {
        const tr = document.createElement('tr');
        
        let durationCellsHtml = '';
        if (data.has_duration_data) {
            const avgDur = seg.duration ? `${seg.duration.avg}s` : '-';
            const medianDur = seg.duration ? `${seg.duration.median}s` : '-';
            durationCellsHtml = `
                <td class="text-right">${avgDur}</td>
                <td class="text-right">${medianDur}</td>
            `;
        } else {
            durationCellsHtml = `
                <td class="text-right duration-header" style="display: none;">-</td>
                <td class="text-right duration-header" style="display: none;">-</td>
            `;
        }
        
        tr.innerHTML = `
            <td><strong>${seg.label}</strong></td>
            <td class="text-right">${seg.record_count.toLocaleString()}</td>
            <td class="text-right" style="color: var(--text-light);">${seg.percentage}%</td>
            <td class="text-right font-medium">${seg.avg_accuracy}%</td>
            ${durationCellsHtml}
            <td class="text-center">
                <button class="btn btn-secondary btn-sm btn-view-time-details" data-index="${index}">View Details</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
    
    // Re-hide duration cells if no duration data
    if (!data.has_duration_data) {
        tableBody.querySelectorAll('.duration-header').forEach(el => el.style.display = 'none');
    } else {
        tableBody.querySelectorAll('.duration-header').forEach(el => el.style.display = 'table-cell');
    }

    // Bind Details buttons
    tableBody.querySelectorAll('.btn-view-time-details').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(btn.getAttribute('data-index'), 10);
            showTimeSegmentDetails(index);
        });
    });
}

// Render Time Volume Chart (ECharts Bar Chart)
function renderTimeVolumeChart(segments) {
    const chartDom = document.getElementById('time-volume-chart');
    if (!chartDom) return;
    
    if (!timeVolumeChartInstance) {
        timeVolumeChartInstance = echarts.init(chartDom);
    }
    
    const labels = segments.map(s => s.label);
    const counts = segments.map(s => s.record_count);
    
    const option = {
        grid: { top: 25, bottom: 45, left: 50, right: 20 },
        tooltip: {
            trigger: 'axis',
            formatter: '{b}: <strong>{c}</strong> records',
            backgroundColor: '#0f172a',
            textStyle: { color: '#ffffff', fontFamily: 'Inter', fontSize: 11 }
        },
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: { color: '#475569', fontFamily: 'Inter', fontSize: 10, rotate: 20 },
            axisLine: { lineStyle: { color: '#e2e8f0' } }
        },
        yAxis: {
            type: 'value',
            minInterval: 1,
            name: 'Record Count',
            nameTextStyle: { color: '#64748b', fontFamily: 'Inter', fontSize: 10 },
            axisLabel: { color: '#475569', fontFamily: 'Inter', fontSize: 11 },
            splitLine: { lineStyle: { color: '#f1f5f9' } }
        },
        series: [{
            data: counts,
            type: 'bar',
            barWidth: '45%',
            itemStyle: {
                color: '#0284c7', // Sky 600
                borderRadius: [3, 3, 0, 0]
            },
            emphasis: {
                itemStyle: { color: '#0369a1' }
            }
        }]
    };
    
    timeVolumeChartInstance.setOption(option);
}

// Render Time Accuracy Chart (ECharts Line Chart)
function renderTimeAccuracyChart(segments) {
    const chartDom = document.getElementById('time-accuracy-chart');
    if (!chartDom) return;
    
    if (!timeAccuracyChartInstance) {
        timeAccuracyChartInstance = echarts.init(chartDom);
    }
    
    const labels = segments.map(s => s.label);
    const accuracy = segments.map(s => s.avg_accuracy);
    
    const option = {
        grid: { top: 25, bottom: 45, left: 50, right: 20 },
        tooltip: {
            trigger: 'axis',
            formatter: '{b}: <strong>{c}%</strong> Avg Accuracy',
            backgroundColor: '#0f172a',
            textStyle: { color: '#ffffff', fontFamily: 'Inter', fontSize: 11 }
        },
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: { color: '#475569', fontFamily: 'Inter', fontSize: 10, rotate: 20 },
            axisLine: { lineStyle: { color: '#e2e8f0' } }
        },
        yAxis: {
            type: 'value',
            max: 100,
            name: 'Accuracy %',
            nameTextStyle: { color: '#64748b', fontFamily: 'Inter', fontSize: 10 },
            axisLabel: { color: '#475569', fontFamily: 'Inter', fontSize: 11 },
            splitLine: { lineStyle: { color: '#f1f5f9' } }
        },
        series: [{
            data: accuracy,
            type: 'line',
            symbolSize: 8,
            lineStyle: {
                color: '#0d9488', // Teal 600
                width: 2.5
            },
            itemStyle: {
                color: '#0d9488'
            },
            emphasis: {
                itemStyle: { scale: true }
            }
        }]
    };
    
    timeAccuracyChartInstance.setOption(option);
}

// Show Time Segment Details Panel
function showTimeSegmentDetails(index) {
    const seg = STATE.timeAnalysis.segments[index];
    if (!seg) return;
    
    const panel = document.getElementById('time-side-panel');
    if (!panel) return;
    
    // Populate simple stats
    document.getElementById('time-panel-label').textContent = seg.label;
    document.getElementById('time-panel-record-count').textContent = seg.record_count.toLocaleString();
    document.getElementById('time-panel-avg-accuracy').textContent = `${seg.avg_accuracy}%`;
    
    // Populate Accuracy distribution
    const accBody = document.querySelector('#time-panel-table-accuracy tbody');
    accBody.innerHTML = '';
    
    const ranges = [
        { label: '80-100', color: 'var(--success)' },
        { label: '60-80', color: 'var(--primary)' },
        { label: '40-60', color: 'var(--warning)' },
        { label: '20-40', color: '#f97316' },
        { label: '0-20', color: 'var(--danger)' }
    ];
    
    ranges.forEach(r => {
        const count = seg.accuracy_distribution[r.label] || 0;
        const pct = seg.record_count > 0 ? ((count / seg.record_count) * 100).toFixed(2) : '0.00';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="badge-accuracy" style="background-color: ${r.color}15; color: ${r.color}; border: 1px solid ${r.color}30; padding: 1px 6px;">${r.label}%</span></td>
            <td class="text-right">${count.toLocaleString()}</td>
            <td class="text-right" style="color: var(--text-light);">${pct}%</td>
        `;
        accBody.appendChild(tr);
    });
    
    // Populate Duration statistics if available
    const durSection = document.getElementById('time-panel-duration-section');
    if (STATE.timeAnalysis.has_duration_data && seg.duration) {
        durSection.style.display = 'block';
        
        document.getElementById('time-panel-dur-avg').textContent = `${seg.duration.avg}s`;
        document.getElementById('time-panel-dur-median').textContent = `${seg.duration.median}s`;
        document.getElementById('time-panel-dur-min').textContent = `${seg.duration.min}s`;
        document.getElementById('time-panel-dur-max').textContent = `${seg.duration.max}s`;
        
        const durBody = document.querySelector('#time-panel-table-duration tbody');
        durBody.innerHTML = '';
        
        const durRanges = [
            { label: '0-30s', color: 'var(--success)' },
            { label: '30-60s', color: 'var(--primary)' },
            { label: '60-120s', color: 'var(--warning)' },
            { label: '120-300s', color: '#f97316' },
            { label: '300s+', color: 'var(--danger)' }
        ];
        
        durRanges.forEach(r => {
            const count = seg.duration.distribution[r.label] || 0;
            const pct = seg.record_count > 0 ? ((count / seg.record_count) * 100).toFixed(2) : '0.00';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="badge-accuracy" style="background-color: ${r.color}15; color: ${r.color}; border: 1px solid ${r.color}30; padding: 1px 6px;">${r.label}</span></td>
                <td class="text-right">${count.toLocaleString()}</td>
                <td class="text-right" style="color: var(--text-light);">${pct}%</td>
            `;
            durBody.appendChild(tr);
        });
    } else {
        durSection.style.display = 'none';
    }
    
    panel.classList.remove('hidden');
}

// Close Time Side Panel
function closeTimeSidePanel() {
    const panel = document.getElementById('time-side-panel');
    if (panel) {
        panel.classList.add('hidden');
    }
}
