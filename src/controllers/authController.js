import { getPage, isBrowserReady, initBrowser } from '../services/puppeteerService.js';

export async function checkStatus(req, res) {
    const ready = isBrowserReady();
    let isLoggedIn = false;

    if (ready) {
        try {
            const page = getPage();
            // Check if we are on the search page (logged in)
            isLoggedIn = page.url().includes('FirSearch.aspx');
        } catch (e) {
            console.error('Status Check Error (ignoring):', e.message);
            isLoggedIn = false;
        }
    }

    console.log(`DEBUG CheckStatus: ready=${ready}, isLoggedIn=${isLoggedIn}`);

    res.json({
        ready,
        isLoggedIn,
        // Debug info
        status: ready ? (isLoggedIn ? 'logged_in' : 'ready_for_otp') : 'initializing'
    });
}

// -------------------- SEND OTP --------------------
export async function sendOtp(req, res) {
    const { mobile } = req.body;

    if (!isBrowserReady()) {
        console.log('♻️ Browser not ready → re-initializing...');
        await initBrowser();

        if (!isBrowserReady()) {
            return res.status(503).json({
                success: false,
                error: 'System is initializing. Please wait...'
            });
        }
    }

    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`Input Attempt ${i + 1}/${maxRetries}...`);

            let page;
            try {
                page = getPage();
            } catch (e) {
                console.log('⚠️ Browser not initialized (getPage failed). Re-initializing...');
                await initBrowser();
                page = getPage();
            }

            // Self-Healing: Check if closed
            if (page.isClosed()) {
                console.log('♻️ Page found closed. Performing full re-initialization...');
                await initBrowser();
                page = getPage();
            }

            // Wait for input
            const inputSelector = '#ContentPlaceHolder1_txtMobileNo';
            console.log('Current URL:', page.url());

            // Check if we are already on a page with the login input
            const hasInput = await page.evaluate(() => !!document.querySelector('#ContentPlaceHolder1_txtMobileNo'));

            // 🛑 PREVENT RELOAD IF ALREADY LOGGED IN
            const isAlreadyLoggedIn = page.url().includes('FirSearch.aspx');

            if (isAlreadyLoggedIn) {
                console.log('✅ Already on FIR Search page. Skipping login.');
                return res.json({ success: true });
            }

            if (!hasInput && !page.url().includes('Login.aspx') && !page.url().includes('FirView.aspx')) {
                console.log('Navigating to login page...');
                await page.goto('https://citizen.mppolice.gov.in/Login.aspx', {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
            }

            await page.waitForSelector(inputSelector, { visible: true, timeout: 30000 });

            // PERFORM ALL ACTIONS IN ONE EVALUATE TO REDUCE ROUND TRIPS
            await page.evaluate(async (mobileNo) => {
                const input = document.querySelector('#ContentPlaceHolder1_txtMobileNo');
                const btn = document.querySelector('#ContentPlaceHolder1_btnGenerateOTP');

                if (input) {
                    input.focus();
                    input.value = mobileNo;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.blur();
                } else {
                    throw new Error('Mobile Input not found in DOM');
                }

                // Small wait to ensure value sticks (if any JS validation exists)
                await new Promise(r => setTimeout(r, 500));

                if (btn) {
                    btn.click();
                } else {
                    throw new Error('OTP Button not found in DOM');
                }
            }, mobile);

            console.log('✅ DOM actions executed successfully.');
            return res.json({ success: true });

        } catch (err) {
            console.error(`⚠️ Attempt ${i + 1} failed: ${err.message}`);

            if (i === maxRetries - 1) {
                return res.status(500).json({ success: false, error: err.message });
            }

            await new Promise(r => setTimeout(r, 1000));

            // Optionally reload if purely detached or destroyed
            if (err.message.includes('detached') || err.message.includes('destroyed') || err.message.includes('closed')) {
                try {
                    console.log('♻️ Reloading/Re-init page to fix context...');
                    // If closed, next loop will catch it. If just detached, replace it?
                    // Simpler to just continue, next getPage() check or reload might help
                    const p = getPage();
                    if (!p.isClosed()) await p.reload({ waitUntil: 'networkidle0' });
                } catch (e) { console.error('Reload failed:', e.message); }
            }
        }
    }
}

// -------------------- VERIFY OTP --------------------
export async function verifyOtp(req, res) {
    const { otp } = req.body;
    const page = getPage();

    try {
        console.log('Submitting OTP...');

        await page.waitForSelector('#ContentPlaceHolder1_txtOtp', { timeout: 10000 });

        // Fill OTP field with proper events
        await page.evaluate((otp) => {
            const input = document.querySelector('#ContentPlaceHolder1_txtOtp');
            if (input) {
                input.focus();
                input.value = otp;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.blur();
            }
        }, otp);

        // Click Submit
        await page.evaluate(() => {
            const btn = document.getElementById('ContentPlaceHolder1_btnSubmitOTP');
            if (btn) btn.click();
        });

        // 🟢 PREFERRED: Wait for URL Change (Robust)
        const startTime = Date.now();
        const maxWait = 45000;

        while (Date.now() - startTime < maxWait) {

            // 1. Success Check: URL changed to Search Page
            if (page.url().includes('FirSearch.aspx')) {
                console.log('✅ OTP Verified. Navigated to Search Page.');
                return res.json({ success: true });
            }

            // 2. Error Check: Error Message in DOM
            let errorMsg = null;
            try {
                errorMsg = await page.evaluate(() => {
                    const lbl = document.getElementById('ContentPlaceHolder1_lblMsg');
                    if (lbl && lbl.innerText && (lbl.innerText.includes('Incorrect') || lbl.innerText.includes('Invalid'))) {
                        return lbl.innerText;
                    }
                    const bodyText = document.body.innerText;
                    if (bodyText.includes('Incorrect OTP') || bodyText.includes('Invalid OTP')) {
                        return 'Incorrect OTP or Invalid OTP detected in page body';
                    }
                    return null;
                });
            } catch (e) {
                // Ignore context destruction (happens during successful navigation)
                if (e.message.includes('Execution context was destroyed')) {
                    console.log('Context destroyed (Navigation in progress)...');
                    // wait a bit and continue loop to let URL check pass next time
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }
                throw e; // Other errors should be thrown
            }

            if (errorMsg) {
                throw new Error(errorMsg);
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        throw new Error('Verify Timeout: No navigation or error message appeared.');

        res.json({ success: true });

    } catch (err) {
        console.error('OTP verify error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

export async function resendOtp(req, res) {
    const page = getPage();
    try {
        await page.click('#ContentPlaceHolder1_btnResend');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}
