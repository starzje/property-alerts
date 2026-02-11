# Njuškalo Listing Scraper — PRD / MVP Spec

## Overview

Build a Node.js scraper that monitors one or more Njuškalo (www.njuskalo.hr) search pages for new listings and sends Telegram notifications when new ones appear. Runs as a scheduled GitHub Actions workflow (every hour), with Upstash Redis for state persistence. Personal-use project — not public-facing.

---

## Problem

I want to be notified immediately when a new listing appears on Njuškalo matching my search filters (e.g. houses, land), without manually checking the site. I may monitor multiple search categories simultaneously (e.g. houses in one area + land in another).

---

## Architecture

```
GitHub Actions (cron every 1 hour)
  └─ Node.js script
       ├─ Playwright (stealth mode) → loads each Njuškalo search URL
       ├─ Dismisses cookie consent popup if present
       ├─ Parses listing data from DOM (id, title, price, URL, location, image)
       ├─ Compares against known listings in Upstash Redis
       ├─ New listings found → sends Telegram message per listing
       └─ Updates Redis with current listing IDs
```

### Why these choices

- **Playwright + stealth plugin**: Njuškalo uses Cloudflare protection. Plain HTTP requests get blocked. Playwright with stealth plugin launches a real Chromium browser that passes JS challenges.
- **GitHub Actions**: Free CI/CD with cron scheduling. ~2000 free minutes/month on private repos. Each run takes ~1-2 min, so hourly runs fit easily. Note: GHA cron can be delayed 5–15 minutes during high load — perfectly fine for hourly listing checks.
- **Upstash Redis**: Free tier (10k commands/day). Needed because GitHub Actions runners are stateless — no filesystem persistence between runs.
- **Telegram Bot API**: Zero cost, instant push notifications, dead simple API (single HTTP POST).

---

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Browser automation**: `playwright` + `playwright-extra` + `puppeteer-extra-plugin-stealth`
- **State storage**: `@upstash/redis` (free tier)
- **Notifications**: Telegram Bot API (direct `fetch` calls, no SDK needed)
- **Env loading (local)**: `dotenv` (for loading `.env` file during local development)
- **Scheduling**: GitHub Actions cron

---

## Project Structure

```
njuskalo-scraper/
├── src/
│   ├── index.ts              # Main entry point — orchestrates the scrape cycle
│   ├── scraper.ts            # Playwright logic — launches browser, navigates, extracts listings
│   ├── store.ts              # Upstash Redis — read/write seen listing IDs
│   ├── notifier.ts           # Telegram — formats and sends notification messages
│   └── types.ts              # Shared TypeScript types
├── .github/
│   └── workflows/
│       └── scrape.yml        # GitHub Actions workflow with cron schedule
├── .gitignore
├── package.json
├── tsconfig.json
└── .env.example              # Template for local env vars (not committed with real values)
```

---

## Configuration (Environment Variables)

All config is via environment variables. In CI they're stored as GitHub Actions secrets; locally they're loaded from a `.env` file via `dotenv`.

