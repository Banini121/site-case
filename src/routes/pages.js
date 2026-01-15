import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import config from '../config.js';
import { getDb } from '../db.js';
import { buildCsrfToken, levelAtLeast, LEVELS } from '../security.js';
import { getAccessPayload } from '../authentication.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

const csrfCookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'strict',
  path: '/'
};

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

function clearAuthCookies(reply) {
  reply.clearCookie('access_token', accessCookieOptions);
  reply.clearCookie('refresh_token', refreshCookieOptions);
}

async function requireUser(request) {
  const payload = await getAccessPayload(request);
  if (!payload) return null;
  const db = getDb();
  return db.collection('users').findOne({ discordId: payload.sub });
}

function attachCsrf(reply) {
  const { token, hash } = buildCsrfToken();
  reply.setCookie('csrf_hash', hash, csrfCookieOptions);
  return token;
}

export async function pageRoutes(app) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    index: false,
    list: false
  });
  await app.register(fastifyView, {
    engine: { ejs },
    root: path.resolve(__dirname, '../views'),
    layout: 'layout',
    defaultContext: {
      user: null,
      showNav: true,
      csrfToken: ''
    }
  });

  app.get('/', async (request, reply) => {
    const user = await requireUser(request);
    if (user && (!user.approved || user.level === LEVELS.PENDING)) {
      clearAuthCookies(reply);
    }
    const csrfToken = attachCsrf(reply);
    return reply.view('login', { title: 'Вход', csrfToken, showNav: false, user: null });
  });

  app.get('/app', async (request, reply) => {
    const user = await requireUser(request);
    if (!user) {
      reply.redirect('/');
      return;
    }
    if (user.blocked) {
      reply.redirect('/');
      return;
    }
    const csrfToken = attachCsrf(reply);
    if (!user.approved || user.level === LEVELS.PENDING) {
      clearAuthCookies(reply);
      reply.redirect('/');
      return;
    }
    return reply.view('app', { title: 'Главная', csrfToken, user, showNav: true });
  });

  app.get('/cases', async (request, reply) => {
    const user = await requireUser(request);
    if (!user) {
      reply.redirect('/');
      return;
    }
    if (user.blocked) {
      reply.redirect('/');
      return;
    }
    const csrfToken = attachCsrf(reply);
    if (!user.approved || user.level === LEVELS.PENDING) {
      clearAuthCookies(reply);
      reply.redirect('/');
      return;
    }
    return reply.view('cases', { title: 'Кейсы', csrfToken, user, showNav: true });
  });

  app.get('/pending', async (request, reply) => {
    const user = await requireUser(request);
    if (!user) {
      reply.redirect('/');
      return;
    }
    if (user.blocked) {
      reply.redirect('/');
      return;
    }
    if (user.approved && user.level !== LEVELS.PENDING) {
      reply.redirect('/app');
      return;
    }
    const csrfToken = attachCsrf(reply);
    return reply.view('pending', { title: 'Ожидание подтверждения', csrfToken, user, showNav: true });
  });

  app.get('/admin', async (request, reply) => {
    const user = await requireUser(request);
    if (!user) {
      reply.redirect('/');
      return;
    }
    if (user.blocked) {
      reply.redirect('/');
      return;
    }
    const csrfToken = attachCsrf(reply);
    const canManage = user.approved && levelAtLeast(user.level, LEVELS.LEADERSHIP);
    return reply.view('admin', {
      title: 'Админ панель',
      csrfToken,
      user,
      showNav: true,
      canManage
    });
  });
}