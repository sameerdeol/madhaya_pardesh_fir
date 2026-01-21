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
    process.stdout.write('➡️ Launching background browser (visible mode)...\n');

    browser = await puppeteer.launch({
        headless: false, // 🔴 BACKGROUND MODE
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();

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
    try {
        await page.goto('https://citizen.mppolice.gov.in/', {
            waitUntil: 'domcontentloaded', // Relaxed
            timeout: 60000
        });
    } catch (e) {
        process.stdout.write(`⚠️ Initial navigation timeout/error: ${e.message}\n`);
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
    try {
        await page.waitForSelector('a[data-target="#FirViewModel_New"]', { visible: true, timeout: 20000 });
        await page.evaluate(() => {
            document.querySelector('a[data-target="#FirViewModel_New"]').click();
        });

        await page.waitForSelector('#FirViewModel_New', { visible: true, timeout: 10000 });

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
            visible: true,
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
    return (
        isReady &&
        browser &&
        page &&
        !page.isClosed()
    );
}
