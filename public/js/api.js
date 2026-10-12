const API = {
  async request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && url !== '/api/login') {
        localStorage.removeItem('token');
        window.location.href = '/';
        return;
      }
      throw new Error(data.error || 'حدث خطأ غير متوقع');
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  del(url) { return this.request('DELETE', url); },
};

function fmt(n) {
  if (n === null || n === undefined) return '0';
  const num = Number(n);
  if (!isFinite(num)) return '0';
  const isWhole = Math.abs(num - Math.round(num)) < 1e-9;
  if (isWhole) return Math.round(num).toLocaleString('ar-EG');
  return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('ar-EG');
}
