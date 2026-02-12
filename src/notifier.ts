import type { Listing } from "./types.js";

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

async function sendTelegramMessage(text: string): Promise<void> {
  const res = await fetch(TELEGRAM_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
}

export async function notifyNewListing(listing: Listing): Promise<void> {
  const siteName = listing.url.includes("index.hr")
    ? "Index Oglasi"
    : listing.url.includes("oglasnik.hr")
      ? "Oglasnik"
      : "Njuškalo";
  const message = [
    `🏠 <b>New Listing!</b>`,
    ``,
    `<b>${listing.title}</b>`,
    `💰 ${listing.price}`,
    listing.location ? `📍 ${listing.location}` : null,
    ``,
    `🔗 <a href="${listing.url}">View on ${siteName}</a>`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendTelegramMessage(message);
}

export async function notifyNewListings(listings: Listing[]): Promise<void> {
  if (listings.length >= 5) {
    await sendTelegramMessage(
      `📊 <b>${listings.length} new listings found!</b> Sending details...`
    );
    await delay(500);
  }

  for (const listing of listings) {
    try {
      await notifyNewListing(listing);
      await delay(500);
    } catch (err) {
      console.error(`Failed to send notification for listing ${listing.id}:`, err);
    }
  }
}

export async function notifyError(errorMessage: string): Promise<void> {
  try {
    const safe = escapeHtml(errorMessage);
    await sendTelegramMessage(`⚠️ <b>Scrape failed:</b> ${safe}`);
  } catch (err) {
    console.error("Failed to send error notification to Telegram:", err);
  }
}

export async function notifyInitialized(
  listingCount: number,
  urlCount: number
): Promise<void> {
  await sendTelegramMessage(
    `🚀 <b>Scraper initialized!</b> Monitoring ${listingCount} existing listings across ${urlCount} search(es). You'll be notified of new ones.`
  );
}

export async function notifyZeroListings(): Promise<void> {
  await sendTelegramMessage(
    `⚠️ <b>Zero listings found</b> — page structure may have changed.`
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
