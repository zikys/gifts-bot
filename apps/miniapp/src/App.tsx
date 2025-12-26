import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf, type Context } from 'telegraf';

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

const BOT_TOKEN = (process.env.BOT_TOKEN ?? '').trim();
const MINIAPP_URL = (process.env.MINIAPP_URL ?? 'http://localhost:3000').trim();

function isHttpsMiniappUrl() {
  return MINIAPP_URL.toLowerCase().startsWith('https://');
}

function miniAppButton() {
  if (isHttpsMiniappUrl()) {
    return {
      text: 'Открыть фильтры',
      web_app: {
        url: MINIAPP_URL,
      },
    };
  }
  return {
    text: 'Открыть фильтры (нужен HTTPS)',
    url: MINIAPP_URL,
  };
}

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Telegraf(BOT_TOKEN);

bot.catch((err: unknown) => {
  console.error('Bot error', err);
});

bot.start(async (ctx: Context) => {
  if (isHttpsMiniappUrl()) {
    await ctx.reply('Ок. Открой фильтры в «Аппке» (кнопка снизу рядом с вводом сообщения).');
    return;
  }

  await ctx.reply('Ок. Открой фильтры:', {
    reply_markup: {
      inline_keyboard: [[miniAppButton()]],
    },
  });
});

bot.command('filters', async (ctx: Context) => {
  if (isHttpsMiniappUrl()) {
    await ctx.reply('Фильтры открываются в «Аппке» (кнопка снизу рядом с вводом сообщения).');
    return;
  }

  await ctx.reply('Фильтры:', {
    reply_markup: {
      inline_keyboard: [[miniAppButton()]],
    },
  });
});

bot.launch().then(() => console.log('Bot started'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));