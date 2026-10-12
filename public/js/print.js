/**
 * Unified Printing Engine (ARP POS Engine)
 * Standardizes printing across Thermal, Label, and A4 printers.
 */

const THERMAL_RE = /XP-?58|XP-?80|GP-?58|GP-?80|POS-?58|POS-?80|POS58|POS80|RONGTA|XPRINTER|BIZOLON|EPSON|TM-?T|ZEBRA|CITIZEN|SEWOO|HOIN|ZONERICH|58\s?MM|80\s?MM|58MM|80MM|58\s?mm|80\s?mm|MINI.?PRINTER|58.?thermal|80.?thermal|THERMAL|RECEIPT|TICKET|SERIAL|CH340|CH341|PRINTER/i;
const A4_RE = /A4|HP|Canon|Epson|Brother|Laser|Inkjet|DeskJet|OfficeJet|PIXMA|PIXIF|LBP|HL-|MFC|ImageClass|LaserJet|Photosmart/i;

/* ==================== UNIFIED CSS PROFILES ==================== */

const RECEIPT_CSS = `
  @page { size: 58mm auto; margin: 0 !important; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    width: 48mm;
    margin: 0 auto;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.35;
    color: #000;
  }
  img { max-width: 100%; }
  .bc { text-align: center; margin: 4px 0; }
  .bc .code-text { font-weight: 800; letter-spacing: 1.5px; font-size: 12px; direction: ltr; }
  .r-head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 5px; margin-top: 0; }
  .r-head h3 { font-size: 16px; font-weight: 800; margin-bottom: 3px; }
  .r-head div { font-size: 12.5px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  td { padding: 2.5px 0; font-weight: 700; }
  .r-head + table thead tr td { border-bottom: 1.5px solid #000; font-size: 13px; font-weight: 800; }
  .r-line { display: flex; justify-content: space-between; margin: 3px 0; font-size: 12.5px; font-weight: 700; }
  .r-total { font-size: 16px; font-weight: 800; border-top: 2px solid #000; margin-top: 5px; padding-top: 5px; }
  .r-foot { text-align: center; margin-top: 6px; font-size: 11.5px; font-weight: 700; padding-bottom: 0; margin-bottom: 0; }
  .dashed { border-bottom: 1.5px dashed #000; margin: 5px 0; }

  @media print {
    @page { size: 58mm auto; margin: 0 !important; }
    html, body {
      width: 100% !important;
      margin: 0 !important;
      padding: 1.5mm !important;
      font-size: 13px !important;
      line-height: 1.35 !important;
      color: #000 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .r-head h3 { font-size: 16px !important; font-weight: 800 !important; }
    .r-head div { font-size: 12.5px !important; font-weight: 700 !important; }
    table { font-size: 12.5px !important; }
    td { font-size: 12.5px !important; padding: 2px 0 !important; }
    .r-line { font-size: 12.5px !important; }
    .r-total { font-size: 16px !important; font-weight: 800 !important; }
  }
`;

const LABEL_CSS = `
  @page { size: 58mm auto; margin: 0 !important; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 48mm; margin: 0 auto; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; }
  .label { text-align: center; padding: 4px 0; }
  .label .l-title { font-size: 14px; font-weight: 800; margin-bottom: 2px; }
  .label .l-sub { font-size: 12px; font-weight: 700; color: #000; margin-bottom: 3px; }
  .label .l-img { text-align: center; }
  .label .l-img img { max-width: 46mm; }
  .label .l-code { font-family: 'Courier New', monospace; font-weight: 800; letter-spacing: 1.5px; font-size: 12px; margin-top: 2px; direction: ltr; }
  .label .l-price { font-size: 16px; font-weight: 800; margin-top: 2px; }
  .label + .label { border-top: 1.5px dashed #000; margin-top: 5px; padding-top: 5px; }

  @media print {
    @page { size: 58mm auto; margin: 0 !important; }
    html, body { width: 100% !important; margin: 0 !important; padding: 0 !important; }
  }
`;

const A4_LABEL_CSS = `
  @page { size: A4; margin: 8mm !important; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
  .labels { display: grid; grid-template-columns: repeat(3, 63mm); gap: 0; justify-content: start; }
  .label {
    width: 63mm; height: 38.1mm;
    border: 1px dashed #999;
    padding: 3mm 2.5mm 2.5mm;
    text-align: center;
    overflow: hidden;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    break-inside: avoid;
  }
  .label .l-name { font-size: 11.5px; font-weight: 800; line-height: 1.25; height: 8.5mm; overflow: hidden; }
  .label img { max-width: 56mm; max-height: 13mm; margin: 1mm 0; }
  .label .l-code { font-family: 'Courier New', monospace; font-size: 10.5px; font-weight: 800; letter-spacing: 1px; }
  .label .l-price { font-size: 15px; font-weight: 800; margin-top: 1mm; }
  .label .no-bc { font-size: 10px; color: #999; font-style: italic; height: 12mm; display: flex; align-items: center; }

  @media print {
    @page { size: A4; margin: 8mm !important; }
    html, body { width: 100% !important; margin: 0 !important; padding: 0 !important; }
  }
`;

