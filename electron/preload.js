const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printerAPI', {
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printHTML: (html, opts) => ipcRenderer.invoke('print-html', { html, ...opts }),
  listPorts: () => ipcRenderer.invoke('list-ports'),
  exportPDF: (html, fileName) => ipcRenderer.invoke('export-pdf', { html, fileName }),
  printESCP: (port, base64) => ipcRenderer.invoke('print-escp', { port, base64 }),
});
