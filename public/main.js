const originalSendText = 'Send OTP';
const originalVerifyText = 'Verify & Login';

// -------------------- LOGGER --------------------
function logToConsole(msg, type = 'info') {
  const el = document.getElementById('console-log');
  if (!el) return;

  const div = document.createElement('div');
  div.className = type === 'error' ? 'text-danger' : (type === 'success' ? 'text-success' : 'text-dark');
  // Timestamp
  div.innerHTML = `<span class="text-muted opacity-50">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// -------------------- SYSTEM STATUS --------------------
let isSystemReady = false;

async function monitorSystemStatus() {
  const btn = document.getElementById('btnSendOtp');
  // Only affect button if we are in the send step
  if (document.getElementById('step-send').style.display === 'none') return;

  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.ready) {
      if (!isSystemReady) {
        isSystemReady = true;
        btn.disabled = false;
        btn.innerHTML = originalSendText;
        logToConsole('System Ready. Please login.', 'success');
      }
    } else {
      isSystemReady = false;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Loading System...';
    }
  } catch (e) {
    // 🛑 Handle Server Offline / Connection Refused
    console.error('Status check failed:', e);
    isSystemReady = false;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-grow spinner-grow-sm text-danger"></span> System Offline';
  }
}

// Check status every 2 seconds until ready
const statusInterval = setInterval(async () => {
  await monitorSystemStatus();
  if (isSystemReady) clearInterval(statusInterval);
}, 2000);

// Initial check
monitorSystemStatus();

document.getElementById('btnSendOtp').onclick = async () => {
  const btn = document.getElementById('btnSendOtp');
  const mobile = document.getElementById('loginMobile').value;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Sending...';
  logToConsole(`Sending OTP to ${mobile}...`);

  try {
    const res = await fetch('/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile })
    });

    const data = await res.json();
    if (data.success) {
      logToConsole('OTP Request Sent. Waiting for user...', 'success');
      document.getElementById('step-send').style.display = 'none';
      document.getElementById('step-verify').style.display = 'block';
    } else {
      logToConsole(`Failed to send OTP: ${data.error}`, 'error');
      alert('Failed to send OTP');
    }
  } catch (e) {
    logToConsole(`Error sending OTP: ${e.message}`, 'error');
    alert('Error sending OTP');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalSendText;
  }
};

document.getElementById('btnVerifyOtp').onclick = async () => {
  const btn = document.getElementById('btnVerifyOtp');
  const otp = document.getElementById('loginOtp').value;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Verifying...';
  logToConsole(`Verifying OTP: ${otp}...`);

  try {
    const res = await fetch('/api/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp })
    });

    const data = await res.json();
    if (data.success) {
      logToConsole('OTP Verified! Login Successful.', 'success');
      document.getElementById('login-overlay').style.display = 'none';
      document.getElementById('app').style.filter = 'none';

      // ✅ LOAD DISTRICTS NOW
      await loadDistricts();
    } else {
      logToConsole(`Invalid OTP: ${data.error}`, 'error');
      alert('Invalid OTP');
    }
  } catch (e) {
    logToConsole(`Error verifying OTP: ${e.message}`, 'error');
    alert('Error verifying OTP');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalVerifyText;
  }
};

document.getElementById('btnResendOtp').onclick = async () => {
  const btn = document.getElementById('btnResendOtp');
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Resending...';
  logToConsole('Resending OTP...');

  try {
    const res = await fetch('/api/resend-otp', {
      method: 'POST'
    });

    const data = await res.json();
    if (data.success) {
      logToConsole('OTP Resend Success!', 'success');
      alert('OTP has been resent');
    } else {
      logToConsole(`Failed to resend OTP: ${data.error}`, 'error');
      alert('Failed to resend OTP');
    }
  } catch (e) {
    logToConsole(`Error resending OTP: ${e.message}`, 'error');
    alert('Error resending OTP');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
};

async function loadDistricts() {
  const container = document.getElementById('district-container');
  container.innerHTML = '<div class="text-center p-3"><span class="spinner-border text-primary"></span><div class="mt-2 small text-muted">Loading Districts...</div></div>';
  container.style.display = 'block';
  logToConsole('Fetching district list...');

  try {
    const dRes = await fetch('/api/districts');
    const districts = await dRes.json();

    const selectAllBtn = document.getElementById('selectAllDistricts');
    container.innerHTML = '';
    selectAllBtn.style.display = 'block';

    if (districts.length === 0) {
      container.innerHTML = '<div class="text-center text-muted p-2">No districts loaded. Refresh?</div>';
      logToConsole('No districts found.', 'error');
      return;
    }

    logToConsole(`Loaded ${districts.length} districts.`);

    districts.forEach(d => {
      const div = document.createElement('div');
      div.className = 'form-check';
      // Added OnChange listener to load stations
      div.innerHTML = `
      <input class="form-check-input district-checkbox" type="checkbox" 
             value="${d.value}" id="dist-${d.value}" 
             data-label="${d.label}" onchange="handleDistrictChange(this)">
      <label class="form-check-label" for="dist-${d.value}">
        ${d.label}
      </label>
    `;
      container.appendChild(div);
    });
  } catch (e) {
    container.innerHTML = '<div class="text-danger p-2">Failed to load districts.</div>';
    logToConsole(`Error loading districts: ${e.message}`, 'error');
  }
}

// -------------------- STATION LOGIC --------------------
async function handleDistrictChange(checkbox) {
  const container = document.getElementById('station-container');
  const distId = checkbox.value;
  const distName = checkbox.getAttribute('data-label');
  const groupId = `station-group-${distId}`;

  if (checkbox.checked) {
    // Prepare Group Container
    container.style.display = 'block';
    if (container.querySelector('.text-muted.text-center')) {
      container.innerHTML = ''; // Clear empty message
    }

    // Placeholder for this district
    const groupDiv = document.createElement('div');
    groupDiv.id = groupId;
    groupDiv.className = 'mb-3 border-bottom pb-2';
    groupDiv.innerHTML = `
            <h6 class="text-primary fw-bold mb-2">
                <span class="spinner-border spinner-border-sm text-secondary me-1" id="loader-${distId}"></span>
                ${distName}
            </h6>
            <div id="list-${distId}" class="ps-3"></div>
        `;
    container.appendChild(groupDiv);
    logToConsole(`Fetching stations for ${distName}...`);

    try {
      const res = await fetch('/api/get-stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ districtValue: distId })
      });
      const data = await res.json();

      const loader = document.getElementById(`loader-${distId}`);
      if (loader) loader.remove();

      if (data.success && data.stations.length > 0) {
        const listDiv = document.getElementById(`list-${distId}`);
        // Add "Select All" for this station group
        const selectAllId = `select-all-${distId}`;
        listDiv.innerHTML = `
                    <div class="form-check mb-1">
                        <input class="form-check-input fw-bold" type="checkbox" checked id="${selectAllId}" 
                               onchange="toggleStationGroup('${distId}', this.checked)">
                        <label class="form-check-label fw-bold text-dark" for="${selectAllId}">Select All</label>
                    </div>
                 `;

        data.stations.forEach(st => {
          const stDiv = document.createElement('div');
          stDiv.className = 'form-check';
          stDiv.innerHTML = `
                        <input class="form-check-input station-checkbox group-${distId}" type="checkbox" checked value="${st.value}" id="st-${st.value}">
                        <label class="form-check-label" for="st-${st.value}">${st.label}</label>
                     `;
          listDiv.appendChild(stDiv);
        });
        logToConsole(`Loaded ${data.stations.length} stations for ${distName}.`);
      } else {
        document.getElementById(`list-${distId}`).innerHTML = '<div class="text-danger small">No stations found or error.</div>';
      }

    } catch (e) {
      logToConsole(`Error fetching stations for ${distName}: ${e.message}`, 'error');
      const loader = document.getElementById(`loader-${distId}`);
      if (loader) loader.className = 'text-danger fw-bold';
      if (loader) loader.innerText = '!';
    }

  } else {
    // Remove Group
    const el = document.getElementById(groupId);
    if (el) el.remove();
    logToConsole(`Removed stations for ${distName}.`);

    // Hide container if empty
    if (!container.children.length) {
      container.style.display = 'none';
    }
  }
}

function toggleStationGroup(distId, checked) {
  const boxes = document.querySelectorAll(`.station-checkbox.group-${distId}`);
  boxes.forEach(b => b.checked = checked);
}

document.getElementById('selectAllDistricts').onclick = function () {
  const checkboxes = document.querySelectorAll('.district-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  // We can't auto-trigger async renders nicely for "Select All" without a queue or massive parallel fetch (bad for scraper).
  // Block this for now or warn.
  if (!allChecked) {
    alert("Please select districts individually to load their stations. Select All is disabled to prevent overloading.");
    return;
  }

  checkboxes.forEach(cb => {
    if (cb.checked) {
      cb.click(); // Uncheck simulates click to clean up
    }
  });
  this.textContent = 'Select All';
};


// Load districts on start if already logged in (optional, based on logic)
loadDistricts();

// Submit FIR search
document.getElementById('downloadForm').addEventListener('submit', async e => {
  e.preventDefault();

  const checkboxes = document.querySelectorAll('.district-checkbox:checked');
  const districts = Array.from(checkboxes).map(cb => cb.value);
  const stationBoxes = document.querySelectorAll('.station-checkbox:checked');
  const selectedStations = Array.from(stationBoxes).map(cb => cb.value);

  const fromDate = e.target.fromDate.value;
  const toDate = e.target.toDate.value;
  const requestName = e.target.requestName.value;

  window.isPausedManually = false; // Reset flag

  if (fromDate > toDate) {
    alert('Start Date cannot be after End Date');
    return;
  }
  if (districts.length === 0) {
    alert('Please select at least one district.');
    return;
  }

  const statusLog = document.getElementById('status-log');
  statusLog.innerHTML = `<div class="alert alert-info">Searching and Downloading...</div>`;
  logToConsole(`🚀 Starting Streamed Search: ${fromDate} to ${toDate}`);

  // Prepare Empty Table
  initResultsTable();

  try {
    const response = await fetch('/api/search-firs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ districts, fromDate, toDate, requestName, selectedStations })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Keep partial line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        const [eventPart, dataPart] = line.split('\n');
        const event = eventPart.replace('event: ', '').trim();
        const data = JSON.parse(dataPart.replace('data: ', '').trim());

        handleServerEvent(event, data);
      }
    }
    if (!window.isPausedManually) {
      statusLog.innerHTML = `<div class="alert alert-success">Process Completed.</div>`;
    }
  } catch (e) {
    console.error('Stream Error:', e);
    statusLog.innerHTML = `<div class="alert alert-danger">Stream Error: ${e.message}</div>`;
    logToConsole(`❌ Stream Error: ${e.message}`, 'error');
  }
});

function handleServerEvent(event, data) {
  const statusLog = document.getElementById('status-log');
  switch (event) {
    case 'log':
      logToConsole(data.msg, data.type);
      break;
    case 'paused':
      window.isPausedManually = true;
      statusLog.innerHTML = `<div class="alert alert-warning">Process Paused.</div>`;
      logToConsole(`⏸️ Request ${data.requestId} paused by user.`, 'warning');
      loadRequests();
      break;
    case 'fir_found':
      addFirRow(data);
      break;
    case 'fir_status':
      updateFirStatus(data.firNo, data.status, data.path || data.error);
      if (data.downloaded && data.total) {
        // You could add a helper to update the local progress bar immediately here
        // but loadRequests is usually fast enough if triggered by event.
      }
      loadRequests(); // Refresh progress
      break;
    case 'complete':
      if (!window.isPausedManually) {
        logToConsole(`✅ Search process finished naturally.`, 'success');
        statusLog.innerHTML = `<div class="alert alert-success">Process Completed.</div>`;
      } else {
        logToConsole(`⚠️ Search process stopped by user.`, 'warning');
      }
      refreshFileTree();
      loadRequests();
      break;
    case 'error':
      logToConsole(`❌ Server Error: ${data.msg}`, 'error');
      statusLog.innerHTML = `<div class="alert alert-danger">Error: ${data.msg}</div>`;
      loadRequests();
      break;
  }
}

function initResultsTable() {
  const container = document.getElementById('fir-results');
  container.innerHTML = `
    <table class="table table-bordered table-striped" id="results-table">
      <thead class="table-dark">
        <tr>
          <th>FIR No</th>
          <th>Date</th>
          <th>Station</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
}

