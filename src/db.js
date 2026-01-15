import { MongoClient } from 'mongodb';
import config from './config.js';

let client;
let db;

export async function connectDb() {
  if (db) return db;
  client = new MongoClient(config.mongoUri, {
    maxPoolSize: 10
  });
  await client.connect();
  db = client.db();

  await Promise.all([
    db.collection('users').createIndex({ discordId: 1 }, { unique: true, name: 'discord_id_idx' }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'session_ttl' }),
    db.collection('sessions').createIndex({ userId: 1, createdAt: -1 }, { name: 'user_session_idx' }),
    db.collection('oauth_attempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'oauth_ttl' }),
    db.collection('oauth_codes').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'oauth_code_ttl' }),
    db.collection('cases').createIndex({ name: 1 }, { unique: true, name: 'case_name_idx' }),
    db.collection('case_opens').createIndex({ userId: 1, createdAt: -1 }, { name: 'case_open_user_idx' })
  ]);

  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.close();
  }
}
