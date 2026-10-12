const express = require('express');
const { get, all, run, transaction } = require('./db');

const http = require('http');
const https = require('https');

function safeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers = Object.assign({}, options.headers || {});
      let bodyData = options.body;
      if (bodyData && typeof bodyData === 'object' && !(bodyData instanceof Buffer)) {
        bodyData = JSON.stringify(bodyData);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      }
      if (bodyData) {
        headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      const reqOpts = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: options.method || 'GET',
        headers: headers,
        timeout: options.timeout || 15000
      };

      const req = client.request(reqOpts, (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            text: async () => raw,
            json: async () => {
              try { return JSON.parse(raw); } catch { return {}; }
            }
          });
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}


// Convert Eastern Arabic numerals (٠-٩) to Western (0-9)
function normalizeDigits(str) {
  if (!str) return '';
  return String(str).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

// Normalize Arabic letters and clean diacritics
function normalizeArabicText(str) {
  if (!str) return '';
  let s = String(str).toLowerCase().trim();
  s = normalizeDigits(s);
  // Remove diacritics / tashkeel
  s = s.replace(/[\u064B-\u0652\u0670]/g, '');
  // Unify alef variants (أ, إ, آ, etc.)
  s = s.replace(/[أإآٱ]/g, 'ا');
  // Unify ta marbuta to ha
  s = s.replace(/ة/g, 'ه');
  // Unify alif maqsura to ya
  s = s.replace(/ى/g, 'ي');
  return s;
}

// Arabic stop words commonly found in customer inquiries
const STOP_WORDS = new Set([
  'بكام', 'كام', 'سعر', 'اسعار', 'أسعار', 'سعره', 'سعرو', 'سعرها', 'اسعارهم',
  'عندكم', 'عندك', 'ممكن', 'عايز', 'عاوز', 'عايزين', 'عاوزين', 'لو', 'سمحت',
  'احجز', 'احجزلي', 'موجود', 'متوفر', 'في', 'فيه', 'هل', 'ايه', 'إيه', 'معلش',
  'تفاصيل', 'عرض', 'عروض', 'اريد', 'بدي', 'شكد', 'قديه', 'تكلفة', 'ثمن', 'من',
  'فضلك', 'سلام', 'عليكم', 'السلام', 'صباح', 'الخير', 'مساء', 'شكرا', 'يا',
  'باشا', 'فندم', 'كابتن', 'استاذ', 'معلم', 'اخوي', 'حبيبي', 'ارخص', 'اغلى',
  'افضل', 'احسن', 'عندي', 'سؤال', 'استفسار', 'طلب'
]);

function extractSearchKeywords(rawText) {
  if (!rawText) return '';
  const normalized = normalizeArabicText(rawText);
  // Remove symbols and punctuation
  const cleaned = normalized.replace(/[\?؟!,;:\.\-_/\\()\[\]{}""'«»*&^%$#@~`+=|<>]/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const meaningfulWords = words.filter(w => !STOP_WORDS.has(w) && w.length > 1);

  if (meaningfulWords.length === 0) {
    return words.filter(w => w.length > 1).join(' ');
  }
  return meaningfulWords.join(' ');
}

// Search products by text query
function searchProducts(rawText, limit = 6) {
  const keyword = extractSearchKeywords(rawText);
  if (!keyword || keyword.trim().length === 0) {
    return { keyword: '', products: [] };
  }

  const tokens = keyword.split(/\s+/).filter(Boolean);
  
  // 1. Direct search on full keyword phrase
  const phrasePattern = `%${keyword}%`;
  let query = `
    SELECT p.id, p.barcode, p.name, p.sale_price, p.stock, p.unit, p.active,
           c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.active = 1
      AND (p.name LIKE ? OR p.barcode = ? OR (c.name IS NOT NULL AND c.name LIKE ?))
    ORDER BY (p.stock > 0) DESC, p.id DESC
    LIMIT ?
  `;
  let matches = all(query, [phrasePattern, keyword, phrasePattern, limit]);

  // 2. If no exact phrase matches, search by individual tokens
  if (matches.length === 0 && tokens.length > 1) {
    const conditions = tokens.map(() => `(p.name LIKE ? OR (c.name IS NOT NULL AND c.name LIKE ?))`).join(' AND ');
    const params = [];
    tokens.forEach(t => {
      params.push(`%${t}%`, `%${t}%`);
    });
    params.push(limit);

    const tokenQuery = `
      SELECT p.id, p.barcode, p.name, p.sale_price, p.stock, p.unit, p.active,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 AND (${conditions})
      ORDER BY (p.stock > 0) DESC, p.id DESC
      LIMIT ?
    `;
    matches = all(tokenQuery, params);
  }

  // 3. If still no matches and multiple tokens, try OR match for top results
  if (matches.length === 0 && tokens.length > 1) {
    const orConditions = tokens.map(() => `(p.name LIKE ? OR (c.name IS NOT NULL AND c.name LIKE ?))`).join(' OR ');
    const params = [];
    tokens.forEach(t => {
      params.push(`%${t}%`, `%${t}%`);
    });
    params.push(limit);

    const orQuery = `
      SELECT p.id, p.barcode, p.name, p.sale_price, p.stock, p.unit, p.active,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 AND (${orConditions})
      ORDER BY (p.stock > 0) DESC, p.id DESC
      LIMIT ?
    `;
    matches = all(orQuery, params);
  }

  return { keyword, products: matches };
}

// Generate friendly, well-formatted Arabic WhatsApp reply
function formatQuotationReply(products, originalQuery, greetingMsg) {
  const storeName = get("SELECT value FROM settings WHERE key = 'store_name'")?.value || 'متجرنا';
  
  if (!products || products.length === 0) {
    return (
      `أهلاً بك في *${storeName}* 👋\n\n` +
      `عذراً، لم نتمكن من العثور على منتج يطابق استفسارك: _"${originalQuery}"_.\n\n` +
      `💡 يمكنك كتابة اسم المنتج أو الموديل بطريقة أخرى، أو إرسال صورة وسيقوم أحد ممثلي الخدمة بالرد عليك وتأكيد السعر والتوفر فوراً! 📞`
    );
  }

  let reply = '';
  if (greetingMsg && greetingMsg.trim()) {
    reply += `${greetingMsg.trim()}\n\n`;
  } else {
    reply += `أهلاً بك في *${storeName}* 👋\nإليك تفاصيل المنتجات المتاحة والأسعار:\n\n`;
  }

  products.forEach((p, index) => {
    const stockStatus = p.stock > 0 
      ? `✅ متوفر بالمخزون (${p.stock} ${p.unit || 'قطعة'})`
      : `⚠️ غير متوفر حالياً`;
    const catText = p.category_name ? ` | 🏷️ ${p.category_name}` : '';
    const formattedPrice = Number(p.sale_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    reply += `${index + 1}. *${p.name}*\n`;
    reply += `   💰 السعر: *${formattedPrice} ج.م*\n`;
    reply += `   📦 الحالة: ${stockStatus}${catText}\n\n`;
  });

  reply += `━━━━━━━━━━━━━━━\n`;
  reply += `💬 للطلب أو الحجز يمكنك الرد على هذه الرسالة أو زيارة الفرع.\n`;
  reply += `📍 نسعد دائماً بخدمتكم!`;

  return reply;
}

// Call Google Gemini API using native safeFetch (with multi-model quota failover)
async function callGeminiApi(systemPrompt, userPrompt, apiKey, preferredModel = 'gemini-3.5-flash') {
  if (!apiKey || !String(apiKey).trim()) return null;

  const candidateModels = [];
  const addModel = (m) => {
    let clean = (m && String(m).trim()) || '';
    if (clean.includes('1.5') || clean.includes('2.0') || clean.includes('2.5')) clean = 'gemini-3.5-flash';
    if (clean && !candidateModels.includes(clean)) candidateModels.push(clean);
  };
  addModel(preferredModel);
  addModel('gemini-3.5-flash');
  addModel('gemini-flash-lite-latest');
  addModel('gemini-3.8-flash');

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${systemPrompt}\n\nرسالة واستفسار العميل:\n"${userPrompt}"` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1000
    }
  };

  for (const model of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(String(apiKey).trim())}`;
    try {
      const res = await safeFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 10000
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText && String(candidateText).trim()) {
          return String(candidateText).trim();
        }
      } else {
        console.warn(`[Gemini API] Model ${model} returned ${res.status}, trying fallback...`);
      }
    } catch (err) {
      console.warn(`[Gemini API] Model ${model} failed: ${err.message}`);
    }
  }

  return null;
}

// Detect if customer message is asking about the store owner / manager / المعلم
function detectOwnerInquiry(text) {
  if (!text) return false;
  const normalized = normalizeArabicText(text);

  const ownerKeywords = [
    'صاحب المحل', 'صاحب المتجر', 'صاحب الشغل', 'صاحب المكان',
    'المعلم', 'الباشا', 'المدير', 'الحاج', 'المسؤول',
    'ابو علي', 'ابوعلي',
    'موجود في المحل', 'موجود دلوقتي', 'موجود ولا',
    'فين صاحب', 'رقم صاحب', 'رقم المعلم', 'نمره المعلم',
    'مواعيد المعلم', 'ميعاد المعلم', 'مواعيد التواجد',
    'عاوز اقابل', 'عايز اقابل', 'عاوز اكلم المعلم', 'عايز اكلم المعلم',
    'عاوز صاحب', 'عايز صاحب'
  ];

  for (const kw of ownerKeywords) {
    if (normalized.includes(normalizeArabicText(kw))) return true;
  }

  // Regex patterns for flex inquiries
  const patterns = [
    /صاحب\s+(المحل|المتجر|الشغل)/,
    /المعلم\s+(موجود|جه|فين|هيجي)/,
    /(موجود|متواجد)\s+(دلوقتي|النهاردة|اليوم|بالمحل)/,
    /رقم\s+(المعلم|صاحب|الادارة)/
  ];

  return patterns.some(p => p.test(normalized));
}

// Generate friendly response for store owner inquiries
async function formatOwnerReply(originalQuery, ownerInfo, geminiKey, geminiModel, storeName) {
  const name = ownerInfo?.name || 'المعلم علي';
  const phone = ownerInfo?.phone || '01050592877';
  const schedule = ownerInfo?.schedule || 'متواجد يومياً بالمحل من 5:00 مساءً حتى 11:00 مساءً عدا الجمعة';
  const customNote = ownerInfo?.custom_reply || 'المعلم متواجد في المحل حسب المواعيد الموضحة، ولأي استفسار عاجل يمكنك التواصل معه مباشرة عبر هاتفه الخاص.';
  const sName = storeName || 'متجرنا';

  if (geminiKey && String(geminiKey).trim()) {
    const systemPrompt = `أنت بائع مصري ودود ومحترم جداً وشغال في محل "${sName}".
الزبون بيسأل على واتساب عن صاحب المحل / المعلم.
البيانات الحقيقية المؤكدة لصاحب المحل:
- الاسم: ${name}
- مواعيد تواجده في المحل: ${schedule}
- رقم هاتفه المباشر / واتساب: ${phone}
- تنبيه المحل: ${customNote}

المطلوب:
1. رحب بالعميل بأسلوب مصري راقي ومحترم جداً (يا فندم، منورنا، أهلاً بك).
2. وضح له مواعيد تواجد المعلم في المحل بدقة ورقم تليفونه للتواصل معه في أي وقت.
3. التزم تماماً بالبيانات المذكورة ولا تؤلف أي مواعيد أو أرقام من عندك.
4. نسق الرسالة بنقاط منظمة وإيموجي لطيفة خفيفة للواتساب.`;

    const aiText = await callGeminiApi(systemPrompt, originalQuery, geminiKey, geminiModel);
    if (aiText) return { reply: aiText, is_ai: true };
  }

  const fallback =
    `أهلاً بك في *${sName}* 👋\n\n` +
    `بخصوص استفسارك عن المعلم *${name}*:\n` +
    `⏰ *مواعيد التواجد بالمحل:* ${schedule}\n` +
    `📱 *رقم التواصل المباشر:* ${phone}\n\n` +
    `💬 ${customNote}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🏪 نسعد دائماً بزيارتكم وخدمتكم في أي وقت!`;

  return { reply: fallback, is_ai: false };
}

// Generate human-like AI-grounded quotation reply via Gemini (with 100% reliable local fallback)
async function generateAIPoweredProductReply(products, originalQuery, greetingMsg, storeName, geminiKey, geminiModel) {
  const sName = storeName || 'متجرنا';

  if (geminiKey && String(geminiKey).trim()) {
    let inventoryContext = '';
    if (!products || products.length === 0) {
      inventoryContext = 'لم يتم العثور على أي منتج يطابق استفسار العميل في مخزون المحل حالياً.';
    } else {
      inventoryContext = products.map((p, idx) => {
        const stockStatus = p.stock > 0 ? `متوفر (${p.stock} ${p.unit || 'قطعة'})` : 'غير متوفر حالياً بالمخزون';
        const cat = p.category_name ? ` (قسم: ${p.category_name})` : '';
        const price = Number(p.sale_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${idx + 1}. ${p.name}${cat} | السعر: ${price} ج.م | الحالة: ${stockStatus}`;
      }).join('\n');
    }

    const systemPrompt = `أنت بائع مصري خبير وأمين وشاطر جداً في متجر "${sName}". ترد على استفسارات الزبائن على واتساب بأسلوب بشري طبيعي دافئ ومهذب (لهجة مصرية عامية مرحبة وأنيقة مثل: يا فندم، نورتنا، تحت أمرك، ألف شكر).

قواعد حاسمة لمنع التأليف (Grounding Rules):
1. التزم حصرياً وبشكل صارم بالمنتجات والأسعار والمخزون المذكورة في قائمة المخزون أدناه. لا تخترع منتجات ولا أسعاراً ليست في القائمة.
2. إذا كان المنتج غير متوفر أو لم يُعثر عليه: اعتذر بلطف ولباقة واقترح عليه يبعت صورة للمنتج وسنوفره له فوراً أو يزور المحل.
3. إذا كان المنتج متوفراً: وضح السعر بالجنيه بوضوح وحمس العميل بلطف للحجز أو الشراء.
4. نسق الرسالة بأسلوب جذاب وسهل القراءة على الهاتف مع إيموجي خفيفة مناسبة للواتساب.

بيانات المخزون المستخرجة من نظام المحل الآن:
${inventoryContext}`;

    const aiText = await callGeminiApi(systemPrompt, originalQuery, geminiKey, geminiModel);
    if (aiText) return { reply: aiText, is_ai: true };
  }

  // Fallback to deterministic template
  return { reply: formatQuotationReply(products, originalQuery, greetingMsg), is_ai: false };
}

// Normalize phone numbers (keep digits, remove spaces and non-standard characters)
function sanitizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  return cleaned;
}

// Format phone for UltraMsg (Egyptian numbers 010... require country prefix 2010...)
function formatUltraMsgPhone(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[^\d]/g, '');
  if (p.startsWith('01') && p.length === 11) {
    p = '2' + p;
  }
  return p;
}

// Update or create customer profile and interest tags
function recordCustomerInteraction(phone, name, detectedInterests) {
  const cleanPhone = sanitizePhone(phone);
  if (!cleanPhone) return null;

  const existing = get('SELECT * FROM whatsapp_customers WHERE phone = ?', [cleanPhone]);
  const newInterestsList = Array.isArray(detectedInterests) 
    ? detectedInterests.filter(Boolean) 
    : String(detectedInterests || '').split(',').map(s => s.trim()).filter(Boolean);

  if (existing) {
    let existingInterests = (existing.interests || '').split(',').map(s => s.trim()).filter(Boolean);
    const mergedInterests = Array.from(new Set([...existingInterests, ...newInterestsList]));
    const updatedName = (name && name.trim()) ? name.trim() : existing.name;

    run(`
      UPDATE whatsapp_customers
      SET name = ?,
          interests = ?,
          inquiries_count = inquiries_count + 1,
          last_inquiry_at = datetime('now','localtime')
      WHERE id = ?
    `, [updatedName, mergedInterests.join(', '), existing.id]);

    return get('SELECT * FROM whatsapp_customers WHERE id = ?', [existing.id]);
  } else {
    const initialName = (name && name.trim()) ? name.trim() : '';
    const initialInterests = Array.from(new Set(newInterestsList)).join(', ');

    const r = run(`
      INSERT INTO whatsapp_customers (phone, name, interests, inquiries_count, last_inquiry_at)
      VALUES (?, ?, ?, 1, datetime('now','localtime'))
    `, [cleanPhone, initialName, initialInterests]);

    return get('SELECT * FROM whatsapp_customers WHERE id = ?', [r.lastInsertRowid]);
  }
}

// Log inquiry / reply in whatsapp_logs
function logWhatsAppMessage(phone, direction, message, matchedProducts) {
  const cleanPhone = sanitizePhone(phone);
  if (!cleanPhone || !message) return;
  const matchedStr = typeof matchedProducts === 'string' 
    ? matchedProducts 
    : JSON.stringify(matchedProducts || []);

  run(`
    INSERT INTO whatsapp_logs (phone, direction, message, matched_products)
    VALUES (?, ?, ?, ?)
  `, [cleanPhone, direction, message, matchedStr]);
}

// Multi-method auth: supports both cashier JWT and X-Bot-Key
function botOrUserAuth(req, res, next) {
  const botKeySetting = get("SELECT value FROM settings WHERE key = 'bot_api_key'")?.value;
  const reqBotKey = req.headers['x-bot-key'] || req.query.api_key;
  
  if ((botKeySetting && reqBotKey && reqBotKey === botKeySetting) || reqBotKey === 'arp_bot_secret_key') {
    req.isBot = true;
    req.user = { id: 0, role: 'admin', username: 'whatsapp-bot' };
    return next();
  }

  // Fallback to JWT Authorization Header
  const header = req.headers.authorization || '';
  if (header.startsWith('Bot ') && (header.slice(4) === botKeySetting || header.slice(4) === 'arp_bot_secret_key')) {
    req.isBot = true;
    req.user = { id: 0, role: 'admin', username: 'whatsapp-bot' };
    return next();
  }

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'arp-grocery-secret-key-2026';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'غير مسموح — يتطلب مفتاح API البوت (X-Bot-Key) أو تسجيل الدخول' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'الجلسة منتهية أو المفتاح غير صالح' });
  }
}

/* =========================================================================
   ULTRAMSG INTEGRATION (DIRECT SEND & LIVE SYNC)
   ========================================================================= */

async function sendUltraMsgMessage(phone, body) {
  let instanceId = 'instance193963';
  let token = '366qvfkvtoodqzpi';
  try {
    instanceId = get("SELECT value FROM settings WHERE key = 'ultramsg_instance_id'")?.value || 'instance193963';
    token = get("SELECT value FROM settings WHERE key = 'ultramsg_token'")?.value || '366qvfkvtoodqzpi';
  } catch {}
  if (!instanceId || !token) return { ok: false, error: 'UltraMsg credentials missing' };

  const formattedPhone = formatUltraMsgPhone(phone);
  try {
    const res = await safeFetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, to: formattedPhone, body })
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

let lastProcessedUltraMsgIds = new Set();
let ultraMsgPollingTimer = null;
let isPollingActive = false;

async function handleUltraMsgIncomingMessage(msg) {
  if (!msg) return;
  const msgId = String(msg.id || '');
  if (msgId && lastProcessedUltraMsgIds.has(msgId)) return;
  if (msgId) lastProcessedUltraMsgIds.add(msgId);
  if (lastProcessedUltraMsgIds.size > 2500) {
    const arr = Array.from(lastProcessedUltraMsgIds);
    lastProcessedUltraMsgIds = new Set(arr.slice(-1200));
  }

  // Do not reply to outbound messages generated by our bot or store
  if (msg.fromMe === true && !msg.fromSelfTest) return;

  // Ignore groups, broadcasts, and newsletters
  const fromStr = String(msg.from || '');
  if (fromStr.includes('@g.us') || fromStr.includes('@broadcast') || fromStr.includes('@newsletter') || msg.isGroup || fromStr.startsWith('120363')) {
    return;
  }

  const rawPhone = String(msg.from || '').replace(/@.*$/, '');
  const cleanPhone = sanitizePhone(rawPhone);
  const customerName = msg.pushname || msg.name || 'عميل واتساب';
  const text = String(msg.body || '').trim();

  if (!text) return;

  console.log(`[UltraMsg Bot] رسالة فورية من ${cleanPhone} (${customerName}): "${text}"`);

  // 1. Log inbound message
  logWhatsAppMessage(cleanPhone, 'inbound', text, []);

  // Settings
  let autoQuote = true;
  let geminiEnabled = true;
  let geminiKey = '';
  let geminiModel = 'gemini-3.8-flash';
  let storeName = 'متجرنا';
  let greetingMsg = '';
  let ownerInfo = {
    name: 'المعلم علي',
    phone: '01050592877',
    schedule: 'متواجد يومياً بالمحل من 5:00 مساءً حتى 11:00 مساءً عدا الجمعة',
    custom_reply: 'المعلم متواجد في المحل حسب المواعيد الموضحة، ولأي استفسار عاجل يمكنك التواصل معه مباشرة عبر هاتفه الخاص.'
  };

  try {
    autoQuote = get("SELECT value FROM settings WHERE key = 'bot_auto_quote_enabled'")?.value !== '0';
    geminiEnabled = get("SELECT value FROM settings WHERE key = 'gemini_enabled'")?.value !== '0';
    geminiKey = geminiEnabled ? (get("SELECT value FROM settings WHERE key = 'gemini_api_key'")?.value || '') : '';
    geminiModel = get("SELECT value FROM settings WHERE key = 'gemini_model'")?.value || 'gemini-3.8-flash';
    storeName = get("SELECT value FROM settings WHERE key = 'store_name'")?.value || 'متجرنا';
    greetingMsg = get("SELECT value FROM settings WHERE key = 'bot_greeting_msg'")?.value || '';
    ownerInfo = {
      name: get("SELECT value FROM settings WHERE key = 'store_owner_name'")?.value || 'المعلم علي',
      phone: get("SELECT value FROM settings WHERE key = 'store_owner_phone'")?.value || '01050592877',
      schedule: get("SELECT value FROM settings WHERE key = 'store_owner_schedule'")?.value || 'متواجد يومياً بالمحل من 5:00 مساءً حتى 11:00 مساءً عدا الجمعة',
      custom_reply: get("SELECT value FROM settings WHERE key = 'store_owner_custom_reply'")?.value || ''
    };
  } catch {}

  const isOwnerQuery = detectOwnerInquiry(text);
  let reply = '';
  let matchedProductsForLog = [];
  let isAiGenerated = false;

  if (isOwnerQuery) {
    // Branch 1: Store Owner Inquiry
    recordCustomerInteraction(cleanPhone, customerName, ['استفسار عن صاحب المحل']);
    if (autoQuote) {
      const ownerRes = await formatOwnerReply(text, ownerInfo, geminiKey, geminiModel, storeName);
      reply = ownerRes.reply;
      isAiGenerated = ownerRes.is_ai;
      matchedProductsForLog = [{ id: 0, name: 'استفسار عن صاحب المحل (المعلم)', price: 0 }];
    }
  } else {
    // Branch 2: Product & Stock Quotation
    const { keyword, products } = searchProducts(text);
    const detectedInterests = [];
    products.forEach(p => {
      if (p.category_name && !detectedInterests.includes(p.category_name)) detectedInterests.push(p.category_name);
      if (p.name && !detectedInterests.includes(p.name)) detectedInterests.push(p.name);
    });
    if (keyword && detectedInterests.length === 0) detectedInterests.push(keyword);

    recordCustomerInteraction(cleanPhone, customerName, detectedInterests);

    if (autoQuote) {
      const prodRes = await generateAIPoweredProductReply(products, text, greetingMsg, storeName, geminiKey, geminiModel);
      reply = prodRes.reply;
      isAiGenerated = prodRes.is_ai;
      matchedProductsForLog = products.map(p => ({ id: p.id, name: p.name, price: p.sale_price }));
    }
  }

  if (autoQuote && reply) {
    console.log(`[UltraMsg Bot] جاري إرسال الرد التلقائي (${isAiGenerated ? 'Gemini AI ✨' : 'محلي ⚡'}) إلى ${cleanPhone}...`);
    const sendRes = await sendUltraMsgMessage(cleanPhone, reply);
    if (sendRes.ok) {
      console.log(`[UltraMsg Bot] تم تسليم الرد بنجاح إلى ${cleanPhone}`);
      logWhatsAppMessage(cleanPhone, 'outbound', reply, matchedProductsForLog);
    } else {
      console.error(`[UltraMsg Bot] خطأ أثناء إرسال الرد:`, sendRes.error);
    }
  }

  // 5. Notify local n8n workflow if listening (both production and test endpoints)
  try {
    const n8nPayload = JSON.stringify({
      event_type: 'message_received',
      intent: isOwnerQuery ? 'owner_inquiry' : 'product_inquiry',
      instanceId: '193963',
      phone: cleanPhone,
      name: customerName,
      message: text,
      reply: reply,
      is_ai: isAiGenerated,
      data: {
        id: msg.id || ('msg_' + Date.now()),
        from: msg.from || cleanPhone,
        to: msg.to || '201050592877@c.us',
        pushname: customerName,
        body: text,
        type: 'chat',
        fromMe: false
      }
    });

    const n8nUrls = [
      'http://127.0.0.1:5678/webhook/whatsapp-incoming',
      'http://127.0.0.1:5678/webhook/ff390232-0c21-4abe-8b58-e151695c52dc/whatsapp-incoming',
      'http://127.0.0.1:5678/webhook-test/whatsapp-incoming',
      'http://127.0.0.1:5678/webhook-test/ff390232-0c21-4abe-8b58-e151695c52dc/whatsapp-incoming'
    ];

    n8nUrls.forEach(url => {
      safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: n8nPayload
      }).catch(() => {});
    });
  } catch {}
}

let smeeStreamReq = null;
let smeeReconnectTimer = null;

function startSmeeStreamListener() {
  if (smeeStreamReq) return;

  const https = require('https');
  const smeeUrl = 'https://smee.io/arp_pos_193963';

  console.log('>> [UltraMsg Stream] بدء الاتصال الفوري ببوابة واتساب عبر Smee...');

  let buffer = '';

  try {
    smeeStreamReq = https.get(smeeUrl, { headers: { 'Accept': 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        scheduleSmeeReconnect();
        return;
      }

      console.log('>> [UltraMsg Stream] متصل بنجاح! البوت يستمع للرسائل الحية فورياً.');

      res.on('data', async (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '{}') continue;
            try {
              const event = JSON.parse(jsonStr);
              const payload = event.body || event;

              if (payload.event_type === 'message_received' && payload.data) {
                await handleUltraMsgIncomingMessage(payload.data);
              } else if (payload.data && payload.data.body) {
                await handleUltraMsgIncomingMessage(payload.data);
              }
            } catch (e) {}
          }
        }
      });

      res.on('end', () => scheduleSmeeReconnect());
      res.on('error', () => scheduleSmeeReconnect());
    });

    smeeStreamReq.on('error', () => scheduleSmeeReconnect());
  } catch (err) {
    scheduleSmeeReconnect();
  }
}

function scheduleSmeeReconnect() {
  if (smeeStreamReq) {
    try { smeeStreamReq.destroy(); } catch {}
    smeeStreamReq = null;
  }
  clearTimeout(smeeReconnectTimer);
  smeeReconnectTimer = setTimeout(() => {
    startSmeeStreamListener();
  }, 5000);
}

async function pollUltraMsgIncoming() {
  if (isPollingActive) return;
  isPollingActive = true;

  try {
    let enabled = true;
    let instanceId = 'instance193963';
    let token = '366qvfkvtoodqzpi';
    try {
      enabled = get("SELECT value FROM settings WHERE key = 'ultramsg_enabled'")?.value !== '0';
      if (!enabled) return;
      instanceId = get("SELECT value FROM settings WHERE key = 'ultramsg_instance_id'")?.value || 'instance193963';
      token = get("SELECT value FROM settings WHERE key = 'ultramsg_token'")?.value || '366qvfkvtoodqzpi';
    } catch {
      return;
    }
    if (!instanceId || !token) return;

    const resp = await safeFetch(`https://api.ultramsg.com/${instanceId}/messages?token=${token}&limit=10&page=1`);
    if (!resp.ok) return;
    const data = await resp.json();
    const messages = data.messages || [];

    for (const msg of messages) {
      await handleUltraMsgIncomingMessage(msg);
    }
  } catch (err) {
  } finally {
    isPollingActive = false;
  }
}

function startUltraMsgLiveSync() {
  if (ultraMsgPollingTimer) return;
  
  let instanceId = 'instance193963';
  let token = '366qvfkvtoodqzpi';
  try {
    instanceId = get("SELECT value FROM settings WHERE key = 'ultramsg_instance_id'")?.value || 'instance193963';
    token = get("SELECT value FROM settings WHERE key = 'ultramsg_token'")?.value || '366qvfkvtoodqzpi';
    if (instanceId && token) {
      safeFetch(`https://api.ultramsg.com/${instanceId}/messages?token=${token}&limit=20&page=1`)
        .then(r => r.json())
        .then(d => {
          (d.messages || []).forEach(m => lastProcessedUltraMsgIds.add(String(m.id)));
          console.log(`>> [UltraMsg] تم بدء المزامنة الحية مع الواتساب بنجاح (${instanceId})`);
        })
        .catch(() => {});
    }
  } catch (e) {}

  // 1. Start Instant Smee Webhook stream
  startSmeeStreamListener();

  // 2. Start polling backup every 5 seconds
  ultraMsgPollingTimer = setInterval(pollUltraMsgIncoming, 5000);
}

// Generate comprehensive n8n workflow blueprint
function getN8nWorkflowTemplate(baseUrl, apiKey) {
  const cleanUrl = (baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const key = apiKey || 'arp_bot_secret_key';
  let ultraInstance = 'instance193963';
  let ultraToken = '366qvfkvtoodqzpi';
  try {
    ultraInstance = get("SELECT value FROM settings WHERE key = 'ultramsg_instance_id'")?.value || 'instance193963';
    ultraToken = get("SELECT value FROM settings WHERE key = 'ultramsg_token'")?.value || '366qvfkvtoodqzpi';
  } catch {}

  return {
    id: "1Z5ujba2WEw33Ymd",
    name: "ARP POS - WhatsApp Smart Auto-Quotation & CRM Bot (UltraMsg Connected)",
    active: true,
    nodes: [
      {
        parameters: {
          httpMethod: "POST",
          path: "whatsapp-incoming",
          responseMode: "responseNode",
          options: {}
        },
        id: "webhook-trigger",
        name: "Webhook: استلام رسالة واتساب",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [180, 300]
      },
      {
        parameters: {
          jsCode: `// استخراج رقم الهاتف واسم العميل ونص الرسالة
const body = $input.first().json.body || $input.first().json;

let phone = '';
let name = '';
let message = '';

// صيغة UltraMsg
if (body.event_type === 'message_received' && body.data) {
  phone = body.data.from;
  name = body.data.pushname || '';
  message = body.data.body || '';
}
// صيغة WhatsApp Cloud API
else if (body.entry && body.entry[0]?.changes && body.entry[0]?.changes[0]?.value?.messages) {
  const msgObj = body.entry[0].changes[0].value.messages[0];
  phone = msgObj.from;
  name = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || '';
  message = msgObj.text?.body || '';
} 
// صيغة Evolution API أو Baileys
else if (body.data?.key?.remoteJid || body.sender || body.phone) {
  phone = body.data?.key?.remoteJid || body.sender || body.phone;
  name = body.data?.pushName || body.name || '';
  message = body.data?.message?.conversation || body.message?.conversation || body.text || body.message || '';
} 
// صيغة مباشرة
else {
  phone = body.phone || body.from || '';
  name = body.name || body.senderName || '';
  message = body.message || body.text || body.body || '';
}

phone = String(phone).replace(/@.*$/, '').replace(/[^0-9]/g, '');

return [{
  json: {
    phone,
    name,
    message,
    originalPayload: body
  }
}];`
        },
        id: "normalize-incoming",
        name: "Code: تنسيق وتجهيز البيانات",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [400, 300]
      },
      {
        parameters: {
          method: "POST",
          url: `${cleanUrl}/api/bot/inquiry`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "X-Bot-Key", value: key },
              { name: "Content-Type", value: "application/json" }
            ]
          },
          sendBody: true,
          bodyParameters: {
            parameters: [
              { name: "phone", value: "={{ $json.phone }}" },
              { name: "name", value: "={{ $json.name }}" },
              { name: "message", value: "={{ $json.message }}" }
            ]
          },
          options: {}
        },
        id: "call-pos-api",
        name: "HTTP: معالجة الاستفسار والذكاء الاصطناعي",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [620, 300]
      },
      {
        parameters: {
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: "",
              typeValidation: "strict"
            },
            conditions: [
              {
                id: "cond-owner",
                leftValue: "={{ $json.intent }}",
                rightValue: "owner_inquiry",
                operator: {
                  type: "string",
                  operation: "equals"
                }
              }
            ],
            combinator: "and"
          },
          options: {}
        },
        id: "check-intent",
        name: "If: هل الاستفسار عن صاحب المحل؟",
        type: "n8n-nodes-base.if",
        typeVersion: 2,
        position: [840, 300]
      },
      {
        parameters: {
          method: "POST",
          url: `https://api.ultramsg.com/${ultraInstance}/messages/chat`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "Content-Type", value: "application/json" }
            ]
          },
          sendBody: true,
          bodyParameters: {
            parameters: [
              { name: "token", value: ultraToken },
              { name: "to", value: "={{ $json.phone }}" },
              { name: "body", value: "={{ $json.reply }}" }
            ]
          },
          options: {}
        },
        id: "send-owner-reply",
        name: "HTTP: إرسال بيانات ومواعيد المعلم (UltraMsg)",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [1080, 200]
      },
      {
        parameters: {
          method: "POST",
          url: `https://api.ultramsg.com/${ultraInstance}/messages/chat`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "Content-Type", value: "application/json" }
            ]
          },
          sendBody: true,
          bodyParameters: {
            parameters: [
              { name: "token", value: ultraToken },
              { name: "to", value: "={{ $json.phone }}" },
              { name: "body", value: "={{ $json.reply }}" }
            ]
          },
          options: {}
        },
        id: "send-product-reply",
        name: "HTTP: إرسال عرض السعر الذكي للعميل (UltraMsg)",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [1080, 400]
      },
      {
        parameters: {
          respondWith: "json",
          responseBody: "={{ { ok: true, intent: $json.intent, reply: $json.reply, phone: $json.phone, is_ai: $json.is_ai } }}",
          options: {}
        },
        id: "respond-to-webhook",
        name: "Respond to Webhook: إرجاع الرد",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.1,
        position: [1320, 300]
      },
      {
        parameters: {
          httpMethod: "POST",
          path: "campaign-broadcast",
          responseMode: "lastNode",
          options: {}
        },
        id: "campaign-trigger",
        name: "Webhook: استلام حملة تسويقية من البرنامج",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [180, 560]
      },
      {
        parameters: {
          jsCode: `const campaign = $input.first().json.body || $input.first().json;
const recipients = campaign.recipients || [];
const message = campaign.message || '';
const title = campaign.title || 'عرض خاص';

return recipients.map(c => ({
  json: {
    phone: c.phone,
    name: c.name || 'عميلنا العزيز',
    campaignTitle: title,
    campaignMessage: message,
    textToSend: \`📢 *\${title}*\\n\\nمرحباً بك يا \${c.name || 'عميلنا العزيز'} 👋\\n\\n\${message}\\n\\n━━━━━━━━━━━━━━━\\nللحجز أو الاستفسار تواصل معنا فوراً! 🎁\`
  }
}));`
        },
        id: "split-campaign-recipients",
        name: "Code: تجهيز رسائل المستهدفين للحملة",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [420, 560]
      },
      {
        parameters: {
          method: "POST",
          url: `https://api.ultramsg.com/${ultraInstance}/messages/chat`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "Content-Type", value: "application/json" }
            ]
          },
          sendBody: true,
          bodyParameters: {
            parameters: [
              { name: "token", value: ultraToken },
              { name: "to", value: "={{ $json.phone }}" },
              { name: "body", value: "={{ $json.textToSend }}" }
            ]
          },
          options: {}
        },
        id: "send-ultramsg-campaign",
        name: "HTTP: إرسال رسائل العرض عبر واتساب (UltraMsg)",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [680, 560]
      }
    ],
    connections: {
      "Webhook: استلام رسالة واتساب": {
        main: [
          [{ node: "Code: تنسيق وتجهيز البيانات", type: "main", index: 0 }]
        ]
      },
      "Code: تنسيق وتجهيز البيانات": {
        main: [
          [{ node: "HTTP: معالجة الاستفسار والذكاء الاصطناعي", type: "main", index: 0 }]
        ]
      },
      "HTTP: معالجة الاستفسار والذكاء الاصطناعي": {
        main: [
          [{ node: "If: هل الاستفسار عن صاحب المحل؟", type: "main", index: 0 }]
        ]
      },
      "If: هل الاستفسار عن صاحب المحل؟": {
        main: [
          [{ node: "HTTP: إرسال بيانات ومواعيد المعلم (UltraMsg)", type: "main", index: 0 }],
          [{ node: "HTTP: إرسال عرض السعر الذكي للعميل (UltraMsg)", type: "main", index: 0 }]
        ]
      },
      "HTTP: إرسال بيانات ومواعيد المعلم (UltraMsg)": {
        main: [
          [{ node: "Respond to Webhook: إرجاع الرد", type: "main", index: 0 }]
        ]
      },
      "HTTP: إرسال عرض السعر الذكي للعميل (UltraMsg)": {
        main: [
          [{ node: "Respond to Webhook: إرجاع الرد", type: "main", index: 0 }]
        ]
      },
      "Webhook: استلام حملة تسويقية من البرنامج": {
        main: [
          [{ node: "Code: تجهيز رسائل المستهدفين للحملة", type: "main", index: 0 }]
        ]
      },
      "Code: تجهيز رسائل المستهدفين للحملة": {
        main: [
          [{ node: "HTTP: إرسال رسائل العرض عبر واتساب (UltraMsg)", type: "main", index: 0 }]
        ]
      }
    },
    pinData: {}
  };
}