| Variable | Description | Example |
|---|---|---|
| `NJUSKALO_URLS` | One or more Njuškalo search URLs, separated by `\|\|\|` | `https://www.njuskalo.hr/prodaja-kuca?geo%5BlocationIds%5D=9515\|\|\|https://www.njuskalo.hr/prodaja-zemljista?geo%5BlocationIds%5D=9515` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST API URL | `https://xyz.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST API token | `AXxx...` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather | `123456:ABC-DEF...` |
| `TELEGRAM_CHAT_ID` | Your Telegram chat/user ID | `123456789` |

> **Note on `NJUSKALO_URLS`**: Since Njuškalo search URLs themselves contain commas in query params (e.g. `locationIds=9515%2C9509`), a simple comma can't be used as a delimiter. Use `|||` as the separator between URLs — it's unambiguous and won't appear in any URL. Example with two searches:
> ```
> https://www.njuskalo.hr/prodaja-kuca?geo%5BlocationIds%5D=9515%2C9509|||https://www.njuskalo.hr/prodaja-zemljista?geo%5BlocationIds%5D=9515
> ```
> A single URL (no separator) works fine too.

---

## Detailed Specifications

### 1. Scraper (`scraper.ts`)

**Responsibilities**: Launch headless Chromium, navigate to a search URL, handle cookie consent, wait for listings to load, extract listing data from the DOM.

**Implementation details**:

- Use `playwright-extra` with `puppeteer-extra-plugin-stealth` to bypass Cloudflare
- Launch Chromium in headless mode with these args: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage` (required for CI environments)
- The scraper function accepts a single URL and returns listings. The orchestrator calls it once per URL.
- Navigate to the given URL with a 60-second timeout
- **Cookie consent handling**: After navigation, check for the cookie consent popup (it covers the full screen). If present, click the **"Prihvati i zatvori"** button to dismiss it. Use a short timeout (5s) for this check — the popup may not appear on every run if cookies persist within the same browser session.
- Wait for the listing container to appear in the DOM (wait for a selector that indicates listings have loaded)
- **Only the first page of results is scraped**. This is by design — new listings appear at the top, and the goal is to detect newly added listings, not to crawl historical data.
- Extract from each listing on the page:
  - **id**: The unique listing ID (look for `data-entity-id` attribute or extract from the listing's href/URL)
  - **title**: Listing title text
  - **price**: Price text (as string, including currency)
  - **url**: Full URL to the listing detail page (prepend `https://www.njuskalo.hr` if relative)
  - **location**: Location/neighborhood text if available
  - **imageUrl**: Thumbnail image URL if available
- Return an array of `Listing` objects
- **Important**: Skip/filter out any promoted/featured listings that appear at the top if they have a distinguishing class or attribute (they often repeat and aren't truly "new"). Look for CSS classes or attributes that distinguish promoted listings from organic ones.
- **Retry logic**: If the page fails to load (timeout, Cloudflare challenge not passed), retry once after a 10-second delay before giving up. This handles transient failures without wasting too many GHA minutes.
- Close the browser after extraction (even on failure — use `finally` block)
- If navigation fails on both attempts, throw a descriptive error

**Njuškalo DOM hints** (verify these at build time as they may change):

- Listings are typically in `<li>` elements with class containing `EntityList-item`
- Each listing has an anchor tag linking to the detail page
- The listing ID is often in a `data-entity-id` or similar data attribute
- Price is usually in an element with class containing `price`
- Promoted/paid listings often have a distinguishing class like `EntityList-item--VauVau` or similar
- Cookie consent button text is **"Prihvati i zatvori"** (Croatian for "Accept and close")

**Types** (`types.ts`):

```typescript
export interface Listing {
  id: string;
  title: string;
  price: string;
  url: string;
  location?: string;
  imageUrl?: string;
}
```

### 2. Store (`store.ts`)

**Responsibilities**: Track which listing IDs have already been seen using Upstash Redis.

**Implementation details**:

- Use `@upstash/redis` package (REST-based, works in any environment including GitHub Actions)
- Store seen listing IDs in a Redis Set with key `njuskalo:seen_ids`
- Listing IDs on Njuškalo are globally unique, so a single shared Set works even when monitoring multiple search URLs.
- Expose two functions:
  - `getSeenIds(): Promise<Set<string>>` — fetches all members of the set
  - `addSeenIds(ids: string[]): Promise<void>` — adds new IDs to the set
- Set a TTL of 30 days on the key using `EXPIRE` after each write. **Note**: Since the cron writes every hour, the TTL effectively resets every hour, meaning the set never expires while the scraper is running. This is intentional — the TTL acts as a **safety net** so that if the cron stops running (e.g. repo archived, workflow disabled), the data auto-cleans after 30 days. The set will grow over time but this is negligible (string IDs only — even 10k entries use minimal memory on Upstash free tier).
- On first run (key doesn't exist), treat all current listings as "seen" and store them WITHOUT sending notifications. This prevents a flood of notifications on first deployment. Log a message like "First run: seeding {n} existing listings".

### 3. Notifier (`notifier.ts`)

**Responsibilities**: Send Telegram messages for new listings.

**Implementation details**:

- Use the Telegram Bot API directly via `fetch` (no SDK needed)
- Endpoint: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
- Send one message per new listing (not a batch) so each is tappable/readable
- Format each message using Telegram's HTML parse mode:

```
🏠 <b>New Listing!</b>

<b>{title}</b>
💰 {price}
📍 {location}

🔗 <a href="{url}">View on Njuškalo</a>
```

- Set `parse_mode: "HTML"` and `disable_web_page_preview: false` (so Telegram shows a link preview — Njuškalo listing pages have Open Graph meta tags, so the preview should include the listing image automatically)
- If Telegram's link preview doesn't reliably show images, this can be upgraded to `sendPhoto` with `imageUrl` in a future iteration (see Future Enhancements). The `imageUrl` field is collected in the `Listing` type for this purpose.
- Add a small delay between messages (500ms) if sending multiple, to avoid Telegram rate limits
- If a message fails to send, log the error but don't crash — continue with remaining listings
- Also send a summary if there are 5+ new listings at once: "📊 {n} new listings found! Sending details..."

### 4. Orchestrator (`index.ts`)

**Responsibilities**: Main entry point that ties everything together.

**Flow**:

```
1. Load environment variables (dotenv in local dev, already set in CI)
2. Log start time
3. Parse NJUSKALO_URLS into an array of URLs (split on "|||")
4. For each URL:
   a. Launch scraper → get current listings from that search page
   b. Aggregate all listings (deduplicate by ID in case of overlap between searches)
5. Fetch seen IDs from Redis
6. Compare: newListings = allListings.filter(l => !seenIds.has(l.id))
7. If first run (no seen IDs exist in Redis):
   a. Store all current IDs in Redis
   b. Log "First run, seeded N listings"
   c. Send a single Telegram message: "🚀 Scraper initialized! Monitoring {n} existing listings across {urlCount} search(es). You'll be notified of new ones."
   d. Exit
8. If newListings.length > 0:
   a. Send Telegram notifications for each
   b. Add new IDs to Redis
   c. Log "Found {n} new listings"
9. If newListings.length === 0:
   a. Log "No new listings found"
10. Log end time and total duration
```

**Error handling**:

- Wrap the entire flow in try/catch
- If the scraper fails (Cloudflare block, timeout, etc.), send a Telegram message: "⚠️ Scrape failed: {error message}" so you know it's broken
- Exit with process.exit(1) on failure so GitHub Actions marks the run as failed

### 5. GitHub Actions Workflow (`.github/workflows/scrape.yml`)

```yaml
name: Scrape Njuškalo

on:
  schedule:
    - cron: '0 * * * *'  # Every hour, on the hour
  workflow_dispatch: # Allow manual trigger for testing

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright Chromium
        run: npx playwright install chromium --with-deps
      
      - name: Run scraper
        run: npx tsx src/index.ts
        env:
          NJUSKALO_URLS: ${{ secrets.NJUSKALO_URLS }}
          UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

---

## Setup Instructions (One-Time)

### 1. Create Telegram Bot

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`, follow prompts, save the **bot token**
3. Send a message to your new bot (just say "hello")
4. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in browser
5. Find your `chat.id` in the response — that's your **chat ID**

### 2. Create Upstash Redis

1. Go to https://upstash.com, create free account
2. Create a new Redis database (choose EU/Frankfurt region for lowest latency from Croatia)
3. Copy the **REST URL** and **REST Token** from the dashboard

### 3. Configure GitHub Secrets

In your GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

- `NJUSKALO_URLS` (`|||`-separated list of search URLs, or a single URL)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

---

## Dependencies (`package.json`)

```json
{
  "name": "njuskalo-scraper",
  "private": true,
  "type": "module",
  "scripts": {
    "scrape": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "playwright-extra": "^4.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "playwright": "^1.49.0",
    "@upstash/redis": "^1.34.3",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

---

## `.gitignore`

```
node_modules/
dist/
.env
*.log
```

---

## Edge Cases & Error Handling

1. **First run**: Don't notify for existing listings — seed them silently (see orchestrator spec above)
2. **Cloudflare block**: If Playwright can't get past the challenge within 60s, retry once after 10s. If both attempts fail, throw and notify via Telegram.
3. **Cookie consent popup**: Dismiss the "Prihvati i zatvori" button if it appears. If the button isn't found within 5s, proceed anyway (it may not appear on every run).
4. **Empty page / no listings**: If zero listings are found, log a warning — this likely means the DOM structure changed or the page didn't load correctly. Send a Telegram warning: "⚠️ Zero listings found — page structure may have changed"
5. **Duplicate notifications**: Redis Set ensures idempotency — same ID won't trigger twice
6. **Redis down**: If Redis is unreachable, log error and exit without scraping (to avoid re-notifying everything)
7. **Telegram rate limits**: 500ms delay between messages. Telegram allows ~30 messages/second so this is very conservative
8. **Listing removed then re-added**: Since we only track IDs, a re-listed item with the same ID won't re-notify. A new ID will.
9. **Multiple URLs with overlapping listings**: Listings are deduplicated by ID before comparison, so a listing appearing in multiple searches won't trigger duplicate notifications.

---

## Future Enhancements (Not MVP)

- **Price tracking**: Store full listing data in Redis, detect price drops on existing listings
- **Filtering**: Add price range or keyword filters on top of Njuškalo's own filters
- **Web dashboard**: Simple Next.js app to view history of found listings
- **Image in Telegram**: Use `sendPhoto` instead of `sendMessage` to show listing thumbnail directly in the notification (the `imageUrl` field is already being collected for this)
- **Configurable schedule**: Allow different intervals per search URL

---

## Testing Locally

1. Clone repo, run `npm install`
2. Install Playwright browsers: `npx playwright install chromium`
3. Create `.env` file with all required env vars (see `.env.example`):
   ```
   NJUSKALO_URLS=https://www.njuskalo.hr/prodaja-kuca?geo%5BlocationIds%5D=9515%2C9509|||https://www.njuskalo.hr/prodaja-zemljista?geo%5BlocationIds%5D=9515%2C9509
   UPSTASH_REDIS_REST_URL=https://xyz.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AXxx...
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=123456789
   ```
4. Run: `npx tsx src/index.ts`
5. Verify: check Telegram for the "initialized" message on first run, then run again to confirm "no new listings" log

---

## Important Notes for Implementation

- The **Njuškalo DOM structure** will need to be inspected at build time. The CSS selectors in `scraper.ts` must match the actual page structure. Open the search URL in Chrome DevTools and identify the correct selectors for listing containers, IDs, titles, prices, and URLs.
- **Playwright stealth** is critical. Without it, Cloudflare will serve a challenge page instead of actual content. The `puppeteer-extra-plugin-stealth` package works with `playwright-extra`.
- **Pin exact versions** of `playwright-extra` and `puppeteer-extra-plugin-stealth` once you find a working combination. The stealth plugin was originally built for Puppeteer, and compatibility with `playwright-extra` can be version-sensitive. Upgrading these packages should be tested carefully.
- **Don't scrape too aggressively**. Once per hour is respectful and sufficient for real estate listings.
- **`dotenv`** is loaded at the top of `index.ts` via `import 'dotenv/config'`. This is a no-op in CI (where env vars are already set) and loads from `.env` locally.
