const originalSendText = document.getElementById('btnSendOtp').innerHTML;
const originalVerifyText = document.getElementById('btnVerifyOtp').innerHTML;

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
    statusLog.innerHTML = `<div class="alert alert-success">Process Completed.</div>`;
  } catch (e) {
    console.error('Stream Error:', e);
    statusLog.innerHTML = `<div class="alert alert-danger">Stream Error: ${e.message}</div>`;
    logToConsole(`❌ Stream Error: ${e.message}`, 'error');
  }
});

function handleServerEvent(event, data) {
  switch (event) {
    case 'log':
      logToConsole(data.msg, data.type);
      break;
    case 'fir_found':
      addFirRow(data);
      break;
    case 'fir_status':
      updateFirStatus(data.firNo, data.status, data.path || data.error);
      break;
    case 'complete':
      logToConsole(`✅ Search finished. Found: ${data.total}, DL: ${data.downloaded}`, 'success');
      refreshFileTree();
      break;
    case 'error':
      logToConsole(`❌ Server Error: ${data.msg}`, 'error');
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
  const tr = document.createElement('tr');
  tr.id = `fir-row-${fir.firNo.replace(/[^a-zA-Z0-9]/g, '_')}`;
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
  const rowId = `fir-row-${firNo.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const row = document.getElementById(rowId);
  if (!row) return;

  const statusCell = row.querySelector('.status-cell');
  if (status === 'downloaded') {
    statusCell.innerHTML = `<span class="badge bg-success">Downloaded</span>`;
  } else if (status === 'failed') {
    statusCell.innerHTML = `<span class="badge bg-danger" title="${extra || ''}">Failed</span>`;
  } else if (status === 'no_token') {
    statusCell.innerHTML = `<span class="badge bg-warning">No PDF</span>`;
  }
}

function renderTable(firs, requestName) {
  // This legacy function is now replaced by initResultsTable + addFirRow 
  // but kept for compatibility if called otherwise.
  initResultsTable();
  firs.forEach(f => addFirRow(f));
}

window.downloadFIR = async (dataStr, btn) => {
  const firData = JSON.parse(decodeURIComponent(dataStr));
  logToConsole(`Downloading FIR ${firData.firNo} from ${firData.station_name || 'station'}...`);

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

// Initial tree load
refreshFileTree();
