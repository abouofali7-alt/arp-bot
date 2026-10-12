/* Offline licensing: machine-bound activation codes + 7-day trial */
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// secret split to avoid trivial string grep
const _a = 'Arp@2026';
const _b = '#L1c-K3y';
const SECRET = _a + '::' + _b + '!v1';

const TRIAL_DAYS = 7;
const B32 = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I confusion

const STASH_PATH = path.join(process.env.APPDATA || os.homedir(), '.arp_pos_license.dat');

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function hmac(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest(); }

function b32(buf, len) {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length && out.length < len; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  while (out.length < len) out += B32[0];
  return out;
}
function group(s, n = 5) { return s.match(new RegExp('.{1,' + n + '}', 'g')).join('-'); }
function ungroup(s) { return String(s || '').toUpperCase().replace(/[^2-9A-Z]/g, ''); }

function machineId() {
  try {
    const out = cp.execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
    if (m) return 'MG:' + m[1];
  } catch (e) { }
  return os.hostname() + '|' + ((os.userInfo().username) || '');
}

function isValidDeviceFormat(code) { return /^[2-9A-HJ-NP-Z]{8}$/.test(ungroup(code)); }

function deviceCode() {
  // stable short fingerprint of this machine
  let dc = '';
  try { dc = b32(sha('dev|' + machineId()), 8); } catch (e) { dc = b32(sha('dev|fallback'), 8); }
  return group(dc, 4);
}

function makeActivationCode(devCode) {
  const d = ungroup(devCode);
  if (!isValidDeviceFormat(d)) throw new Error('كود جهاز غير صالح');
  return group(b32(hmac('ARP-ACT|' + d), 15));
}

function verifyCode(code, devCode) {
  try { return ungroup(code).length === 15 && ungroup(code) === ungroup(makeActivationCode(devCode)); }
  catch (e) { return false; }
}

/* ---- trial stash: survives deleting the data directory ---- */
function stashRead() {
  try {
    const raw = fs.readFileSync(STASH_PATH, 'utf8').trim();
    const idx = raw.lastIndexOf('|');
    if (idx < 0) return null;
    const payload = raw.slice(0, idx), sig = raw.slice(idx + 1);
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(crypto.createHmac('sha256', SECRET).update(payload).digest('hex')))) {
      const t = new Date(payload);
      if (!isNaN(t)) return t.toISOString();
    }
  } catch (e) { }
  return null;
}
function stashWrite(startIso) {
  try {
    const cur = stashRead();
    const pick = (!cur || new Date(startIso) < new Date(cur)) ? startIso : cur;
    const sig = crypto.createHmac('sha256', SECRET).update(pick).digest('hex');
    fs.mkdirSync(path.dirname(STASH_PATH), { recursive: true });
    fs.writeFileSync(STASH_PATH, pick + '|' + sig);
    return pick;
  } catch (e) { return startIso; }
}

/* ---- state backed by settings table ---- */
let dbGet = null, dbRun = null;
function attachDb(getFn, runFn) { dbGet = getFn; dbRun = runFn; }

function readRecord() {
  try {
    const r = dbGet && dbGet("SELECT value FROM settings WHERE key = 'license_json'");
    if (r && r.value) return JSON.parse(r.value);
  } catch (e) { }
  return {};
}
function writeRecord(rec) {
  try {
    dbRun("INSERT INTO settings (key, value) VALUES ('license_json', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(rec)]);
  } catch (e) { }
}

function status() {
  const rec = readRecord();
  const dev = deviceCode();
  if (rec.activated) {
    return { mode: 'active', device_code: dev, activated_at: rec.activated_at || null };
  }
  let start = rec.trial_start || null;
  const stashed = stashRead();
  if (stashed && (!start || new Date(stashed) < new Date(start))) start = stashed;
  if (start && !rec.trial_start) writeRecord({ ...rec, trial_start: start }); // re-adopt after data reset
  if (!start) {
    return { mode: 'unlicensed', device_code: dev, trial_days_left: TRIAL_DAYS };
  }
  const elapsedDays = (Date.now() - new Date(start).getTime()) / 86400000;
  const left = Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays));
  return {
    mode: left > 0 ? 'trial' : 'expired',
    device_code: dev,
    trial_started_at: start,
    trial_days_left: left,
    trial_total: TRIAL_DAYS,
  };
}

function isOpen() {
  const s = status();
  return s.mode === 'active' || s.mode === 'trial';
}

function startTrial() {
  const rec = readRecord();
  if (rec.activated) return status();
  if (!rec.trial_start) {
    rec.trial_start = new Date().toISOString();
    writeRecord(rec);
    stashWrite(rec.trial_start);
  } else {
    stashWrite(rec.trial_start); // ensure stash mirrors db even if older
  }
  return status();
}

function activate(code) {
  const dev = deviceCode();
  if (!verifyCode(code, dev)) return { ok: false };
  const rec = readRecord();
  rec.activated = true;
  rec.code = ungroup(code);
  rec.activated_at = new Date().toISOString();
  writeRecord(rec);
  return { ok: true, status: status() };
}

module.exports = {
  TRIAL_DAYS, deviceCode, makeActivationCode, verifyCode, isValidDeviceFormat,
  attachDb, status, isOpen, startTrial, activate,
  _writeStash: stashWrite, // internal — for tests
};