const THERMAL_LABEL_CSS = `
  @page { size: 58mm auto; margin: 0 !important; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 48mm; margin: 0 auto; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12.5px; color: #000; }
  .label { text-align: center; padding: 4px 0; border-bottom: 1px dashed #000; }
  .label .l-name { font-size: 13px; font-weight: 800; line-height: 1.25; }
  .label img { max-width: 100%; }
  .label .l-code { font-weight: 800; letter-spacing: 1.5px; font-size: 12px; direction: ltr; font-family: 'Courier New', monospace; }
  .label .l-price { font-size: 16px; font-weight: 800; margin-top: 3px; }

  @media print {
    @page { size: 58mm auto; margin: 0 !important; }
    html, body { width: 100% !important; margin: 0 !important; padding: 0 !important; }
  }
`;

const INVOICE_A4_CSS = `
  @page { size: A4 portrait; margin: 8mm 10mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; font-size: 13px; line-height: 1.45; font-weight: 600; }
  .inv-head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; margin-top: 0; }
  .inv-head h2 { font-size: 22px; font-weight: 800; margin-bottom: 3px; }
  .inv-head .inv-meta { font-size: 12.5px; color: #000; margin-top: 3px; font-weight: 700; }
  .inv-info { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 12.5px; font-weight: 700; }
  .inv-info div { flex: 1; }
  .inv-info .inv-store { text-align: right; }
  .inv-info .inv-customer { text-align: left; }
  .inv-info .inv-store b, .inv-info .inv-customer b { display: block; margin-bottom: 2px; font-size: 14px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { background: #f1f5f9; font-size: 13px; padding: 7px 10px; text-align: right; border: 1.5px solid #000; font-weight: 800; color: #000; }
  td { padding: 6px 10px; border: 1px solid #000; font-size: 12.5px; font-weight: 700; color: #000; }
  .num { text-align: left; font-variant-numeric: tabular-nums; }
  .inv-totals { width: 320px; margin-left: 0; margin-right: auto; }
  .inv-totals table { margin-bottom: 0; }
  .inv-totals td { padding: 4px 8px; border: none; font-size: 12.5px; font-weight: 700; }
  .inv-totals .inv-grand td { font-size: 17px; font-weight: 800; border-top: 2px solid #000; padding-top: 6px; color: #000; }
  .inv-foot { text-align: center; margin-top: 14px; padding-top: 8px; border-top: 1.5px dashed #000; font-size: 12px; color: #000; font-weight: 700; }
  .inv-bc { text-align: center; margin-top: 8px; }
  .inv-bc img { max-width: 200px; }
  .inv-bc .code-text { font-family: 'Courier New', monospace; font-weight: 800; letter-spacing: 1.5px; font-size: 12px; direction: ltr; margin-top: 3px; }

  @media print {
    @page { size: A4 portrait; margin: 8mm !important; }
    html, body {
      width: 100% !important;
      font-size: 13px !important;
      line-height: 1.45 !important;
      color: #000 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .inv-head h2 { font-size: 22px !important; }
    th { font-size: 13px !important; }
    td { font-size: 12.5px !important; }
    .inv-totals td { font-size: 12.5px !important; }
    .inv-totals .inv-grand td { font-size: 17px !important; }
  }
`;

const REPORT_CSS = `
  @page { size: A4 portrait; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; font-size: 12.5px; line-height: 1.45; font-weight: 600; }
  .rep-head { text-align: center; margin-bottom: 10px; margin-top: 0; }
  .rep-head h2 { font-size: 22px; font-weight: 800; margin-bottom: 3px; }
  .rep-head .rep-meta { font-size: 12px; color: #000; font-weight: 700; }
  .rep-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .rep-stat { flex: 1 1 120px; border: 1.5px solid #000; border-radius: 6px; padding: 8px; text-align: center; background: #fafafa; }
  .rep-stat .lbl { font-size: 12px; color: #000; font-weight: 700; }
  .rep-stat b { display: block; font-size: 18px; margin-top: 2px; font-weight: 800; color: #000; }
  h4 { margin: 10px 0 6px; border-bottom: 1.5px solid #000; padding-bottom: 3px; font-size: 15px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #000; padding: 6px 8px; text-align: right; }
  th { background: #f1f5f9; font-weight: 800; font-size: 12.5px; color: #000; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .num { text-align: left; font-variant-numeric: tabular-nums; }

  @media print {
    @page { size: A4 portrait; margin: 8mm !important; }
    html, body {
      width: 100% !important;
      font-size: 12.5px !important;
      line-height: 1.45 !important;
      color: #000 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    th { font-size: 12.5px !important; }
    td { font-size: 12px !important; }
  }
`;

