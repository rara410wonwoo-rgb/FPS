// Network message names and payload validation (the server never trusts client values as-is)
import { ROOM_CODE_LENGTH, PAIR_CODE_LENGTH, CODE_ALPHABET } from './config.js';

export const C2S = {
  CREATE: 'session:create',
  JOIN: 'session:join',
  RESUME: 'session:resume',
  LEAVE: 'room:leave',
  START: 'room:start',
  RESTART: 'room:restart',
  INPUT: 'input',
  MENU: 'menu',
  PAIR_CREATE: 'pair:create',
  CONTROLLER_PAIR: 'controller:pair',
  CONTROLLER_RESUME: 'controller:resume',
  CONTROLLER_INPUT: 'controller:input',
  PING: 'net:ping',
};

export const S2C = {
  SESSION_OK: 'session:ok',
  SESSION_ERROR: 'session:error',
  SESSION_REPLACED: 'session:replaced',
  ROOM_STATE: 'room:state',
  FULL: 'state:full',
  SNAPSHOT: 'state:snap',
  PAIR_CODE: 'pair:code',
  CONTROLLER_STATUS: 'controller:status',
  CONTROLLER_OK: 'controller:ok',
  CONTROLLER_ERROR: 'controller:error',
  CONTROLLER_KICKED: 'controller:kicked',
  CONTROLLER_STATE: 'controller:state',
  RATE_LIMITED: 'net:rate_limited',
};

const INPUT_KEYS = new Set(['seq', 'mx', 'mz', 'aim', 'fire', 'ads', 'reload', 'interact', 'swap', 'jump', 'crouch', 'sprint']);
const BOOL_KEYS = ['fire', 'ads', 'reload', 'interact', 'swap', 'jump', 'crouch', 'sprint'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Input validation. Any invalid value returns null (no partial acceptance)
export function validateInput(m, { requireSeq = true } = {}) {
  if (!isPlainObject(m)) return null;
  const keys = Object.keys(m);
  if (keys.length > 12) return null;
  for (const k of keys) if (!INPUT_KEYS.has(k)) return null;
  if (requireSeq) {
    if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 2147483647) return null;
  } else if (m.seq !== undefined && (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 2147483647)) {
    return null;
  }
  for (const k of ['mx', 'mz', 'aim']) {
    if (typeof m[k] !== 'number' || !Number.isFinite(m[k])) return null;
  }
  if (Math.abs(m.mx) > 1.001 || Math.abs(m.mz) > 1.001) return null;
  if (Math.abs(m.aim) > Math.PI * 2 + 0.001) return null;
  const out = {
    seq: m.seq ?? 0,
    mx: Math.max(-1, Math.min(1, m.mx)),
    mz: Math.max(-1, Math.min(1, m.mz)),
    aim: m.aim,
  };
  for (const k of BOOL_KEYS) {
    if (m[k] === undefined) { out[k] = false; continue; }
    if (typeof m[k] !== 'boolean') return null;
    out[k] = m[k];
  }
  return out;
}

export function validateName(n) {
  if (typeof n !== 'string') return null;
  const s = n.replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').trim().slice(0, 16);
  return s.length ? s : null;
}

function validateCode(c, len) {
  if (typeof c !== 'string') return null;
  const s = c.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== len) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export const validateRoomCode = (c) => validateCode(c, ROOM_CODE_LENGTH);
export const validatePairCode = (c) => validateCode(c, PAIR_CODE_LENGTH);

export function validateToken(t) {
  if (typeof t !== 'string' || t.length < 16 || t.length > 128) return null;
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : null;
}

export function validatePlayerId(id) {
  if (typeof id !== 'string' || id.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}
