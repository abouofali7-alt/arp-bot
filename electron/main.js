const { app, BrowserWindow, shell, ipcMain, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { execFile } = require('node:child_process');

process.env.ARP_DATA_DIR = process.env.ARP_DATA_DIR || path.join(app.getPath('userData'), 'data');

const logCrash = (msg) => {
  try {
    const f = path.join(app.getPath('userData'), 'app_debug.log');
    fs.appendFileSync(f, new Date().toISOString() + ' ' + msg + '\n');
  } catch {}
};

process.on('uncaughtException', (err) => {
  logCrash('UNCAUGHT EXCEPTION: ' + (err.stack || err));
});
process.on('unhandledRejection', (err) => {
  logCrash('UNHANDLED REJECTION: ' + (err.stack || err));
});

let server = null;
let win = null;
let PORT = 3000;

const gotLock = app.requestSingleInstanceLock();
logCrash('gotLock: ' + gotLock);
if (!gotLock) {
  logCrash('Exiting due to singleInstanceLock = false');
  app.quit();
} else {
  app.on('second-instance', () => {
    logCrash('second-instance triggered');
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

async function startServer() {
  try {
    logCrash('startServer: requiring server/index.js');
    server = require(path.join(__dirname, '..', 'server', 'index.js'));
    const info = await server.ready;
    logCrash('startServer: server.ready resolved with port ' + info.port);
    return info.port;
  } catch (err) {
    logCrash('startServer error: ' + (err.stack || err));
    console.error('تعذر تشغيل السيرفر:', err);
    throw err;
  }
}

function createWindow() {
  logCrash('cw: 1 start');
  const iconPath = path.join(__dirname, '..', 'public', 'icon.png');
  const preloadPath = path.join(__dirname, 'preload.js');
  logCrash('cw: 2 icon=' + iconPath + ' preload=' + preloadPath);
  win = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 1024,
    minHeight: 680,
    autoHideMenuBar: true,
    title: 'ARP نظام ادارة الكترونيات',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });
  logCrash('cw: 3 BrowserWindow created');
  win.loadURL(`http://127.0.0.1:${PORT}`);
  logCrash('cw: 4 loadURL called');
  win.on('close', (e) => logCrash('win close event fired'));
  win.on('closed', () => logCrash('win closed event fired'));
  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    logCrash('win did-fail-load: code=' + code + ' desc=' + desc + ' url=' + url);
  });
  win.webContents.on('render-process-gone', (e, details) => {
    logCrash('render-process-gone: ' + JSON.stringify(details));
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    ipcMain.handle('get-printers', (event) => event.sender.getPrintersAsync());
  } catch (e) { logCrash('ipc get-printers err: ' + e); }

  // load print documents from a temp file: Chromium caps data: URLs at ~2MB,
  // which silently truncated long reports in print/PDF output
  const writeTmp = (htmlStr) => {
    const p = path.join(app.getPath('temp'), `arp-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    fs.writeFileSync(p, htmlStr, 'utf8');
    return p;
  };
  const dropTmp = (p) => { try { fs.unlinkSync(p); } catch {} };

  ipcMain.handle('print-html', (event, { html, deviceName }) => {
    const tmp = writeTmp(html);
    return new Promise((resolve) => {
      const w = new BrowserWindow({
        show: false,
        width: 820,
        height: 700,
        webPreferences: { sandbox: true },
      });
      let done = false;
      const finish = (res) => { if (!done) { done = true; dropTmp(tmp); resolve(res); } };
      const fail = (err) => { try { w.close(); } catch {} finish({ ok: false, err: String(err) }); };
      w.webContents.on('did-fail-load', (_e, code, desc) => fail('فشل تحميل الصفحة (' + code + ' ' + desc + ')'));
      w.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          w.webContents.print({ silent: !!deviceName, deviceName: deviceName || '', printBackground: true }, (ok, err) => {
            try { w.close(); } catch {}
            // no extra delay needed: cut.ps1 polls the printer queue and cuts only after the receipt drains
            if (ok && deviceName) cutPaper(deviceName);
            finish({ ok, err: err || null });
          });
        }, 300);
      });
      w.loadFile(tmp).catch(fail);
      setTimeout(() => fail('انتهت مهلة الطباعة'), 30000);
    });
  });

    try { ipcMain.handle('list-ports', () => listComPorts()); } catch (e) {}
    try {
      ipcMain.handle('export-pdf', async (event, { html, fileName }) => {
        const tmp = writeTmp(html);
        const w = new BrowserWindow({ show: false, width: 900, height: 900, webPreferences: { sandbox: true } });
        try {
          await w.loadFile(tmp);
          await new Promise((r) => setTimeout(r, 400));
          const buf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
          const parent = BrowserWindow.fromWebContents(event.sender) || win;
          const { canceled, filePath } = await dialog.showSaveDialog(parent, {
            title: 'حفظ التقرير PDF',
            defaultPath: fileName || 'report.pdf',
            filters: [{ name: 'ملف PDF', extensions: ['pdf'] }],
          });
          if (canceled || !filePath) { try { w.close(); } catch {} return { ok: false, canceled: true }; }
          fs.writeFileSync(filePath, buf);
          return { ok: true, path: filePath };
        } catch (err) {
          return { ok: false, err: String(err && err.message || err) };
        } finally {
          dropTmp(tmp);
          try { w.close(); } catch {}
        }
      });
    } catch (e) {}
  try {
    ipcMain.handle('print-escp', (event, { port, base64 }) => printEscp(port, base64));
  } catch (e) {}
}

function cutPaper(deviceName, attempt = 0) {
  try {
    // packaged builds: the script ships via extraResources (PowerShell cannot read inside app.asar)
    const ps1 = app.isPackaged ? path.join(process.resourcesPath, 'cut.ps1') : path.join(__dirname, 'cut.ps1');
    const logCut = (msg) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'cut.log'), new Date().toISOString() + '  ' + msg + '\n'); } catch (e) { } };
    if (!fs.existsSync(ps1)) { logCut('SCRIPT MISSING: ' + ps1); return; }
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1,
      '-PrinterName', deviceName, '-FeedLines', '1'],
      { windowsHide: true, timeout: 20000 }, (err, stdout) => {
        const out = String(stdout || '').trim();
        const ok = !err && out.includes('CUT OK');
        logCut((ok ? 'OK' : 'FAIL') + ' printer="' + deviceName + '" ' + (out || (err && err.message) || ''));
        console.log(ok ? '>> تم قطع الورق آلياً' : '>> تعذر القطع الآلي: ' + (out || (err && err.message) || 'سبب غير معروف'));
        if (!ok && attempt < 1) setTimeout(() => cutPaper(deviceName, attempt + 1), 1500);
      });
  } catch (e) { }
}

function listComPorts() {
  return new Promise((resolve) => {
    const script = "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { $_.Name }";
    execFile('powershell', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) return resolve([]);
      const out = [];
      for (const line of stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
        const m = line.match(/\(COM(\d+)\)/i);
        if (m) out.push({ port: 'COM' + m[1], desc: line });
      }
      return resolve(out);
    });
  });
}

function printEscp(port, base64) {
  return new Promise((resolve) => {
    const num = String(port).replace(/^COM/i, '');
    execFile('mode', ['COM' + num, 'baud=9600', 'parity=n', 'data=8', 'stop=1'], { windowsHide: true }, () => {
      let fd;
      try {
        fd = fs.openSync('\\\\.\\COM' + num, 'w');
        fs.writeSync(fd, Buffer.from(base64, 'base64'));
        fs.closeSync(fd);
        resolve({ ok: true });
      } catch (e) {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
        resolve({ ok: false, err: e.message });
      }
    });
  });
}

app.whenReady().then(async () => {
  logCrash('app.whenReady reached');
  Menu.setApplicationMenu(null);
  try {
    PORT = await startServer();
    logCrash('Server started successfully on port ' + PORT);
  } catch (err) {
    logCrash('FATAL startServer: ' + (err.stack || err));
    dialog.showErrorBox('تعذر تشغيل البرنامج', 'حدث خطأ أثناء بدء التشغيل:\n' + err.message + '\n\nجرب إعادة تشغيل البرنامج.');
    app.quit();
    return;
  }
  setTimeout(() => {
    try {
      logCrash('Calling createWindow()...');
      createWindow();
      logCrash('createWindow() called.');
    } catch (e) {
      logCrash('createWindow exception: ' + (e.stack || e));
    }
  }, 300);
});

app.on('window-all-closed', () => {
  app.quit();
});