const AGREEMENT_A4_CSS = `
  @page { size: A4 portrait; margin: 5mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; font-size: 12.5px; line-height: 1.5; font-weight: 600; background: #fff; }
  .agr-card { border: 2px solid #000; padding: 14px; border-radius: 6px; margin-bottom: 10px; background: #fff; width: 100%; }
  .agr-head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .agr-head h2 { font-size: 22px; margin-bottom: 4px; color: #000; font-weight: 800; }
  .agr-head p.store-subtitle { font-size: 12px; color: #000; font-weight: 700; margin-bottom: 6px; }
  .agr-head h3 { font-size: 15px; font-weight: 800; color: #000; margin-top: 6px; background: #f3f4f6; display: inline-block; padding: 6px 20px; border-radius: 6px; border: 1.5px solid #000; }
  .agr-meta { display: flex; justify-content: space-between; font-size: 12px; margin-top: 10px; color: #000; border-top: 1.5px dashed #000; padding-top: 6px; font-weight: 800; }
  .parties-box { display: flex; gap: 12px; margin-bottom: 14px; }
  .party-card { flex: 1; border: 1.5px solid #000; padding: 10px; border-radius: 6px; background: #fafafa; }
  .party-card h4 { font-size: 13.5px; margin-bottom: 8px; border-bottom: 1.5px solid #000; padding-bottom: 4px; color: #000; font-weight: 800; }
  .party-card p { margin-bottom: 6px; font-size: 12px; color: #000; font-weight: 700; }
  .section-title { font-size: 14px; font-weight: 800; margin-bottom: 8px; margin-top: 12px; color: #000; }
  table.agr-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.agr-table th, table.agr-table td { border: 1.5px solid #000; padding: 8px 10px; font-size: 12px; text-align: right; }
  table.agr-table th { background: #e5e7eb; font-weight: 800; font-size: 13px; color: #000; }
  .legal-terms { border: 1.5px dashed #000; padding: 10px 14px; background: #fffbe6; border-radius: 6px; margin-bottom: 14px; font-size: 11.5px; line-height: 1.6; color: #000; font-weight: 700; }
  .legal-terms h4 { margin-bottom: 6px; color: #990000; font-size: 13.5px; font-weight: 800; border-bottom: 1.5px solid #ffcc00; padding-bottom: 4px; }
  .legal-terms p { margin-bottom: 6px; font-weight: 700; }
  .signatures { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 6px; }
  .sig-box { text-align: center; width: 46%; border: 1.5px solid #000; padding: 10px; border-radius: 6px; background: #fff; }
  .sig-box p { margin-bottom: 30px; font-weight: 800; font-size: 13px; color: #000; }
  .sig-line { border-bottom: 1.5px dotted #000; margin-top: 8px; margin-bottom: 8px; }
  .sig-box span { font-size: 11.5px; font-weight: 700; color: #000; }

  @media print {
    html, body {
      font-size: 12.5px !important;
      line-height: 1.5 !important;
      color: #000 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .agr-card {
      padding: 12px !important;
      border-width: 2px !important;
    }
    table.agr-table th { font-size: 13px !important; }
    table.agr-table td { font-size: 12px !important; }
    .legal-terms { font-size: 11.5px !important; line-height: 1.6 !important; }
    .party-card p { font-size: 12px !important; }
  }
`;

/* ==================== UNIFIED PRINT ENGINE OBJECT ==================== */

