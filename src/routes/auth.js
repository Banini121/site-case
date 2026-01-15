import crypto from 'node:crypto';
import config from '../config.js';
import { getDb } from '../db.js';
import { authLog, errorLog } from '../logger.js';
import { generateRandomToken, hashValue, normalizeUserAgent, signAccessToken, verifyCsrfToken } from '../security.js';
import { loginLimiter, refreshLimiter } from '../rateLimiter.js';

const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_URL = 'https://discord.com/api/users/@me';

const accessCookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax',
  path: '/'
};

const refreshCookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax',
  path: '/auth/refresh'
};

function setAuthCookies(reply, { accessToken, refreshToken }) {
  reply.setCookie('access_token', accessToken, accessCookieOptions);
  reply.setCookie('refresh_token', refreshToken, refreshCookieOptions);
}

function clearAuthCookies(reply) {
  reply.clearCookie('access_token', accessCookieOptions);
  reply.clearCookie('refresh_token', refreshCookieOptions);
}

function buildDiscordUrl(state) {
  const params = new URLSearchParams({
    client_id: config.discordClientId,
    redirect_uri: config.discordRedirectUri,
    response_type: 'code',
    scope: 'identify',
    state
  });
  return `${DISCORD_AUTH_URL}?${params.toString()}`;
}

function requireOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    return config.allowedOrigins.some((allowed) => new URL(allowed).host === originHost);
  } catch (error) {
    return false;
  }
}

function requireCsrf(request, reply) {
  const csrfToken = request.headers['x-csrf-token'];
  const csrfHash = request.cookies.csrf_hash;
  const contentType = request.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    reply.code(415).send({ message: 'Unsupported content type' });
    return false;
  }
  if (!verifyCsrfToken(csrfToken, csrfHash)) {
    reply.code(403).send({ message: 'CSRF validation failed' });
    return false;
  }
  if (!requireOrigin(request)) {
    reply.code(403).send({ message: 'Invalid origin' });
    return false;
  }
  return true;
}

