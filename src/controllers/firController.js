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
        res.status(500).json({ success: false, error: err.message });
    }
}


// -------------------- GET DISTRICTS --------------------
export async function getDistricts(req, res) {
    if (!isBrowserReady()) {
        return res.status(503).json({ success: false, error: 'System is initializing. Please wait...' });
    }

    const page = getPage();

    try {
        await page.waitForSelector('#ContentPlaceHolder1_ddlDistrictFirSearch', { timeout: 15000 });

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

    let requestId;
    try {
        const [result] = await pool.execute(
            `INSERT INTO requests (request_name, status, total_firs, downloaded_firs)
             VALUES (?, 'processing', 0, 0)`,
            [requestName || `Search_${Date.now()}`]
        );
        requestId = result.insertId;
        logToClient(`Started Request ID: ${requestId}`, 'success');
    } catch (err) {
        logToClient(`DB Error: ${err.message}`, 'error');
        return res.end();
    }

    let allFirs = [];
    let totalDownloaded = 0;

    try {
        const start = new Date(fromDate.split('/').reverse().join('-'));
        const end = new Date(toDate.split('/').reverse().join('-'));

        for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toLocaleDateString('en-GB');
            logToClient(`--- Processing Date: ${dateStr} ---`);

            for (const districtId of districts) {
                logToClient(`Selecting District: ${districtId}...`);
                await scraperService.selectDistrict(page, districtId);
                const stations = await scraperService.getPoliceStations(page);

                for (const ps of stations) {
                    if (stationFilter.size && !stationFilter.has(ps.value)) continue;

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
                        const firWithMeta = { ...fir, districtId, station_name: ps.label };
                        allFirs.push(firWithMeta);

                        // Notify Frontend Immediately
                        sendEvent('fir_found', firWithMeta);

                        let dbFirId = null;
                        try {
                            const [res] = await pool.execute(
                                `INSERT INTO firs (request_id, district, police_station, fir_no, fir_date, fir_status, download_status, brief)
                                 VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
                                [requestId, districtId, ps.label, fir.firNo, fir.firDate, fir.firStatus, fir.firBrief || '']
                            );
                            dbFirId = res.insertId;
                        } catch (e) {
                            logToClient(`⚠️ DB Insert Failed for ${fir.firNo}: ${e.message}`, 'error');
                        }

                        if (fir.printToken) {
                            try {
                                logToClient(`Downloading PDF for ${fir.firNo}...`);
                                const savedPath = await scraperService.downloadFIRPdf({
                                    page,
                                    firNo: fir.firNo,
                                    requestName,
                                    districtName: districtId,
                                    psName: ps.label
                                });

                                totalDownloaded++;
                                sendEvent('fir_status', { firNo: fir.firNo, status: 'downloaded', path: savedPath });

                                if (dbFirId) {
                                    await pool.execute(
                                        `UPDATE firs SET download_status='downloaded', pdf_path=? WHERE id=?`,
                                        [savedPath, dbFirId]
                                    );
                                }
                                logToClient(`✅ Successfully Downloaded: ${fir.firNo}`, 'success');
                            } catch (e) {
                                logToClient(`❌ PDF Failed: ${fir.firNo} - ${e.message}`, 'error');
                                sendEvent('fir_status', { firNo: fir.firNo, status: 'failed', error: e.message });

                                if (dbFirId) {
                                    await pool.execute(`UPDATE firs SET download_status='failed' WHERE id=?`, [dbFirId]);
                                }
                            }
                        } else {
                            sendEvent('fir_status', { firNo: fir.firNo, status: 'no_token' });
                        }
                    }
                }
            }
        }

        await pool.execute(
            `UPDATE requests SET status='completed', total_firs=?, downloaded_firs=? WHERE id=?`,
            [allFirs.length, totalDownloaded, requestId]
        );

        logToClient(`Search Completed. Total FIRs: ${allFirs.length}, Downloaded: ${totalDownloaded}`, 'success');
        sendEvent('complete', { total: allFirs.length, downloaded: totalDownloaded });
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
