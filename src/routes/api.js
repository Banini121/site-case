import config from '../config.js';
import { getDb } from '../db.js';
import { auditLog, errorLog, prizeLog } from '../logger.js';
import { perUserLimiter, writeLimiter } from '../rateLimiter.js';
import { levelAtLeast, LEVELS, LEVEL_ORDER, verifyCsrfToken } from '../security.js';
import { getAccessPayload } from '../authentication.js';
import crypto from 'node:crypto';

const RARITY_WEIGHTS = {
  'Редкий': 50,
  'Эпический': 30,
  'Мифический': 15,
  'Легендарный': 5
};

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

async function authenticate(request, reply) {
  const payload = await getAccessPayload(request);
  if (!payload) {
    reply.code(401).send({ message: 'Unauthorized' });
    return null;
  }
  if (!payload.sub) {
    reply.code(401).send({ message: 'Invalid token' });
    return null;
  }
  const limit = perUserLimiter.check(payload.sub, { route: request.routerPath });
  if (!limit.allowed) {
    reply.code(429).send({ message: 'User rate limit exceeded' });
    return null;
  }
  return payload;
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

function requireWriteLimit(request, reply) {
  const limit = writeLimiter.check(request.ip, { route: request.routerPath });
  if (!limit.allowed) {
    reply.code(429).send({ message: 'Write rate limit exceeded' });
    return false;
  }
  return true;
}

function parsePrizeChoice(prizes) {
  const rarityWeights = RARITY_WEIGHTS;
  const available = (prizes || []).filter((p) => p && (p.remaining == null || p.remaining > 0));
  if (!available.length) return null;
  const weights = available.map((p) => Math.max(1, Number(rarityWeights[p.rarity] ?? 10)));
  const total = weights.reduce((a, b) => a + b, 0);
  const roll = crypto.randomInt(0, total);
  let acc = 0;
  for (let i = 0; i < available.length; i++) {
    acc += weights[i];
    if (roll < acc) return available[i];
  }
  return available[available.length - 1];
}

export async function apiRoutes(app) {
  app.addHook('preHandler', async (request, reply) => {
    const payload = await authenticate(request, reply);
    if (!payload) return reply;
    request.userPayload = payload;
  });

  app.addHook('preHandler', async (request, reply) => {
    if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
      if (!requireWriteLimit(request, reply)) return reply;
      if (!requireCsrf(request, reply)) return reply;
    }
  });

  app.get('/cases', async (request, reply) => {
    const db = getDb();
    const user = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!user || user.blocked || !user.approved || user.level === LEVELS.PENDING) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    const cases = await db.collection('cases').find({}).toArray();
    const opens = await db.collection('case_opens').aggregate([
      { $match: { userId: user.discordId } },
      { $group: { _id: '$caseName', count: { $sum: 1 } } }
    ]).toArray();
    const opensByName = Object.fromEntries(opens.map((x) => [x._id, x.count]));

    const result = cases.map((item) => {
      const totalOpened = Number(item.totalOpened || 0);
      const maxTotal = Number(item.maxTotal || 0);
      const userOpens = Number(opensByName[item.name] || 0);
      const maxPerUser = Number(item.maxPerUser || 0);

      let remainingTotal = null;
      if (maxTotal > 0) remainingTotal = Math.max(maxTotal - totalOpened, 0);

      let remainingPerUser = null;
      if (maxPerUser > 0) remainingPerUser = Math.max(maxPerUser - userOpens, 0);

      return {
        name: item.name,
        price: item.price,
        remainingTotal,
        remainingPerUser,
        imageUrl: item.imageUrl || null,
        disabled: Boolean(item.disabled),
        prizesBrief: (item.prizes || []).map((p) => ({ name: p.name, rarity: p.rarity || '', emoji: p.image || null }))
      };
    });
    const levelIndex = (level) => LEVEL_ORDER.indexOf(level);
    result.sort((a, b) => levelIndex(a.minLevel || LEVELS.USER) - levelIndex(b.minLevel || LEVELS.USER));
    reply.send({ cases: result });
  });

  app.get('/me', async (request, reply) => {
    const db = getDb();
    const user = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!user || user.blocked || !user.approved || user.level === LEVELS.PENDING) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    const prizes = await db.collection('case_opens')
      .find({ userId: user.discordId })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    reply.send({
      user: {
        discordId: user.discordId,
        username: user.username,
        level: user.level,
        balance: user.balance,
        approved: user.approved,
        blocked: Boolean(user.blocked),
        avatarUrl: user.avatarUrl || null,
        createdAt: user.createdAt || null
      },
      prizes: prizes.map((entry) => ({
        caseName: entry.caseName,
        prize: entry.prize,
        createdAt: entry.createdAt,
        confirmedAt: entry.confirmedAt || null
      }))
    });
  });

  app.post('/cases/open', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const user = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!user || user.blocked || !user.approved || user.level === LEVELS.PENDING) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }

    const caseItem = await db.collection('cases').findOne({ name: request.body.name });
    if (!caseItem) {
      reply.code(404).send({ message: 'Case not found' });
      return;
    }
    if (caseItem.disabled) {
      reply.code(400).send({ message: 'Case disabled' });
      return;
    }
    if (user.balance < caseItem.price) {
      reply.code(400).send({ message: 'Insufficient balance' });
      return;
    }

    const userCaseOpens = await db.collection('case_opens').countDocuments({
      userId: user.discordId,
      caseName: caseItem.name
    });

    const maxPerUser = Number(caseItem.maxPerUser || 0);
    if (maxPerUser > 0 && userCaseOpens >= maxPerUser) {
      reply.code(400).send({ message: 'User case limit reached' });
      return;
    }

    const maxTotal = Number(caseItem.maxTotal || 0);
    if (maxTotal > 0 && Number(caseItem.totalOpened || 0) >= maxTotal) {
      reply.code(400).send({ message: 'Case total limit reached' });
      return;
    }

    const prizeChoice = parsePrizeChoice(caseItem.prizes);
    if (!prizeChoice) {
      reply.code(400).send({ message: 'No prizes available' });
      return;
    }

    const updatedPrizes = caseItem.prizes.map((prize) => {
      if (prize.name === prizeChoice.name) {
        if (prize.remaining == null) return prize;
        return { ...prize, remaining: Math.max((prize.remaining || 0) - 1, 0) };
      }
      return prize;
    });

    await db.collection('cases').updateOne({ name: caseItem.name }, {
      $set: { prizes: updatedPrizes },
      $inc: { totalOpened: 1 }
    });

    await db.collection('users').updateOne({ discordId: user.discordId }, {
      $inc: { balance: -caseItem.price, openedCasesCount: 1 }
    });

    await db.collection('case_opens').insertOne({
      userId: user.discordId,
      caseName: caseItem.name,
      prize: prizeChoice.name,
      createdAt: new Date()
    });

    prizeLog({ event: 'case_open', userId: user.discordId, caseName: caseItem.name, prize: prizeChoice.name });
    auditLog({ event: 'case_open', userId: user.discordId, caseName: caseItem.name });

    const prizeNames = (caseItem.prizes || [])
      .map((p) => p.name || p.emoji || '')
      .filter(Boolean);
    const loop = [];
    while (loop.length < 16 && prizeNames.length) {
      loop.push(...prizeNames);
    }
    const base = loop.length ? loop.slice(0, 16) : Array.from({ length: 16 }, (_, i) => String(i + 1));
    const prizeIndex = 12;
    const display = base.slice(0, prizeIndex).concat([prizeChoice.name], base.slice(prizeIndex));

    reply.send({ prize: prizeChoice, display });
  });

  app.post('/admin/balance', {
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'amount'],
        properties: {
          userId: { type: 'string', minLength: 1 },
          amount: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    await db.collection('users').updateOne(
      { discordId: request.body.userId },
      { $inc: { balance: request.body.amount }, $set: { updatedAt: new Date() } }
    );
    auditLog({ event: 'balance_update', actor: actor.discordId, target: request.body.userId, amount: request.body.amount });
    reply.send({ ok: true });
  });

  app.post('/admin/user', {
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'level'],
        properties: {
          userId: { type: 'string', minLength: 1 },
          level: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    const allowedLevels = [LEVELS.USER, LEVELS.LEADERSHIP, LEVELS.DEV];
    if (!allowedLevels.includes(request.body.level)) {
      reply.code(400).send({ message: 'Invalid level' });
      return;
    }
    if (request.body.level === LEVELS.DEV && actor.level !== LEVELS.DEV) {
      reply.code(403).send({ message: 'Only dev can assign dev' });
      return;
    }
    if (request.body.userId === actor.discordId) {
      reply.code(400).send({ message: 'Cannot change own level' });
      return;
    }
    await db.collection('users').updateOne(
      { discordId: request.body.userId },
      { $set: { level: request.body.level, approved: true, updatedAt: new Date() } }
    );
    auditLog({ event: 'user_level_update', actor: actor.discordId, target: request.body.userId, level: request.body.level });
    reply.send({ ok: true });
  });

  app.post('/admin/user/dev', {
    schema: {
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || actor.level !== LEVELS.DEV) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    await db.collection('users').updateOne(
      { discordId: request.body.userId },
      { $set: { level: LEVELS.DEV, approved: true, updatedAt: new Date() } }
    );
    auditLog({ event: 'user_dev_assign', actor: actor.discordId, target: request.body.userId });
    reply.send({ ok: true });
  });

  app.post('/admin/case', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'price', 'maxPerUser', 'maxTotal', 'prizes'],
        properties: {
          name: { type: 'string', minLength: 1 },
          price: { type: 'number' },
          minLevel: { type: 'string' },
          maxPerUser: { type: 'number' },
          maxTotal: { type: 'number' },
          imageUrl: { type: 'string' },
          disabled: { type: 'boolean' },
          prizes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'rarity'],
              properties: {
                name: { type: 'string' },
                quantity: { type: 'number' },
                count: { type: 'number' },
                rarity: { type: 'string' },
                image: { type: 'string' },
                emoji: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }

    if (request.body.imageUrl) {
      const okImg = /^https?:\/\/\S+/i.test(request.body.imageUrl);
      if (!okImg) {
        reply.code(400).send({ message: 'Invalid image URL' });
        return;
      }
    }

    const rawMinLevel = request.body.minLevel && request.body.minLevel.trim();
    const allowedLevels = [LEVELS.USER, LEVELS.LEADERSHIP, LEVELS.DEV];
    const normalizedMinLevel = allowedLevels.includes(rawMinLevel) ? rawMinLevel : LEVELS.USER;

    const prizes = request.body.prizes.map((prize) => {
      const hasQty = prize.quantity != null || prize.count != null;
      const quantity = hasQty ? Number(prize.quantity ?? prize.count ?? 0) : null;
      return {
        name: prize.name,
        quantity,
        remaining: quantity,
        rarity: prize.rarity,
        image: prize.image ?? prize.emoji ?? null
      };
    });

    await db.collection('cases').updateOne(
      { name: request.body.name },
      {
        $set: {
          name: request.body.name,
          price: request.body.price,
          minLevel: normalizedMinLevel,
          maxPerUser: request.body.maxPerUser,
          maxTotal: request.body.maxTotal,
          imageUrl: request.body.imageUrl || null,
          disabled: Boolean(request.body.disabled),
          prizes,
          updatedAt: new Date()
        },
        $setOnInsert: { totalOpened: 0, createdAt: new Date() }
      },
      { upsert: true }
    );

    auditLog({ event: 'case_upsert', actor: actor.discordId, caseName: request.body.name });
    reply.send({ ok: true });
  });

  app.delete('/admin/case', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }

    await db.collection('cases').deleteOne({ name: request.body.name });
    auditLog({ event: 'case_delete', actor: actor.discordId, caseName: request.body.name });
    reply.send({ ok: true });
  });

  app.get('/admin/users', async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    const users = await db.collection('users').find({}).toArray();
    const approved = users.filter((u) => u.approved);
    const pending = users.filter((u) => !u.approved);
    reply.send({
      approved: approved.map((u) => ({
        discordId: u.discordId,
        username: u.username,
        level: u.level,
        balance: u.balance,
        blocked: Boolean(u.blocked),
        avatarUrl: u.avatarUrl || null
      })),
      pending: pending.map((u) => ({
        discordId: u.discordId,
        username: u.username,
        avatarUrl: u.avatarUrl || null
      }))
    });
  });

  app.get('/admin/users/:id', async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    const user = await db.collection('users').findOne({ discordId: request.params.id });
    if (!user) {
      reply.code(404).send({ message: 'User not found' });
      return;
    }
    const prizes = await db.collection('case_opens')
      .find({ userId: user.discordId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    reply.send({
      user: {
        discordId: user.discordId,
        username: user.username,
        level: user.level,
        balance: user.balance,
        approved: user.approved,
        blocked: Boolean(user.blocked),
        avatarUrl: user.avatarUrl || null
      },
      prizes: prizes.map((entry) => ({
        caseName: entry.caseName,
        prize: entry.prize,
        createdAt: entry.createdAt,
        confirmedAt: entry.confirmedAt || null
      }))
    });
  });

  app.post('/admin/users/:id/balance', {
    schema: {
      body: {
        type: 'object',
        required: ['delta'],
        properties: {
          delta: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    await db.collection('users').updateOne(
      { discordId: request.params.id },
      { $inc: { balance: request.body.delta }, $set: { updatedAt: new Date() } }
    );
    auditLog({ event: 'balance_update', actor: actor.discordId, target: request.params.id, amount: request.body.delta });
    reply.send({ ok: true });
  });

  app.post('/admin/users/:id/level', {
    schema: {
      body: {
        type: 'object',
        required: ['level'],
        properties: {
          level: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    const allowedLevels = [LEVELS.USER, LEVELS.LEADERSHIP, LEVELS.DEV];
    if (!allowedLevels.includes(request.body.level)) {
      reply.code(400).send({ message: 'Invalid level' });
      return;
    }
    if (request.body.level === LEVELS.DEV && actor.level !== LEVELS.DEV) {
      reply.code(403).send({ message: 'Only dev can assign dev' });
      return;
    }
    if (request.params.id === actor.discordId) {
      reply.code(400).send({ message: 'Cannot change own level' });
      return;
    }
    await db.collection('users').updateOne(
      { discordId: request.params.id },
      { $set: { level: request.body.level, approved: true, updatedAt: new Date() } }
    );
    auditLog({ event: 'user_level_update', actor: actor.discordId, target: request.params.id, level: request.body.level });
    reply.send({ ok: true });
  });

  app.post('/admin/users/:id/decision', {
    schema: {
      body: {
        type: 'object',
        required: ['approved'],
        properties: {
          approved: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    if (request.body.approved) {
      await db.collection('users').updateOne(
        { discordId: request.params.id },
        { $set: { approved: true, level: LEVELS.USER, updatedAt: new Date() } }
      );
      auditLog({ event: 'user_approved', actor: actor.discordId, target: request.params.id });
    } else {
      await db.collection('users').updateOne(
        { discordId: request.params.id },
        { $set: { approved: false, level: LEVELS.PENDING, updatedAt: new Date() } }
      );
      auditLog({ event: 'user_denied', actor: actor.discordId, target: request.params.id });
    }
    reply.send({ ok: true });
  });

  app.post('/admin/users/:id/block', {
    schema: {
      body: {
        type: 'object',
        required: ['blocked'],
        properties: {
          blocked: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    if (request.params.id === actor.discordId) {
      reply.code(400).send({ message: 'Cannot block yourself' });
      return;
    }
    await db.collection('users').updateOne(
      { discordId: request.params.id },
      { $set: { blocked: request.body.blocked, updatedAt: new Date() } }
    );
    auditLog({ event: 'user_block', actor: actor.discordId, target: request.params.id, blocked: request.body.blocked });
    if (request.body.blocked) {
      await db.collection('sessions').updateMany(
        { userId: request.params.id },
        { $set: { revokedAt: new Date() } }
      );
    }
    reply.send({ ok: true });
  });

  app.post('/admin/users/:id/prize/confirm', {
    schema: {
      body: {
        type: 'object',
        required: ['caseName', 'prize'],
        properties: {
          caseName: { type: 'string', minLength: 1 },
          prize: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    await db.collection('case_opens').updateOne(
      { userId: request.params.id, caseName: request.body.caseName, prize: request.body.prize, confirmedAt: { $exists: false } },
      { $set: { confirmedAt: new Date() } }
    );
    auditLog({ event: 'prize_confirm', actor: actor.discordId, target: request.params.id, prize: request.body.prize });
    reply.send({ ok: true });
  });

  app.get('/admin/cases', async (request, reply) => {
    const db = getDb();
    const actor = await db.collection('users').findOne({ discordId: request.userPayload.sub });
    if (!actor || actor.blocked || !levelAtLeast(actor.level, LEVELS.LEADERSHIP)) {
      reply.code(403).send({ message: 'Access denied' });
      return;
    }
    const cases = await db.collection('cases').find({}).toArray();
    reply.send({ cases });
  });

  app.setErrorHandler((error, request, reply) => {
    errorLog({ event: 'api_error', message: error.message });
    reply.code(500).send({ message: 'Internal error' });
  });
}