const PrintEngine = {
  detectPrinterType(name) {
    if (!name) return 'a4';
    return THERMAL_RE.test(name) ? 'thermal' : 'a4';
  },

  getInvoicePrinter() {
    return (typeof localStorage !== 'undefined' && (localStorage.getItem('invoicePrinterPref') || localStorage.getItem('printerPref'))) || '';
  },

  getBarcodePrinter() {
    return (typeof localStorage !== 'undefined' && localStorage.getItem('barcodePrinterPref')) || '';
  },

  getPrinterType() {
    const profilePref = (typeof localStorage !== 'undefined' && localStorage.getItem('printerProfilePref')) || 'auto';
    if (profilePref === 'thermal') return 'thermal';
    if (profilePref === 'a4') return 'a4';
    const pref = this.getInvoicePrinter();
    return this.detectPrinterType(pref);
  },

  async print(html, opts = {}) {
    return this.doPrint(html, opts);
  },

  doPrint(html, opts = {}) {
    if (typeof window !== 'undefined' && window.printerAPI) {
      return window.printerAPI.getPrinters().then(list => {
        const isLabel = opts.type === 'label';
        let device = opts.deviceName || '';
        if (!device) {
          if (isLabel) {
            device = this.getBarcodePrinter();
          } else {
            device = this.getInvoicePrinter();
          }
        }
        if (device && !list.some(p => p.name === device)) device = '';
        if (!device) {
          if (!isLabel) {
            const th = list.find(p => THERMAL_RE.test(p.name || ''));
            if (th) {
              device = th.name;
              localStorage.setItem('invoicePrinterPref', device);
              localStorage.setItem('printerPref', device);
            }
          }
        }
        if (device) {
          return window.printerAPI.printHTML(html, { deviceName: device }).then(r => {
            if (r && !r.ok) showAlert('فشلت الطباعة على الطابعة المحددة: ' + (r.err || 'خطأ غير معروف'), 'error');
            else if (r && r.ok) showAlert('تم إرسال الطباعة إلى ' + device);
          });
        }
        return this.iframePrint(html);
      }).catch(() => this.iframePrint(html));
    }
    return this.iframePrint(html);
  },

  iframePrint(html) {
    if (typeof document === 'undefined') return;
    const f = document.createElement('iframe');
    f.setAttribute('style', 'position:fixed;top:-9999px;left:0;width:820px;height:700px;border:0;');
    document.body.appendChild(f);
    const doc = f.contentDocument || f.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } finally {
        setTimeout(() => document.body.removeChild(f), 1500);
      }
    }, 350);
  },

  getFontSizeZoomCss() {
    const pref = (typeof localStorage !== 'undefined' && localStorage.getItem('printerFontSizePref')) || 'compact';
    if (pref === 'large') return '@media print, screen { body { zoom: 1.3; } }';
    if (pref === 'normal') return '@media print, screen { body { zoom: 1.15; } }';
    return '';
  },

  formatThermalDoc(html, title = 'طباعة فاتورة حرارية') {
    return `<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>${esc(title)}</title>
        <style>${RECEIPT_CSS}\n${this.getFontSizeZoomCss()}</style>
      </head>
      <body>${html}</body>
      </html>`;
  },

  formatA4Doc(html, title = 'مستند A4') {
    return `<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>${esc(title)}</title>
        <style>${INVOICE_A4_CSS}\n${this.getFontSizeZoomCss()}</style>
      </head>
      <body>${html}</body>
      </html>`;
  },

  formatLabelDoc(html, mode = 'a4', title = 'طباعة ليبل') {
    const css = mode === 'thermal' ? THERMAL_LABEL_CSS : A4_LABEL_CSS;
    return `<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>${esc(title)}</title>
        <style>${css}\n${this.getFontSizeZoomCss()}</style>
      </head>
      <body><div class="labels">${html}</div></body>
      </html>`;
  },

  formatReportDoc(html, title = 'تقرير المبيعات') {
    return `<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>${esc(title)}</title>
        <style>${REPORT_CSS}\n${this.getFontSizeZoomCss()}</style>
      </head>
      <body>${html}</body>
      </html>`;
  },

  smartPrint(html, type) {
    const pt = this.getPrinterType();
    if (type === 'label') return this.print(this.formatLabelDoc(html, pt), { type: 'label' });
    if (type === 'report') return this.print(this.formatReportDoc(html), { type: 'report' });
    return pt === 'thermal' ? this.printThermal(html) : this.printA4(html);
  },

  printThermal(html, opts = {}) {
    return this.print(this.formatThermalDoc(html), { type: 'invoice', ...opts });
  },

  printA4(html, opts = {}) {
    return this.print(this.formatA4Doc(html), { type: 'invoice', ...opts });
  },

  printLabel(html, opts = {}) {
    return this.print(this.formatLabelDoc(html), { type: 'label', ...opts });
  },

  openPreviewModal(html, type, title, onPrint) {
    const isLabel = type === 'label';
    const isReport = type === 'report';
    const pt = this.getPrinterType();
    const isThermalPrinter = pt === 'thermal';
    window.__printModal = { html, type, onPrint: onPrint || null };
    const body = isReport ? html : `<div class="receipt">${html}</div>`;
    const headTitle = title || (isReport ? 'التقرير' : isLabel ? 'الليبل' : 'الفاتورة');
    let buttons = '';
    if (isLabel) {
      buttons = '<button class="btn btn-accent" onclick="PrintEngine.printModalGo()">🖨️ طباعة</button>';
    } else if (isReport) {
      buttons = '<button class="btn btn-accent" onclick="PrintEngine.printModalGo()">🖨️ طباعة</button>';
    } else {
      if (isThermalPrinter) {
        buttons = '<button class="btn btn-accent" onclick="PrintEngine.printModalGo()">🖨️ طباعة حرارية</button>';
      } else {
        buttons = '<button class="btn btn-accent" onclick="PrintEngine.printModalGo()">🖨️ طباعة A4</button>';
      }
    }
    openModal(`
      <div class="modal-head"><h3>${esc(headTitle)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div style="background:#fff;border-radius:12px;padding:14px;border:1px solid var(--border);max-height:60vh;overflow:auto">${body}</div>
      <div class="modal-foot">
        <button class="btn btn-secondary" onclick="closeModal()">إغلاق</button>
        ${buttons}
      </div>
    `, true);
  },

  printModalGo() {
    const p = window.__printModal;
    if (!p) return;
    if (p.onPrint) return p.onPrint();
    const pt = this.getPrinterType();
    if (p.type === 'label') {
      return this.printLabel(p.html, { preview: false });
    }
    if (p.type === 'report') return this.print(this.formatReportDoc(p.html), { type: 'report' });
    return pt === 'thermal' ? this.printThermal(p.html, { preview: false }) : this.printA4(p.html, { preview: false });
  },

  printModalNormal() {
    const p = window.__printModal;
    if (!p) return;
    const doc = p.type === 'label' ? this.formatLabelDoc(p.html) : p.type === 'report' ? this.formatReportDoc(p.html) : this.formatThermalDoc(p.html);
    this.iframePrint(doc);
  },

  receiptHtml(s, methodNames, methodName, loyalty) {
    const lines = [
      `<div class="r-head"><h3>${esc(SETTINGS.store_name || 'سوبر ماركت')}</h3>`,
      `<div>فاتورة رقم: ${esc(s.invoice_no)}</div>`,
      `<div>${fmtDate(s.created_at)}</div>`,
      `<div>الكاشير: ${esc(s.cashier)}</div>`,
      s.customer_name ? `<div>العميل: ${esc(s.customer_name)} — ${esc(s.customer_phone || '')}</div>` : '',
      `</div>`,
      `<table>`,
      `<thead><tr><td style="text-align:right"><b>الصنف</b></td><td style="text-align:center"><b>كمية</b></td><td style="text-align:left"><b>سعر</b></td><td style="text-align:left"><b>إجمالي</b></td></tr></thead><tbody>`,
      ...s.items.map(i => {
        let serialsArr = [];
        try { if (i.serials_json) serialsArr = JSON.parse(i.serials_json); } catch {}
        const serialsStr = serialsArr.length ? `<div style="font-size:11.5px;font-weight:800;color:#000;direction:ltr;text-align:right;margin-top:2px;letter-spacing:0.5px"><b>🔢 S/N:</b> ${serialsArr.map(s => esc(s)).join(', ')}</div>` : '';
        return `<tr>
          <td style="text-align:right">${esc(i.name)}${serialsStr}</td>
          <td style="text-align:center">${fmt(i.qty)}</td>
          <td style="text-align:left">${fmt(i.price)}</td>
          <td style="text-align:left">${fmt(i.total)}</td>
        </tr>`;
      }),
      `</tbody></table>`,
      `<div class="dashed"></div>`,
      `<div class="r-line"><span>الإجمالي قبل الخصم</span><span>${fmt(s.subtotal)}</span></div>`,
      `<div class="r-line"><span>الخصم</span><span>${fmt(s.discount)}</span></div>`,
      Number(s.delivery_fee) > 0 ? `<div class="r-line"><span>توصيل${s.delivery_address ? ': ' + esc(s.delivery_address) : ''}</span><span>${fmt(s.delivery_fee)}</span></div>` : '',
      `<div class="r-line r-total"><span>المطلوب</span><span>${fmt(s.total)} ${SETTINGS.currency || 'ج'}</span></div>`,
      `<div class="r-line"><span>المدفوع</span><span>${fmt(s.paid)}</span></div>`,
      s.total - s.paid > 0 ? `<div class="r-line"><span>المتبقي</span><span>${fmt(s.total - s.paid)}</span></div>` : '',
      `<div class="r-line"><span>طريقة الدفع</span><span>${methodName || methodNames[s.payment_method] || s.payment_method}</span></div>`,
      loyalty && loyalty.code ? this.loyaltyBarcodePrintHtml(loyalty) : '',
      `<div class="r-foot">${esc(SETTINGS.invoice_footer || 'شكراً لتعاملكم معنا')}</div>`,
    ];
    return lines.join('\n');
  },

  barcodeImg(code, opts = {}) {
    if (typeof bwipjs === 'undefined') return '';
    try {
      const canvas = document.createElement('canvas');
      bwipjs.toCanvas(canvas, { bcid: 'code128', text: String(code), scale: opts.scale || 3, height: opts.height || 14, includetext: false });
      return canvas.toDataURL('image/png');
    } catch (e) { return ''; }
  },

  loyaltyBarcodePrintHtml(loy) {
    const title = loy.issued ? 'كوبون ولاء جديد' : 'كوبون الخصم';
    return `
      <div class="dashed"></div>
      <div class="bc">
        <div style="font-weight:bold">${title}: خصم ${loy.discount_type === 'percent' ? loy.value + '%' : fmt(loy.value)}</div>
        <div>صالح حتى ${loy.expires_at}</div>
        <img src="${this.barcodeImg(loy.code)}" alt="barcode">
        <div class="code-text">${esc(loy.code)}</div>
      </div>`;
  },

  loyaltyLabelHtml(loy) {
    if (!loy) return '';
    return [
      `<div class="label">`,
      `<div class="l-title">${esc(SETTINGS.store_name || 'سوبر ماركت')}</div>`,
      `<div class="l-sub">كوبون خصم ${loy.discount_type === 'percent' ? loy.value + '%' : fmt(loy.value)}</div>`,
      `<div class="l-sub">صالح حتى ${loy.expires_at}</div>`,
      `<div class="l-img"><img src="${this.barcodeImg(loy.code)}" alt="barcode"><div class="l-code">${esc(loy.code)}</div></div>`,
      `<div class="l-sub">امسح الباركود عند الكاشير للخصم</div>`,
      `</div>`,
    ].join('\n');
  },

  printBarcodeLabels(labels, mode, opts = {}) {
    if (labels.length === 0) return;
    const items = labels.map(l => `
      <div class="label">
        <div class="l-name">${esc(l.name)}</div>
        ${l.barcode ? `<img src="${this.barcodeImg(l.barcode)}" alt="">` : '<div class="no-bc">بدون باركود</div>'}
        ${l.barcode ? `<div class="l-code">${esc(l.barcode)}</div>` : ''}
        ${l.showPrice !== false ? `<div class="l-price">${fmt(l.price)} ${esc(SETTINGS.currency || 'ج')}</div>` : ''}
      </div>`).join('');
    this.print(this.formatLabelDoc(items, mode, `طباعة باركود — ${labels.length} ملصق`), { type: 'label', ...opts });
  }
};

