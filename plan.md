# Njuškalo Scraper — Implementation Plan

Step-by-step checklist for building the scraper from the ground up.
Check off each task as it's completed.

---

## Phase 1: Project Scaffolding

- [x] **1.1** Initialize the project with `npm init` and set `"type": "module"` in `package.json`
- [x] **1.2** Install production dependencies: `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`, `@upstash/redis`, `dotenv`
- [x] **1.3** Install dev dependencies: `tsx`, `typescript`, `@types/node`
- [x] **1.4** Create `tsconfig.json` (target ES2022, module ESNext, moduleResolution bundler, strict)
- [x] **1.5** Create `.gitignore` (node_modules, dist, .env, *.log)
- [x] **1.6** Create `.env.example` with all required env var placeholders
- [x] **1.7** Create the `src/` directory and empty entry files: `index.ts`, `scraper.ts`, `store.ts`, `notifier.ts`, `types.ts`

---

## Phase 2: Types (`src/types.ts`)

- [x] **2.1** Define and export the `Listing` interface (`id`, `title`, `price`, `url`, `location?`, `imageUrl?`)

---

## Phase 3: Notifier (`src/notifier.ts`)

_No external dependencies beyond `fetch` — easy to build and test independently._

- [x] **3.1** Implement `sendTelegramMessage(text: string)` — POST to Telegram Bot API with `parse_mode: "HTML"` and `disable_web_page_preview: false`
- [x] **3.2** Implement `notifyNewListing(listing: Listing)` — format a single listing into the HTML template (🏠 title, 💰 price, 📍 location, 🔗 link) and call `sendTelegramMessage`
- [x] **3.3** Implement `notifyNewListings(listings: Listing[])` — iterate listings, send one message each with 500ms delay between them; if 5+ listings, send a summary message first ("📊 N new listings found!")
- [x] **3.4** Implement `notifyError(errorMessage: string)` — send "⚠️ Scrape failed: {message}" via Telegram
- [x] **3.5** Implement `notifyInitialized(listingCount: number, urlCount: number)` — send the "🚀 Scraper initialized!" message
- [x] **3.6** Add error handling: if a single message fails to send, log the error but don't throw — continue with the rest

---

## Phase 4: Store (`src/store.ts`)

- [x] **4.1** Initialize the Upstash Redis client using env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)
- [x] **4.2** Define the Redis key constant: `njuskalo:seen_ids`
- [x] **4.3** Implement `getSeenIds(): Promise<Set<string>>` — `SMEMBERS` on the key, return as a `Set<string>`; return empty set if key doesn't exist
- [x] **4.4** Implement `addSeenIds(ids: string[]): Promise<void>` — `SADD` the IDs to the set, then `EXPIRE` with 30-day TTL
- [x] **4.5** Implement `hasSeenIds(): Promise<boolean>` — `EXISTS` check on the key (used by orchestrator to detect first run)

---

## Phase 5: Scraper (`src/scraper.ts`)

_This is the most complex and fragile part — depends on Njuškalo's actual DOM._

- [x] **5.1** Set up Playwright with stealth plugin: `chromium.use(StealthPlugin())`, launch with `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage` args, headless mode
- [x] **5.2** Implement `scrapeListings(url: string): Promise<Listing[]>` — main function that opens a page, navigates, extracts, and returns listings
- [x] **5.3** Add cookie consent handling: after navigation, try to click "Prihvati i zatvori" button with a 5s timeout; proceed silently if not found
- [x] **5.4** Wait for the listing container selector to appear in the DOM (e.g. `EntityList-item` or similar — to be verified against the live site)
- [x] **5.5** Extract listing data from each DOM element: `id` (from `data-entity-id` or href), `title`, `price`, `url` (prepend base URL if relative), `location`, `imageUrl`
- [x] **5.6** Filter out promoted/featured listings (e.g. `EntityList-item--VauVau` or similar distinguishing class)
- [x] **5.7** Add retry logic: on failure (timeout, Cloudflare block), wait 10s and retry once before throwing
- [x] **5.8** Ensure browser is always closed in a `finally` block
- [x] **5.9** 🔍 **Manual verification step (human-in-the-loop)**: Before writing the scraper extraction logic, the AI assistant should **ask the user** to open their Njuškalo search URL in Chrome DevTools and provide the actual CSS selectors/classes for: listing container, listing ID attribute, title, price, URL, location, image, and promoted/featured listing markers. The user pastes these into the chat as context, and only then does the AI write the DOM extraction code. This avoids guesswork and back-and-forth.

