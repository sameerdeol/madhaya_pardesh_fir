import fs from 'fs';
import path from 'path';

// -------------------- HELPERS --------------------
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function getDistricts(page) {
    return await page.evaluate(() => {
        const select = document.querySelector(
            '#ContentPlaceHolder1_ddlDistrictFirSearch'
        );

        if (!select) return [];

        return Array.from(select.options)
            .filter(o => o.value)
            .map(o => ({
                value: o.value,
                label: o.text.trim()
            }));
    });
}

export async function selectDistrict(page, districtValue) {
    // 1. Check if already selected to avoid redundant postback
    const currentValue = await page.evaluate(() => {
        const ddl = document.querySelector('#ContentPlaceHolder1_ddlDistrictFirSearch');
        return ddl ? ddl.value : null;
    });

    if (currentValue === districtValue) {
        console.log(`District ${districtValue} already selected. Skipping...`);
        // Still ensure stations are there just in case
        await waitForPoliceStations(page);
        return;
    }

    // 2. Snapshot current stations state
    const initialState = await page.evaluate(() => {
        const ddl = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch');
        return {
            html: ddl ? ddl.innerHTML : '',
            count: ddl ? ddl.options.length : 0
        };
    });

    console.log(`Selecting District: ${districtValue} and waiting for stations...`);

    // 3. Select and wait for the postback to finish naturally
    try {
        await Promise.all([
            page.select('#ContentPlaceHolder1_ddlDistrictFirSearch', districtValue),
            page.waitForFunction((init) => {
                const ddl = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch');
                if (!ddl) return false;
                // Postback happened if HTML changed OR count > 1 (and it was 1 or 0 before)
                const changed = ddl.innerHTML !== init.html;
                const hasOptions = ddl.options.length > 1;
                return changed && hasOptions;
            }, { timeout: 45000 }, initialState)
        ]);
        // 4. Final verification wait (very short)
        await waitForPoliceStations(page);
    } catch (e) {
        console.warn(`⚠️ selectDistrict failed: ${e.message}`);
        throw new Error("Source Website Not Responding, please try after some time");
    }
}


// -------------------- POLICE STATIONS --------------------
// Waits for PS dropdown to populate after selecting a district
export async function waitForPoliceStations(page) {
    await page.waitForFunction(() => {
        const psDropdown = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch');
        return psDropdown && psDropdown.options.length > 1; // skip "Select"
    }, { timeout: 60000 }); // wait up to 60s
}

// Fetch all PS options
export async function getPoliceStations(page) {
    return await page.evaluate(() => {
        const select = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch');
        if (!select) return [];
        return Array.from(select.options)
            .filter(o => o.value && o.value !== '0' && o.text.toLowerCase() !== 'select')
            .map(o => ({ value: o.value, label: o.text.trim() }));
    });
}