/* Attach PrintEngine and wrappers to global scope (window / globalThis) */
const _g = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : globalThis);
_g.PrintEngine = PrintEngine;

function detectPrinterType(name) { return PrintEngine.detectPrinterType(name); }
function getPrinterType() { return PrintEngine.getPrinterType(); }
function printDocument(html, opts) { return PrintEngine.print(html, opts); }
function doPrint(html, opts) { return PrintEngine.doPrint(html, opts); }
function iframePrint(html) { return PrintEngine.iframePrint(html); }
function receiptDoc(html) { return PrintEngine.formatThermalDoc(html); }
function invoiceA4Doc(html) { return PrintEngine.formatA4Doc(html); }
function labelDoc(html) { return PrintEngine.formatLabelDoc(html); }
function reportDoc(html) { return PrintEngine.formatReportDoc(html); }
function thermalPrint(html, opts) { return PrintEngine.printThermal(html, opts); }
function a4InvoicePrint(html, opts) { return PrintEngine.printA4(html, opts); }
function labelPrint(html, opts) { return PrintEngine.printLabel(html, opts); }
function smartPrint(html, type) { return PrintEngine.smartPrint(html, type); }
function openPrintModal(html, type, title, onPrint) { return PrintEngine.openPreviewModal(html, type, title, onPrint); }
function printModalGo() { return PrintEngine.printModalGo(); }
function printModalNormal() { return PrintEngine.printModalNormal(); }
function receiptHtml(s, methodNames, methodName, loyalty) { return PrintEngine.receiptHtml(s, methodNames, methodName, loyalty); }
function barcodeImg(code, opts) { return PrintEngine.barcodeImg(code, opts); }
function loyaltyBarcodePrintHtml(loy) { return PrintEngine.loyaltyBarcodePrintHtml(loy); }
function loyaltyLabelHtml(loy) { return PrintEngine.loyaltyLabelHtml(loy); }
function printBarcodeLabels(labels, mode, opts) { return PrintEngine.printBarcodeLabels(labels, mode, opts); }
function getFontSizeZoomCss() { return PrintEngine.getFontSizeZoomCss(); }
function getInvoicePrinter() { return PrintEngine.getInvoicePrinter(); }
function getBarcodePrinter() { return PrintEngine.getBarcodePrinter(); }

