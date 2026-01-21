import { getPage, isBrowserReady, initBrowser } from '../services/puppeteerService.js';

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

            if (!hasInput && !page.url().includes('Login.aspx') && !page.url().includes('FirView.aspx')) {
                console.log('Navigating to login page...');
                await page.goto('https://citizen.mppolice.gov.in/Login.aspx', {
                    waitUntil: 'networkidle2',
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

        // Fill OTP field
        await page.evaluate((otp) => {
            document.querySelector('#ContentPlaceHolder1_txtOtp').value = otp;
        }, otp);

        // Click OK via DOM
        await page.evaluate(() => {
            const btn = document.getElementById('ContentPlaceHolder1_btnSubmitOTP');
            if (btn) btn.click();
        });

        // 🔥 WAIT FOR FirSearch.aspx RESPONSE (NOT navigation)
        await page.waitForResponse(
            r =>
                r.url().includes('FirSearch.aspx') &&
                r.request().resourceType() === 'document',
            { timeout: 30000 }
        );

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
