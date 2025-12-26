import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findRootEnvPath(): string | null {
  const starts = [process.cwd(), __dirname];
  for (const start of starts) {
    let cur = start;
    for (let i = 0; i < 10; i++) {
      const p = resolve(cur, '.env');
      if (existsSync(p)) return p;
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return null;
}

dotenv.config({ path: findRootEnvPath() ?? undefined });

type Filters = {
  tab: 'listing' | 'sale' | 'rent';
  minTon: number;
  maxTon: number;
  models: string[];
};

let filtersCache: Filters | null | undefined;
let filtersCacheAt = 0;
const FILTERS_CACHE_TTL_MS = 1000;

async function backendGetFilters(): Promise<Filters | null> {
  if (!BACKEND_URL) return null;
  const now = Date.now();
  if (filtersCacheAt && now - filtersCacheAt < FILTERS_CACHE_TTL_MS) {
    return filtersCache ?? null;
  }

  try {
    const url = `${BACKEND_URL}/api/filters?userKey=${encodeURIComponent(FILTER_USER_KEY)}`;
    const headers: Record<string, string> = {};
    if (BACKEND_TOKEN) headers.authorization = `Bearer ${BACKEND_TOKEN}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      try {
        const t = await res.text();
        console.warn(`backendGetFilters failed: ${res.status} ${t}`);
      } catch {
        console.warn(`backendGetFilters failed: ${res.status}`);
      }
      filtersCache = null;
      filtersCacheAt = now;
      return null;
    }
    const data = (await res.json()) as { filters?: Filters | null };
    const f = data?.filters ?? null;
    filtersCache = f;
    filtersCacheAt = now;
    return f;
  } catch {
    filtersCache = null;
    filtersCacheAt = now;
    return null;
  }
}

async function backendPostSeenModel(model: string) {
  if (!BACKEND_URL) return;
  const m = model.trim();
  if (!m) return;

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
  };
  if (BACKEND_TOKEN) headers.authorization = `Bearer ${BACKEND_TOKEN}`;

  try {
    const res = await fetch(`${BACKEND_URL}/api/models/seen`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: m }),
    });
    if (!res.ok) {
      try {
        const t = await res.text();
        console.warn(`backendPostSeenModel failed: ${res.status} ${t}`);
      } catch {
        console.warn(`backendPostSeenModel failed: ${res.status}`);
      }
    }
  } catch {
  }
}

function matchesFilters(listing: Listing, filters: Filters | null): boolean {
  if (!filters) return true;

  if (filters.tab !== 'listing') return false;
  if (!Number.isFinite(listing.priceTon)) return false;

  const price = listing.priceTon as number;
  if (Number.isFinite(filters.minTon) && price < filters.minTon) return false;
  if (Number.isFinite(filters.maxTon) && price > filters.maxTon) return false;

  if (Array.isArray(filters.models) && filters.models.length > 0) {
    if (!listing.model) return false;
    const set = new Set(filters.models.map((m) => m.toLowerCase()));
    if (!set.has(listing.model.toLowerCase())) return false;
  }

  return true;
}

type MarketLabels = Record<string, string>;

type TonApiWsResponse = {
  id?: number;
  jsonrpc?: string;
  method?: string;
  result?: unknown;
  params?: unknown;
};

type AccountTransactionParams = {
  account_id: string;
  lt: number;
  tx_hash: string;
};

type TraceParams = {
  accounts: string[];
  hash: string;
};

const TONAPI_WS_URL = process.env.TONAPI_WS_URL ?? 'wss://tonapi.io/v2/websocket';
const TONAPI_REST_URL = process.env.TONAPI_REST_URL ?? 'https://tonapi.io';
const TONAPI_TOKEN = (process.env.TONAPI_TOKEN ?? '').trim();

const GIFTS_COLLECTION = process.env.GIFTS_COLLECTION ?? '';
const LOW_BUDGET_MAX_TON = Number(process.env.LOW_BUDGET_MAX_TON ?? '10');
const FLOOR_TON = Number(process.env.FLOOR_TON ?? '');
const FLOOR_MODEL_TON = Number(process.env.FLOOR_MODEL_TON ?? '');

const WATCH_ACCOUNTS = (process.env.WATCH_ACCOUNTS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

const MARKET_LABELS: MarketLabels = (process.env.MARKET_LABELS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)
  .reduce<MarketLabels>((acc: MarketLabels, pair: string) => {
    const idx = pair.indexOf('=');
    if (idx <= 0) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key && value) acc[key] = value;
    return acc;
  }, {});

const BOT_TOKEN = (process.env.BOT_TOKEN ?? '').trim();
const ALERT_CHAT_ID = (process.env.ALERT_CHAT_ID ?? '').trim();
const MINIAPP_URL = (process.env.MINIAPP_URL ?? 'http://localhost:3000').trim();

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:8080').trim().replace(/\/$/, '');
const BACKEND_TOKEN = (process.env.BACKEND_TOKEN ?? '').trim();
const FILTER_USER_KEY = (process.env.FILTER_USER_KEY ?? 'default').trim();

const FRAGMENT_BUY_URL_TEMPLATE = (process.env.FRAGMENT_BUY_URL_TEMPLATE ?? '').trim();

console.log(`Backend URL: ${BACKEND_URL || '(empty)'}`);
console.log(`Backend token: ${BACKEND_TOKEN ? 'set' : 'empty'}`);
console.log(`Filter user key: ${FILTER_USER_KEY}`);

const TEST_ALERT = (process.env.TEST_ALERT ?? '').trim() === '1';
const TEST_NFT_ADDRESS = (process.env.TEST_NFT_ADDRESS ?? '').trim();
const TEST_PRICE_TON = Number(process.env.TEST_PRICE_TON ?? '5');
const TEST_MARKET_LABEL = (process.env.TEST_MARKET_LABEL ?? 'Fragment').trim();
const TEST_BUY_URL = (process.env.TEST_BUY_URL ?? '').trim();

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required');
}
if (!ALERT_CHAT_ID) {
  throw new Error('ALERT_CHAT_ID is required');
}
if (WATCH_ACCOUNTS.length === 0) {
  console.warn('WATCH_ACCOUNTS is empty. Scanner will connect but won\'t subscribe to anything.');
}

async function sendTestAlert() {
  if (!TEST_NFT_ADDRESS) {
    throw new Error('TEST_NFT_ADDRESS is required when TEST_ALERT=1');
  }

  const base: Listing = {
    nftAddress: TEST_NFT_ADDRESS,
    priceTon: Number.isFinite(TEST_PRICE_TON) ? TEST_PRICE_TON : 5,
    marketLabel: TEST_MARKET_LABEL || 'Fragment',
  };

  const listing = await enrichListing(base);
  const buyUrl = TEST_BUY_URL || buyUrlFor(listing);

  const giftTitlePlain = listing.model
    ? `${listing.model}${listing.number ? ' #' + listing.number : ''}`
    : listing.nftAddress;

  const giftTitleLinked = `[${escapeMarkdownV2(giftTitlePlain)}](${escapeMarkdownV2Url(buyUrl)})`;

  const priceLine = listing.priceTon !== undefined
    ? `Цена: *${escapeMarkdownV2(listing.priceTon.toFixed(2))} TON*`
    : 'Цена: *неизвестно*';

  const floorGiftLine = Number.isFinite(FLOOR_TON) && FLOOR_TON > 0
    ? `Флор гифта: *${escapeMarkdownV2(FLOOR_TON.toFixed(2))} TON*`
    : undefined;

  const floorModelLine = Number.isFinite(FLOOR_MODEL_TON) && FLOOR_MODEL_TON > 0
    ? `Флор модели: *${escapeMarkdownV2(FLOOR_MODEL_TON.toFixed(2))} TON*`
    : undefined;

  const caption = [
    '*✅ ЛИСТИНГ*',
    giftTitleLinked,
    listing.model ? `Модель: *${escapeMarkdownV2(listing.model)}*` : undefined,
    listing.background ? `Фон: *${escapeMarkdownV2(listing.background)}*` : undefined,
    floorGiftLine,
    floorModelLine,
    priceLine,
  ].filter(Boolean).join('\n');

  await sendTelegramAlert({
    caption,
    photoUrl: listing.imageUrl,
    buyUrl,
    buyButtonText: 'Ссылка на маркет',
    openInTelegramUrl: `https://t.me/nft/${listing.nftAddress}`,
  });
}

const seen = new Map<string, number>();
const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 10_000;

function cleanupSeen(now: number) {
  for (const [k, ts] of seen) {
    if (now - ts > SEEN_TTL_MS) seen.delete(k);
  }
  if (seen.size <= SEEN_MAX) return;
  const extra = seen.size - SEEN_MAX;
  let i = 0;
  for (const k of seen.keys()) {
    seen.delete(k);
    i++;
    if (i >= extra) break;
  }
}

function labelForAccount(accountId: string) {
  return MARKET_LABELS[accountId] ?? accountId;
}

async function tonapiGetEvent(traceHashOrTxHash: string): Promise<unknown | null> {
  try {
    const url = `${TONAPI_REST_URL}/v2/events/${encodeURIComponent(traceHashOrTxHash)}`;
    const res = await fetch(url, {
      headers: TONAPI_TOKEN ? { Authorization: `Bearer ${TONAPI_TOKEN}` } : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function tonapiGetNftItemByAddress(nftAddress: string): Promise<unknown | null> {
  try {
    const url = `${TONAPI_REST_URL}/v2/nfts/${encodeURIComponent(nftAddress)}`;
    const res = await fetch(url, {
      headers: TONAPI_TOKEN ? { Authorization: `Bearer ${TONAPI_TOKEN}` } : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function tonapiGetAccountEvents(accountId: string, limit: number): Promise<unknown | null> {
  try {
    const url = `${TONAPI_REST_URL}/v2/accounts/${encodeURIComponent(accountId)}/events?limit=${encodeURIComponent(String(limit))}`;
    const res = await fetch(url, {
      headers: TONAPI_TOKEN ? { Authorization: `Bearer ${TONAPI_TOKEN}` } : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function sendTelegramAlert(opts: {
  caption: string;
  photoUrl?: string;
  buyUrl: string;
  buyButtonText: string;
  openInTelegramUrl: string;
}) {
  const miniappButton = MINIAPP_URL.toLowerCase().startsWith('https://')
    ? ({ text: 'Аппка', web_app: { url: MINIAPP_URL } } as const)
    : ({ text: 'Аппка', url: MINIAPP_URL } as const);

  const reply_markup = {
    inline_keyboard: [
      [
        miniappButton,
        {
          text: opts.buyButtonText,
          url: opts.buyUrl,
        },
      ],
    ],
  };

  if (opts.photoUrl) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
    const body = {
      chat_id: ALERT_CHAT_ID,
      photo: opts.photoUrl,
      caption: opts.caption,
      parse_mode: 'MarkdownV2',
      reply_markup,
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Telegram sendPhoto failed: ${res.status} ${errText}`);
      }
      return;
    } catch (e: unknown) {
      console.warn('sendPhoto failed, falling back to sendMessage (non-fatal)', e);
    }
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: ALERT_CHAT_ID,
    text: opts.caption,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    reply_markup,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${res.status} ${errText}`);
  }
}

type Listing = {
  nftAddress: string;
  priceTon?: number;
  marketAccount?: string;
  marketLabel: string;
  model?: string;
  background?: string;
  number?: string;
  collectionAddress?: string;
  imageUrl?: string;
};

function toTon(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000) return value / 1e9;
    return value;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (!Number.isFinite(num)) return undefined;
    if (num > 1_000_000) return num / 1e9;
    return num;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.value === 'string' || typeof obj.value === 'number') {
      return toTon(obj.value);
    }
  }
  return undefined;
}

function normalizeImageUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (u.toLowerCase().startsWith('ipfs://')) {
    const cid = u.slice('ipfs://'.length).replace(/^ipfs\//i, '');
    return `https://cloudflare-ipfs.com/ipfs/${cid}`;
  }
  return u;
}

function findAllStringsByKey(node: unknown, key: string, out: string[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const v of node) findAllStringsByKey(v, key, out);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === key && typeof v === 'string') out.push(v);
    findAllStringsByKey(v, key, out);
  }
}

function findFirstStringByKeys(node: unknown, keys: string[]): string | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const v of node) {
      const found = findFirstStringByKeys(v, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object') return undefined;

  const obj = node as Record<string, unknown>;
  for (const key of keys) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  for (const v of Object.values(obj)) {
    const found = findFirstStringByKeys(v, keys);
    if (found) return found;
  }
  return undefined;
}

function findFirstNumberLike(node: unknown, keys: string[]): number | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const v of node) {
      const found = findFirstNumberLike(v, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object') return undefined;

  const obj = node as Record<string, unknown>;
  for (const key of keys) {
    if (key in obj) {
      const t = toTon(obj[key]);
      if (t !== undefined) return t;
    }
  }
  for (const v of Object.values(obj)) {
    const found = findFirstNumberLike(v, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeMarketLabel(label: string): 'getgems' | 'mrkt' | 'fragment' | 'unknown' {
  const l = label.toLowerCase();
  if (l.includes('getgems')) return 'getgems';
  if (l.includes('mrkt')) return 'mrkt';
  if (l.includes('fragment')) return 'fragment';
  return 'unknown';
}

function displayMarketName(listing: Listing): string {
  const label = listing.marketLabel;
  if (label && !isTonAddress(label)) return label;

  const kind = normalizeMarketLabel(label);
  if (kind === 'getgems') return 'GetGems';
  if (kind === 'mrkt') return 'MRKT';
  if (kind === 'fragment') return 'Fragment';
  return 'Маркет';
}

function buyUrlFor(listing: Listing) {
  const marketKind = normalizeMarketLabel(listing.marketLabel);
  if (marketKind === 'getgems') return `https://getgems.io/nft/${listing.nftAddress}`;
  if (marketKind === 'mrkt') return `https://mrkt.com/item/${listing.nftAddress}`;
  if (marketKind === 'fragment') {
    if (FRAGMENT_BUY_URL_TEMPLATE) {
      return FRAGMENT_BUY_URL_TEMPLATE.replaceAll('{nft}', listing.nftAddress);
    }
    return `https://tonviewer.com/${listing.nftAddress}?section=nft`;
  }
  return `https://tonviewer.com/${listing.nftAddress}?section=nft`;
}

function isTonAddress(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v.startsWith('0:') || v.startsWith('-1:')) return true;
  if (v.startsWith('EQ') || v.startsWith('UQ') || v.startsWith('kQ')) return true;
  return false;
}

function extractAddressFromNode(node: unknown): string | undefined {
  if (!node) return undefined;
  if (typeof node === 'string') return isTonAddress(node) ? node : undefined;
  if (typeof node !== 'object') return undefined;

  const obj = node as Record<string, unknown>;
  if (isTonAddress(obj.address)) return obj.address;
  if (isTonAddress(obj.account_id)) return obj.account_id;
  if (isTonAddress(obj.owner)) return obj.owner;
  return undefined;
}

function findFirstAddressByKeys(node: unknown, keys: string[]): string | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const v of node) {
      const found = findFirstAddressByKeys(v, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object') return undefined;

  const obj = node as Record<string, unknown>;
  for (const key of keys) {
    if (key in obj) {
      const addr = extractAddressFromNode(obj[key]);
      if (addr) return addr;
    }
  }
  for (const v of Object.values(obj)) {
    const found = findFirstAddressByKeys(v, keys);
    if (found) return found;
  }
  return undefined;
}

function getActionType(action: Record<string, unknown>): string | undefined {
  if (typeof action.type === 'string') return action.type;
  if (typeof action.action_type === 'string') return action.action_type;
  if (typeof action.kind === 'string') return action.kind;
  return undefined;
}

function getMarketsSet(): Set<string> {
  const markets = WATCH_ACCOUNTS.filter((a) => a && a !== GIFTS_COLLECTION);
  return new Set(markets);
}

function toTonMaybe(v: number): number {
  if (!Number.isFinite(v)) return v;
  if (v > 1_000_000) return v / 1e9;
  return v;
}

const nftModelCache = new Map<string, { at: number; model?: string }>();
const NFT_MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

async function getModelByNftAddressCached(nftAddress: string): Promise<string | undefined> {
  const now = Date.now();
  const cached = nftModelCache.get(nftAddress);
  if (cached && now - cached.at < NFT_MODEL_CACHE_TTL_MS) return cached.model;

  const nft = await tonapiGetNftItemByAddress(nftAddress);
  const extracted = extractFromNftItem(nft);
  const model = extracted.model;
  nftModelCache.set(nftAddress, { at: now, model });
  return model;
}

const recentSalesCache = new Map<string, { at: number; prices: number[] }>();
const RECENT_SALES_CACHE_TTL_MS = 3 * 60 * 1000;
const RECENT_SALES_MAX = 3;

async function getRecentSalesForModel(model: string): Promise<number[] | null> {
  const m = model.trim();
  if (!m) return null;
  const now = Date.now();

  const cached = recentSalesCache.get(m.toLowerCase());
  if (cached && now - cached.at < RECENT_SALES_CACHE_TTL_MS) return cached.prices;

  const marketAccounts = Array.from(getMarketsSet());
  const prices: number[] = [];

  for (const accountId of marketAccounts) {
    if (prices.length >= RECENT_SALES_MAX) break;
    const events = await tonapiGetAccountEvents(accountId, 50);
    if (!events || typeof events !== 'object') continue;
    const obj = events as Record<string, unknown>;
    const list = obj.events;
    if (!Array.isArray(list)) continue;

    for (const ev of list) {
      if (prices.length >= RECENT_SALES_MAX) break;
      if (!ev || typeof ev !== 'object') continue;
      const eobj = ev as Record<string, unknown>;
      const actions = eobj.actions;
      if (!Array.isArray(actions)) continue;

      for (const act of actions) {
        if (prices.length >= RECENT_SALES_MAX) break;
        if (!act || typeof act !== 'object') continue;
        const action = act as Record<string, unknown>;
        const type = (getActionType(action) ?? '').toLowerCase();
        if (!type.includes('purchase') && !type.includes('nftpurchase')) continue;

        const nftAddress = findFirstAddressByKeys(action, ['nft_address', 'nft', 'nft_item', 'item', 'address']);
        if (!nftAddress) continue;

        const foundModel = await getModelByNftAddressCached(nftAddress);
        if (!foundModel) continue;
        if (foundModel.toLowerCase() !== m.toLowerCase()) continue;

        const rawAmount = findFirstNumberLike(action, ['amount', 'price', 'ton', 'ton_amount', 'value']);
        if (rawAmount === undefined) continue;
        const ton = toTonMaybe(rawAmount);
        if (!Number.isFinite(ton) || ton <= 0) continue;
        prices.push(ton);
      }
    }
  }

  const out = prices.slice(0, RECENT_SALES_MAX);
  recentSalesCache.set(m.toLowerCase(), { at: now, prices: out });
  return out.length > 0 ? out : null;
}

function parseListingsFromEventActions(event: unknown): Listing[] {
  if (!event || typeof event !== 'object') return [];
  const obj = event as Record<string, unknown>;
  const actions = obj.actions;
  if (!Array.isArray(actions)) return [];

  const markets = getMarketsSet();
  const out: Listing[] = [];

  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const action = raw as Record<string, unknown>;
    const type = (getActionType(action) ?? '').toLowerCase();
    if (!type.includes('nft')) continue;

    const destination = findFirstAddressByKeys(action, ['destination', 'recipient', 'to', 'receiver']);
    if (!destination || !markets.has(destination)) continue;

    const nftAddress = findFirstAddressByKeys(action, ['nft_address', 'nft', 'nft_item', 'item', 'address']);
    if (!nftAddress) continue;

    const priceTon = findFirstNumberLike(action, ['price', 'amount', 'value', 'ton', 'ton_amount']);

    out.push({
      nftAddress,
      priceTon,
      marketAccount: destination,
      marketLabel: labelForAccount(destination),
    });
  }

  return out;
}

function extractFromNftItem(nft: unknown): Pick<Listing, 'model' | 'background' | 'number' | 'collectionAddress' | 'imageUrl'> {
  const res: Pick<Listing, 'model' | 'background' | 'number' | 'collectionAddress' | 'imageUrl'> = {};
  if (!nft || typeof nft !== 'object') return res;

  const obj = nft as Record<string, unknown>;
  const collection = obj.collection as Record<string, unknown> | undefined;
  if (collection && typeof collection.address === 'string') {
    res.collectionAddress = collection.address;
  }

  if (typeof obj.index === 'number') res.number = String(obj.index);
  if (typeof obj.item_index === 'number') res.number = String(obj.item_index);
  if (typeof obj.item_index === 'string') res.number = obj.item_index;

  const metadata = (obj.metadata ?? obj.content) as Record<string, unknown> | undefined;
  if (metadata && typeof metadata === 'object') {
    if (typeof metadata.name === 'string' && !res.model) res.model = metadata.name;

    const imageCandidate = findFirstStringByKeys(metadata, ['image', 'image_url', 'imageUrl']);
    if (typeof imageCandidate === 'string' && imageCandidate.length > 0) {
      res.imageUrl = normalizeImageUrl(imageCandidate);
    }

    const attrs = metadata.attributes;
    if (Array.isArray(attrs)) {
      for (const a of attrs) {
        if (!a || typeof a !== 'object') continue;
        const ao = a as Record<string, unknown>;
        const trait = (ao.trait_type ?? ao.key ?? ao.type) as unknown;
        const value = (ao.value ?? ao.val) as unknown;
        if (typeof trait !== 'string') continue;
        const t = trait.toLowerCase();
        if (!res.model && typeof value === 'string' && (t === 'model' || t.includes('model'))) res.model = value;
        if (!res.background && typeof value === 'string' && (t === 'background' || t.includes('background'))) res.background = value;
      }
    }
  }

  if (!res.imageUrl) {
    const previews = obj.previews;
    if (Array.isArray(previews) && previews.length > 0) {
      const last = previews[previews.length - 1];
      if (last && typeof last === 'object') {
        const url = (last as Record<string, unknown>).url;
        if (typeof url === 'string' && url.length > 0) res.imageUrl = normalizeImageUrl(url);
      }
    }
  }

  return res;
}

async function enrichListing(listing: Listing): Promise<Listing> {
  const nft = await tonapiGetNftItemByAddress(listing.nftAddress);
  if (!nft) return listing;

  const extra = extractFromNftItem(nft);
  return {
    ...listing,
    ...extra,
  };
}

async function handleTrace(p: TraceParams) {
  const now = Date.now();
  cleanupSeen(now);

  if (seen.has(p.hash)) return;
  seen.set(p.hash, now);

  const event = await tonapiGetEvent(p.hash);
  if (!event) return;

  const extracted = parseListingsFromEventActions(event);
  if (extracted.length === 0) return;

  const filters = await backendGetFilters();

  for (const rawListing of extracted) {
    const listing = await enrichListing(rawListing);
    if (GIFTS_COLLECTION && listing.collectionAddress && listing.collectionAddress !== GIFTS_COLLECTION) {
      continue;
    }

    if (listing.model) {
      backendPostSeenModel(listing.model);
    }

    if (!matchesFilters(listing, filters)) {
      continue;
    }
    const buyUrl = buyUrlFor(listing);

    const giftTitlePlain = listing.model
      ? `${listing.model}${listing.number ? ' #' + listing.number : ''}`
      : listing.nftAddress;

    const giftTitleLinked = `[${escapeMarkdownV2(giftTitlePlain)}](${escapeMarkdownV2Url(buyUrl)})`;

    const priceLine = listing.priceTon !== undefined
      ? `Цена: *${escapeMarkdownV2(listing.priceTon.toFixed(2))} TON*`
      : 'Цена: *неизвестно*';

    const floorGiftLine = Number.isFinite(FLOOR_TON) && FLOOR_TON > 0
      ? `Флор гифта: *${escapeMarkdownV2(FLOOR_TON.toFixed(2))} TON*`
      : undefined;

    const floorModelLine = Number.isFinite(FLOOR_MODEL_TON) && FLOOR_MODEL_TON > 0
      ? `Флор модели: *${escapeMarkdownV2(FLOOR_MODEL_TON.toFixed(2))} TON*`
      : undefined;

    const recentSales = listing.model ? await getRecentSalesForModel(listing.model) : null;
    const recentSalesLine = (recentSales && recentSales.length > 0)
      ? `Последние продажи: ${recentSales.map((p) => `*${escapeMarkdownV2(p.toFixed(2))} TON*`).join(' / ')}`
      : undefined;

    const caption = [
      '*✅ ЛИСТИНГ*',
      giftTitleLinked,
      listing.model ? `Модель: *${escapeMarkdownV2(listing.model)}*` : undefined,
      listing.background ? `Фон: *${escapeMarkdownV2(listing.background)}*` : undefined,
      floorGiftLine,
      floorModelLine,
      recentSalesLine,
      priceLine,
    ].filter(Boolean).join('\n');

    const isLowBudget = listing.priceTon !== undefined && listing.priceTon <= LOW_BUDGET_MAX_TON;
    await sendTelegramAlert({
      caption,
      photoUrl: listing.imageUrl,
      buyUrl,
      buyButtonText: isLowBudget ? 'Ссылка на маркет' : 'Ссылка на маркет',
      openInTelegramUrl: `https://t.me/nft/${listing.nftAddress}`,
    });
  }
}

function escapeMarkdownV2(s: string) {
  return s.replaceAll(/([_\-*\[\]()~`>#+=|{}.!\\])/g, '\\$1');
}

function escapeMarkdownV2Url(url: string) {
  return url.replaceAll(/([)\\])/g, '\\$1');
}

function connect() {
  const wsUrl = (() => {
    if (!TONAPI_TOKEN) return TONAPI_WS_URL;
    const tokenEnc = encodeURIComponent(TONAPI_TOKEN);

    if (TONAPI_WS_URL.includes('token=')) {
      return TONAPI_WS_URL.replace(/([?&]token=)[^&]+/i, `$1${tokenEnc}`);
    }

    const sep = TONAPI_WS_URL.includes('?') ? '&' : '?';
    return `${TONAPI_WS_URL}${sep}token=${tokenEnc}`;
  })();

  const wsUrlForLog = wsUrl.replace(/([?&]token=)[^&]+/i, '$1***');

  console.log(`Connecting to TonAPI WS: ${wsUrlForLog}`);

  const ws = new WebSocket(wsUrl, {
    headers: TONAPI_TOKEN ? { Authorization: `Bearer ${TONAPI_TOKEN}` } : undefined,
  });

  ws.on('open', () => {
    console.log(`Connected to TonAPI WS: ${wsUrlForLog}`);

    if (WATCH_ACCOUNTS.length > 0) {
      const req = {
        id: 1,
        jsonrpc: '2.0',
        method: 'subscribe_trace',
        params: WATCH_ACCOUNTS,
      };
      ws.send(JSON.stringify(req));
      console.log(`Subscribed to ${WATCH_ACCOUNTS.length} account(s)`);
    }
  });

  ws.on('message', async (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString('utf8')) as TonApiWsResponse;
      if (msg.method === 'trace') {
        const p = msg.params as TraceParams;
        if (!p?.hash || !Array.isArray(p.accounts)) return;
        await handleTrace(p);
      }
    } catch (e: unknown) {
      console.error('WS message handling error', e);
    }
  });

  ws.on('close', () => {
    console.warn('WS closed. Reconnecting in 1s...');
    setTimeout(connect, 1000);
  });

  ws.on('error', (e: Error) => {
    console.error('WS error', e);
    try {
      ws.close();
    } catch {
    }
  });
}

if (TEST_ALERT) {
  sendTestAlert()
    .then(() => {
      console.log('Test alert sent');
      process.exit(0);
    })
    .catch((e: unknown) => {
      console.error('Test alert failed', e);
      process.exitCode = 1;
    });
} else {
  connect();
}
