import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Listing } from "./types.js";

chromium.use(StealthPlugin());

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

const NAV_TIMEOUT = 60_000;
const COOKIE_TIMEOUT = 5_000;
const RETRY_DELAY = 10_000;

export async function scrapeListings(url: string): Promise<Listing[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const browser = await chromium.launch({
      headless: true,
      args: BROWSER_ARGS,
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      console.log(`[Attempt ${attempt}] Navigating to: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

      // Dismiss cookie consent popup if present
      try {
        const cookieButton = page.getByRole("button", { name: "Prihvati i zatvori" });
        await cookieButton.click({ timeout: COOKIE_TIMEOUT });
        console.log("Cookie consent dismissed.");
      } catch {
        // Cookie popup not found or already dismissed — continue
      }

      // Wait for listings to load
      await page.waitForSelector("li.EntityList-item--Regular", { timeout: 30_000 });

      // Extract only regular (non-promoted) listings from the DOM
      const listings = await page.$$eval(
        "li.EntityList-item--Regular",
        (elements) => {
          return elements
            .map((el) => {
              // Extract listing ID from data-options JSON or from the <a name="..."> attribute
              let id = "";
              try {
                const opts = el.getAttribute("data-options");
                if (opts) {
                  id = String(JSON.parse(opts).id);
                }
              } catch {
                // fallback below
              }
              if (!id) {
                const namedAnchor = el.querySelector("a[name]");
                id = namedAnchor?.getAttribute("name") ?? "";
              }

              // Title from h3.entity-title > a.link
              const titleEl = el.querySelector("h3.entity-title a.link");
              const title = titleEl?.textContent?.trim() ?? "";

              // URL from data-href on the <li>, or from the title anchor
              const dataHref = el.getAttribute("data-href") ?? "";
              const href = dataHref || (titleEl?.getAttribute("href") ?? "");
              const fullUrl = href.startsWith("http")
                ? href
                : `https://www.njuskalo.hr${href}`;

              // Price from strong.price
              const priceEl = el.querySelector("strong.price");
              const price = priceEl?.textContent?.trim() ?? "";

              // Location: text after "Lokacija: " inside .entity-description-main
              let location: string | undefined;
              const descEl = el.querySelector(".entity-description-main");
              if (descEl) {
                const locCaption = descEl.querySelector(".entity-description-itemCaption");
                if (locCaption && locCaption.textContent?.includes("Lokacija")) {
                  // The location text is the next text node sibling after the caption span
                  const nextText = locCaption.nextSibling?.textContent?.trim();
                  location = nextText || undefined;
                }
              }

              // Thumbnail image
              const imgEl = el.querySelector("img.entity-thumbnail-img");
              let imageUrl = imgEl?.getAttribute("src") || undefined;
              if (imageUrl && imageUrl.startsWith("//")) {
                imageUrl = `https:${imageUrl}`;
              }

              return { id, title, price, url: fullUrl, location, imageUrl };
            })
            .filter((l) => l.id !== "");
        }
      );

      console.log(`Extracted ${listings.length} listings from ${url}`);
      return listings;
    } catch (err) {
      lastError = err;
      console.error(`[Attempt ${attempt}] Scrape failed:`, err);

      if (attempt < 2) {
        console.log(`Retrying in ${RETRY_DELAY / 1000}s...`);
        await delay(RETRY_DELAY);
      }
    } finally {
      await browser.close();
    }
  }

  throw new Error(
    `Failed to scrape ${url} after 2 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
