import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import config from './config.js';

const encoder = new TextEncoder();

export const LEVELS = {
  PENDING: 'pending',
  USER: 'user',
  LEADERSHIP: 'leadership',
  DEV: 'dev'
};

export const LEVEL_ORDER = [
  LEVELS.PENDING,
  LEVELS.USER,
  LEVELS.LEADERSHIP,
  LEVELS.DEV
];

export function levelAtLeast(userLevel, requiredLevel) {
  return LEVEL_ORDER.indexOf(userLevel) >= LEVEL_ORDER.indexOf(requiredLevel);
}

export function normalizeUserAgent(userAgent) {
  return (userAgent || 'unknown').slice(0, 200);
}

export function hashValue(value, secret = config.refreshTokenSecret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function generateRandomToken() {
  return crypto.randomBytes(48).toString('hex');
}

export async function signAccessToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(`${config.accessTokenMinutes}m`)
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, encoder.encode(config.jwtSecret));
  return payload;
}

export function buildCsrfToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashValue(token, config.csrfSecret);
  return { token, hash };
}

export function verifyCsrfToken(token, hash) {
  if (!token || !hash) return false;
  return hashValue(token, config.csrfSecret) === hash;
}
