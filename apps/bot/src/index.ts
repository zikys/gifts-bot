import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf, type Context } from 'telegraf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootEnvPath = resolve(__dirname, '../../..', '.env');
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

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

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (err: Error) => {
  console.error('Uncaught exception', err);
});

async function main() {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  } catch (e: unknown) {
    console.warn('deleteWebhook failed (non-fatal)', e);
  }

  if (isHttpsMiniappUrl()) {
    try {
      await bot.telegram.callApi('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: 'Фильтры',
          web_app: {
            url: MINIAPP_URL,
          },
        },
      });
      console.log('Chat menu button set to Mini App');
    } catch (e: unknown) {
      console.warn('setChatMenuButton failed (non-fatal)', e);
    }
  }

  const me = await bot.telegram.getMe();
  console.log(`Starting bot: @${me.username ?? me.id}`);

  await bot.launch({
    dropPendingUpdates: true,
  });

  console.log('Bot launched and polling');
}

main().catch((e: unknown) => {
  console.error('Bot failed to start', e);
  process.exitCode = 1;
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
