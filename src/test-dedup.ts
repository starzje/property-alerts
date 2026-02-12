/**
 * End-to-end test for the deduplication logic.
 * Tests three scenarios against real Redis:
 *   1. Known listing (same ID)         → skipped (not new)
 *   2. Repost (new ID, same title+price) → skipped (fingerprint match)
 *   3. Genuinely new (new ID, new title) → notified
 *
 * Usage: npx tsx src/test-dedup.ts
 */

import "dotenv/config";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TEST_ID_KEY = "test:seen_ids";
const TEST_FP_KEY = "test:seen_fingerprints";

interface FakeListing {
  id: string;
  title: string;
  price: string;
}

function getFingerprint(listing: FakeListing): string {
  const title = listing.title.toLowerCase().replace(/\s+/g, " ").trim();
  const price = listing.price.replace(/\s+/g, "").trim();
  return `${title}|${price}`;
}

async function cleanup() {
  await redis.del(TEST_ID_KEY);
  await redis.del(TEST_FP_KEY);
}

async function test() {
  console.log("=== Deduplication Logic Test ===\n");

  // Clean up any previous test data
  await cleanup();

  // --- SETUP: Simulate a first run with 2 existing listings ---
  const existingListings: FakeListing[] = [
    { id: "1001", title: "Zaprešić, kuća, 95 m2", price: "200.000 €" },
    { id: "1002", title: "Sveta Nedelja, kuća, 150 m2", price: "300.000 €" },
  ];

  // Seed IDs and fingerprints (simulates first run)
  const ids = existingListings.map((l) => l.id) as [string, ...string[]];
  const fps = existingListings.map(getFingerprint) as [string, ...string[]];
  await redis.sadd(TEST_ID_KEY, ...ids);
  await redis.sadd(TEST_FP_KEY, ...fps);

  console.log("Seeded 2 existing listings:");
  existingListings.forEach((l) =>
    console.log(`  ID=${l.id}  FP="${getFingerprint(l)}"`)
  );
  console.log();

  // --- SIMULATE: A subsequent scrape returns 3 listings ---
  const scrapedListings: FakeListing[] = [
    // Scenario 1: Same ID as before → should be filtered out by ID check
    { id: "1001", title: "Zaprešić, kuća, 95 m2", price: "200.000 €" },
    // Scenario 2: NEW ID, but same title+price as 1002 → REPOST
    { id: "9999", title: "Sveta Nedelja, kuća, 150 m2", price: "300.000 €" },
    // Scenario 3: NEW ID and NEW title+price → GENUINELY NEW
    { id: "2001", title: "Bregana, kuća, 200 m2", price: "250.000 €" },
  ];

  console.log("Simulated scrape returned 3 listings:");
  scrapedListings.forEach((l) =>
    console.log(`  ID=${l.id}  title="${l.title}"  price="${l.price}"`)
  );
  console.log();

  // Step 1: Fetch seen data (BEFORE adding new ones)
  const seenIds = new Set((await redis.smembers(TEST_ID_KEY)).map(String));
  const seenFps = new Set((await redis.smembers(TEST_FP_KEY)).map(String));

  // Step 2: Filter by ID
  const newByIdListings = scrapedListings.filter((l) => !seenIds.has(l.id));

  // Step 3: Filter reposts by fingerprint
  const genuinelyNew: FakeListing[] = [];
  const reposts: FakeListing[] = [];

  for (const listing of newByIdListings) {
    if (seenFps.has(getFingerprint(listing))) {
      reposts.push(listing);
    } else {
      genuinelyNew.push(listing);
    }
  }

  // --- VERIFY RESULTS ---
  let passed = 0;
  let failed = 0;

  // Test 1: Listing with existing ID should NOT be in newByIdListings
  const test1 = !newByIdListings.find((l) => l.id === "1001");
  console.log(`${test1 ? "✅" : "❌"} Test 1: Known ID (1001) filtered out by ID check`);
  test1 ? passed++ : failed++;

  // Test 2: Repost (new ID 9999, same fingerprint) should be in reposts
  const test2 = reposts.some((l) => l.id === "9999");
  console.log(`${test2 ? "✅" : "❌"} Test 2: Repost (ID 9999, same title+price) detected and skipped`);
  test2 ? passed++ : failed++;

  // Test 3: Genuinely new listing should be in genuinelyNew
  const test3 = genuinelyNew.some((l) => l.id === "2001");
  console.log(`${test3 ? "✅" : "❌"} Test 3: Genuinely new listing (ID 2001) correctly identified`);
  test3 ? passed++ : failed++;

  // Test 4: Only 1 genuinely new listing (not 2)
  const test4 = genuinelyNew.length === 1;
  console.log(`${test4 ? "✅" : "❌"} Test 4: Exactly 1 genuinely new listing (got ${genuinelyNew.length})`);
  test4 ? passed++ : failed++;

  // Test 5: Only 1 repost detected
  const test5 = reposts.length === 1;
  console.log(`${test5 ? "✅" : "❌"} Test 5: Exactly 1 repost detected (got ${reposts.length})`);
  test5 ? passed++ : failed++;

  console.log(`\n${passed}/${passed + failed} tests passed`);

  // Clean up test keys
  await cleanup();
  console.log("\nTest keys cleaned up from Redis.");

  if (failed > 0) process.exit(1);
}

test().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
