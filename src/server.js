import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import config from './config.js';
import { connectDb, closeDb } from './db.js';
import { authRoutes } from './routes/auth.js';
import { pageRoutes } from './routes/pages.js';
import { apiRoutes } from './routes/api.js';

const app = Fastify({
  logger: true,
  trustProxy: config.trustProxy,
  bodyLimit: 1024 * 20
});

await connectDb();

await app.register(cookie, {
  secret: config.jwtSecret
});

await app.register(rateLimit, {
  global: true,
  max: config.rateLimitMaxPerIp,
  timeWindow: config.rateLimitWindowMs,
  keyGenerator: (request) => request.ip,
  allowList: [],
  errorResponseBuilder: (_, context) => ({
    message: 'Rate limit exceeded',
    retryAfter: context.after
  })
});

app.addHook('onSend', async (_, reply, payload) => {
  reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self';");
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), usb=()');
  return payload;
});

app.register(pageRoutes);
app.register(authRoutes, { prefix: '/auth' });
app.register(apiRoutes, { prefix: '/api' });

app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ message: 'Not found' });
});

app.addHook('onClose', async () => {
  await closeDb();
});

app.listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`Server running on ${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
