import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootEnvPath = resolve(__dirname, '../../..', '.env');
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

type Tab = 'listing' | 'sale' | 'rent';

type Filters = {
  tab: Tab;
  minTon: number;
  maxTon: number;
  models: string[];
};

type FiltersStore = Record<string, Filters>;

type ModelsStore = {
  models: string[];
};

const PORT = Number(process.env.PORT ?? 8080);
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? '*').trim();
const BACKEND_TOKEN = (process.env.BACKEND_TOKEN ?? '').trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN ?? '').trim();

const MONGODB_URI = (process.env.MONGODB_URI ?? '').trim();
const MONGODB_DB = (process.env.MONGODB_DB ?? 'gifts').trim();

function normalizeTab(v: unknown): Tab {
  const s = String(v ?? '').toLowerCase();
  if (s === 'sale') return 'sale';
  if (s === 'rent') return 'rent';
  return 'listing';
}

function asNumber(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeFilters(input: unknown): Filters {
  const obj = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {};
  const tab = normalizeTab(obj.tab);
  const minTon = Math.max(0, asNumber(obj.minTon, 0));
  const maxTon = Math.max(0, asNumber(obj.maxTon, 5000));
  const modelsRaw = Array.isArray(obj.models) ? obj.models : [];
  const models = modelsRaw
    .map((m) => String(m).trim())
    .filter(Boolean)
    .slice(0, 500);
  return { tab, minTon, maxTon, models };
}

function requireToken(headers: Record<string, unknown>): boolean {
  if (!BACKEND_TOKEN) return true;
  const auth = String(headers.authorization ?? '').trim();
  return auth === `Bearer ${BACKEND_TOKEN}`;
}

function parseInitData(initData: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of initData.split('&')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1);
    if (!k) continue;
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

function verifyTelegramInitData(initData: string): { ok: boolean; userId?: string } {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false };
  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return { ok: false };

  const pairs = Object.entries(data)
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const ok = crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(hash, 'hex'));
  if (!ok) return { ok: false };

  const userStr = data.user;
  if (!userStr) return { ok: true };
  try {
    const userObj = JSON.parse(userStr) as { id?: number | string };
    if (userObj?.id === undefined || userObj?.id === null) return { ok: true };
    return { ok: true, userId: String(userObj.id) };
  } catch {
    return { ok: true };
  }
}

const app = Fastify({
  logger: true,
});

app.addHook('onRequest', async (req, reply) => {
  try {
    const origin = String((req.headers as Record<string, unknown>).origin ?? '');
    app.log.info({ method: req.method, url: req.url, origin }, 'incoming request');
  } catch {
  }

  if (CORS_ORIGIN) {
    const origin = String((req.headers as Record<string, unknown>).origin ?? '').trim();
    const allowlist = CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

    if (allowlist.length === 1 && allowlist[0] === '*') {
      reply.header('vary', 'origin');
      reply.header('access-control-allow-origin', origin || '*');
    } else if (origin && allowlist.includes(origin)) {
      reply.header('vary', 'origin');
      reply.header('access-control-allow-origin', origin);
    }

    reply.header('access-control-allow-headers', 'content-type,authorization,x-telegram-init-data');
    reply.header('access-control-allow-methods', 'GET,PUT,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    reply.code(204);
    return reply.send();
  }
});

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required');
}

const mongo = new MongoClient(MONGODB_URI);
await mongo.connect();
const db = mongo.db(MONGODB_DB);

type FiltersDoc = Filters & { userKey: string; updatedAt: Date };
type ModelDoc = { name: string; createdAt: Date };

const filtersCol = db.collection<FiltersDoc>('filters');
const modelsCol = db.collection<ModelDoc>('models');

await filtersCol.createIndex({ userKey: 1 }, { unique: true });
await modelsCol.createIndex({ name: 1 }, { unique: true });

app.addHook('onClose', async () => {
  await mongo.close();
});

app.get('/health', async () => {
  return { ok: true };
});

app.get('/miniapp/config', async () => {
  return {
    ok: true,
    limits: {
      freeFilters: 1,
      premiumFilters: 200,
    },
  };
});

app.get('/api/filters', async (req, reply) => {
  const initData = String((req.headers as Record<string, unknown>)['x-telegram-init-data'] ?? '').trim();
  const verified = initData ? verifyTelegramInitData(initData) : { ok: false };
  const tokenOk = requireToken(req.headers as Record<string, unknown>);
  if (!verified.ok && !tokenOk) {
    reply.code(401);
    return { ok: false };
  }

  const userKey = verified.userId
    ? verified.userId
    : String((req.query as Record<string, unknown> | undefined)?.userKey ?? 'default');

  const doc = await filtersCol.findOne({ userKey });

  return {
    ok: true,
    userKey,
    filters: doc ? ({ tab: doc.tab, minTon: doc.minTon, maxTon: doc.maxTon, models: doc.models } satisfies Filters) : null,
  };
});

app.put('/api/filters', async (req, reply) => {
  const initData = String((req.headers as Record<string, unknown>)['x-telegram-init-data'] ?? '').trim();
  const verified = initData ? verifyTelegramInitData(initData) : { ok: false };
  const tokenOk = requireToken(req.headers as Record<string, unknown>);
  if (!verified.ok && !tokenOk) {
    reply.code(401);
    return { ok: false };
  }

  const body = (req.body && typeof req.body === 'object') ? (req.body as Record<string, unknown>) : {};
  const userKey = verified.userId ? verified.userId : String(body.userKey ?? 'default');
  const next = normalizeFilters(body.filters);
  await filtersCol.updateOne(
    { userKey },
    {
      $set: {
        userKey,
        tab: next.tab,
        minTon: next.minTon,
        maxTon: next.maxTon,
        models: next.models,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  return { ok: true, userKey, filters: next };
});

app.get('/api/models', async (req) => {
  const q = String((req.query as Record<string, unknown> | undefined)?.q ?? '').trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, asNumber((req.query as Record<string, unknown> | undefined)?.limit, 200)));

  const cursor = q
    ? modelsCol.find({ name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })
    : modelsCol.find({});

  const docs = await cursor.sort({ name: 1 }).limit(limit).toArray();
  return { ok: true, models: docs.map((d) => d.name) };
});

app.post('/api/models/seen', async (req, reply) => {
  if (!requireToken(req.headers as Record<string, unknown>)) {
    reply.code(401);
    return { ok: false };
  }

  const body = (req.body && typeof req.body === 'object') ? (req.body as Record<string, unknown>) : {};
  const model = String(body.model ?? '').trim();
  if (!model) return { ok: true };

  await modelsCol.updateOne(
    { name: model },
    {
      $setOnInsert: {
        name: model,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  return { ok: true };
});

await app.listen({
  port: PORT,
  host: '0.0.0.0',
});