_g.detectPrinterType = detectPrinterType;
_g.getPrinterType = getPrinterType;
_g.printDocument = printDocument;
_g.doPrint = doPrint;
_g.iframePrint = iframePrint;
_g.receiptDoc = receiptDoc;
_g.invoiceA4Doc = invoiceA4Doc;
_g.labelDoc = labelDoc;
_g.reportDoc = reportDoc;
_g.thermalPrint = thermalPrint;
_g.a4InvoicePrint = a4InvoicePrint;
_g.labelPrint = labelPrint;
_g.smartPrint = smartPrint;
_g.openPrintModal = openPrintModal;
_g.printModalGo = printModalGo;
_g.printModalNormal = printModalNormal;
_g.receiptHtml = receiptHtml;
_g.barcodeImg = barcodeImg;
_g.loyaltyBarcodePrintHtml = loyaltyBarcodePrintHtml;
_g.loyaltyLabelHtml = loyaltyLabelHtml;
_g.printBarcodeLabels = printBarcodeLabels;
_g.getFontSizeZoomCss = getFontSizeZoomCss;
_g.getInvoicePrinter = getInvoicePrinter;
_g.getBarcodePrinter = getBarcodePrinter;

/* ==================== USED DEVICE AGREEMENT PRINTING ==================== */

