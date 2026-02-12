import puppeteer from 'puppeteer';

let browser;
let page;
let isReady = false;
let initializing = false;
export async function initBrowser() {
    if (initializing) {
        process.stdout.write('⏳ Browser already initializing...\n');
        return;
    }

    if (browser && page && !page.isClosed() && isReady) {
        return { browser, page };
    }

    initializing = true;
    process.stdout.write('➡️ Launching background browser (HEADLESS mode)...\n');

    browser = await puppeteer.launch({
        headless: true, // 🟢 VISIBLE MODE (for debugging)
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    });

    page = await browser.newPage();

    // 🛑 FORCE CLEAR EVERYTHING to ensure fresh login
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    await client.send('Storage.clearDataForOrigin', {
        origin: 'https://citizen.mppolice.gov.in',
        storageTypes: 'all',
    });

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    );

    // Set Viewport to Desktop
    await page.setViewport({ width: 1366, height: 768 });

    // -------------------- HANDLE ALERTS --------------------
    page.on('dialog', async (dialog) => {
        const msg = dialog.message();
        process.stdout.write(`⚠️ ALERT: ${msg}\n`);
        await dialog.accept();
    });

    // -------------------- HANDLE CONSOLE LOGS --------------------
    page.on('console', msg => {
        if (msg.text() !== '107') {
            // console.log('PAGE LOG:', msg.text()); 
        }
    });

    // -------------------- INITIAL FLOW --------------------
    process.stdout.write('➡️ Navigating to homepage...\n');

    const maxNavRetries = 3;
    for (let i = 0; i < maxNavRetries; i++) {
        try {
            console.log(`🌐 Navigation Attempt ${i + 1}/${maxNavRetries}...`);
            await page.goto('https://citizen.mppolice.gov.in/', {
                waitUntil: 'domcontentloaded',
                timeout: 90000 // Increased timeout
            });
            console.log('✅ Homepage reached.');
            break; // Success
        } catch (e) {
            console.warn(`⚠️ Navigation Attempt ${i + 1} failed: ${e.message}`);
            if (i === maxNavRetries - 1) {
                const msg = "Source Website Not Responding, please try after some time";
                process.stdout.write(`❌ FATAL: ${msg}\n`);
                throw new Error(msg); // Rethrow to fail initialization
            }
            await new Promise(r => setTimeout(r, 5000)); // Wait before retry
        }
    }

    // Switch to English
    process.stdout.write('➡️ Switching to English...\n');
    try {
        await page.waitForFunction(() => typeof __doPostBack === 'function', { timeout: 10000 });

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { }),
            page.evaluate(() => __doPostBack('English', ''))
        ]);
        process.stdout.write('✅ Language switched.\n');
    } catch (e) {
        process.stdout.write(`⚠️ Language switch skipped: ${e.message}\n`);
    }


    // Small stabilization wait
    await new Promise(r => setTimeout(r, 2000));

    // Click FIR View
    process.stdout.write('➡️ Opening FIR View modal...\n');
    // Click FIR View
    process.stdout.write('➡️ Opening FIR View modal...\n');
    try {
        await page.waitForSelector('a[data-target="#FirViewModel_New"]', { timeout: 30000 });

        // Ensure successful click
        await page.evaluate(() => {
            const btn = document.querySelector('a[data-target="#FirViewModel_New"]');
            if (btn) btn.click();
        });

        // Wait for modal transition
        await page.waitForSelector('#FirViewModel_New', { timeout: 60000 });

        // Click YES
        process.stdout.write('➡️ Clicking YES button...\n');
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('#FirViewModel_New button, #FirViewModel_New a')]
                .find(b => {
                    const text = b.innerText.trim().toLowerCase();
                    return text === 'yes' || text === 'हाँ';
                });
            if (btn) btn.click();
        });

        // Wait for FIR page
        process.stdout.write('➡️ Waiting for FIR View page load...\n');
        await page.waitForSelector('#ContentPlaceHolder1_txtMobileNo', {
            timeout: 60000
        });

        process.stdout.write('✅ FIR View page ready (background)\n');
        isReady = true;
    } catch (err) {
        process.stdout.write(`❌ Initialization Failed: ${err.message}\n`);
        isReady = false;
    } finally {
        initializing = false;
    }

    return { browser, page };
}

export function getPage() {
    if (!page) throw new Error('Browser not initialized');
    return page;
}

export function getBrowser() {
    return browser;
}

export function isBrowserReady() {
    const readyState = (
        isReady &&
        browser &&
        page &&
        !page.isClosed()
    );
    // Debug log if false but we think we should be ready (optional, maybe too noisy for polling)
    if (!readyState && isReady) {
        // console.log(`DEBUG: isReady=${isReady}, browser=${!!browser}, page=${!!page}, closed=${page?.isClosed()}`);
    }
    return readyState;
}

export async function closeBrowser() {
    if (browser) {
        process.stdout.write('🛑 Closing browser instance...\n');
        await browser.close();
        browser = null;
        page = null;
        isReady = false;
        process.stdout.write('✅ Browser closed.\n');
    }
}
