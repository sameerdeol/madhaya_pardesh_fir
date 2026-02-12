import { getPage, isBrowserReady } from '../services/puppeteerService.js';
import * as scraperService from '../services/scraperService.js';
import pool from '../../db.js';
import fs from 'fs';
import path from 'path';

// 🔍 DEBUG (can remove later)
console.log('SCRAPER SERVICE KEYS:', Object.keys(scraperService));


// -------------------- GET STATIONS --------------------
export async function getStations(req, res) {
    if (!isBrowserReady()) {
        return res.status(503).json({ success: false, error: 'System is initializing. Please wait...' });
    }

    const { districtValue } = req.body;
    if (!districtValue) {
        return res.status(400).json({ success: false, error: 'District ID required' });
    }

    const page = getPage();

    try {
        await scraperService.selectDistrict(page, districtValue);
        const stations = await scraperService.getPoliceStations(page);

        res.json({ success: true, stations });
    } catch (err) {
        console.error('❌ getStations error:', err.message);
        const msg = err.message.includes('Source Website') ? err.message : 'Failed to fetch stations';
        res.status(500).json({ success: false, error: msg });
    }
}


// -------------------- GET DISTRICTS --------------------
export async function getDistricts(req, res) {
    if (!isBrowserReady()) {
        return res.status(503).json({ success: false, error: 'System is initializing. Please wait...' });
    }

    const page = getPage();

    try {
        await page.waitForSelector('#ContentPlaceHolder1_ddlDistrictFirSearch', { timeout: 60000 });

        const districts = await page.evaluate(() => {
            const sel = document.querySelector('#ContentPlaceHolder1_ddlDistrictFirSearch');
            if (!sel) return [];
            return [...sel.options]
                .filter(o => o.value && o.value !== '0')
                .map(o => ({ label: o.innerText.trim(), value: o.value }));
        });

        res.json(districts);
    } catch (err) {
        console.error('❌ getDistricts error:', err.message);
        if (err.message.includes('Source Website')) {
            // If we can't get districts because site is down, we should probably let frontend know?
            // But getDistricts returns an array. We might need to handle this on frontend or just return empty.
            // For now, logging it is fine, frontend might show empty list.
        }
        res.status(500).json([]);
    }
}


