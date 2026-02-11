import "dotenv/config";
import { scrapeListings } from "./scraper.js";
import { getSeenIds, addSeenIds, hasSeenIds } from "./store.js";
import {
  notifyNewListings,
  notifyError,
  notifyInitialized,
  notifyZeroListings,
} from "./notifier.js";
import type { Listing } from "./types.js";

const REQUIRED_ENV_VARS = [
  "NJUSKALO_URLS",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
];

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Scraper started`);

  validateEnv();

  const urls = process.env.NJUSKALO_URLS!.split("|||").map((u) => u.trim());
  console.log(`Monitoring ${urls.length} search URL(s)`);

  // Scrape all URLs and aggregate listings
  const allListingsMap = new Map<string, Listing>();

  for (const url of urls) {
    const listings = await scrapeListings(url);
    for (const listing of listings) {
      if (!allListingsMap.has(listing.id)) {
        allListingsMap.set(listing.id, listing);
      }
    }
  }

  const allListings = Array.from(allListingsMap.values());
  console.log(`Total unique listings scraped: ${allListings.length}`);

  // Check for zero listings edge case
  if (allListings.length === 0) {
    console.warn("WARNING: Zero listings found — page structure may have changed");
    await notifyZeroListings();
    return;
  }

  // Check if this is the first run
  const isFirstRun = !(await hasSeenIds());

  if (isFirstRun) {
    const ids = allListings.map((l) => l.id);
    await addSeenIds(ids);
    console.log(`First run: seeded ${ids.length} existing listings`);
    await notifyInitialized(allListings.length, urls.length);
    return;
  }

  // Subsequent run — find new listings
  const seenIds = await getSeenIds();
  const newListings = allListings.filter((l) => !seenIds.has(l.id));

  if (newListings.length > 0) {
    console.log(`Found ${newListings.length} new listing(s)`);
    await notifyNewListings(newListings);
    await addSeenIds(newListings.map((l) => l.id));
  } else {
    console.log("No new listings found");
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] Scraper finished in ${elapsed}s`);
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  const message = err instanceof Error ? err.message : String(err);
  await notifyError(message);
  process.exit(1);
});
