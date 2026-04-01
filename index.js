const puppeteer = require('puppeteer');
const xlsx = require('xlsx'); 
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ==========================================
// 🔑 إعدادات البوت (تُسحب من بيئة GitHub Actions)
// ==========================================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 
const CHAT_ID = process.env.CHAT_ID;
const SELLZA_EMAIL = process.env.SELLZA_EMAIL;
const SELLZA_PASS = process.env.SELLZA_PASS;
const BOSAT_USER = process.env.BOSAT_USER;
const BOSAT_PASS = process.env.BOSAT_PASS;

const GLOBAL_START = parseInt(process.env.START) || 1;
const GLOBAL_MAX = parseInt(process.env.END) || 1000;
const BATCH_SIZE = 10; 

let startTime = Date.now();
let totalUpdatedCount = 0;
let masterReportData = [];
let isReportSent = false;

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

async function sendFinalReport(reason) {
    if (isReportSent) return; 
    isReportSent = true; 
    const duration = formatDuration(Date.now() - startTime);
    if (masterReportData.length > 0) {
        const ws = xlsx.utils.json_to_sheet(masterReportData);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "التقرير الشامل");
        const fPath = path.join(__dirname, 'Full_Report.xlsx');
        xlsx.writeFile(wb, fPath);
        await sendTelegramFile(fPath, `🏁 <b>حالة المأمورية: ${reason}</b>\n🎯 إجمالي التحديثات: ${totalUpdatedCount}\n⏱️ الوقت الكلي: <b>${duration}</b>`);
        if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
    } else {
        await sendLog(`🏁 <b>حالة المأمورية: ${reason}</b>\nلا توجد بيانات للتقرير.\n⏱️ الوقت: <b>${duration}</b>`);
    }
    process.exit(0);
}

process.on('SIGINT', async () => { await sendFinalReport('إيقاف يدوي'); });
process.on('uncaughtException', async (err) => { await sendLog(`❌ خطأ حرج: ${err.message}`); await sendFinalReport('توقف بسبب خطأ'); });