function addFirRow(fir) {
  const tbody = document.querySelector('#results-table tbody');
  // Make ID unique per station + FIR to avoid conflicts if same FIR is in multiple stations
  const safeStation = (fir.station_name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
  const safeFir = fir.firNo.replace(/[^a-zA-Z0-9]/g, '_');
  const rowId = `fir-row-${safeFir}-${safeStation}`;

  if (document.getElementById(rowId)) return; // Prevent duplicates

  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML = `
    <td class="fw-bold">${fir.firNo}</td>
    <td>${fir.firDate}</td>
    <td>${fir.station_name || 'N/A'}</td>
    <td class="status-cell">
      <span class="badge bg-secondary">Found</span>
    </td>
  `;
  tbody.appendChild(tr);
  tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateFirStatus(firNo, status, extra) {
  // We need to find the row. Since we changed ID to include station, 
  // we might need to search or update the backend to send station info in 'fir_status'.
  // However, simpler fix for now: query by FIR NO part of ID if possible, 
  // OR just update ALL rows with that FIR NO (if same FIR exists in multiple stations).

  const safeFir = firNo.replace(/[^a-zA-Z0-9]/g, '_');
  const rows = document.querySelectorAll(`[id^="fir-row-${safeFir}-"]`);

  rows.forEach(row => {
    const statusCell = row.querySelector('.status-cell');
    if (status === 'downloading') {
      statusCell.innerHTML = `<span class="badge bg-info text-dark spinner-border spinner-border-sm"></span> <span class="badge bg-info text-dark">Downloading...</span>`;
    } else if (status === 'downloaded') {
      statusCell.innerHTML = `<span class="badge bg-success">Downloaded</span>`;
    } else if (status === 'failed') {
      statusCell.innerHTML = `<span class="badge bg-danger" title="${extra || ''}">Failed</span>`;
    } else if (status === 'no_token') {
      statusCell.innerHTML = `<span class="badge bg-warning">No PDF</span>`;
    }
  });
}

function renderTable(firs, requestName) {
  // This legacy function is now replaced by initResultsTable + addFirRow 
  // but kept for compatibility if called otherwise.
  initResultsTable();
  firs.forEach(f => addFirRow(f));
}

window.downloadFIR = async (dataStr, btn) => {
  const firData = JSON.parse(decodeURIComponent(dataStr));
  logToConsole(`Downloading FIR ${firData.firNo} from ${firData.station_name || 'station'}. Please wait 40-60s...`);

  const btnRow = btn.closest('tr');
  const statusCell = btnRow.querySelector('td:last-child');

  // Visual feedback
  const originalText = statusCell.innerHTML;
  statusCell.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Downloading...';

  try {
    const res = await fetch('/api/download-fir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firData)
    });

    const resp = await res.json();

    if (resp.success) {
      statusCell.innerHTML = '<span class="badge bg-success">Downloaded</span>';
      logToConsole(`✅ Successfully Downloaded: ${resp.path}`, 'success');
      refreshFileTree(); // Update tree after single download
    } else {
      statusCell.innerHTML = '<span class="badge bg-danger">Failed</span>';
      logToConsole(`❌ Download Failed: ${resp.error}`, 'error');
      setTimeout(() => statusCell.innerHTML = originalText, 5000);
    }
  } catch (e) {
    console.error(e);
    statusCell.innerHTML = '<span class="badge bg-danger">Error</span>';
    logToConsole(`❌ Exception: ${e.message}`, 'error');
  }
};

// -------------------- FILE TREE LOGIC --------------------
async function refreshFileTree() {
  const treeEl = document.getElementById('file-tree');
  try {
    const res = await fetch('/api/files');
    const tree = await res.json();
    treeEl.innerHTML = renderTree(tree);
  } catch (e) {
    treeEl.textContent = 'Failed to load files';
  }
}

function renderTree(nodes, indent = 0) {
  if (!nodes || nodes.length === 0) return '<div class="ms-3 text-muted">Empty</div>';

  let html = '';
  nodes.forEach(node => {
    const padding = indent * 15;
    if (node.type === 'directory') {
      const id = 'folder-' + Math.random().toString(36).substr(2, 9);
      html += `
        <div style="padding-left: ${padding}px">
          <span style="cursor:pointer; user-select:none;" onclick="toggleFolder('${id}')">
            📁 <strong>${node.name}</strong>
          </span>
          <div id="${id}" style="display:none;">
            ${renderTree(node.children, indent + 1)}
          </div>
        </div>
      `;
    } else {
      html += `
        <div style="padding-left: ${padding}px">
          📄 ${node.name} <span class="text-muted small">(${node.size} b)</span>
        </div>
      `;
    }
  });
  return html;
}

window.toggleFolder = (id) => {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

// -------------------- REQUEST MANAGEMENT --------------------

async function loadRequests() {
  const tbody = document.getElementById('requests-body');
  try {
    const res = await fetch('/api/requests');
    const requests = await res.json();

    if (requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No requests found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    requests.forEach(req => {
      const tr = document.createElement('tr');
      const progress = req.total_firs > 0 ? Math.round((req.downloaded_firs / req.total_firs) * 100) : 0;

      let statusBadge = `<span class="badge bg-secondary">${req.status}</span>`;
      if (req.status === 'processing') statusBadge = `<span class="badge bg-primary spinner-grow spinner-grow-sm" role="status"></span> <span class="badge bg-primary">Processing</span>`;
      if (req.status === 'completed') statusBadge = `<span class="badge bg-success">Completed</span>`;
      if (req.status === 'stopped') statusBadge = `<span class="badge bg-warning text-dark">Stopped</span>`;

      let actions = '';
      if (req.status === 'processing') {
        actions = `<button class="btn btn-sm btn-danger" onclick="stopRequest(${req.id})">Stop</button>`;
      } else if (req.status === 'stopped' || req.status === 'failed') {
        actions = `<button class="btn btn-sm btn-success" onclick="resumeRequest(${req.id})">Resume</button>`;
      }

      tr.innerHTML = `
        <td><strong>${req.request_name}</strong></td>
        <td>${statusBadge}</td>
        <td>
          <div class="progress" style="height: 20px;">
            <div class="progress-bar ${req.status === 'completed' ? 'bg-success' : ''}" 
                 role="progressbar" style="width: ${progress}%">${req.downloaded_firs} PDFs</div>
          </div>
        </td>
        <td><small>${new Date(req.created_at).toLocaleString()}</small></td>
        <td>${actions}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('Failed to load requests:', e);
  }
}

async function stopRequest(id) {
  if (!confirm('Are you sure you want to stop this request?')) return;
  try {
    const res = await fetch('/api/stop-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.success) {
      logToConsole(`Request ${id} stopped.`, 'warning');
      loadRequests();
    }
  } catch (e) {
    alert('Failed to stop request');
  }
}

async function resumeRequest(id) {
  window.isPausedManually = false; // Reset flag
  logToConsole(`Resuming Request ${id}...`);
  const statusLog = document.getElementById('status-log');
  statusLog.innerHTML = `<div class="alert alert-info">Resuming and Downloading...</div>`;
  initResultsTable();

  try {
    const response = await fetch('/api/resume-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const [eventPart, dataPart] = line.split('\n');
        const event = eventPart.replace('event: ', '').trim();
        const data = JSON.parse(dataPart.replace('data: ', '').trim());
        handleServerEvent(event, data);
      }
    }
  } catch (e) {
    logToConsole(`Resume Error: ${e.message}`, 'error');
  }
}

// Attach to window for onclick
window.loadRequests = loadRequests;
window.stopRequest = stopRequest;
window.resumeRequest = resumeRequest;

// Initial load and periodic refresh
loadRequests();
setInterval(loadRequests, 5000);

// Initial tree load
refreshFileTree();
