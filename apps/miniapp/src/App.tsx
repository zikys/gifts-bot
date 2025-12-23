import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Tab = 'listing' | 'sale' | 'rent';

type Filters = {
  tab: Tab;
  minTon: number;
  maxTon: number;
  models: string[];
};

function getTelegramUserKey() {
  const w = window as unknown as {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          user?: {
            id?: number;
          };
        };
      };
    };
  };

  const id = w.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return 'default';
}

function getTelegramInitData() {
  const w = window as unknown as {
    Telegram?: {
      WebApp?: {
        initData?: string;
      };
    };
  };
  const initData = w.Telegram?.WebApp?.initData;
  if (typeof initData === 'string' && initData.trim().length > 0) return initData.trim();
  return '';
}

function apiBase() {
  const v = (import.meta as unknown as { env?: Record<string, string> }).env;
  const base = (v?.VITE_BACKEND_URL ?? 'http://localhost:8080').trim();
  return base.replace(/\/$/, '');
}


export function App() {
  const [tab, setTab] = useState<Tab>('listing');
  const [min, setMin] = useState<number>(0);
  const [max, setMax] = useState<number>(5000);

  const [models, setModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const saveTimer = useRef<number | null>(null);

  const userKey = useMemo(() => getTelegramUserKey(), []);

  const tabs = useMemo(
    () => [
      { key: 'listing' as const, label: 'Листинг' },
      { key: 'sale' as const, label: 'Продажа' },
      { key: 'rent' as const, label: 'Сдано в аренду' },
    ],
    []
  );

  useEffect(() => {
    setLoading(true);
    const initData = getTelegramInitData();
    const url = initData
      ? `${apiBase()}/api/filters`
      : `${apiBase()}/api/filters?userKey=${encodeURIComponent(userKey)}`;

    const headers: Record<string, string> = {};
    if (initData) headers['x-telegram-init-data'] = initData;

    fetch(url, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const obj = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
        const f = obj.filters as Filters | null | undefined;
        if (!f) return;
        if (f.tab) setTab(f.tab);
        if (typeof f.minTon === 'number') setMin(f.minTon);
        if (typeof f.maxTon === 'number') setMax(f.maxTon);
        if (Array.isArray(f.models)) setSelectedModels(new Set(f.models));
      })
      .finally(() => setLoading(false));
  }, [userKey]);

  const scheduleSave = useCallback((next?: Partial<Filters>) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const body = {
        userKey,
        filters: {
          tab: next?.tab ?? tab,
          minTon: next?.minTon ?? min,
          maxTon: next?.maxTon ?? max,
          models: next?.models ?? Array.from(selectedModels.values()),
        },
      };

      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      const initData = getTelegramInitData();
      if (initData) headers['x-telegram-init-data'] = initData;

      fetch(`${apiBase()}/api/filters`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      }).catch(() => {
      });
    }, 250);
  }, [userKey, tab, min, max, selectedModels]);

  useEffect(() => {
    scheduleSave();
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [scheduleSave]);

  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    const url = `${apiBase()}/api/models?q=${encodeURIComponent(q)}&limit=200`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const obj = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
        const list = obj.models;
        if (Array.isArray(list)) {
          setModels(list.map((m) => String(m)));
        }
      })
      .catch(() => {
      });
  }, [searchOpen, searchQuery]);

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="mx-auto max-w-md px-4 pb-20 pt-5">
        <div className="rounded-2xl bg-panel px-4 py-4 shadow">
          <div className="text-center text-lg font-semibold">Фильтры подарков</div>

          <div className="mt-4 rounded-xl bg-panel2 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-200">Премиум</div>
              <div className="text-xs text-slate-400">до 02.01.2026</div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
              <div className="rounded-lg bg-panel px-2 py-2">
                <div className="text-slate-400">Листинг</div>
                <div className="mt-1 font-semibold">16 / 200</div>
              </div>
              <div className="rounded-lg bg-panel px-2 py-2">
                <div className="text-slate-400">Продажа</div>
                <div className="mt-1 font-semibold">0 / 200</div>
              </div>
              <div className="rounded-lg bg-panel px-2 py-2">
                <div className="text-slate-400">Аренда</div>
                <div className="mt-1 font-semibold">0 / 200</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-panel2 p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={
                  'rounded-lg px-2 py-2 text-xs font-semibold transition ' +
                  (tab === t.key ? 'bg-accent text-white' : 'text-slate-300')
                }
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl bg-panel2 p-3">
            <div className="text-sm font-medium">Цена (TON)</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-panel px-3 py-2">
                <div className="text-xs text-slate-400">Min</div>
                <input
                  className="mt-1 w-full bg-transparent text-sm outline-none"
                  inputMode="numeric"
                  value={min}
                  onChange={(e) => setMin(Number(e.target.value || 0))}
                />
              </div>
              <div className="rounded-lg bg-panel px-3 py-2">
                <div className="text-xs text-slate-400">Max</div>
                <input
                  className="mt-1 w-full bg-transparent text-sm outline-none"
                  inputMode="numeric"
                  value={max}
                  onChange={(e) => setMax(Number(e.target.value || 0))}
                />
              </div>
            </div>

            <div className="mt-3">
              <input
                type="range"
                min={0}
                max={5000}
                value={Math.min(max, 5000)}
                onChange={(e) => setMax(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {Array.from(selectedModels.values()).slice(0, 6).map((m) => (
              <GiftCard
                key={m}
                title={m}
                subtitle=""
                rarity=""
                enabled={true}
                onToggle={() => {
                  setSelectedModels((prev) => {
                    const next = new Set(prev);
                    if (next.has(m)) next.delete(m);
                    else next.add(m);
                    return next;
                  });
                }}
              />
            ))}
          </div>
        </div>

        {searchOpen ? (
          <div className="fixed inset-0 z-10 bg-black/60">
            <div className="mx-auto mt-10 max-w-md px-4">
              <div className="rounded-2xl bg-panel p-4 shadow">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Поиск модели</div>
                  <button
                    className="rounded-lg bg-panel2 px-3 py-2 text-xs font-semibold"
                    onClick={() => setSearchOpen(false)}
                  >
                    Закрыть
                  </button>
                </div>

                <input
                  className="mt-3 h-11 w-full rounded-xl bg-panel2 px-3 text-sm outline-none"
                  placeholder="Например: Vintage Cigar"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />

                <div className="mt-3 max-h-[55vh] overflow-auto rounded-xl bg-panel2 p-2">
                  {models.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-slate-400">{loading ? 'Загрузка...' : 'Нет результатов'}</div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {models.map((m) => {
                        const checked = selectedModels.has(m);
                        return (
                          <button
                            key={m}
                            className={
                              'flex items-center justify-between rounded-xl px-3 py-3 text-left text-sm ' +
                              (checked ? 'bg-accent text-white' : 'bg-panel text-slate-200')
                            }
                            onClick={() => {
                              setSelectedModels((prev) => {
                                const next = new Set(prev);
                                if (next.has(m)) next.delete(m);
                                else next.add(m);
                                return next;
                              });
                            }}
                          >
                            <span className="font-semibold">{m}</span>
                            <span className="text-xs">{checked ? 'Выбрано' : 'Выбрать'}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-bg via-bg/90 to-transparent pb-5">
          <div className="mx-auto flex max-w-md items-center justify-between px-4">
            <button
              className="h-11 rounded-full bg-panel px-4 text-sm font-semibold text-slate-200"
              onClick={() => setSearchOpen(true)}
            >
              Поиск
            </button>
            <button
              className="h-12 rounded-full bg-accent px-5 text-sm font-semibold"
              onClick={() => {
                scheduleSave({ models: Array.from(selectedModels.values()) });
              }}
            >
              Добавить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GiftCard(props: { title: string; subtitle: string; rarity: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl bg-panel2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{props.title}</div>
          <div className="mt-1 text-xs text-slate-400">{props.subtitle}</div>
        </div>
        <div className="rounded-md bg-panel px-2 py-1 text-xs text-slate-200">{props.rarity}</div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <label className="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={props.enabled} onChange={props.onToggle} />
          <div className="peer h-6 w-11 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-accent peer-checked:after:translate-x-full"></div>
        </label>
        <div className="flex gap-2">
          <button className="h-9 rounded-xl bg-panel px-3 text-xs font-semibold">Правка</button>
          <button className="h-9 rounded-xl bg-panel px-3 text-xs font-semibold">Удалить</button>
        </div>
      </div>
    </div>
  );
}