async function runCloudBot() {
    let currentBatchStart = GLOBAL_START;
    let keepRunningGlobal = true;

    await sendLog(`🚀 <b>انطلاق القناص (النسخة النهائية)</b>\nالرادار المباشر يعمل 📟 | الحماية الكاملة مُفعلة 🛡️`);

    while (keepRunningGlobal && currentBatchStart <= GLOBAL_MAX) {
        let currentBatchEnd = currentBatchStart + BATCH_SIZE - 1;
        let scoutedOrders = [];
        let activeBrowser = null;
        let isWebsiteFinished = false;

        try {
            activeBrowser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
            const page = await activeBrowser.newPage();

            await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/Auth', { waitUntil: 'networkidle2' });
            await page.type('input[name="email"]', SELLZA_EMAIL); 
            await page.type('input[name="password"]', SELLZA_PASS);
            await page.keyboard.press('Enter');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/orders', { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 5000)); 

            await page.evaluate(async () => {
                const shipped = Array.from(document.querySelectorAll('.filter-label, p, span')).find(el => el.textContent.trim() === 'SHIPPED');
                if (shipped) shipped.click();
                await new Promise(r => setTimeout(r, 3000));
                const rpp = document.querySelector('p-dropdown.p-paginator-rpp-options');
                if (rpp) {
                    rpp.click(); await new Promise(r => setTimeout(r, 1000));
                    const opt100 = Array.from(document.querySelectorAll('.p-dropdown-item')).find(el => el.innerText.trim() === '100');
                    if (opt100) opt100.click();
                }
            });
            await new Promise(r => setTimeout(r, 6000));

            if (currentBatchStart > 1) {
                await page.evaluate(async (target) => {
                    let current = 1;
                    while (current < target) {
                        const next = document.querySelector('.p-paginator-next');
                        if (next && !next.classList.contains('p-disabled')) { next.click(); current++; await new Promise(r => setTimeout(r, 1000)); } else break;
                    }
                }, currentBatchStart);
                await new Promise(r => setTimeout(r, 3000));
            }

            for (let pCount = currentBatchStart; pCount <= currentBatchEnd; pCount++) {
                const pageData = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    let data = [];
                    for (let row of rows) {
                        const elements = Array.from(row.querySelectorAll('p.mh3.mw6')).map(el => el.innerText.trim());
                        if (elements.length === 0) continue;
                        let sPhone = null; let code = null;
                        for (let text of elements) {
                            let clean = text.replace(/[\s\+]/g, '');
                            if (/^(01|1|201)[0-9]{9}$/.test(clean)) sPhone = clean.length === 11 ? clean : `0${clean.slice(-10)}`; 
                            else if (/^[0-9]{4,8}$/.test(clean) && !/^(01|1|201)/.test(clean)) code = clean;
                        }
                        if (sPhone && code) data.push({ sellzaPhone: sPhone, bosatPhone: sPhone.slice(-10), code });
                    }
                    return data;
                });
                scoutedOrders.push(...pageData);
                const canNext = await page.evaluate(() => {
                    const n = document.querySelector('.p-paginator-next');
                    return (n && !n.classList.contains('p-disabled'));
                });
                if (canNext && pCount < currentBatchEnd) { 
                    await page.evaluate(() => document.querySelector('.p-paginator-next').click());
                    await new Promise(r => setTimeout(r, 4000));
                } else { if(!canNext) isWebsiteFinished = true; break; }
            }

            if (scoutedOrders.length > 0) {
                const bosatPage = await activeBrowser.newPage();
                await bosatPage.goto('https://bosatexpress.com/index');
                await bosatPage.type('#Txt_Emp_User_Login', BOSAT_USER);
                await bosatPage.type('#Txt_Emp_Pass', BOSAT_PASS);
                await bosatPage.click('#LnkLogin');
                await new Promise(r => setTimeout(r, 3000));
                await bosatPage.goto('https://bosatexpress.com/FollowUpOreders');

                for (let o of scoutedOrders) {
                    try {
                        await bosatPage.bringToFront();
                        await bosatPage.evaluate(() => { 
                            const inp = document.querySelector('#ArMainContent_UcFollow_Up_Orders_TxtSearch');
                            if(inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
                        });
                        await bosatPage.type('#ArMainContent_UcFollow_Up_Orders_TxtSearch', o.bosatPhone);
                        await bosatPage.keyboard.press('Enter');
                        await new Promise(r => setTimeout(r, 2500));
                        
                        let bosatInfo = await bosatPage.evaluate((sellzaCode) => {
                            const rows = Array.from(document.querySelectorAll('tr'));
                            let sIdx = -1, codeIdx = -1;
                            let statusText = "غير مسجل";
                            for (let i = 0; i < rows.length; i++) {
                                const texts = Array.from(rows[i].children).map(c => c.innerText.trim());
                                if (texts.includes('حالة الشحنة') && texts.includes('كود التاجر')) {
                                    sIdx = texts.indexOf('حالة الشحنة');
                                    codeIdx = texts.indexOf('كود التاجر');
                                    break; 
                                }
                            }
                            if (sIdx !== -1 && codeIdx !== -1) {
                                for (let i = 0; i < rows.length; i++) {
                                    if (rows[i].children[codeIdx] && rows[i].children[codeIdx].innerText.trim() === String(sellzaCode)) {
                                        statusText = rows[i].children[sIdx].innerText.trim().split('\n')[0].trim();
                                        break; 
                                    }
                                }
                            }
                            return statusText;
                        }, o.code);

                        o.statusInBosat = bosatInfo;

                        // الحالات الشرطية المحدثة
                        if (o.statusInBosat === 'تم التسليم' || o.statusInBosat.includes('تم تسليم')) {
                            o.action = "DELIVERED";
                        } else if (['مرتجع', 'ملغي', 'المرتجع للراسل'].some(s => o.statusInBosat.includes(s))) {
                            o.action = "RETURNED";
                        } else if (o.statusInBosat.includes('قيد انتظار الموافقة') || o.statusInBosat.includes('في مخزن الشحن')) {
                            o.action = "IN PACKING";
                        } else {
                            o.action = "In Transit";
                        }

                        if (o.action !== "In Transit") {
                            await page.bringToFront();
                            const sInp = 'input[placeholder*="Customer"]';
                            await page.evaluate((s) => { 
                                const input = document.querySelector(s);
                                if(input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
                            }, sInp);
                            await page.type(sInp, o.sellzaPhone);
                            await page.keyboard.press('Enter');
                            await new Promise(r => setTimeout(r, 4000));
                            
                            const done = await page.evaluate(async (c, a) => {
                                const r = Array.from(document.querySelectorAll('tr')).find(row => row.innerText.includes(c));
                                if (r && r.querySelector('button .pi-angle-down')) {
                                    r.querySelector('button .pi-angle-down').closest('button').click();
                                    await new Promise(res => setTimeout(res, 1200));
                                    const opt = Array.from(document.querySelectorAll('app-status-dropdown p, span'))
                                                     .find(p => p.textContent.trim().toUpperCase() === a.toUpperCase());
                                    if (opt) { opt.closest('.element-inner').click(); return true; }
                                }
                                return false;
                            }, o.code, o.action);
                            
                            if (done) {
                                await page.evaluate(() => { const c = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('CONFIRM')); if (c) c.click(); });
                                totalUpdatedCount++;
                                await new Promise(r => setTimeout(r, 5000));
                            }
                        }
                        masterReportData.push({ "كود سيلزا": o.code, "الموبايل": o.sellzaPhone, "حالة بساط": o.statusInBosat, "التصرف": o.action });
                    } catch(e) { console.error(`خطأ شحنة ${o.code}`); }
                }
            }
            if (isWebsiteFinished) { keepRunningGlobal = false; } else { currentBatchStart += BATCH_SIZE; }
        } catch (e) { await sendLog(`❌ عطل: ${e.message}`); currentBatchStart += BATCH_SIZE; }
        finally { if (activeBrowser) await activeBrowser.close(); }
    }
    await sendFinalReport('تمت المأمورية بنجاح'); 
}

runCloudBot();
