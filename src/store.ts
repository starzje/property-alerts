import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const REDIS_KEY = "njuskalo:seen_ids";
const FINGERPRINT_KEY = "seen:fingerprints";
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function getSeenIds(): Promise<Set<string>> {
  const members = await redis.smembers(REDIS_KEY);
  // Upstash auto-deserializes numeric strings to numbers — coerce back to strings
  return new Set(members.map(String));
}

export async function addSeenIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await redis.sadd(REDIS_KEY, ...(ids as [string, ...string[]]));
  await redis.expire(REDIS_KEY, TTL_SECONDS);
}

export async function hasSeenIds(): Promise<boolean> {
  const exists = await redis.exists(REDIS_KEY);
  return exists === 1;
}

export async function getSeenFingerprints(): Promise<Set<string>> {
  const members = await redis.smembers(FINGERPRINT_KEY);
  return new Set(members.map(String));
}

export async function addSeenFingerprints(fingerprints: string[]): Promise<void> {
  if (fingerprints.length === 0) return;
  await redis.sadd(FINGERPRINT_KEY, ...(fingerprints as [string, ...string[]]));
  await redis.expire(FINGERPRINT_KEY, TTL_SECONDS);
}
