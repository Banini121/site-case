import config from '../config.js';
import { getDb } from '../db.js';
import { auditLog, errorLog, prizeLog } from '../logger.js';
import { perUserLimiter, writeLimiter } from '../rateLimiter.js';
import { levelAtLeast, LEVELS, LEVEL_ORDER, verifyCsrfToken } from '../security.js';
import { getAccessPayload } from '../authentication.js';
import crypto from 'node:crypto';

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
  const available = prizes.filter((prize) => prize.remaining > 0);
  const total = available.reduce((sum, prize) => sum + prize.remaining, 0);
  if (total <= 0) return null;
  const roll = crypto.randomInt(0, total);
  let current = 0;
  for (const prize of available) {
    current += prize.remaining;
    if (roll < current) {
      return prize;
    }
  }
  return available[0];
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
    const result = cases.map((item) => ({
      name: item.name,
      price: item.price,
      minLevel: item.minLevel,
      remainingTotal: item.prizes.reduce((sum, prize) => sum + prize.remaining, 0),
      imageUrl: item.imageUrl || null,
      disabled: Boolean(item.disabled)
    }));
    const levelIndex = (level) => LEVEL_ORDER.indexOf(level);
    result.sort((a, b) => levelIndex(a.minLevel) - levelIndex(b.minLevel));
    reply.send({ cases: result });
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
    if (!levelAtLeast(user.level, caseItem.minLevel)) {
      reply.code(403).send({ message: 'Insufficient level' });
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
    if (userCaseOpens >= caseItem.maxPerUser) {
      reply.code(400).send({ message: 'User case limit reached' });
      return;
    }
    if (caseItem.totalOpened >= caseItem.maxTotal) {
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
        return { ...prize, remaining: prize.remaining - 1 };
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

    reply.send({ prize: prizeChoice });
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
    if (request.body.level === LEVELS.DEV && actor.level !== LEVELS.DEV) {
      reply.code(403).send({ message: 'Only dev can assign dev' });
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
        required: ['name', 'price', 'minLevel', 'maxPerUser', 'maxTotal', 'prizes'],
        properties: {
          name: { type: 'string', minLength: 1 },
          price: { type: 'number' },
          minLevel: { type: 'string', minLength: 1 },
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

    const prizes = request.body.prizes.map((prize) => {
      const quantity = Number(prize.quantity ?? prize.count ?? 0);
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
          minLevel: request.body.minLevel,
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
    if (request.body.level === LEVELS.DEV && actor.level !== LEVELS.DEV) {
      reply.code(403).send({ message: 'Only dev can assign dev' });
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
        { $set: { approved: true, level: LEVELS.ADMIN_1, updatedAt: new Date() } }
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
    await db.collection('users').updateOne(
      { discordId: request.params.id },
      { $set: { blocked: request.body.blocked, updatedAt: new Date() } }
    );
    auditLog({ event: 'user_block', actor: actor.discordId, target: request.params.id, blocked: request.body.blocked });
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
