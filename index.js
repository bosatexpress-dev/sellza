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
const CHAT_ID = '533842418';

const START_PAGE = parseInt(process.env.START) || 1;
const MAX_END_PAGE = parseInt(process.env.END) || 1000;

// دالة إرسال التقارير اللحظية
async function sendLog(msg) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID, text: msg, parse_mode: 'HTML'
        });
        console.log(msg.replace(/<[^>]*>?/gm, '')); 
    } catch (e) { console.error('❌ فشل إرسال التقرير لتليجرام'); }
}

async function sendTelegramFile(filePath, caption) {
    try {
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('document', fs.createReadStream(filePath));
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
    } catch (e) { console.error('❌ خطأ إرسال الملف'); }
}

async function enableTurboMode(page) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
}

async function runCloudBot() {
    let scoutedOrders = []; 
    let activeBrowser = null;
    
    await sendLog(`🚀 <b>بدء المأمورية</b>\n🎯 النطاق: من صـ ${START_PAGE} لـ صـ ${MAX_END_PAGE}`);
    
    try {
        activeBrowser = await puppeteer.launch({ 
            headless: true, 
            args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        
        const page = await activeBrowser.newPage();
        await enableTurboMode(page); 

        // 1. دخول سيلزا
        await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/Auth', { waitUntil: 'networkidle2' });
        await page.type('input[name="email"]', 'Admin@gmail.com'); 
        await page.type('input[name="password"]', 'Hh@102030');
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/orders', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000)); 

        await sendLog(`⏳ جاري تفعيل الفلاتر (SHIPPED & 100 أوردر)...`);
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

        if (START_PAGE > 1) {
            await sendLog(`⏩ تخطي لصفحة رقم ${START_PAGE}...`);
            await page.evaluate(async (target) => {
                let current = 1;
                while (current < target) {
                    const next = document.querySelector('.p-paginator-next');
                    if (next && !next.classList.contains('p-disabled')) { next.click(); current++; await new Promise(r => setTimeout(r, 1500)); } else break;
                }
            }, START_PAGE);
        }

        let currentPage = START_PAGE;
        let hasNext = true;

        // المرحلة الأولى: الاستطلاع
        while (hasNext && currentPage <= MAX_END_PAGE) {
            await sendLog(`📄 فحص صفحة <b>(${currentPage})</b>...`);
            const pageData = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('tr'));
                let data = [];
                for (let row of rows) {
                    const elements = Array.from(row.querySelectorAll('p.mh3.mw6')).map(el => el.innerText.trim());
                    if (elements.length === 0) continue;
                    let sellzaPhone = null; let bosatPhone = null; let code = null;
                    for (let text of elements) {
                        let clean = text.replace(/[\s\+]/g, '');
                        if (/^(01|1|201)[0-9]{9}$/.test(clean)) {
                            sellzaPhone = clean.length === 11 ? clean : `0${clean.slice(-10)}`; 
                            bosatPhone = clean.slice(-10); 
                        }
                        else if (/^[0-9]{4,8}$/.test(clean) && !/^(01|1|201)/.test(clean)) code = clean;
                    }
                    if (sellzaPhone && code) data.push({ sellzaPhone, bosatPhone, code });
                }
                return data;
            });

            scoutedOrders.push(...pageData);
            hasNext = await page.evaluate(() => {
                const next = document.querySelector('.p-paginator-next');
                if (next && !next.classList.contains('p-disabled')) { next.click(); return true; }
                return false;
            });
            if (hasNext && currentPage < MAX_END_PAGE) { currentPage++; await new Promise(r => setTimeout(r, 4000)); } else { hasNext = false; }
        }

        await sendLog(`✅ تم سحب ${scoutedOrders.length} أوردر.\n🕵️‍♂️ جاري التحري عن الحالات في بساط...`);

        // المرحلة الثانية: بساط
        const bosatPage = await activeBrowser.newPage();
        await enableTurboMode(bosatPage); 
        await bosatPage.goto('https://bosatexpress.com/index');
        await bosatPage.type('#Txt_Emp_User_Login', 'admin1');
        await bosatPage.type('#Txt_Emp_Pass', 'Hh100100');
        await bosatPage.click('#LnkLogin');
        await new Promise(r => setTimeout(r, 3000));
        await bosatPage.goto('https://bosatexpress.com/FollowUpOreders');

        let ordersReadyToUpdate = []; 
        for (let order of scoutedOrders) {
            let bosatResult = null;
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

                bosatResult = await bosatPage.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    let sIdx = -1, dataRow = null;
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i].innerText.includes('حالة الشحنة')) {
                            sIdx = Array.from(rows[i].children).findIndex(c => c.innerText.includes('حالة الشحنة'));
                            if (i + 1 < rows.length) dataRow = rows[i + 1]; break;
                        }
                    }
                    if (dataRow && sIdx !== -1) return dataRow.children[sIdx].innerText.trim().split('\n')[0].trim();
                    return "لا يوجد نتائج";
                });
            } catch(e) {}

            if (bosatResult === 'تم التسليم') order.targetAction = "DELIVERED 🟢";
            else if (['مرتجع', 'ملغي', 'المرتجع للراسل'].some(s => bosatResult.includes(s))) order.targetAction = "RETURNED 🔴";
            
            if (order.targetAction) ordersReadyToUpdate.push(order);
        }

        await sendLog(`🎯 وجدنا <b>${ordersReadyToUpdate.length}</b> أوردر محتاج تحديث.\n⚡ جاري الهجوم الآن...`);

        // المرحلة الثالثة: الهجوم
        await page.bringToFront();
        await page.reload({ waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000));

        let updateCount = 0;
        for (let order of ordersReadyToUpdate) {
            try {
                const searchInputSelector = 'input[placeholder*="Customer"]'; 
                await page.waitForSelector(searchInputSelector, { timeout: 10000 });
                await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, searchInputSelector);
                await page.type(searchInputSelector, order.sellzaPhone);
                await page.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 4000)); 

                const updated = await page.evaluate(async (targetCode, actionToTake) => {
                    const row = Array.from(document.querySelectorAll('tr')).find(r => r.innerText.includes(targetCode));
                    if (row) {
                        const btn = row.querySelector('button .pi-angle-down');
                        if (btn) {
                            btn.closest('button').click(); await new Promise(r => setTimeout(r, 1000));
                            const opt = Array.from(document.querySelectorAll('app-status-dropdown p, span')).find(p => p.textContent.trim().toUpperCase() === actionToTake.split(' ')[0]);
                            if (opt) { opt.closest('.element-inner').click(); return true; }
                        }
                    }
                    return false;
                }, order.code, order.targetAction);

                if (updated) {
                    await new Promise(r => setTimeout(r, 1500));
                    await page.evaluate(() => {
                        const conf = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('CONFIRM'));
                        if (conf) conf.click();
                    });
                    updateCount++;
                    await sendLog(`✅ [${updateCount}] تم تحديث الأوردر: <b>${order.code}</b>`);
                    await new Promise(r => setTimeout(r, 4000)); 
                }
            } catch (err) {}
        }

        // إرسال الإكسيل النهائي
        if (scoutedOrders.length > 0) {
            const ws = xlsx.utils.json_to_sheet(scoutedOrders.map(o => ({ "كود": o.code, "الموبايل": o.sellzaPhone, "الحالة": o.targetAction || "في الشحن" })));
            const wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, ws, "التقرير");
            const filePath = path.join(__dirname, 'Report.xlsx');
            xlsx.writeFile(wb, filePath);
            await sendTelegramFile(filePath, `🏁 <b>انتهت المأمورية بنجاح!</b>\n🎯 تم تحديث: ${updateCount} أوردر.`);
            fs.unlinkSync(filePath);
        }

    } catch (e) {
        await sendLog(`❌ <b>خطأ طارئ:</b>\n${e.message}`);
    } finally {
        if (activeBrowser) await activeBrowser.close();
        process.exit(0); 
    }
}
runCloudBot();