function getUsedDevicePurchaseAgreementHTML(device) {
  if (!device) return '';
  const storeName = esc(SETTINGS.store_name || 'محل الإلكترونيات');
  const storePhone = esc(SETTINGS.phone || '');
  const storeAddr = esc(SETTINGS.address || '');

  return `<!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>مبايعة شراء جهاز مستعمل — ${esc(device.code)}</title>
      <style>${AGREEMENT_A4_CSS}\n${PrintEngine.getFontSizeZoomCss()}</style>
    </head>
    <body>
      <div class="agr-card">
        <div class="agr-head">
          <h2>${storeName}</h2>
          ${storeAddr ? `<p class="store-subtitle">${storeAddr} ${storePhone ? ' — ت: ' + storePhone : ''}</p>` : ''}
          <h3>عقد مبايعة وإقرار بيع جهاز مستعمل</h3>
          <div class="agr-meta">
            <span><b>رقم المبايعة:</b> ${esc(device.code)}</span>
            <span><b>التاريخ:</b> ${esc(device.purchase_date || '')}</span>
          </div>
        </div>

        <div class="parties-box">
          <div class="party-card">
            <h4>الطرف الأول (المشتري / المحل):</h4>
            <p><b>الاسم:</b> ${storeName}</p>
            <p><b>العنوان:</b> ${storeAddr || 'مقر المحل'}</p>
            <p><b>الهاتف:</b> ${storePhone || '—'}</p>
          </div>
          <div class="party-card">
            <h4>الطرف الثاني (البائع / العميل):</h4>
            <p><b>الاسم الكامل:</b> ${esc(device.seller_name || '—')}</p>
            <p><b>الرقم القومي:</b> ${esc(device.seller_national_id || '—')}</p>
            <p><b>رقم الهاتف:</b> ${esc(device.seller_phone || '—')}</p>
            <p><b>العنوان:</b> ${esc(device.seller_address || '—')}</p>
          </div>
        </div>

        <h4 class="section-title">بيانات ومواصفات الجهاز المباع:</h4>
        <table class="agr-table">
          <thead>
            <tr>
              <th>اسم / نوع الجهاز</th>
              <th>الماركة والـ Model</th>
              <th>الرقم التسلسلي / IMEI</th>
              <th>الحالة والعيوب والملحقات</th>
              <th>سعر الشراء المتفق عليه</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>${esc(device.device_name)}</b></td>
              <td>${esc(device.brand || '')} ${esc(device.model || '')}</td>
              <td style="direction:ltr;text-align:center;"><b>${esc(device.serial_number || '—')}</b></td>
              <td>${esc(device.condition_notes || 'حالة ممتازة / بدون ملحقات')}</td>
              <td><b>${fmt(device.purchase_price)} ${esc(SETTINGS.currency || 'ج')}</b></td>
            </tr>
          </tbody>
        </table>

        <div class="legal-terms">
          <h4>إقرار وشروط المبايعة (تعهد قانوني):</h4>
          <p>1. يقر الطرف الثاني (البائع) بأنه المالك الشرعي والوحيد للجهاز الموصوف أعلاه، وأن الجهاز غير مسروق وليس عليه أي أعباء أو نزاعات قضائية أو بلاغات أمنية أو التزامات لشركات الاتصالات.</p>
          <p>2. يتحمل الطرف الثاني (البائع) المسئولية الجنائية والمدنية كاملة أمام كافة الجهات الرسمية والقضائية في حال ثبوت عدم ملكيته للجهاز أو وجود أي بلاغ سابق عنه.</p>
          <p>3. يقر الطرف الثاني بأنه قد استلم كامل قيمة الشراء الموضحة أعلاه نقداً وعداً، وتم انتقال ملكية الجهاز بالكامل إلى الطرف الأول.</p>
        </div>

        <div class="signatures">
          <div class="sig-box">
            <p>توقيع الطرف الأول (المحل)</p>
            <div class="sig-line"></div>
            <span>التوقيع / الخاتم</span>
          </div>
          <div class="sig-box">
            <p>توقيع وإقرار الطرف الثاني (البائع)</p>
            <div class="sig-line"></div>
            <span>اسم المقر والأساسي / البصمة</span>
          </div>
        </div>
      </div>
    </body>
    </html>`;
}

