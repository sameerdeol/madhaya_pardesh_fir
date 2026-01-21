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
    await Promise.all([
        page.select('#ContentPlaceHolder1_ddlDistrictFirSearch', districtValue),
        page.waitForFunction((init) => {
            const ddl = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch');
            if (!ddl) return false;
            // Postback happened if HTML changed OR count > 1 (and it was 1 or 0 before)
            const changed = ddl.innerHTML !== init.html;
            const hasOptions = ddl.options.length > 1;
            return changed && hasOptions;
        }, { timeout: 30000 }, initialState).catch(e => {
            console.warn('⚠️ selectDistrict wait timed out, continuing anyway...');
        })
    ]);

    // 4. Final verification wait (very short)
    await waitForPoliceStations(page);
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

// Select a police station
export async function selectPoliceStation(page, psValue) {
    console.log(`Selecting Station: ${psValue}...`);
    await page.select('#ContentPlaceHolder1_ddlPoliceStationFirSearch', psValue);

    // Attempt to wait for any postback or just stabilize
    // Some sites trigger postback on station select too (e.g. to load other filters?)
    await new Promise(r => setTimeout(r, 1000));
}


// -------------------- FIR EXTRACTION --------------------
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
        // CLEAR PREVIOUS RESULTS TO ENSURE FRESHNESS
        await page.evaluate(() => {
            const grid = document.querySelector('#ContentPlaceHolder1_gdvFirSearch');
            if (grid) grid.innerHTML = ''; // Nuke the table content

            // Also remove any "No Record Found" message if it exists in a specific span?
            // Usually it's in a span or div, let's just trust the grid clear for now.
        });

        const clicked = await page.evaluate(() => {
            // DEBUG: Log values before clicking
            const dist = document.querySelector('#ContentPlaceHolder1_ddlDistrictFirSearch')?.value;
            const ps = document.querySelector('#ContentPlaceHolder1_ddlPoliceStationFirSearch')?.value;
            const dt = document.querySelector('#ContentPlaceHolder1_txtFirSearchDate')?.value;
            console.log(`🔍 SEARCH DEBUG: Dist=${dist}, PS=${ps}, Date=${dt}`);

            // Check for ALERT usage - some sites use alerts for "Select Station"
            // We can't catch it here easily in evaluate unless we stub window.alert, 
            // but puppeteerService.js initBrowser already handles dialogs.

            // Try common IDs for the search button based on the naming convention
            const btn = document.querySelector('#ContentPlaceHolder1_btnFirSearch')
                || document.querySelector('input[type="submit"][value="Search"]')
                || document.querySelector('#ContentPlaceHolder1_btnSearch');

            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        if (clicked) {
            console.log('Search clicked, waiting for results...');
            // Wait for results grid OR no records message
            await page.waitForFunction(() => {
                const grid = document.querySelector('#ContentPlaceHolder1_gdvFirSearch');
                // Since we nuked it, if it exists and has content, it's new!
                // OR if "No Record Found" appears in body.

                const hasGridContent = grid && grid.innerText.trim().length > 10;
                const noRecords = document.body.innerText.includes('No Record Found');
                const alert = document.querySelector('.alert');

                return hasGridContent || noRecords || alert;
            }, { timeout: 60000 }); // Increased timeout to 60s

            // Stabilization wait to ensure table is fully rendered
            await new Promise(r => setTimeout(r, 2000));
        }

        return clicked;
    } catch (err) {
        console.error('Error clicking search:', err.message);
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

export async function downloadFIRPdf({
    page,
    firNo,
    requestName,
    districtName,
    psName,
    requestId,
    dbFirId
}) {
    const sanitizedFirNo = firNo.replace(/[^a-zA-Z0-9]/g, '_');
    const downloadDir = path.join(
        process.cwd(),
        'download',
        requestName || 'Default',
        districtName,
        psName
    );
    fs.mkdirSync(downloadDir, { recursive: true });

    const finalPdfPath = path.join(downloadDir, `${sanitizedFirNo}.pdf`);
    // Delete existing file to avoid confusion
    if (fs.existsSync(finalPdfPath)) fs.unlinkSync(finalPdfPath);

    let newPage;
    let pdfUrl = null;

    try {
        console.log(`\n================================================================================`);
        console.log(`⬇️ STARTING PDF DOWNLOAD FOR FIR: ${firNo}`);
        console.log(`================================================================================`);

        /* 1️⃣ OPEN FIR POPUP */
        const popupPromise = new Promise(res => page.once('popup', res));

        await page.evaluate(firNo => {
            const rows = [...document.querySelectorAll('#ContentPlaceHolder1_gdvFirSearch tr')]; // Use generic tr
            const row = rows.find(r => r.cells[1]?.innerText.trim() === firNo);
            row?.querySelector('a')?.click();
        }, firNo);

        newPage = await popupPromise;
        if (!newPage) throw new Error('FIR popup did not open');

        console.log('!!! 🟢 POPUP OPENED !!!');
        await newPage.setViewport({ width: 1300, height: 900 });

        /* 2️⃣ CAPTURE PDF DOWNLOAD REQUEST */
        // Removed verbose "POPUP RES" logs to clean up output
        newPage.on('response', res => {
            const url = res.url();
            if (url.toLowerCase().includes('format=pdf')) {
                pdfUrl = url;
                process.stdout.write('📄 PDF request triggered internally...\n');
            }
        });

        /* 3️⃣ WAIT FOR EXPORT BUTTON (INLINE REPORTVIEWER) */
        process.stdout.write('⏳ Waiting for Export button (timeout 90s)...\n');

        // Increased timeout to 90s for slow loading
        const exportSelector = 'a[id$="_ButtonLink"] img[src*="Export.gif"]';
        // Note: The ID often ends in _ctl05_ctl04_ctl00_ButtonLink or similar
        // We look for any img with Export.gif inside an 'a' tag ending in ButtonLink logic is good, 
        // or just the image itself.

        await newPage.waitForSelector(exportSelector, { timeout: 90000 });

        /* 4️⃣ SETUP DOWNLOAD & CLICK */
        // 1. Configure Download Path
        const client = await newPage.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir,
        });

        // 2. Click Logic - Optimized
        const startTime = Date.now();
        let downloadStarted = false;
        let downloadedFileName = null;
        const initialFiles = new Set(fs.readdirSync(downloadDir));

        console.log('🖱️ Attempting to click Export -> PDF...');

        while (!downloadStarted && Date.now() - startTime < 90000) { // 90s Loop

            try {
                // Click Export Icon
                await newPage.evaluate(() => {
                    const exportImg = [...document.querySelectorAll('img')].find(img => img.src.includes('Export.gif'));
                    if (exportImg) exportImg.click();
                });

                // Wait for Menu to appear (it's usually a div with 'PDF' link)
                // Relaxed wait - just sleep a bit
                await new Promise(r => setTimeout(r, 1500));

                // Try to Click PDF Link
                const clickedPdf = await newPage.evaluate(() => {
                    // The menu items are usually <a> tags with text "PDF" visible
                    const links = [...document.querySelectorAll('a')];
                    const pdfLink = links.find(a => a.innerText && a.innerText.trim() === 'PDF');
                    if (pdfLink && pdfLink.offsetParent !== null) { // Check visibility
                        pdfLink.click();
                        return true;
                    }
                    return false;
                });

                if (clickedPdf) {
                    process.stdout.write('🖱️ PDF Option Clicked. Waiting for file...\n');
                    // Wait longer after clicking PDF to allow start
                    await new Promise(r => setTimeout(r, 5000));
                } else {
                    process.stdout.write('.'); // Retry dot
                }

            } catch (err) {
                // Ignore transient interaction errors
            }

            // Poll for file existence
            const currentFiles = fs.readdirSync(downloadDir);
            const newFile = currentFiles.find(f => !initialFiles.has(f) && (f.endsWith('.pdf') || f.endsWith('.crdownload')));

            if (newFile) {
                process.stdout.write(`\n✅ Download detected in FS: ${newFile}\n`);
                downloadStarted = true;
                downloadedFileName = newFile;
                break;
            }

            await new Promise(r => setTimeout(r, 2000));
        }

        if (!downloadStarted) throw new Error('PDF download never started (File not found in 90s)');

        /* 5️⃣ WAIT & RENAME */
        process.stdout.write('⬇️ Waiting for download completion...\n');

        let finalFileName = downloadedFileName;
        const downloadStartTime = Date.now();

        while (true) {
            // Check timeout (120s max for download)
            if (Date.now() - downloadStartTime > 120000) throw new Error('Download stuck/timeout');

            const files = fs.readdirSync(downloadDir);

            // If it was crdownload and now gone, look for the .pdf
            if (finalFileName.endsWith('.crdownload') && !files.includes(finalFileName)) {
                // It might be renamed to .pdf
                const stablePdf = files.find(f => f.endsWith('.pdf') && !initialFiles.has(f));
                if (stablePdf) {
                    finalFileName = stablePdf;
                    break; // Done
                }
            } else if (finalFileName.endsWith('.pdf')) {
                // Check if size is stable/growing? Or just assume done if valid PDF?
                // Usually Chrome keeps .crdownload until done. If it's .pdf, it should be done.
                // Just ensuring it has size > 0
                try {
                    const stats = fs.statSync(path.join(downloadDir, finalFileName));
                    if (stats.size > 0) break;
                } catch (e) { }
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        // Final Rename
        const oldPath = path.join(downloadDir, finalFileName);
        // Sometimes the file name is already correct but we want to sanitize
        if (path.basename(oldPath) !== `${sanitizedFirNo}.pdf`) {
            // Force rename to our format
            // But wait, if we are running parallel this might be risky? 
            // No, generic loop prevents parallel for now.
            fs.renameSync(oldPath, finalPdfPath);
        }

        process.stdout.write(`✅ PDF saved: ${finalPdfPath}\n`);

        // Close the popup to free resources!
        if (newPage && !newPage.isClosed()) await newPage.close();

        return finalPdfPath;

    } catch (err) {
        if (newPage && !newPage.isClosed()) await newPage.close();
        throw err;
    }
}