---

## Phase 6: Orchestrator (`src/index.ts`)

- [x] **6.1** Import `dotenv/config` at the top for local dev env loading
- [x] **6.2** Validate that all required env vars are present; exit with a clear error if any are missing
- [x] **6.3** Parse `NJUSKALO_URLS` by splitting on `|||` into an array of URLs
- [x] **6.4** For each URL, call `scrapeListings()` and aggregate results; deduplicate by listing ID
- [x] **6.5** Call `hasSeenIds()` to check if this is the first run
- [x] **6.6** **First run path**: store all current IDs via `addSeenIds()`, send `notifyInitialized()`, log, and exit
- [x] **6.7** **Subsequent run path**: call `getSeenIds()`, filter listings to find new ones (`!seenIds.has(id)`)
- [x] **6.8** If new listings found: call `notifyNewListings()`, then `addSeenIds()` with new IDs, log count
- [x] **6.9** If no new listings: log "No new listings found"
- [x] **6.10** Handle zero-listings edge case: if a scrape returns 0 listings, send a Telegram warning ("⚠️ Zero listings found — page structure may have changed")
- [x] **6.11** Wrap everything in try/catch: on error, call `notifyError()`, log, and `process.exit(1)`
- [x] **6.12** Log start time, end time, and total duration

---

## Phase 7: GitHub Actions Workflow

- [x] **7.1** Create `.github/workflows/scrape.yml` with cron schedule (`0 * * * *` — every hour)
- [x] **7.2** Add `workflow_dispatch` trigger for manual runs
- [x] **7.3** Add job steps: checkout, setup Node 20 with npm cache, `npm ci`, `npx playwright install chromium --with-deps`, `npx tsx src/index.ts`
- [x] **7.4** Pass all secrets as env vars to the run step
- [x] **7.5** Set `timeout-minutes: 5` on the job

---

## Phase 8: Local Testing & Verification

- [x] **8.1** Create a `.env` file with real credentials (not committed)
- [x] **8.2** Run `npx playwright install chromium` locally
- [x] **8.3** Run `npx tsx src/index.ts` — verify first-run behavior (seeds listings, sends "initialized" Telegram message)
- [x] **8.4** Run again — verify "no new listings found" log and no Telegram messages sent
- [ ] **8.5** Manually delete one ID from Redis, run again — verify that listing triggers a Telegram notification
- [x] **8.6** Run `tsc --noEmit` to confirm no type errors

---

## Phase 9: Deploy & Monitor

- [x] **9.1** Push code to GitHub
- [x] **9.2** Add all secrets to the repo (Settings → Secrets → Actions)
- [x] **9.3** Trigger the workflow manually via `workflow_dispatch` and verify it passes
- [ ] **9.4** Wait for the first cron-triggered run and confirm it works
- [ ] **9.5** Monitor Telegram for the next few hours to ensure notifications are arriving correctly

---

## Implementation Order & Rationale

| Order | Module | Why this order |
|-------|--------|----------------|
| 1 | Scaffolding | Everything depends on having a working project |
| 2 | Types | Shared by all modules — define the contract first |
| 3 | Notifier | Zero dependencies on other modules; easy to verify by sending a test message |
| 4 | Store | Only depends on types; can test with Upstash independently |
| 5 | Scraper | Most complex; depends on types. Test in isolation against a live URL |
| 6 | Orchestrator | Wires everything together — all pieces must exist first |
| 7 | GHA Workflow | Only needed once the script runs correctly locally |
| 8–9 | Test & Deploy | Final validation |

---

## Notes

- **Selectors will need live verification** (Phase 5.9). The spec provides hints (`EntityList-item`, `data-entity-id`, etc.) but these must be confirmed by inspecting the actual Njuškalo page in DevTools.
- **Pin dependency versions** once a working combination of `playwright-extra` + stealth plugin is confirmed.
- Keep each phase as a separate commit for clean history.