function getUsedDeviceSaleAgreementHTML(device) {
  if (!device) return '';
  const storeName = esc(SETTINGS.store_name || 'محل الإلكترونيات');
  const storePhone = esc(SETTINGS.phone || '');
  const storeAddr = esc(SETTINGS.address || '');

  return `<!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>مبايعة بيع جهاز مستعمل — ${esc(device.code)}</title>
      <style>${AGREEMENT_A4_CSS}\n${PrintEngine.getFontSizeZoomCss()}</style>
    </head>
    <body>
      <div class="agr-card">
        <div class="agr-head">
          <h2>${storeName}</h2>
          ${storeAddr ? `<p class="store-subtitle">${storeAddr} ${storePhone ? ' — ت: ' + storePhone : ''}</p>` : ''}
          <h3>فاتورة وعقد بيع جهاز مستعمل</h3>
          <div class="agr-meta">
            <span><b>رقم العملية:</b> ${esc(device.code)}</span>
            <span><b>تاريخ البيع:</b> ${esc(device.sale_date || '')}</span>
          </div>
        </div>

        <div class="parties-box">
          <div class="party-card">
            <h4>الطرف الأول (البائع / المحل):</h4>
            <p><b>الاسم:</b> ${storeName}</p>
            <p><b>العنوان:</b> ${storeAddr || 'مقر المحل'}</p>
            <p><b>الهاتف:</b> ${storePhone || '—'}</p>
          </div>
          <div class="party-card">
            <h4>الطرف الثاني (المشتري):</h4>
            <p><b>الاسم الكامل:</b> ${esc(device.buyer_name || '—')}</p>
            <p><b>الرقم القومي:</b> ${esc(device.buyer_national_id || '—')}</p>
            <p><b>رقم الهاتف:</b> ${esc(device.buyer_phone || '—')}</p>
            <p><b>العنوان:</b> ${esc(device.buyer_address || '—')}</p>
          </div>
        </div>

        <h4 class="section-title">بيانات ومواصفات الجهاز المباع:</h4>
        <table class="agr-table">
          <thead>
            <tr>
              <th>اسم / نوع الجهاز</th>
              <th>الماركة والـ Model</th>
              <th>الرقم التسلسلي / IMEI</th>
              <th>فترة الضمان</th>
              <th>إجمالي سعر البيع</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>${esc(device.device_name)}</b></td>
              <td>${esc(device.brand || '')} ${esc(device.model || '')}</td>
              <td style="direction:ltr;text-align:center;"><b>${esc(device.serial_number || '—')}</b></td>
              <td>${device.warranty_days ? `${device.warranty_days} يوم` : 'بدون ضمان (معاينة تجربة)'}</td>
              <td><b>${fmt(device.sale_price)} ${esc(SETTINGS.currency || 'ج')}</b></td>
            </tr>
          </tbody>
        </table>

        <div class="legal-terms">
          <h4>شروط البيع والاستلام:</h4>
          <p>1. يقر الطرف الثاني (المشتري) بأنه قد عاين الجهاز المعاينة التامة النافية للجهالة وقبله بحالته الراهنة.</p>
          <p>2. الضمان يغطي العيوب التشغيلية المحددة فقط خلال فترة الضمان الموضحة أعلاه، ولا يشمل الكسر أو السوائل أو سوء الاستخدام.</p>
          <p>3. تم سداد كامل الثمن ونقل حيازة الجهاز إلى المشتري.</p>
        </div>

        <div class="signatures">
          <div class="sig-box">
            <p>توقيع وخاتم المحل (البائع)</p>
            <div class="sig-line"></div>
            <span>التوقيع الرسمي</span>
          </div>
          <div class="sig-box">
            <p>توقيع المشتري بالاستلام</p>
            <div class="sig-line"></div>
            <span>اسم المشتري بالتوقيع</span>
          </div>
        </div>
      </div>
    </body>
    </html>`;
}

function openAgreementPromptModal(type, device) {
  if (!device) return;
  const isPurchase = type === 'purchase';
  const title = isPurchase ? `📜 معاينة عقد مبايعة شراء (${esc(device.code)})` : `📄 معاينة عقد مبايعة بيع (${esc(device.code)})`;
  const rawHtml = isPurchase ? getUsedDevicePurchaseAgreementHTML(device) : getUsedDeviceSaleAgreementHTML(device);

  window._currentPendingAgreementHtml = rawHtml;

  const modalHtml = `
    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #ddd; padding-bottom:10px;">
      <h3 style="margin:0; font-size:1.3rem;">${title}</h3>
      <button class="btn btn-sm btn-secondary" onclick="closeModal()">✕</button>
    </div>
    
    <div style="margin-bottom:10px; font-size:0.95rem; color:#444; background:#e0f2fe; border:1px solid #bae6fd; padding:10px; border-radius:6px;">
      <b>📋 معاينة عقد المبايعة:</b> يمكنك مراجعة كافة بيانات البائع والمشتري ومواصفات الجهاز أدناه ثم اختيار الطباعة أو الإغلاق.
    </div>

    <!-- Scrollable Document Preview Box -->
    <div style="max-height:65vh; overflow-y:auto; background:#525659; padding:20px; border-radius:8px; margin-bottom:15px; border:1px solid #333;">
      <div style="background:#fff; padding:25px; border-radius:4px; font-family:'Segoe UI', Tahoma, sans-serif; color:#000; box-shadow:0 4px 15px rgba(0,0,0,0.3);">
        ${rawHtml.slice(rawHtml.indexOf('<body>') + 6, rawHtml.indexOf('</body>'))}
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; pt-2">
      <button class="btn btn-secondary btn-lg" onclick="closeModal()">✖ إلغاء وإغلاق</button>
      <button class="btn btn-primary btn-lg" style="font-weight:bold; font-size:1.1rem; padding:10px 24px;" onclick="confirmPrintCurrentAgreement()">🖨️ تأكيد وطباعة العقد الآن</button>
    </div>
  `;

  openModal(modalHtml, true);
}

function confirmPrintCurrentAgreement() {
  if (window._currentPendingAgreementHtml) {
    PrintEngine.print(window._currentPendingAgreementHtml, { type: 'a4' });
  }
}

function printUsedDevicePurchaseAgreement(device) {
  openAgreementPromptModal('purchase', device);
}

function printUsedDeviceSaleAgreement(device) {
  openAgreementPromptModal('sale', device);
}
