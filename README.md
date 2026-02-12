# Croatian Property Listing Scraper

Automatically monitors multiple Croatian classifieds sites for new property listings and sends instant notifications to your phone via Telegram.

**Supported sites:**
- [Njuškalo](https://www.njuskalo.hr)
- [Index Oglasi](https://www.index.hr/oglasi)
- [Oglasnik](https://oglasnik.hr)

## How It Works

1. **Every hour**, a scheduled job runs in the cloud (GitHub Actions)
2. It opens your saved search pages across all configured sites in a headless browser (like a robot browsing the site)
3. It collects all the listings on each page — title, price, location, photo
4. It compares them against a list of previously seen listings (stored in a cloud database)
5. **Repost detection**: if someone takes down a listing and re-uploads it with the same title and price, it's recognized as a duplicate and skipped — no spam
6. If there are **genuinely new listings** → it sends you a Telegram message with the details
7. If nothing new → it does nothing and waits for the next hour

That's it. Set it up once, and you'll get a phone notification whenever something new pops up — no need to manually check three different sites.

## What a Notification Looks Like

```
🏠 New Listing!

Zaprešić, samostojeća kuća, 95 m2
💰 200.000 €
📍 Zaprešić, Centar

🔗 View on Njuškalo
```

The link text adapts to the source site (Njuškalo / Index Oglasi / Oglasnik).

## How Repost Detection Works

People on classifieds sites often delete and re-post their listing to bump it to the top. This would normally trigger a new notification since the listing gets a new ID.

The scraper prevents this by generating a **fingerprint** (normalized title + price) for every listing it sees. If a "new" listing has the same fingerprint as one already seen, it's silently skipped. This means you only get notified about genuinely new properties.

## Tech Stack

| Component | Purpose |
|---|---|
| **Node.js + TypeScript** | The scraper script |
| **Playwright + Stealth** | Headless browser that loads pages and bypasses Cloudflare bot protection |
| **Upstash Redis** | Cloud database that tracks seen listing IDs and content fingerprints |
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
| `NJUSKALO_URLS` | Njuškalo search URLs, separated by `\|\|\|` (optional) |
| `INDEX_HR_URLS` | Index.hr Oglasi search URLs, separated by `\|\|\|` (optional) |
| `OGLASNIK_HR_URLS` | Oglasnik.hr search URLs, separated by `\|\|\|` (optional) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram user/chat ID |

At least one of the URL variables must be set. You can use any combination of sites.

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
