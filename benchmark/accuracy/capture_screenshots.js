import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const OUT_DIR = path.resolve(__dirname, 'screenshots');
const GT_DIR = path.resolve(__dirname, 'ground_truth');

const BASE_URL = 'http://localhost:3000';
const PAGES = [
    'index.html',
    'pages/healthcare.html',
    'pages/banking.html',
    'pages/government.html',
];

async function capture() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(GT_DIR, { recursive: true });

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--window-size=1280,900',
            '--no-sandbox',
        ],
    });

    for (let i = 0; i < PAGES.length; i++) {
        const pageName = PAGES[i];
        const url = `${BASE_URL}/${pageName}`;
        console.log(`Processing ${url}...`);

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });

        await new Promise(r => setTimeout(r, 1000));

        const prefix = `screenshot_${String(i + 1).padStart(3, '0')}_${pageName.replace('.html', '').replace(/\//g, '-')}`;
        const imgPath = path.join(OUT_DIR, `${prefix}.png`);
        const jsonPath = path.join(GT_DIR, `${prefix}_meta.json`);

        await page.screenshot({ path: imgPath });

        const elements = await page.evaluate(() => {
            const boxes = [];
            const rules = [
                { sel: 'input[type="password"]', cls: 'password' },
                { sel: 'input[type="email"]', cls: 'email-input' },
                { sel: 'input[type="tel"]', cls: 'phone-num' },
                { sel: 'input[type="checkbox"]', cls: 'checkbox' },
                { sel: 'input[type="radio"]', cls: 'radio button' },
                { sel: 'input[type="date"]', cls: 'date' },
                { sel: 'select', cls: 'dropdown' },
                { sel: 'button, .btn, [role="button"]', cls: 'button' },
                { sel: 'textarea', cls: 'input' },
                { sel: 'input[type="text"]', cls: 'input' },
                { sel: 'input[type="number"]', cls: 'input' }
            ];

            const seen = new Set();
            for (const rule of rules) {
                document.querySelectorAll(rule.sel).forEach(el => {
                    if (seen.has(el)) return;
                    seen.add(el);
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth) {
                        boxes.push({
                            box: [r.x, r.y, r.width, r.height],
                            cls: rule.cls
                        });
                    }
                });
            }

            boxes.forEach(b => {
                if (b.cls === 'input') {
                    const el = document.elementFromPoint(b.box[0] + 5, b.box[1] + 5);
                    if (el) {
                        const id = (el.id || el.name || '').toLowerCase();
                        if (id.includes('dob') || id.includes('birth')) b.cls = 'DOB';
                        else if (id.includes('address')) b.cls = 'address';
                        else if (id.includes('city')) b.cls = 'city';
                        else if (id.includes('zip') || id.includes('pin')) b.cls = 'zip code';
                        else if (id.includes('name')) b.cls = 'name';
                        else if (id.includes('otp')) b.cls = 'otp';
                    }
                }
            });

            return boxes;
        });

        fs.writeFileSync(jsonPath, JSON.stringify({
            image: `${prefix}.png`,
            width: 1280,
            height: 900,
            elements: elements
        }, null, 2));

        console.log(`  Saved ${imgPath} and ${jsonPath} with ${elements.length} proxy ground truth boxes.`);
        await page.close();
    }

    await browser.close();
}

capture().catch(console.error);