export async function authRoutes(app) {
  app.get('/discord', async (request, reply) => {
    const limit = loginLimiter.check(request.ip, { route: 'oauth_start' });
    if (!limit.allowed) {
      reply.code(429).send({ message: 'Слишком много попыток входа' });
      return;
    }
    const state = crypto.randomBytes(24).toString('hex');
    const db = getDb();
    const userAgent = normalizeUserAgent(request.headers['user-agent']);
    const expiresAt = new Date(Date.now() + config.oauthTimeoutMinutes * 60 * 1000);
    await db.collection('oauth_attempts').insertOne({
      state,
      createdAt: new Date(),
      expiresAt,
      redirectUri: config.discordRedirectUri,
      ip: request.ip,
      userAgentHash: hashValue(userAgent)
    });
    reply.redirect(buildDiscordUrl(state));
  });

  app.get('/discord/callback', async (request, reply) => {
    const { code, state } = request.query;
    if (!code || !state) {
      authLog({ event: 'oauth_invalid_callback', ip: request.ip });
      reply.code(400).send({ message: 'Invalid OAuth callback' });
      return;
    }

    const db = getDb();
    const attempt = await db.collection('oauth_attempts').findOne({ state });
    if (!attempt || attempt.redirectUri !== config.discordRedirectUri) {
      authLog({ event: 'oauth_invalid_state', ip: request.ip });
      reply.code(400).send({ message: 'OAuth attempt not found' });
      return;
    }
    if (attempt.expiresAt < new Date()) {
      authLog({ event: 'oauth_expired', ip: request.ip });
      reply.code(400).send({ message: 'OAuth attempt expired' });
      return;
    }
    await db.collection('oauth_attempts').deleteOne({ state });

    const codeHash = hashValue(code);
    const existingCode = await db.collection('oauth_codes').findOne({ codeHash });
    if (existingCode) {
      authLog({ event: 'oauth_code_reuse', ip: request.ip });
      reply.code(400).send({ message: 'OAuth code already used' });
      return;
    }
    await db.collection('oauth_codes').insertOne({
      codeHash,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const tokenResponse = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.discordRedirectUri
      })
    });

    if (!tokenResponse.ok) {
      errorLog({ event: 'oauth_token_error', status: tokenResponse.status });
      authLog({ event: 'oauth_token_error', ip: request.ip });
      reply.code(400).send({ message: 'OAuth token exchange failed' });
      return;
    }

    const tokenData = await tokenResponse.json();
    const scopeList = (tokenData.scope || '').split(' ');
    if (!scopeList.includes('identify')) {
      authLog({ event: 'oauth_invalid_scope', ip: request.ip });
      reply.code(400).send({ message: 'Invalid OAuth scope' });
      return;
    }

    const userResponse = await fetch(DISCORD_USER_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userResponse.ok) {
      authLog({ event: 'oauth_user_fetch_failed', ip: request.ip });
      reply.code(400).send({ message: 'Failed to fetch Discord user' });
      return;
    }

    const discordUser = await userResponse.json();
    const dbUser = await db.collection('users').findOneAndUpdate(
      { discordId: discordUser.id },
      {
        $setOnInsert: {
          discordId: discordUser.id,
          level: 'pending',
          balance: 0,
          openedCasesCount: 0,
          approved: false,
          blocked: false,
          createdAt: new Date()
        },
        $set: {
          username: `${discordUser.username}#${discordUser.discriminator}`,
          avatarUrl: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null,
          updatedAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const user = dbUser.value || await db.collection('users').findOne({ discordId: discordUser.id });
    if (!user) {
      errorLog({ event: 'oauth_user_missing', discordId: discordUser.id });
      reply.code(500).send({ message: 'User provisioning failed' });
      return;
    }
    const refreshToken = generateRandomToken();
    const refreshTokenHash = hashValue(refreshToken);
    const userAgent = normalizeUserAgent(request.headers['user-agent']);
    const session = {
      userId: user.discordId,
      refreshTokenHash,
      userAgentHash: hashValue(userAgent),
      ip: request.ip,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000)
    };
    await db.collection('sessions').insertOne(session);

    const sessionCount = await db.collection('sessions').countDocuments({ userId: user.discordId });
    if (sessionCount > config.maxActiveSessions) {
      const excess = sessionCount - config.maxActiveSessions;
      const oldSessions = await db.collection('sessions')
        .find({ userId: user.discordId })
        .sort({ createdAt: 1 })
        .limit(excess)
        .toArray();
      if (oldSessions.length) {
        await db.collection('sessions').deleteMany({ _id: { $in: oldSessions.map((s) => s._id) } });
      }
    }

    const accessToken = await signAccessToken({
      sub: user.discordId,
      level: user.level,
      approved: user.approved
    });

    setAuthCookies(reply, { accessToken, refreshToken });
    authLog({ event: 'login', userId: user.discordId, ip: request.ip });

    reply.redirect('/pending');
  });

  app.post('/refresh', async (request, reply) => {
    if (!requireCsrf(request, reply)) return;
    const limit = refreshLimiter.check(request.ip, { route: 'refresh' });
    if (!limit.allowed) {
      reply.code(429).send({ message: 'Слишком много попыток обновления' });
      return;
    }
    const refreshToken = request.cookies.refresh_token;
    if (!refreshToken) {
      reply.code(401).send({ message: 'Missing refresh token' });
      return;
    }

    const db = getDb();
    const refreshTokenHash = hashValue(refreshToken);
    const session = await db.collection('sessions').findOne({ refreshTokenHash });
    if (!session) {
      reply.code(401).send({ message: 'Invalid refresh token' });
      return;
    }
    if (session.revokedAt || session.expiresAt < new Date()) {
      await db.collection('sessions').updateMany({ userId: session.userId }, { $set: { revokedAt: new Date() } });
      authLog({ event: 'refresh_reuse', userId: session.userId, ip: request.ip });
      clearAuthCookies(reply);
      reply.code(401).send({ message: 'Session revoked' });
      return;
    }

    const userAgent = normalizeUserAgent(request.headers['user-agent']);
    if (session.userAgentHash !== hashValue(userAgent)) {
      await db.collection('sessions').updateMany({ userId: session.userId }, { $set: { revokedAt: new Date() } });
      authLog({ event: 'refresh_user_agent_mismatch', userId: session.userId, ip: request.ip });
      clearAuthCookies(reply);
      reply.code(401).send({ message: 'Session revoked' });
      return;
    }

    const newRefreshToken = generateRandomToken();
    const newRefreshHash = hashValue(newRefreshToken);
    await db.collection('sessions').updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date(), replacedBy: newRefreshHash, lastUsedAt: new Date() } }
    );
    await db.collection('sessions').insertOne({
      userId: session.userId,
      refreshTokenHash: newRefreshHash,
      userAgentHash: session.userAgentHash,
      ip: request.ip,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000)
    });

    const user = await db.collection('users').findOne({ discordId: session.userId });
    const accessToken = await signAccessToken({
      sub: user.discordId,
      level: user.level,
      approved: user.approved
    });

    setAuthCookies(reply, { accessToken, refreshToken: newRefreshToken });
    authLog({ event: 'refresh', userId: user.discordId, ip: request.ip });
    reply.send({ ok: true });
  });

  app.post('/logout', async (request, reply) => {
    if (!requireCsrf(request, reply)) return;
    const refreshToken = request.cookies.refresh_token;
    if (refreshToken) {
      const db = getDb();
      await db.collection('sessions').updateOne(
        { refreshTokenHash: hashValue(refreshToken) },
        { $set: { revokedAt: new Date() } }
      );
    }
    clearAuthCookies(reply);
    authLog({ event: 'logout', ip: request.ip });
    reply.send({ ok: true });
  });
}