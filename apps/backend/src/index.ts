import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

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
const DATA_DIR = resolve(process.env.DATA_DIR ?? resolve(__dirname, '../..', 'data'));
const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? '*').trim();
const BACKEND_TOKEN = (process.env.BACKEND_TOKEN ?? '').trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN ?? '').trim();

const filtersPath = resolve(DATA_DIR, 'filters.json');
const modelsPath = resolve(DATA_DIR, 'models.json');

async function safeReadJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(filePath)) return fallback;
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch {
    return fallback;
  }
}

async function safeWriteJson(filePath: string, value: unknown) {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, filePath);
}

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
  if (CORS_ORIGIN) {
    reply.header('access-control-allow-origin', CORS_ORIGIN);
    reply.header('access-control-allow-headers', 'content-type,authorization,x-telegram-init-data');
    reply.header('access-control-allow-methods', 'GET,PUT,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    reply.code(204);
    return reply.send();
  }
});

let filtersStore: FiltersStore = {};
let modelsStore: ModelsStore = { models: [] };

await mkdir(DATA_DIR, { recursive: true });
filtersStore = await safeReadJson<FiltersStore>(filtersPath, {});
modelsStore = await safeReadJson<ModelsStore>(modelsPath, { models: [] });

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

app.get('/api/filters', async (req) => {
  const initData = String((req.headers as Record<string, unknown>)['x-telegram-init-data'] ?? '').trim();
  const verified = initData ? verifyTelegramInitData(initData) : { ok: false };
  const tokenOk = requireToken(req.headers as Record<string, unknown>);
  if (!verified.ok && !tokenOk) {
    return {
      ok: false,
    };
  }

  const userKey = verified.userId
    ? verified.userId
    : String((req.query as Record<string, unknown> | undefined)?.userKey ?? 'default');

  return {
    ok: true,
    userKey,
    filters: filtersStore[userKey] ?? null,
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
  filtersStore[userKey] = next;
  await safeWriteJson(filtersPath, filtersStore);
  return { ok: true, userKey, filters: next };
});

app.get('/api/models', async (req) => {
  const q = String((req.query as Record<string, unknown> | undefined)?.q ?? '').trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, asNumber((req.query as Record<string, unknown> | undefined)?.limit, 200)));

  const models = modelsStore.models
    .filter((m) => (q ? m.toLowerCase().includes(q) : true))
    .slice(0, limit);

  return { ok: true, models };
});

app.post('/api/models/seen', async (req, reply) => {
  if (!requireToken(req.headers as Record<string, unknown>)) {
    reply.code(401);
    return { ok: false };
  }

  const body = (req.body && typeof req.body === 'object') ? (req.body as Record<string, unknown>) : {};
  const model = String(body.model ?? '').trim();
  if (!model) return { ok: true };

  const set = new Set(modelsStore.models);
  set.add(model);
  modelsStore.models = Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  await safeWriteJson(modelsPath, modelsStore);
  return { ok: true };
});

await app.listen({
  port: PORT,
  host: '0.0.0.0',
});
