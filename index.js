const puppeteer = require('puppeteer');
const xlsx = require('xlsx'); 
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ==========================================
// 🔑 إعدادات البوت (تليجرام)
// ==========================================
const TELEGRAM_TOKEN = '8620652430:AAGo2XuUlT4O96LNKJkbEUbn3d20ti-ppoo'; 
const CHAT_ID = '202909633';

const GLOBAL_START = parseInt(process.env.START) || 1;
const GLOBAL_MAX = parseInt(process.env.END) || 1000;
const BATCH_SIZE = 10; 

// دالة تنسيق الوقت (من ميللي ثانية لدقائق وثواني)
function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes} دقيقة و ${seconds} ثانية`;
}

async function sendLog(msg) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID, text: msg, parse_mode: 'HTML'
        });
        console.log(msg.replace(/<[^>]*>?/gm, '')); 
    } catch (e) { console.error('❌ خطأ تليجرام'); }
}

async function sendTelegramFile(filePath, caption) {
    try {
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('document', fs.createReadStream(filePath));
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
    } catch (e) { console.error('❌ خطأ إرسال ملف'); }
}

async function enableTurboMode(page) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
}

// ==========================================
// 🤖 المخ الرئيسي للبوت
// ==========================================
async function runCloudBot() {
    const startTime = Date.now(); // ⏱️ تسجيل وقت البداية
    let currentBatchStart = GLOBAL_START;
    let keepRunningGlobal = true;
    let totalUpdatedInAllBatches = 0;

    await sendLog(`🚀 <b>انطلاق نظام المجموعات (Batches)</b>\nالخطة: فحص وتحديث كل ${BATCH_SIZE} صفحات على حدة.`);

    while (keepRunningGlobal && currentBatchStart <= GLOBAL_MAX) {
        let currentBatchEnd = currentBatchStart + BATCH_SIZE - 1;
        let scoutedOrders = [];
        let activeBrowser = null;

        await sendLog(`📦 <b>بدء المجموعة:</b> من صـ ${currentBatchStart} لـ صـ ${currentBatchEnd}`);

        try {
            activeBrowser = await puppeteer.launch({ 
                headless: true, 
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
            });
            const page = await activeBrowser.newPage();
            await enableTurboMode(page);

            // تسجيل دخول سيلزا
            await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/Auth', { waitUntil: 'networkidle2' });
            await page.type('input[name="email"]', 'Admin@gmail.com'); 
            await page.type('input[name="password"]', 'Hh@102030');
            await page.keyboard.press('Enter');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });

            await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/orders', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 5000)); 

            // فلاتر SHIPPED و 100 أوردر
            await page.evaluate(async () => {
                const shipped = Array.from(document.querySelectorAll('.filter-label, p, span')).find(el => el.textContent.trim() === 'SHIPPED');
                if (shipped) shipped.click();
                await new Promise(r => setTimeout(r, 3000));
                const rpp = document.querySelector('p-dropdown.p-paginator-rpp-options');
                if (rpp) {
                    rpp.click(); await new Promise(r => setTimeout(r, 1500));
                    const opt100 = Array.from(document.querySelectorAll('.p-dropdown-item')).find(el => el.innerText.trim() === '100');
                    if (opt100) opt100.click();
                }
            });
            await new Promise(r => setTimeout(r, 6000));

            // الذهاب لصفحة البداية
            if (currentBatchStart > 1) {
                await page.evaluate(async (target) => {
                    let current = 1;
                    while (current < target) {
                        const next = document.querySelector('.p-paginator-next');
                        if (next && !next.classList.contains('p-disabled')) { next.click(); current++; await new Promise(r => setTimeout(r, 1500)); } else break;
                    }
                }, currentBatchStart);
            }

            // سحب البيانات
            let pCount = currentBatchStart;
            let hasNextPage = true;
            while (pCount <= currentBatchEnd && hasNextPage) {
                await sendLog(`📄 فحص صـ (${pCount})...`);
                const pageData = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    let data = [];
                    for (let row of rows) {
                        const elements = Array.from(row.querySelectorAll('p.mh3.mw6')).map(el => el.innerText.trim());
                        if (elements.length === 0) continue;
                        let sellzaPhone = null; let code = null;
                        for (let text of elements) {
                            let clean = text.replace(/[\s\+]/g, '');
                            if (/^(01|1|201)[0-9]{9}$/.test(clean)) sellzaPhone = clean.length === 11 ? clean : `0${clean.slice(-10)}`; 
                            else if (/^[0-9]{4,8}$/.test(clean) && !/^(01|1|201)/.test(clean)) code = clean;
                        }
                        if (sellzaPhone && code) data.push({ sellzaPhone, bosatPhone: sellzaPhone.slice(-10), code });
                    }
                    return data;
                });
                scoutedOrders.push(...pageData);
                
                hasNextPage = await page.evaluate(() => {
                    const next = document.querySelector('.p-paginator-next');
                    if (next && !next.classList.contains('p-disabled')) { next.click(); return true; }
                    return false;
                });
                if (hasNextPage && pCount < currentBatchEnd) { pCount++; await new Promise(r => setTimeout(r, 4000)); } else { hasNextPage = false; }
            }

            // فحص بساط والتحديث
            if (scoutedOrders.length > 0) {
                const bosatPage = await activeBrowser.newPage();
                await enableTurboMode(bosatPage);
                await bosatPage.goto('https://bosatexpress.com/index');
                await bosatPage.type('#Txt_Emp_User_Login', 'admin1');
                await bosatPage.type('#Txt_Emp_Pass', 'Hh100100');
                await bosatPage.click('#LnkLogin');
                await new Promise(r => setTimeout(r, 3000));
                await bosatPage.goto('https://bosatexpress.com/FollowUpOreders');

                let toUpdate = [];
                for (let order of scoutedOrders) {
                    try {
                        await bosatPage.bringToFront();
                        await bosatPage.evaluate(() => {
                            const input = document.querySelector('#ArMainContent_UcFollow_Up_Orders_TxtSearch');
                            if(input) input.value = '';
                            document.querySelectorAll('tr').forEach(r => { if(r.innerText.includes('البوليصة')) r.innerHTML = ''; });
                        });
                        await bosatPage.type('#ArMainContent_UcFollow_Up_Orders_TxtSearch', order.bosatPhone);
                        await bosatPage.keyboard.press('Enter');
                        await new Promise(r => setTimeout(r, 2500));

                        const res = await bosatPage.evaluate(() => {
                            const rows = Array.from(document.querySelectorAll('tr'));
                            let sIdx = -1, dRow = null;
                            for (let i = 0; i < rows.length; i++) {
                                if (rows[i].innerText.includes('حالة الشحنة')) {
                                    sIdx = Array.from(rows[i].children).findIndex(c => c.innerText.includes('حالة الشحنة'));
                                    if (i + 1 < rows.length) dRow = rows[i + 1]; break;
                                }
                            }
                            return (dRow && sIdx !== -1) ? dRow.children[sIdx].innerText.trim().split('\n')[0].trim() : "N/A";
                        });

                        if (res === 'تم التسليم') order.target = "DELIVERED";
                        else if (['مرتجع', 'ملغي', 'المرتجع للراسل'].some(s => res.includes(s))) order.target = "RETURNED";
                        if (order.target) toUpdate.push(order);
                    } catch(e) {}
                }

                if (toUpdate.length > 0) {
                    await page.bringToFront();
                    await page.reload({ waitUntil: 'networkidle2' });
                    await new Promise(r => setTimeout(r, 5000));
                    for (let order of toUpdate) {
                        try {
                            const search = 'input[placeholder*="Customer"]';
                            await page.waitForSelector(search);
                            await page.evaluate((s) => { document.querySelector(s).value = ''; }, search);
                            await page.type(search, order.sellzaPhone);
                            await page.keyboard.press('Enter');
                            await new Promise(r => setTimeout(r, 4000));
                            const updated = await page.evaluate(async (code, action) => {
                                const row = Array.from(document.querySelectorAll('tr')).find(r => r.innerText.includes(code));
                                if (row) {
                                    const btn = row.querySelector('button .pi-angle-down');
                                    if (btn) {
                                        btn.closest('button').click(); await new Promise(r => setTimeout(r, 1000));
                                        const opt = Array.from(document.querySelectorAll('app-status-dropdown p, span')).find(p => p.textContent.trim().toUpperCase() === action);
                                        if (opt) { opt.closest('.element-inner').click(); return true; }
                                    }
                                }
                                return false;
                            }, order.code, order.target);
                            if (updated) {
                                await new Promise(r => setTimeout(r, 1500));
                                await page.evaluate(() => {
                                    const c = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('CONFIRM'));
                                    if (c) c.click();
                                });
                                totalUpdatedInAllBatches++;
                                await new Promise(r => setTimeout(r, 5000));
                            }
                        } catch(err) {}
                    }
                }
            }

            if (!hasNextPage) { keepRunningGlobal = false; }
            currentBatchStart += BATCH_SIZE;

        } catch (e) {
            await sendLog(`❌ خطأ: ${e.message}`);
            currentBatchStart += BATCH_SIZE;
        } finally {
            if (activeBrowser) await activeBrowser.close();
        }
    }

    const endTime = Date.now(); // ⏱️ تسجيل وقت النهاية
    const duration = formatDuration(endTime - startTime); // حساب الفرق

    await sendLog(`🏁 <b>انتهت المأمورية بالكامل</b>\n🎯 إجمالي التحديثات: ${totalUpdatedInAllBatches} أوردر\n⏱️ الوقت المستغرق: <b>${duration}</b>`);
    process.exit(0);
}

runCloudBot();
