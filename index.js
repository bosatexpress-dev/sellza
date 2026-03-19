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

// قراءة الإعدادات من GitHub Actions (لو مفيش بياخد 1 لـ 1000)
const START_PAGE = parseInt(process.env.START) || 1;
const MAX_END_PAGE = parseInt(process.env.END) || 1000;

async function sendTelegramMsg(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID, text: text, parse_mode: 'HTML'
        });
        console.log(`[Telegram] ${text.replace(/<[^>]*>?/gm, '')}`); 
    } catch (e) { console.error('❌ خطأ تليجرام'); }
}

async function sendTelegramFile(filePath, caption) {
    try {
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', caption);
        form.append('document', fs.createReadStream(filePath));
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
        console.log(`[Telegram] 📁 تم إرسال التقرير.`);
    } catch (e) { console.error('❌ خطأ إرسال ملف'); }
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
    
    await sendTelegramMsg(`🚀 <b>انطلاق القناص السحابي</b>\nبدءاً من صفحة: ${START_PAGE}\nالجدول: أحد، ثلاثاء، خميس 9م.`);
    
    try {
        activeBrowser = await puppeteer.launch({ 
            headless: true, 
            args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        
        const page = await activeBrowser.newPage();
        await enableTurboMode(page); 

        // 1. تسجيل دخول سيلزا
        console.log('1️⃣ دخول سيلزا...');
        await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/Auth', { waitUntil: 'networkidle2' });
        await page.type('input[name="email"]', 'Admin@gmail.com'); 
        await page.type('input[name="password"]', 'Hh@102030');
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        await page.goto('https://sellza-frontend-qnmcs.ondigitalocean.app/orders', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000)); 

        // 2. تفعيل SHIPPED و 100 أوردر
        await page.evaluate(async () => {
            const shipped = Array.from(document.querySelectorAll('.filter-label, p, span')).find(el => el.textContent.trim() === 'SHIPPED');
            if (shipped) shipped.click();
            await new Promise(r => setTimeout(r, 3000));
            const rpp = document.querySelector('p-dropdown.p-paginator-rpp-options');
            if (rpp) {
                rpp.scrollIntoView(); rpp.click();
                await new Promise(r => setTimeout(r, 1500));
                const opt100 = Array.from(document.querySelectorAll('.p-dropdown-item')).find(el => el.innerText.trim() === '100');
                if (opt100) opt100.click();
            }
        });
        await new Promise(r => setTimeout(r, 6000));

        // 3. تخطي الصفحات لصفحة البداية
        if (START_PAGE > 1) {
            console.log(`⏩ تخطي لصفحة ${START_PAGE}...`);
            await page.evaluate(async (target) => {
                let current = 1;
                while (current < target) {
                    const next = document.querySelector('.p-paginator-next');
                    if (next && !next.classList.contains('p-disabled')) {
                        next.click(); current++;
                        await new Promise(r => setTimeout(r, 2000));
                    } else break;
                }
            }, START_PAGE);
            await new Promise(r => setTimeout(r, 4000));
        }

        // 4. حلقة المسح الشامل (Scouting)
        let currentPage = START_PAGE;
        let hasNext = true;

        while (hasNext && currentPage <= MAX_END_PAGE) {
            console.log(`📄 سحب بيانات صفحة (${currentPage})...`);
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
                    let sellzaPrice = 0;
                    const priceMatch = row.innerText.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*EGP/i);
                    if (priceMatch) sellzaPrice = parseFloat(priceMatch[1]);
                    if (sellzaPhone && code) data.push({ sellzaPhone, bosatPhone, code, sellzaPrice });
                }
                return data;
            });

            scoutedOrders.push(...pageData);

            hasNext = await page.evaluate(() => {
                const next = document.querySelector('.p-paginator-next');
                if (next && !next.classList.contains('p-disabled')) {
                    next.click(); return true;
                }
                return false;
            });
            if (hasNext) {
                currentPage++;
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        await sendTelegramMsg(`✅ <b>انتهى الاستطلاع:</b> تم جمع ${scoutedOrders.length} أوردر.\n🔍 جاري التحقق من بساط...`);

        // 5. فحص بساط
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
            console.log(`🔍 فحص ${order.code} في بساط...`);
            let attempts = 0; let bosatResult = null;
            while(attempts < 3) {
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
                        let sIdx = -1, wIdx = -1, costIdx = -1, dataRow = null;
                        for (let i = 0; i < rows.length; i++) {
                            const texts = Array.from(rows[i].children).map(c => c.innerText.trim());
                            if (texts.includes('حالة الشحنة')) {
                                sIdx = texts.indexOf('حالة الشحنة'); wIdx = texts.indexOf('رقم البوليصة');
                                costIdx = texts.findIndex(t => t.includes('اجمالي الشحنة') || t.includes('إجمالي الشحنة'));
                                if (i + 1 < rows.length && rows[i + 1].innerText.trim() !== '') dataRow = rows[i + 1];
                                break;
                            }
                        }
                        if (dataRow && sIdx !== -1) {
                            const statusText = dataRow.children[sIdx].innerText.trim().split('\n')[0].trim();
                            const waybill = dataRow.children[wIdx].innerText.trim();
                            let bosatPrice = 0;
                            if (costIdx !== -1) {
                                const match = dataRow.children[costIdx].innerText.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
                                if (match) bosatPrice = parseFloat(match[0]);
                            }
                            return { statusText, waybill, bosatPrice };
                        }
                        return { statusText: "لا يوجد نتائج", waybill: "غير متوفر", bosatPrice: 0 };
                    });
                    break;
                } catch(e) { attempts++; await new Promise(r => setTimeout(r, 5000)); }
            }
            if(bosatResult) {
                let action = null;
                if (bosatResult.statusText === 'تم التسليم') action = "DELIVERED 🟢";
                else if (['مرتجع', 'ملغي', 'المرتجع للراسل'].some(s => bosatResult.statusText.includes(s))) action = "RETURNED 🔴";
                order.bosatWaybill = bosatResult.waybill;
                order.bosatPrice = bosatResult.bosatPrice;
                order.bosatStatus = bosatResult.statusText;
                order.targetAction = action;
                ordersReadyToUpdate.push(order);
            }
        }

        // 6. التحديث في سيلزا (الهجوم)
        await page.bringToFront();
        await page.reload({ waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000));

        let updateCount = 0;
        for (let order of ordersReadyToUpdate) {
            if (!order.targetAction) continue; 
            let cleanAction = order.targetAction.includes('DELIVERED') ? 'DELIVERED' : 'RETURNED';
            try {
                const searchInputSelector = 'input[placeholder*="Customer"]'; 
                await page.waitForSelector(searchInputSelector, { timeout: 10000 });
                await page.evaluate((sel) => {
                    const input = document.querySelector(sel);
                    if(input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
                }, searchInputSelector);
                await new Promise(r => setTimeout(r, 1000)); 
                await page.type(searchInputSelector, order.sellzaPhone);
                await page.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 4000)); 
                const updated = await page.evaluate(async (targetCode, actionToTake) => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    const correctRow = rows.find(r => r.innerText.includes(targetCode));
                    if (correctRow) {
                        const btn = correctRow.querySelector('button .pi-angle-down');
                        if (btn) {
                            btn.closest('button').click(); 
                            await new Promise(r => setTimeout(r, 1000));
                            const opt = Array.from(document.querySelectorAll('app-status-dropdown p, span')).find(p => p.textContent.trim().toUpperCase() === actionToTake);
                            if (opt) { opt.closest('.element-inner').click(); return true; }
                        }
                    }
                    return false;
                }, order.code, cleanAction);

                if (updated) {
                    await new Promise(r => setTimeout(r, 1500));
                    await page.evaluate(() => {
                        const conf = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('CONFIRM'));
                        if (conf) conf.click();
                    });
                    console.log(`✅ تم تحديث ${order.code}`);
                    updateCount++;
                    await new Promise(r => setTimeout(r, 5000)); 
                }
            } catch (err) { console.log(`❌ فشل تحديث ${order.code}`); }
        }

        // 7. إرسال التقرير
        if (ordersReadyToUpdate.length > 0) {
            const excelData = ordersReadyToUpdate.map(o => ({
                "الموبايل (سيلزا)": o.sellzaPhone, "كود سيلزا": o.code, "بوليصة بساط": o.bosatWaybill,
                "إجمالي سيلزا": o.sellzaPrice, "إجمالي بساط": o.bosatPrice,
                "حالة بساط": o.bosatStatus, "القرار": o.targetAction || "تخطّي (في الشحن ⚪)"
            }));
            const ws = xlsx.utils.json_to_sheet(excelData);
            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws, "التقرير");
            const fileName = `Report.xlsx`;
            const filePath = path.join(__dirname, fileName);
            xlsx.writeFile(wb, filePath);
            await sendTelegramFile(filePath, `📊 <b>تقرير سيلزا الآلي</b>\n🎯 تم تحديث: ${updateCount} أوردر من أصل ${scoutedOrders.length}`);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 
        }
    } catch (e) { await sendTelegramMsg(`❌ <b>خطأ:</b> ${e.message}`); }
    finally { if (activeBrowser) await activeBrowser.close(); process.exit(0); }
}
runCloudBot();