// Select a police station and verify
export async function selectPoliceStation(page, psValue) {
    console.log(`Selecting Station: ${psValue}...`);

    await page.evaluate((val) => {
        const ddl = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch');
        if (ddl && ddl.value !== val) {
            ddl.value = val;
            ddl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, psValue);

    // Verify selection applied
    try {
        await page.waitForFunction((val) => {
            const ddl = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch');
            return ddl && ddl.value === val;
        }, { timeout: 15000 }, psValue);
    } catch (e) {
        console.warn(`⚠️ Warning: Selection verification for station ${psValue} timed out.`);
        throw new Error("Source Website Not Responding, please try after some time");
    }

    // Small stabilization wait to let any background AJAX start
    await new Promise(r => setTimeout(r, 1000));
}


// -------------------- FIR EXTRACTION --------------------
export async function extractFIRs(page) {
    return await page.evaluate(() => {
        // Get all rows from the grid
        const allRows = Array.from(
            document.querySelectorAll('#ContentPlaceHolder1_gdvFirSearch tr')
        );

        // Filter out header row (usually the first one, or one with th)
        // Check if row has 'th' or if it doesn't have enough 'td'
        const dataRows = allRows.filter(row => {
            return row.querySelectorAll('td').length > 1 && !row.querySelector('th');
        });

        console.log(`Found ${allRows.length} total rows, ${dataRows.length} data rows.`);

        return dataRows.map(row => {
            const cells = row.querySelectorAll('td');
            const link = cells[1]?.querySelector('a');

            let token = null;
            if (link) {
                const onClick = link.getAttribute('onclick');
                const m = onClick?.match(/FIRPrintView\.aspx\?num=([^']+)/);
                if (m) token = m[1];
            }

            return {
                firNo: cells[1]?.innerText.trim(),
                firDate: cells[2]?.innerText.trim(),
                firBrief: cells[3]?.querySelector('span')?.innerText.trim(),
                firStatus: cells[4]?.innerText.replace(/\s+/g, ' ').trim(),
                printToken: token
            };
        });
    });
}

export async function clickSearch(page) {
    try {
        // 1. AGGRESSIVELY CLEAR STALE STATE
        // This is crucial to prevent the scraper from picking up "No Record Found" from the previous station/date
        await page.evaluate(() => {
            const grid = document.querySelector('#ContentPlaceHolder1_gdvFirSearch');
            if (grid) grid.innerHTML = '';

            const lbl = document.querySelector('#ContentPlaceHolder1_lblMsg');
            if (lbl) lbl.innerText = '';

            // Clear any text content that looks like "No Record" from the entire body
            // This handles cases where the message is injected outside specific labels
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            const toRemove = [];
            while (node = walker.nextNode()) {
                if (node.textContent.includes('No Record Found') || node.textContent.includes('Data not found')) {
                    toRemove.push(node);
                }
            }
            toRemove.forEach(n => n.textContent = '');

            // Prepare a marker for the next postback
            window.__lastRequestFinished = false;

            // If Sys (ASP.NET AJAX) is present, hook into it
            if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
                const prm = Sys.WebForms.PageRequestManager.getInstance();
                const handler = () => {
                    window.__lastRequestFinished = true;
                    prm.remove_endRequest(handler);
                };
                prm.add_endRequest(handler);
            } else {
                // Fallback for non-AJAX or if Sys is missing
                window.__lastRequestFinished = 'no_sys';
            }
        });

        console.log('Attempting to click Search button...');

        // Use Puppeteer's native click
        const searchBtnSelector = '#ContentPlaceHolder1_btnFirSearch, input[value="Search"], #ContentPlaceHolder1_btnSearch';
        const btn = await page.$(searchBtnSelector);

        if (btn) {
            await btn.click();

            // 2. WAIT FOR POSTBACK COMPLETION
            // We wait for either the __lastRequestFinished flag OR a visible change in the UI
            await page.waitForFunction(() => {
                const grid = document.querySelector('#ContentPlaceHolder1_gdvFirSearch');
                const lbl = document.querySelector('#ContentPlaceHolder1_lblMsg');

                // Check if Sys.WebForms finished
                if (window.__lastRequestFinished === true) return true;

                // Indicators of a finished search
                const hasRows = grid && grid.querySelectorAll('tr').length > 0 && grid.innerText.trim().length > 10;
                const hasAlert = lbl && lbl.innerText.trim().length > 0;

                // Fallback: If "No Record Found" appears in body text (and we cleared it before)
                const bodyText = document.body.innerText;
                const noRecords = bodyText.includes('No Record Found') || bodyText.includes('Data not found');

                return hasRows || hasAlert || noRecords;
            }, { timeout: 90000 });

            // Small settle time to ensure DOM elements are fully initialized
            await new Promise(r => setTimeout(r, 2000));

            console.log('Search action completed and page updated.');
            return true;
        } else {
            console.error('Search button not found!');
            return false;
        }

    } catch (err) {
        console.error('Error clicking search:', err.message);
        // Fallback: If timeout occurred, check if maybe results appeared anyway?
        const hasResults = await page.evaluate(() => {
            const grid = document.querySelector('#ContentPlaceHolder1_gdvFirSearch');
            return grid && grid.rows.length > 0;
        });
        if (hasResults) {
            console.log('Wait timed out but results found! Continuing...');
            return true;
        }
        if (err.message && (err.message.includes('Timeout') || err.message.includes('Source Website Not Responding'))) {
            throw new Error("Source Website Not Responding, please try after some time");
        }
        return false;
    }
}





// export async function setDate(page, dateISO) {
//     // dateISO comes as YYYY-MM-DD, we need DD/MM/YYYY
//     const [yyyy, mm, dd] = dateISO.split('-');
//     const formattedDate = `${dd}/${mm}/${yyyy}`;

//     await page.evaluate((day) => {
//         const input = document.querySelector('#ContentPlaceHolder1_txtFirSearchDate');
//         if (!input) throw new Error('Date input not found');

//         input.focus();
//         input.value = day;
//         input.dispatchEvent(new Event('change', { bubbles: true }));
//         input.blur(); // Sometimes triggers validation
//     }, formattedDate);
// }
export async function setDate(page, dateStr) {
    await page.evaluate((dateStr) => {
        const input = document.querySelector('#ContentPlaceHolder1_txtFirSearchDate');
        if (!input) throw new Error('Date input not found');

        input.focus();
        input.value = dateStr;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
    }, dateStr);
}

/**
 * Waits for a file to appear in a directory within a timeout
 */
async function waitForFile(directory, timeout = 30000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const files = fs.readdirSync(directory);
        // Look for any file that is NOT a crdownload (temp chrome download)
        const finishedFile = files.find(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
        if (finishedFile) return finishedFile;
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Timeout waiting for file in ${directory}`);
}

export async function downloadFIRPdf({
    page,
    firNo,
    requestName,
    districtName,
    psName,
    requestId,
    dbFirId,
    checkStop
}) {
    const sanitizedFirNo = firNo.replace(/[^a-zA-Z0-9]/g, '_');
    const finalDownloadDir = path.join(
        process.cwd(),
        'download',
        requestName || 'Default',
        districtName,
        psName
    );
    fs.mkdirSync(finalDownloadDir, { recursive: true });

    // 🆕 Create a UNIQUE temp directory for THIS specific download attempt
    // This prevents race conditions where waitForFile picks up a previously downloaded file
    const tempDirName = `temp_${sanitizedFirNo}_${Date.now()}`;
    const tempDownloadDir = path.join(finalDownloadDir, tempDirName);
    fs.mkdirSync(tempDownloadDir, { recursive: true });

    const finalPdfPath = path.join(finalDownloadDir, `${sanitizedFirNo}.pdf`);
    // Delete existing file if any (overwrite)
    if (fs.existsSync(finalPdfPath)) fs.unlinkSync(finalPdfPath);

    let newPage;

    try {
        console.log(`\n================================================================================`);
        console.log(`⬇️ STARTING PDF DOWNLOAD (Export Button) FOR FIR: ${firNo}`);
        console.log(`================================================================================`);

        /* 1️⃣ OPEN FIR POPUP */
        if (checkStop && await checkStop()) throw new Error('Request stopped by user');

        const popupPromise = new Promise(res => page.once('popup', res));

        await page.evaluate(firNo => {
            const rows = [...document.querySelectorAll('#ContentPlaceHolder1_gdvFirSearch tr')];
            const row = rows.find(r => r.cells[1]?.innerText.trim() === firNo);
            row?.querySelector('a')?.click();
        }, firNo);

        newPage = await popupPromise;
        if (!newPage) throw new Error('FIR popup did not open');

        // Allow downloads in this popup via CDP - USE THE UNIQUE TEMP DIR
        const client = await newPage.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: tempDownloadDir
        });

        /* 2️⃣ WAIT FOR CONTENT TO LOAD */
        console.log('Waiting for ReportViewer to initialize (can take 40-60s)...');
        if (checkStop && await checkStop()) throw new Error('Request stopped by user');

        try {
            // First wait for the form to exist if it's slow
            await newPage.waitForSelector('#form1', { timeout: 30000 }).catch(() => {
                console.log('Note: #form1 not found immediately, continuing to wait for Export button...');
            });

            // Increased timeout for slow report generation to 120 seconds
            await newPage.waitForFunction(() => {
                const selectors = [
                    'img[title="Export"]',
                    'table[title="Export"]',
                    '[id*="_ButtonImg"]', // The ID from user's HTML
                    '[id*="_ButtonLink"]',
                    'a[onclick*="exportReport"]'
                ];
                return selectors.some(s => document.querySelector(s));
            }, { timeout: 120000 });
            console.log('✅ Export button found.');

            // Wait for the ReportViewer to be truly interactive
            await new Promise(r => setTimeout(r, 5000));
        } catch (e) {
            // Fallback: check if we see "401" or errors
            const content = await newPage.content();
            if (content.includes('401') || content.includes('Unauthorized')) {
                throw new Error('401 Unauthorized in popup. Session might be stale.');
            }
            throw new Error(`ReportViewer Export button not found after 120s: ${e.message}`);
        }

        /* 3️⃣ CLICK EXPORT -> PDF */
        if (checkStop && await checkStop()) throw new Error('Request stopped by user');
        console.log('📄 Clicking Export -> PDF...');

        try {
            // Function to find the export button and click it in main frame or any iframe
            const clickExport = async (frame) => {
                return await frame.evaluate(() => {
                    // Try Direct JS first if available
                    try {
                        const rv = (typeof $find === 'function') ? $find('RptView') : null;
                        if (rv && typeof rv.exportReport === 'function') {
                            rv.exportReport('PDF');
                            return 'direct_js';
                        }
                    } catch (e) { }

                    // UI Click
                    const selectors = [
                        'img[title="Export"]',
                        'a[title="Export"]',
                        '[id*="_ButtonImg"]',
                        '[id*="_ButtonLink"]',
                        'table[title="Export"]'
                    ];
                    for (const sel of selectors) {
                        const btn = document.querySelector(sel);
                        if (btn && btn.offsetParent !== null) { // visible
                            btn.click();
                            return 'clicked_ui';
                        }
                    }
                    return false;
                });
            };

            const clickPdfOption = async (frame) => {
                return await frame.evaluate(() => {
                    const links = [...document.querySelectorAll('a')];
                    const pdfLink = links.find(a => {
                        const text = a.innerText.trim().toUpperCase();
                        const onclick = a.getAttribute('onclick') || '';
                        return text === 'PDF' || onclick.includes("exportReport('PDF')");
                    });
                    if (pdfLink && pdfLink.offsetParent !== null) {
                        pdfLink.click();
                        return true;
                    }
                    return false;
                });
            };

            // TRY UP TO 3 TIMES FOR THE WHOLE SEQUENCE
            let success = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                console.log(`Export Attempt ${attempt}...`);

                // 1. Click Export
                let exportResult = await clickExport(newPage);
                if (!exportResult) {
                    for (const frame of newPage.frames()) {
                        exportResult = await clickExport(frame);
                        if (exportResult) break;
                    }
                }

                if (!exportResult) {
                    console.log('⚠️ Could not find Export button, retrying in 2s...');
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                if (exportResult === 'direct_js') {
                    success = true;
                    break;
                }

                // 2. Click PDF in Dropdown (wait up to 10s)
                console.log('⏳ Waiting for PDF option in dropdown...');
                let pdfClicked = false;
                for (let i = 0; i < 10; i++) {
                    pdfClicked = await clickPdfOption(newPage);
                    if (!pdfClicked) {
                        for (const frame of newPage.frames()) {
                            if (await clickPdfOption(frame)) {
                                pdfClicked = true;
                                break;
                            }
                        }
                    }
                    if (pdfClicked) break;
                    await new Promise(r => setTimeout(r, 1000));
                }

                if (pdfClicked) {
                    success = true;
                    break;
                } else {
                    console.log('⚠️ PDF option did not appear, retrying Export click...');
                }
            }

            if (!success) throw new Error('Failed to trigger PDF export after 3 attempts');

        } catch (e) {
            console.error('Error during click sequence:', e.message);
            throw e;
        }

        /* 4️⃣ WAIT FOR DOWNLOAD IN UNIQUE TEMP DIR */
        console.log('⏳ Waiting for download to complete...');
        const downloadedFileName = await waitForFile(tempDownloadDir, 60000); // 60s timeout
        const downloadedFilePath = path.join(tempDownloadDir, downloadedFileName);

        // Rename/Move to the final desired name in the main station folder
        fs.renameSync(downloadedFilePath, finalPdfPath);

        console.log(`✅ PDF saved via Export: ${finalPdfPath}\n`);

        // 🆕 Clean up the temp directory
        try {
            fs.rmSync(tempDownloadDir, { recursive: true, force: true });
        } catch (e) {
            console.warn(`⚠️ Warning: Could not remove temp dir ${tempDownloadDir}: ${e.message}`);
        }

        if (newPage && !newPage.isClosed()) await newPage.close();
        return finalPdfPath;

    } catch (err) {
        if (newPage && !newPage.isClosed()) await newPage.close();
        // Clean up temp dir even on error
        if (fs.existsSync(tempDownloadDir)) {
            try { fs.rmSync(tempDownloadDir, { recursive: true, force: true }); } catch (e) { }
        }
        throw err;
    }
}
