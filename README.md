# Croatian Property Listing Scraper

Automatically monitors multiple Croatian classifieds sites for new property listings and sends instant notifications to your phone via Telegram.

**Supported sites:** [Njuškalo](https://www.njuskalo.hr) · [Index Oglasi](https://www.index.hr/oglasi) · [Oglasnik](https://oglasnik.hr)

## How It Works

1. Every hour, a scheduled job runs in the cloud (GitHub Actions)
2. It opens your saved search pages in a headless browser
3. It collects all listings — title, price, location, photo
4. It compares them against previously seen listings (stored in Upstash Redis)
5. Reposts are detected via fingerprinting (title + price) and silently skipped
6. Genuinely new listings trigger a Telegram notification
7. If nothing new — it waits for the next hour

## Tech Stack

| Component | Purpose |
|---|---|
| **Node.js + TypeScript** | The scraper script |
| **Playwright + Stealth** | Headless browser that bypasses Cloudflare bot protection |
| **Upstash Redis** | Tracks seen listing IDs and content fingerprints |
| **Telegram Bot API** | Sends notifications to your phone |
| **GitHub Actions** | Runs the scraper every hour for free (cron job) |

## Setup

### Prerequisites

- Node.js 20+
- A [Telegram bot](https://core.telegram.org/bots#botfather) + your chat ID
- An [Upstash Redis](https://upstash.com) database (free tier)

### Install & Configure

```bash
npm install
npx playwright install chromium --with-deps
cp .env.example .env   # then fill in your values
```

| Variable | What it is |
|---|---|
| `NJUSKALO_URLS` | Njuškalo search URLs, separated by `\|\|\|` (optional) |
| `INDEX_HR_URLS` | Index.hr search URLs, separated by `\|\|\|` (optional) |
| `OGLASNIK_HR_URLS` | Oglasnik.hr search URLs, separated by `\|\|\|` (optional) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |

At least one URL variable must be set.

### Run & Deploy

```bash
npm run scrape              # run locally
npx tsx src/test-dedup.ts   # run dedup tests
```

To deploy: push to GitHub, add the env vars as **repository secrets** (Settings → Secrets → Actions), and the workflow runs automatically every hour.

## Cost

Zero. GitHub Actions free tier (2,000 min/month), Upstash free tier (10k commands/day), Telegram Bot API (free).

---

## Non-Developer Setup

No coding or IDE needed — everything runs in the cloud for free.

1. **Fork this repo** — click the Fork button at the top of this page
2. **Create a Telegram bot** — search `@BotFather` on Telegram, send `/newbot`, save the token. Then message your bot, open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy your chat ID
3. **Create a free Redis database** — sign up at [console.upstash.com](https://console.upstash.com), create a database (region: EU-West), copy the REST URL and Token
4. **Get your search URLs** — go to Njuškalo/Index/Oglasnik, set your filters, copy the URL from the address bar
5. **Add secrets** — in your forked repo go to Settings → Secrets → Actions, add: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and your search URLs (`NJUSKALO_URLS`, `INDEX_HR_URLS`, `OGLASNIK_HR_URLS` — only the ones you need)
6. **Enable & run** — go to the Actions tab, enable workflows, click "Scrape Listings" → "Run workflow"

Done. It runs automatically every hour from now on.
