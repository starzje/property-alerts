import "dotenv/config";
import { scrapeListings } from "./scraper.js";
import {
  getSeenIds,
  addSeenIds,
  hasSeenIds,
  getSeenFingerprints,
  addSeenFingerprints,
} from "./store.js";
import {
  notifyNewListings,
  notifyError,
  notifyInitialized,
  notifyZeroListings,
} from "./notifier.js";
import type { Listing } from "./types.js";

const REQUIRED_ENV_VARS = [
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

  // At least one URL source must be configured
  if (!process.env.NJUSKALO_URLS && !process.env.INDEX_HR_URLS && !process.env.OGLASNIK_HR_URLS) {
    throw new Error(
      "At least one of NJUSKALO_URLS, INDEX_HR_URLS, or OGLASNIK_HR_URLS must be set"
    );
  }
}

function collectUrls(): string[] {
  const urls: string[] = [];

  if (process.env.NJUSKALO_URLS) {
    urls.push(
      ...process.env.NJUSKALO_URLS.split("|||").map((u) => u.trim()).filter(Boolean)
    );
  }

  if (process.env.INDEX_HR_URLS) {
    urls.push(
      ...process.env.INDEX_HR_URLS.split("|||").map((u) => u.trim()).filter(Boolean)
    );
  }

  if (process.env.OGLASNIK_HR_URLS) {
    urls.push(
      ...process.env.OGLASNIK_HR_URLS.split("|||").map((u) => u.trim()).filter(Boolean)
    );
  }

  return urls;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Scraper started`);

  validateEnv();

  const urls = collectUrls();
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
    await addSeenFingerprints(allListings.map(getFingerprint));
    console.log(`First run: seeded ${ids.length} existing listings`);
    await notifyInitialized(allListings.length, urls.length);
    return;
  }

  // Fetch seen IDs and fingerprints BEFORE adding new ones
  const seenIds = await getSeenIds();
  const seenFps = await getSeenFingerprints();

  // Find listings with IDs we haven't seen before
  const newByIdListings = allListings.filter((l) => !seenIds.has(l.id));

  if (newByIdListings.length === 0) {
    console.log("No new listings found");
  } else {
    // Filter out reposts (same title + price as a previously seen listing)
    const genuinelyNew: Listing[] = [];
    const reposts: Listing[] = [];

    for (const listing of newByIdListings) {
      if (seenFps.has(getFingerprint(listing))) {
        reposts.push(listing);
      } else {
        genuinelyNew.push(listing);
      }
    }

    if (reposts.length > 0) {
      console.log(`Skipped ${reposts.length} repost(s) (same title + price as before)`);
    }

    // Track new IDs
    await addSeenIds(newByIdListings.map((l) => l.id));

    if (genuinelyNew.length > 0) {
      console.log(`Found ${genuinelyNew.length} genuinely new listing(s)`);
      await notifyNewListings(genuinelyNew);
    } else {
      console.log("No new listings found (all were reposts)");
    }
  }

  // Sync all current fingerprints AFTER comparison
  // This ensures the set stays populated (handles migration + new listings)
  await addSeenFingerprints(allListings.map(getFingerprint));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] Scraper finished in ${elapsed}s`);
}

/**
 * Generate a fingerprint from a listing's title + price.
 * Used to detect reposts — same listing re-uploaded with a new ID.
 */
function getFingerprint(listing: Listing): string {
  const title = listing.title.toLowerCase().replace(/\s+/g, " ").trim();
  const price = listing.price.replace(/\s+/g, "").trim();
  return `${title}|${price}`;
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  const message = err instanceof Error ? err.message : String(err);
  await notifyError(message);
  process.exit(1);
});