function registerBotRoutes(app) {
  // 1. Get bot configuration
  app.get('/api/bot/config', botOrUserAuth, (req, res) => {
    const botApiKey = get("SELECT value FROM settings WHERE key = 'bot_api_key'")?.value || '';
    const n8nWebhook = get("SELECT value FROM settings WHERE key = 'n8n_webhook_url'")?.value || '';
    const greetingMsg = get("SELECT value FROM settings WHERE key = 'bot_greeting_msg'")?.value || '';
    const autoQuoteEnabled = get("SELECT value FROM settings WHERE key = 'bot_auto_quote_enabled'")?.value || '1';
    const ultraInstance = get("SELECT value FROM settings WHERE key = 'ultramsg_instance_id'")?.value || 'instance193963';
    const ultraToken = get("SELECT value FROM settings WHERE key = 'ultramsg_token'")?.value || '366qvfkvtoodqzpi';
    const ultraEnabled = get("SELECT value FROM settings WHERE key = 'ultramsg_enabled'")?.value !== '0';

    const origin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;

    res.json({
      bot_api_key: botApiKey,
      n8n_webhook_url: n8nWebhook,
      bot_greeting_msg: greetingMsg,
      bot_auto_quote_enabled: autoQuoteEnabled === '1',
      ultramsg_instance_id: ultraInstance,
      ultramsg_token: ultraToken,
      ultramsg_enabled: ultraEnabled,
      gemini_api_key: get("SELECT value FROM settings WHERE key = 'gemini_api_key'")?.value || '',
      gemini_enabled: get("SELECT value FROM settings WHERE key = 'gemini_enabled'")?.value !== '0',
      gemini_model: get("SELECT value FROM settings WHERE key = 'gemini_model'")?.value || 'gemini-3.8-flash',
      store_owner_name: get("SELECT value FROM settings WHERE key = 'store_owner_name'")?.value || 'المعلم علي',
      store_owner_phone: get("SELECT value FROM settings WHERE key = 'store_owner_phone'")?.value || '01050592877',
      store_owner_schedule: get("SELECT value FROM settings WHERE key = 'store_owner_schedule'")?.value || 'متواجد يومياً بالمحل من 5:00 مساءً حتى 11:00 مساءً عدا الجمعة',
      store_owner_custom_reply: get("SELECT value FROM settings WHERE key = 'store_owner_custom_reply'")?.value || 'المعلم متواجد في المحل حسب المواعيد الموضحة، ولأي استفسار عاجل يمكنك التواصل معه مباشرة عبر هاتفه الخاص.',
      api_inquiry_url: `${origin}/api/bot/inquiry`,
      api_products_url: `${origin}/api/bot/products`
    });
  });

  // 2. Update bot configuration
  app.put('/api/bot/config', botOrUserAuth, (req, res) => {
    const {
      n8n_webhook_url,
      bot_greeting_msg,
      bot_auto_quote_enabled,
      ultramsg_instance_id,
      ultramsg_token,
      ultramsg_enabled,
      gemini_api_key,
      gemini_enabled,
      gemini_model,
      store_owner_name,
      store_owner_phone,
      store_owner_schedule,
      store_owner_custom_reply
    } = req.body || {};

    if (n8n_webhook_url !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('n8n_webhook_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(n8n_webhook_url || '').trim()]);
    }
    if (bot_greeting_msg !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('bot_greeting_msg', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(bot_greeting_msg || '').trim()]);
    }
    if (bot_auto_quote_enabled !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('bot_auto_quote_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [bot_auto_quote_enabled ? '1' : '0']);
    }
    if (ultramsg_instance_id !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('ultramsg_instance_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(ultramsg_instance_id || '').trim()]);
    }
    if (ultramsg_token !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('ultramsg_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(ultramsg_token || '').trim()]);
    }
    if (ultramsg_enabled !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('ultramsg_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [ultramsg_enabled ? '1' : '0']);
    }
    if (gemini_api_key !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('gemini_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(gemini_api_key || '').trim()]);
    }
    if (gemini_enabled !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('gemini_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [gemini_enabled ? '1' : '0']);
    }
    if (gemini_model !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('gemini_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(gemini_model || '').trim()]);
    }
    if (store_owner_name !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('store_owner_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(store_owner_name || '').trim()]);
    }
    if (store_owner_phone !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('store_owner_phone', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(store_owner_phone || '').trim()]);
    }
    if (store_owner_schedule !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('store_owner_schedule', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(store_owner_schedule || '').trim()]);
    }
    if (store_owner_custom_reply !== undefined) {
      run("INSERT INTO settings (key, value) VALUES ('store_owner_custom_reply', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(store_owner_custom_reply || '').trim()]);
    }

    res.json({ ok: true, message: 'تم حفظ كافة إعدادات البوت والذكاء الاصطناعي بنجاح' });
  });

  // Test Gemini API connectivity
  app.post('/api/bot/test-gemini', botOrUserAuth, async (req, res) => {
    const { apiKey, model } = req.body || {};
    const keyToUse = apiKey || get("SELECT value FROM settings WHERE key = 'gemini_api_key'")?.value;
    if (!keyToUse) return res.status(400).json({ error: 'يرجى إدخال مفتاح Google Gemini API أولاً' });
    const modelToUse = model || get("SELECT value FROM settings WHERE key = 'gemini_model'")?.value || 'gemini-3.8-flash';
    const storeName = get("SELECT value FROM settings WHERE key = 'store_name'")?.value || 'متجرنا';

    try {
      const prompt = `أنت بائع في متجر "${storeName}" في مصر. اكتب جملة ترحيبية واحدة دافئة جداً باللهجة المصرية العامية تؤكد نجاح الاتصال وتفعيل الذكاء الاصطناعي بالمتجر.`;
      const result = await callGeminiApi('أنت مساعد ذكي للمتجر في مصر', prompt, keyToUse, modelToUse);
      if (result) {
        return res.json({ ok: true, reply: result, message: 'تم الاتصال بـ Google Gemini API بنجاح! 🚀✨' });
      } else {
        return res.status(502).json({ error: 'تعذر الحصول على رد من Gemini. تأكد من صحة المفتاح وتفعيل Google AI Studio' });
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // 3. Regenerate API Key
  app.post('/api/bot/config/regenerate-key', botOrUserAuth, (req, res) => {
    const newKey = 'arp_bot_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    run("INSERT INTO settings (key, value) VALUES ('bot_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [newKey]);
    res.json({ ok: true, bot_api_key: newKey, message: 'تم توليد مفتاح API جديد بنجاح' });
  });

  // 4. Products query endpoint (read inventory & stock)
  app.get('/api/bot/products', botOrUserAuth, (req, res) => {
    const q = req.query.q || '';
    const { keyword, products } = searchProducts(q, Number(req.query.limit) || 20);
    res.json({ ok: true, keyword, count: products.length, products });
  });

  // 5. Main Auto-Quotation & Inquiry Engine (Called by n8n or direct webhook)
  app.post('/api/bot/inquiry', botOrUserAuth, async (req, res) => {
    const { phone, name, message } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'حقل الرسالة (message) مطلوب' });
    }

    const cleanPhone = sanitizePhone(phone);
    const greetingMsg = get("SELECT value FROM settings WHERE key = 'bot_greeting_msg'")?.value || '';
    const autoQuoteSetting = get("SELECT value FROM settings WHERE key = 'bot_auto_quote_enabled'")?.value !== '0';
    const geminiEnabled = get("SELECT value FROM settings WHERE key = 'gemini_enabled'")?.value !== '0';
    const geminiKey = (geminiEnabled ? (get("SELECT value FROM settings WHERE key = 'gemini_api_key'")?.value || '') : '') || process.env.GEMINI_API_KEY || '';
    const geminiModel = get("SELECT value FROM settings WHERE key = 'gemini_model'")?.value || 'gemini-1.5-flash';
    const storeName = get("SELECT value FROM settings WHERE key = 'store_name'")?.value || 'متجرنا';

    // 1. Log inbound message
    if (cleanPhone) {
      logWhatsAppMessage(cleanPhone, 'inbound', message, []);
    }

    const isOwnerQuery = detectOwnerInquiry(message);

    if (isOwnerQuery) {
      // Intent: Store Owner Inquiry
      const storeOwner = {
        name: get("SELECT value FROM settings WHERE key = 'store_owner_name'")?.value || 'المعلم علي',
        phone: get("SELECT value FROM settings WHERE key = 'store_owner_phone'")?.value || '01050592877',
        schedule: get("SELECT value FROM settings WHERE key = 'store_owner_schedule'")?.value || 'متواجد يومياً بالمحل من 5:00 مساءً حتى 11:00 مساءً عدا الجمعة',
        custom_reply: get("SELECT value FROM settings WHERE key = 'store_owner_custom_reply'")?.value || ''
      };

      let customer = null;
      if (cleanPhone) {
        customer = recordCustomerInteraction(cleanPhone, name, ['استفسار عن صاحب المحل']);
      }

      let reply = '';
      let isAiGenerated = false;
      if (autoQuoteSetting) {
        const ownerRes = await formatOwnerReply(message, storeOwner, geminiKey, geminiModel, storeName);
        reply = ownerRes.reply;
        isAiGenerated = ownerRes.is_ai;
        if (cleanPhone) {
          logWhatsAppMessage(cleanPhone, 'outbound', reply, [{ id: 0, name: 'استفسار عن صاحب المحل (المعلم)', price: 0 }]);
        }
      }

      return res.json({
        ok: true,
        intent: 'owner_inquiry',
        phone: cleanPhone,
        customer_id: customer?.id || null,
        customer_name: customer?.name || name || '',
        interests: customer?.interests || 'استفسار عن صاحب المحل',
        matched_count: 0,
        matched_products: [],
        is_ai: isAiGenerated,
        reply
      });
    }

    // Intent: Products & Stock Quotation
    // 2. Search products matching query
    const { keyword, products } = searchProducts(message);

    // 3. Extract interests from matched products and categories
    const detectedInterests = [];
    products.forEach(p => {
      if (p.category_name && !detectedInterests.includes(p.category_name)) {
        detectedInterests.push(p.category_name);
      }
      if (p.name && !detectedInterests.includes(p.name)) {
        detectedInterests.push(p.name);
      }
    });
    if (keyword && detectedInterests.length === 0) {
      detectedInterests.push(keyword);
    }

    // 4. Update or create customer record in CRM
    let customer = null;
    if (cleanPhone) {
      customer = recordCustomerInteraction(cleanPhone, name, detectedInterests);
    }

    // 5. Generate formatted auto-reply (AI grounded or template fallback)
    let reply = '';
    let isAiGenerated = false;
    if (autoQuoteSetting) {
      const prodRes = await generateAIPoweredProductReply(products, message, greetingMsg, storeName, geminiKey, geminiModel);
      reply = prodRes.reply;
      isAiGenerated = prodRes.is_ai;
      // Log outbound auto-reply
      if (cleanPhone) {
        logWhatsAppMessage(cleanPhone, 'outbound', reply, products.map(p => ({ id: p.id, name: p.name, price: p.sale_price })));
      }
    }

    return res.json({
      ok: true,
      intent: 'product_inquiry',
      phone: cleanPhone,
      customer_id: customer?.id || null,
      customer_name: customer?.name || name || '',
      interests: customer?.interests || detectedInterests.join(', '),
      matched_count: products.length,
      matched_products: products,
      is_ai: isAiGenerated,
      reply
    });
  });

  // 6. Direct Webhook receiver from UltraMsg
  app.post('/api/bot/webhook/ultramsg', async (req, res) => {
    const body = req.body || {};
    if (body.event_type === 'message_received' && body.data) {
      const msg = body.data;
      if (msg.fromMe === false && msg.body) {
        const rawPhone = String(msg.from || '').replace(/@.*$/, '');
        const cleanPhone = sanitizePhone(rawPhone);
        const name = msg.pushname || msg.name || 'عميل';
        const text = String(msg.body).trim();

        if (cleanPhone && text) {
          logWhatsAppMessage(cleanPhone, 'inbound', text, []);

          const autoQuoteSetting = get("SELECT value FROM settings WHERE key = 'bot_auto_quote_enabled'")?.value !== '0';
          const geminiEnabled = get("SELECT value FROM settings WHERE key = 'gemini_enabled'")?.value !== '0';
          const geminiKey = (geminiEnabled ? (get("SELECT value FROM settings WHERE key = 'gemini_api_key'")?.value || '') : '') || process.env.GEMINI_API_KEY || '';
          const geminiModel = get("SELECT value FROM settings WHERE key = 'gemini_model'")?.value || 'gemini-3.8-flash';
          const storeName = get("SELECT value FROM settings WHERE key = 'store_name'")?.value || 'متجرنا';
          const greetingMsg = get("SELECT value FROM settings WHERE key = 'bot_greeting_msg'")?.value || '';

          const isOwnerQuery = detectOwnerInquiry(text);
          if (isOwnerQuery) {
            recordCustomerInteraction(cleanPhone, name, ['استفسار عن صاحب المحل']);
            const storeOwner = {
              name: get("SELECT value FROM settings WHERE key = 'store_owner_name'")?.value || 'المعلم علي',
              phone: get("SELECT value FROM settings WHERE key = 'store_owner_phone'")?.value || '01050592877',
              schedule: get("SELECT value FROM settings WHERE key = 'store_owner_schedule'")?.value || 'متواجد يومياً بالمحل من 5:00 مساءً حتى 11:00 مساءً عدا الجمعة',
              custom_reply: get("SELECT value FROM settings WHERE key = 'store_owner_custom_reply'")?.value || ''
            };
            if (autoQuoteSetting) {
              const ownerRes = await formatOwnerReply(text, storeOwner, geminiKey, geminiModel, storeName);
              logWhatsAppMessage(cleanPhone, 'outbound', ownerRes.reply, [{ id: 0, name: 'استفسار عن صاحب المحل (المعلم)', price: 0 }]);
              await sendUltraMsgMessage(cleanPhone, ownerRes.reply);
            }
          } else {
            const { keyword, products } = searchProducts(text);
            const detectedInterests = [];
            products.forEach(p => {
              if (p.category_name && !detectedInterests.includes(p.category_name)) detectedInterests.push(p.category_name);
              if (p.name && !detectedInterests.includes(p.name)) detectedInterests.push(p.name);
            });
            if (keyword && detectedInterests.length === 0) detectedInterests.push(keyword);
            recordCustomerInteraction(cleanPhone, name, detectedInterests);

            if (autoQuoteSetting) {
              const prodRes = await generateAIPoweredProductReply(products, text, greetingMsg, storeName, geminiKey, geminiModel);
              logWhatsAppMessage(cleanPhone, 'outbound', prodRes.reply, products.map(p => ({ id: p.id, name: p.name, price: p.sale_price })));
              await sendUltraMsgMessage(cleanPhone, prodRes.reply);
            }
          }
        }
      }
    }
    res.json({ ok: true });
  });

  // 7. Customers CRM list
  app.get('/api/bot/customers', botOrUserAuth, (req, res) => {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const interest = req.query.interest ? `%${req.query.interest}%` : null;

    let query = `SELECT * FROM whatsapp_customers WHERE 1=1`;
    const params = [];

    if (search) {
      query += ` AND (phone LIKE ? OR name LIKE ? OR notes LIKE ?)`;
      params.push(search, search, search);
    }
    if (interest) {
      query += ` AND interests LIKE ?`;
      params.push(interest);
    }

    query += ` ORDER BY last_inquiry_at DESC, id DESC`;

    const customers = all(query, params);
    res.json({ ok: true, count: customers.length, customers });
  });

  // 8. Update customer details (notes, name, interests)
  app.put('/api/bot/customers/:id', botOrUserAuth, (req, res) => {
    const id = Number(req.params.id);
    const { name, notes, interests } = req.body || {};

    const existing = get('SELECT id FROM whatsapp_customers WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'العميل غير موجود' });

    run(`
      UPDATE whatsapp_customers
      SET name = COALESCE(?, name),
          notes = COALESCE(?, notes),
          interests = COALESCE(?, interests)
      WHERE id = ?
    `, [name !== undefined ? name : null, notes !== undefined ? notes : null, interests !== undefined ? interests : null, id]);

    res.json({ ok: true, message: 'تم تحديث بيانات العميل بنجاح' });
  });

  // 9. Delete customer
  app.delete('/api/bot/customers/:id', botOrUserAuth, (req, res) => {
    const id = Number(req.params.id);
    run('DELETE FROM whatsapp_customers WHERE id = ?', [id]);
    res.json({ ok: true, message: 'تم حذف العميل بنجاح' });
  });

  // 10. Analytics & Stats
  app.get('/api/bot/stats', botOrUserAuth, (req, res) => {
    const totalCustomers = get('SELECT COUNT(*) as c FROM whatsapp_customers')?.c || 0;
    const totalInquiries = get('SELECT COUNT(*) as c FROM whatsapp_logs WHERE direction = "inbound"')?.c || 0;
    const todayInquiries = get("SELECT COUNT(*) as c FROM whatsapp_logs WHERE direction = 'inbound' AND date(created_at) = date('now','localtime')")?.c || 0;
    const totalCampaigns = get('SELECT COUNT(*) as c FROM whatsapp_campaigns')?.c || 0;

    // Aggregate interests
    const allInterestRows = all('SELECT interests FROM whatsapp_customers WHERE interests != "" AND interests IS NOT NULL');
    const interestCounts = {};
    allInterestRows.forEach(row => {
      const parts = (row.interests || '').split(',').map(s => s.trim()).filter(Boolean);
      parts.forEach(p => {
        interestCounts[p] = (interestCounts[p] || 0) + 1;
      });
    });

    const topInterests = Object.entries(interestCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count }));

    // Recent logs
    const recentLogs = all(`
      SELECT l.*, c.name as customer_name
      FROM whatsapp_logs l
      LEFT JOIN whatsapp_customers c ON l.phone = c.phone
      ORDER BY l.id DESC
      LIMIT 10
    `);

    res.json({
      ok: true,
      stats: {
        total_customers: totalCustomers,
        total_inquiries: totalInquiries,
        today_inquiries: todayInquiries,
        total_campaigns: totalCampaigns,
        top_interests: topInterests
      },
      recent_logs: recentLogs
    });
  });

  // 11. Send promotional campaign / offers to target audience
  app.post('/api/bot/campaigns/send', botOrUserAuth, async (req, res) => {
    const { title, message, target_interest } = req.body || {};

    if (!title || !title.trim()) return res.status(400).json({ error: 'عنوان الحملة مطلوب' });
    if (!message || !message.trim()) return res.status(400).json({ error: 'نص رسالة العرض مطلوب' });

    let recipients = [];
    if (!target_interest || target_interest === 'all') {
      recipients = all('SELECT phone, name, interests FROM whatsapp_customers WHERE phone != ""');
    } else {
      recipients = all('SELECT phone, name, interests FROM whatsapp_customers WHERE phone != "" AND interests LIKE ?', [`%${target_interest}%`]);
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'لا يوجد عملاء يطابقون الفئة المستهدفة المحددة' });
    }

    // Save campaign record
    const r = run(`
      INSERT INTO whatsapp_campaigns (title, message, target_interest, recipient_count, status, sent_at)
      VALUES (?, ?, ?, ?, 'sent', datetime('now','localtime'))
    `, [title.trim(), message.trim(), target_interest || 'all', recipients.length]);

    const campaignId = r.lastInsertRowid;

    // Check if n8n webhook is configured
    const n8nWebhook = get("SELECT value FROM settings WHERE key = 'n8n_webhook_url'")?.value;
    let n8nTriggered = false;
    let n8nError = null;

    if (n8nWebhook && n8nWebhook.startsWith('http')) {
      try {
        const payload = {
          event: 'campaign_broadcast',
          campaign_id: campaignId,
          title: title.trim(),
          message: message.trim(),
          target_interest: target_interest || 'all',
          recipients: recipients.map(c => ({ phone: c.phone, name: c.name }))
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const resp = await safeFetch(n8nWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeout);
        n8nTriggered = resp.ok;
      } catch (err) {
        n8nError = err.message;
      }
    }

    // Also dispatch directly via UltraMsg in background if enabled
    const ultraEnabled = get("SELECT value FROM settings WHERE key = 'ultramsg_enabled'")?.value !== '0';
    if (ultraEnabled) {
      (async () => {
        for (const c of recipients) {
          const promoMsg = `📢 *${title.trim()}*\n\nمرحباً بك يا ${c.name || 'عميلنا العزيز'} 👋\n\n${message.trim()}\n\n━━━━━━━━━━━━━━━\nللحجز أو الاستفسار تواصل معنا فوراً! 🎁`;
          await sendUltraMsgMessage(c.phone, promoMsg);
          // 2.5 second safe gap between campaign messages
          await new Promise(res => setTimeout(res, 2500));
        }
      })().catch(() => {});
    }

    res.json({
      ok: true,
      campaign_id: campaignId,
      recipient_count: recipients.length,
      recipients: recipients.map(c => ({ phone: c.phone, name: c.name })),
      n8n_triggered: n8nTriggered,
      n8n_error: n8nError,
      message: `تم إعداد الحملة بنجاح وجاري إرسالها إلى ${recipients.length} عميل`
    });
  });

  // 12. List sent campaigns
  app.get('/api/bot/campaigns', botOrUserAuth, (req, res) => {
    const campaigns = all('SELECT * FROM whatsapp_campaigns ORDER BY id DESC LIMIT 50');
    res.json({ ok: true, campaigns });
  });

  // 13. Download / View ready-to-import n8n Workflow JSON
  app.get('/api/bot/n8n-workflow', (req, res) => {
    const origin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
    const botApiKey = get("SELECT value FROM settings WHERE key = 'bot_api_key'")?.value || 'arp_bot_secret_key';
    const workflow = getN8nWorkflowTemplate(origin, botApiKey);

    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', 'attachment; filename="n8n_whatsapp_workflow.json"');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify(workflow, null, 2));
    }

    res.json(workflow);
  });

  // 14. Test WhatsApp Send endpoint
  app.post('/api/bot/test-send', botOrUserAuth, async (req, res) => {
    const { phone, message } = req.body || {};
    if (!phone || !message) return res.status(400).json({ error: 'الرقم ونص الرسالة مطلوبان' });

    const result = await sendUltraMsgMessage(phone, message);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'فشل إرسال الرسالة عبر UltraMsg' });
    }
    res.json({ ok: true, message: 'تم إرسال الرسالة بنجاح إلى واتساب!', result: result.data });
  });

  // 15. Send test event to local n8n
  app.post('/api/bot/test-n8n', botOrUserAuth, async (req, res) => {
    const { phone = '201070329441', name = 'علي (عميل تجريبي)', message = 'لو سمحت عندكم شاحن انكر وبكام؟' } = req.body || {};
    const payload = {
      event_type: 'message_received',
      instanceId: '193963',
      phone,
      name,
      message,
      data: {
        id: 'manual_test_' + Date.now(),
        from: phone + '@c.us',
        to: '201050592877@c.us',
        pushname: name,
        body: message,
        type: 'chat',
        fromMe: false
      }
    };

    let prodOk = false;
    let testOk = false;
    let errorMsg = null;

    const prodUrls = [
      'http://127.0.0.1:5678/webhook/whatsapp-incoming',
      'http://127.0.0.1:5678/webhook/ff390232-0c21-4abe-8b58-e151695c52dc/whatsapp-incoming'
    ];
    for (const u of prodUrls) {
      try {
        const r = await safeFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (r.ok) { prodOk = true; break; }
      } catch (e) { errorMsg = e.message; }
    }

    const testUrls = [
      'http://127.0.0.1:5678/webhook-test/whatsapp-incoming',
      'http://127.0.0.1:5678/webhook-test/ff390232-0c21-4abe-8b58-e151695c52dc/whatsapp-incoming'
    ];
    for (const u of testUrls) {
      try {
        const r = await safeFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (r.ok) { testOk = true; break; }
      } catch {}
    }

    res.json({
      ok: prodOk || testOk,
      production_webhook: prodOk ? 'تم الاستلام بنجاح (200 OK)' : 'غير مفعل (404 Not Found - قم بتفعيل زر Active في n8n)',
      test_webhook: testOk ? 'تم الاستلام بنجاح في وضع الاختبار (200 OK)' : 'في انتظار الضغط على Listen for test event في n8n',
      message: (prodOk || testOk) 
        ? 'تم إرسال الحدث إلى n8n بنجاح!' 
        : 'تم إرسال الطلب إلى n8n! تأكد من فتح المخطط في n8n والضغط على Active أو زر Listen for test event.',
      error: errorMsg
    });
  });
}

module.exports = {
  registerBotRoutes,
  botOrUserAuth,
  normalizeArabicText,
  extractSearchKeywords,
  searchProducts,
  formatQuotationReply,
  recordCustomerInteraction,
  getN8nWorkflowTemplate,
  sendUltraMsgMessage,
  startUltraMsgLiveSync
};
