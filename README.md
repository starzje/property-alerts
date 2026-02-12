# Njuškalo Listing Scraper

Automatically monitors [Njuškalo](https://www.njuskalo.hr) (Croatia's largest classifieds site) for new property listings and sends instant notifications to your phone via Telegram.

## How It Works

1. **Every hour**, a scheduled job runs in the cloud (GitHub Actions)
2. It opens your saved Njuškalo search pages in a headless browser (like a robot browsing the site)
3. It collects all the listings on the page — title, price, location, photo
4. It compares them against a list of previously seen listings (stored in a cloud database)
5. If there are **new listings** that weren't there before → it sends you a Telegram message with the details
6. If nothing new → it does nothing and waits for the next hour

That's it. Set it up once, and you'll get a phone notification whenever something new pops up — no need to manually refresh the page.

## What a Notification Looks Like

```
🏠 New Listing!

Zaprešić, samostojeća kuća, 95 m2
💰 200.000 €
📍 Zaprešić, Centar

🔗 View on Njuškalo
```

## Tech Stack

| Component | Purpose |
|---|---|
| **Node.js + TypeScript** | The scraper script |
| **Playwright** | Headless browser that loads Njuškalo pages (bypasses bot protection) |
| **Upstash Redis** | Cloud database that remembers which listings have already been seen |
| **Telegram Bot API** | Sends notifications to your phone |
| **GitHub Actions** | Runs the scraper every hour for free (cron job) |

## Setup

### Prerequisites

- Node.js 20+
- A [Telegram bot](https://core.telegram.org/bots#botfather) + your chat ID
- An [Upstash Redis](https://upstash.com) database (free tier)
- A GitHub repo with Actions enabled

### 1. Install locally

```bash
npm install
npx playwright install chromium --with-deps
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | What it is |
|---|---|
| `NJUSKALO_URLS` | One or more Njuškalo search URLs, separated by `\|\|\|` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram user/chat ID |

### 3. Test locally

```bash
npm run scrape
```

First run seeds existing listings (no notifications). Second run should report "No new listings found".

### 4. Deploy

1. Push to GitHub
2. Add the same env vars as **repository secrets** (Settings → Secrets → Actions)
3. The workflow runs automatically every hour, or trigger it manually from the Actions tab

## Cost

Zero. Everything used is on free tiers:
- **GitHub Actions**: ~720 min/month (well within the 2,000 free minutes)
- **Upstash Redis**: ~1,500 commands/day (well within 10,000/day free limit)
- **Telegram Bot API**: Free, no limits for personal use