// -------------------- SEARCH FIRS --------------------
export async function searchFirs(req, res) {
    if (!isBrowserReady()) {
        return res.status(503).json({ success: false, error: 'System is initializing. Please wait...' });
    }

    const { districts, fromDate, toDate, requestName, selectedStations } = req.body;
    const stationFilter = new Set(selectedStations || []);
    const page = getPage();

    // 🟢 SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders ? res.flushHeaders() : null;

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const logToClient = (msg, type = 'info') => {
        console.log(`[CLIENT LOG] ${msg}`);
        sendEvent('log', { msg, type });
    };

    let requestId = req.body.existingRequestId;
    try {
        if (!requestId) {
            const searchParams = JSON.stringify({
                districts,
                fromDate,
                toDate,
                selectedStations: Array.from(stationFilter)
            });

            const [result] = await pool.execute(
                `INSERT INTO requests (request_name, search_params, status, total_firs, downloaded_firs)
                 VALUES (?, ?, 'processing', 0, 0)`,
                [requestName || `Search_${Date.now()}`, searchParams]
            );
            requestId = result.insertId;
            logToClient(`Started Request ID: ${requestId}`, 'success');
        } else {
            logToClient(`Resuming Request ID: ${requestId}`, 'info');
        }
    } catch (err) {
        logToClient(`DB Error: ${err.message}`, 'error');
        return res.end();
    }

    let allFirs = [];
    let totalDownloaded = 0;
    let totalFirsCount = 0; // Cumulative total
    let checkpoint = null;

    try {
        if (req.body.existingRequestId) {
            const [rows] = await pool.execute('SELECT checkpoint, downloaded_firs, total_firs FROM requests WHERE id=?', [requestId]);
            if (rows.length > 0) {
                if (rows[0].checkpoint) checkpoint = JSON.parse(rows[0].checkpoint);
                totalDownloaded = rows[0].downloaded_firs || 0;
                totalFirsCount = rows[0].total_firs || 0;
            }
        }
        const start = new Date(fromDate.split('/').reverse().join('-'));
        const end = new Date(toDate.split('/').reverse().join('-'));

        for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toLocaleDateString('en-GB');

            if (checkpoint && new Date(checkpoint.date) > d) {
                logToClient(`Jumping past date: ${dateStr}...`);
                continue;
            }

            logToClient(`--- Processing Date: ${dateStr} ---`);

            for (const districtId of districts) {
                if (checkpoint && checkpoint.date === d.toISOString() && checkpoint.districtId && districts.indexOf(districtId) < districts.indexOf(checkpoint.districtId)) {
                    continue;
                }

                logToClient(`Selecting District: ${districtId}...`);
                await scraperService.selectDistrict(page, districtId);
                const stations = await scraperService.getPoliceStations(page);

                for (const ps of stations) {
                    if (stationFilter.size && !stationFilter.has(ps.value)) continue;

                    // Optimization: Skip stations before checkpoint station on the same date/district
                    if (checkpoint && checkpoint.date === d.toISOString() && checkpoint.districtId === districtId && checkpoint.stationValue) {
                        const psIndex = stations.findIndex(s => s.value === ps.value);
                        const cpIndex = stations.findIndex(s => s.value === checkpoint.stationValue);
                        if (psIndex !== -1 && cpIndex !== -1 && psIndex < cpIndex) {
                            continue;
                        }
                    }

                    // 🛑 Check Stop Status
                    const [reqRows] = await pool.execute('SELECT status FROM requests WHERE id = ?', [requestId]);
                    if (reqRows[0]?.status === 'stopped') {
                        logToClient(`Request ${requestId} stopped by user.`, 'warning');
                        return res.end();
                    }

                    logToClient(`Scraping Station: ${ps.label}...`);
                    await scraperService.selectPoliceStation(page, ps.value);
                    await scraperService.setDate(page, dateStr);

                    if (!await scraperService.clickSearch(page)) {
                        logToClient(`No results or search failed for ${ps.label}`, 'info');
                        continue;
                    }

                    const firs = await scraperService.extractFIRs(page);
                    logToClient(`Found ${firs.length} FIRs at ${ps.label}.`);

                    for (const fir of firs) {


                        // 🛑 Check Stop Status inside FIR loop
                        const [reqRowsFIR] = await pool.execute('SELECT status FROM requests WHERE id = ?', [requestId]);
                        if (reqRowsFIR[0]?.status === 'stopped') {
                            logToClient(`Request ${requestId} stopped by user (during FIR loop).`, 'warning');
                            sendEvent('paused', { requestId }); // 🟢 Explicitly tell frontend it's paused
                            return res.end();
                        }

                        // Only count as "new" if it's the first time we see it for this station/day
                        // This prevents over-counting if we resume mid-station
                        const [existingRecord] = await pool.execute(
                            `SELECT id FROM firs WHERE request_id=? AND fir_no=?`,
                            [requestId, fir.firNo]
                        );

                        if (existingRecord.length === 0) {
                            totalFirsCount++;
                        }

                        const firWithMeta = { ...fir, districtId, station_name: ps.label };
                        allFirs.push(firWithMeta);
                        sendEvent('fir_found', firWithMeta);

                        let dbFirId = null;
                        try {
                            if (existingRecord.length > 0) {
                                dbFirId = existingRecord[0].id;
                            } else {
                                const [res] = await pool.execute(
                                    `INSERT INTO firs (request_id, district, police_station, fir_no, fir_date, fir_status, download_status, brief)
                                     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
                                    [requestId, districtId, ps.label, fir.firNo, fir.firDate, fir.firStatus, fir.firBrief || '']
                                );
                                dbFirId = res.insertId;
                            }
                        } catch (e) {
                            logToClient(`⚠️ DB Insert Failed for ${fir.firNo}: ${e.message}`, 'error');
                        }

                        if (fir.printToken) {
                            try {
                                // Check if already downloaded (for Resume)
                                const [existing] = await pool.execute(
                                    `SELECT id, download_status FROM firs WHERE request_id=? AND fir_no=?`,
                                    [requestId, fir.firNo]
                                );

                                if (existing.length > 0 && existing[0].download_status === 'downloaded') {
                                    logToClient(`Skipping ${fir.firNo} (Already Downloaded)`);
                                    totalDownloaded++;
                                    continue;
                                }

                                logToClient(`Downloading PDF for ${fir.firNo}. This can take 40-60 seconds...`);
                                sendEvent('fir_status', { firNo: fir.firNo, status: 'downloading' }); // 🟢 UI Update

                                const savedPath = await scraperService.downloadFIRPdf({
                                    page,
                                    firNo: fir.firNo,
                                    requestName,
                                    districtName: districtId,
                                    psName: ps.label,
                                    requestId,
                                    dbFirId,
                                    checkStop: async () => {
                                        const [sRows] = await pool.execute('SELECT status FROM requests WHERE id = ?', [requestId]);
                                        return sRows[0]?.status === 'stopped';
                                    }
                                });

                                totalDownloaded++; // Increment first

                                if (dbFirId) {
                                    await pool.execute(
                                        `UPDATE firs SET download_status='downloaded', pdf_path=? WHERE id=?`,
                                        [savedPath, dbFirId]
                                    );
                                }

                                // ✅ Update request progress in DB
                                await pool.execute(
                                    `UPDATE requests SET downloaded_firs=?, total_firs=? WHERE id=?`,
                                    [totalDownloaded, totalFirsCount, requestId]
                                );

                                sendEvent('fir_status', {
                                    firNo: fir.firNo,
                                    status: 'downloaded',
                                    path: savedPath,
                                    downloaded: totalDownloaded,
                                    total: totalFirsCount
                                });

                                logToClient(`✅ Successfully Downloaded: ${fir.firNo}`, 'success');
                            } catch (e) {
                                if (e.message && e.message.includes('stopped by user')) {
                                    logToClient(`🛑 Download ABORTED for ${fir.firNo} by user.`, 'warning');
                                    sendEvent('fir_status', { firNo: fir.firNo, status: 'failed', error: 'Stopped' });
                                    sendEvent('paused', { requestId });
                                    return res.end();
                                }

                                console.error(`Failed to download ${fir.firNo}:`, e);
                                logToClient(`❌ Failed to download ${fir.firNo}: ${e.message}`, 'error');
                                sendEvent('fir_status', { firNo: fir.firNo, status: 'failed', error: e.message });

                                if (dbFirId) {
                                    await pool.execute(
                                        `UPDATE firs SET download_status='failed' WHERE id=?`,
                                        [dbFirId]
                                    );
                                }
                            }
                        } else {
                            sendEvent('fir_status', { firNo: fir.firNo, status: 'no_token' });
                        }
                    }

                    // ✅ Save Checkpoint after each station
                    await pool.execute(
                        `UPDATE requests SET checkpoint=? WHERE id=?`,
                        [JSON.stringify({ date: d.toISOString(), districtId, stationValue: ps.value }), requestId]
                    );
                }
            }
        }

        await pool.execute(
            `UPDATE requests SET status='completed', total_firs=?, downloaded_firs=? WHERE id=?`,
            [totalFirsCount, totalDownloaded, requestId]
        );

        logToClient(`Search Completed. Total FIRs: ${totalFirsCount}, Downloaded: ${totalDownloaded}`, 'success');
        sendEvent('complete', { total: totalFirsCount, downloaded: totalDownloaded });
        res.end();

    } catch (err) {
        logToClient(`Generic Error: ${err.message}`, 'error');
        sendEvent('error', { msg: err.message });
        res.end();
    }
}


// -------------------- DOWNLOAD SINGLE FIR --------------------
export async function downloadSingleFir(req, res) {
    if (!isBrowserReady()) {
        return res.status(503).json({ success: false, error: 'System is initializing. Please wait...' });
    }

    const { firNo, requestName, districtName, psName, requestId, dbFirId } = req.body;
    const page = getPage();

    try {
        const savedPath = await scraperService.downloadFIRPdf({
            page,
            firNo,
            requestName,
            districtName: districtName || 'UnknownDistrict',
            psName: psName || 'UnknownStation',
            requestId,
            dbFirId
        });

        res.json({ success: true, path: savedPath });
    } catch (err) {
        console.error('❌ downloadSingleFir error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

// -------------------- REQUEST MANAGEMENT --------------------

export async function getRequests(req, res) {
    try {
        const [rows] = await pool.execute('SELECT * FROM requests ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function stopRequest(req, res) {
    const { id } = req.body;
    try {
        await pool.execute("UPDATE requests SET status='stopped' WHERE id=?", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function resumeRequest(req, res) {
    const { id } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM requests WHERE id=?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });

        const request = rows[0];
        const searchParams = JSON.parse(request.search_params);

        // Update status back to processing
        await pool.execute("UPDATE requests SET status='processing' WHERE id=?", [id]);

        // We can't easily "inject" into searchFirs if it's already running, 
        // but since it's a new request, we just call searchFirs logic again with the same RID
        // This requires searchFirs to be refactored or handled.
        // Actually, we can just trigger a new search but pass the existing requestId.

        // Refactoring searchFirs to handle an optional requestId
        req.body = { ...searchParams, requestName: request.request_name, existingRequestId: id };
        return searchFirs(req, res);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
