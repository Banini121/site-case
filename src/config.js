import 'dotenv/config';
import crypto from 'node:crypto';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const baseUrlRaw = requireEnv('BASE_URL');
const normalizeUrl = (value) => (value.match(/^https?:\/\//) ? value : `http://${value}`);
const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  baseUrl: normalizeUrl(baseUrlRaw),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  discordClientSecret: requireEnv('DISCORD_CLIENT_SECRET'),
  discordRedirectUri: requireEnv('DISCORD_REDIRECT_URI'),
  jwtSecret: requireEnv('JWT_SECRET'),
  refreshTokenSecret: requireEnv('REFRESH_TOKEN_SECRET'),
  mongoUri: requireEnv('MONGODB_URI'),
  maxActiveSessions: Number(process.env.MAX_ACTIVE_SESSIONS || 5),
  oauthTimeoutMinutes: Number(process.env.OAUTH_TIMEOUT_MINUTES || 10),
  accessTokenMinutes: Number(process.env.ACCESS_TOKEN_MINUTES || 10),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 21),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  rateLimitMaxPerIp: Number(process.env.RATE_LIMIT_MAX_PER_IP || 120),
  rateLimitMaxPerUser: Number(process.env.RATE_LIMIT_MAX_PER_USER || 60),
  rateLimitLogin: Number(process.env.RATE_LIMIT_LOGIN || 10),
  rateLimitRefresh: Number(process.env.RATE_LIMIT_REFRESH || 15),
  rateLimitWrite: Number(process.env.RATE_LIMIT_WRITE || 30),
  trustProxy: process.env.TRUST_PROXY === 'true'
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
config.allowedOrigins = [config.baseUrl, ...allowedOrigins.map(normalizeUrl)];

const cookieSecureEnv = process.env.COOKIE_SECURE;
if (cookieSecureEnv === 'true') {
  config.cookieSecure = true;
} else if (cookieSecureEnv === 'false') {
  config.cookieSecure = false;
} else {
  config.cookieSecure = config.baseUrl.startsWith('https://');
}
config.csrfSecret = crypto.createHash('sha256').update(config.jwtSecret).digest('hex');

export default config;