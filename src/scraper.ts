import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page } from "playwright";
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
  const domain = new URL(url).hostname;

  let extractFn: (page: Page) => Promise<Listing[]>;
  if (domain.includes("njuskalo.hr")) {
    extractFn = extractNjuskaloListings;
  } else if (domain.includes("index.hr")) {
    extractFn = extractIndexHrListings;
  } else if (domain.includes("oglasnik.hr")) {
    extractFn = extractOglasnikListings;
  } else if (domain.includes("nekretnine.hr")) {
    extractFn = extractNekretnineListings;
  } else {
    throw new Error(`Unsupported site: ${domain}`);
  }

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

      const listings = await extractFn(page);
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

// ---------------------------------------------------------------------------
// Njuškalo
// ---------------------------------------------------------------------------

async function extractNjuskaloListings(page: Page): Promise<Listing[]> {
  // Dismiss cookie consent popup if present
  try {
    const cookieButton = page.getByRole("button", { name: "Prihvati i zatvori" });
    await cookieButton.click({ timeout: COOKIE_TIMEOUT });
    console.log("Cookie consent dismissed.");
  } catch {
    // Cookie popup not found or already dismissed — continue
  }

  await page.waitForSelector("li.EntityList-item--Regular", { timeout: 30_000 });

  return page.$$eval("li.EntityList-item--Regular", (elements) => {
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
          const locCaption = descEl.querySelector(
            ".entity-description-itemCaption"
          );
          if (locCaption && locCaption.textContent?.includes("Lokacija")) {
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
  });
}

// ---------------------------------------------------------------------------
// Index.hr
// ---------------------------------------------------------------------------

async function extractIndexHrListings(page: Page): Promise<Listing[]> {
  // Index.hr is a React SPA — wait for listing links to render
  await page.waitForSelector('a[class*="AdLink__link"]', { timeout: 30_000 });

  return page.$$eval('a[class*="AdLink__link"]', (elements) => {
    return elements
      .map((el) => {
        const href = el.getAttribute("href") ?? "";
        const fullUrl = href.startsWith("http")
          ? href
          : `https://www.index.hr${href}`;

        // ID from the URL — last numeric segment (e.g. /6478169)
        const idMatch = href.match(/\/(\d+)$/);
        const id = idMatch ? `idx-${idMatch[1]}` : "";

        // Title
        const titleEl = el.querySelector('[class*="AdSummary__title"]');
        const title = titleEl?.textContent?.trim() ?? "";

        // Price (stable data-test attribute)
        const priceEl = el.querySelector('[data-test="adprice"]');
        const price = priceEl?.textContent?.trim() ?? "";

        // Location
        const locationEl = el.querySelector('[class*="adLocation__location"]');
        const location = locationEl?.textContent?.trim() || undefined;

        // Image from carousel background-image
        const imgDiv = el.querySelector('[class*="carouselImage"]');
        let imageUrl: string | undefined;
        if (imgDiv) {
          const style = imgDiv.getAttribute("style") ?? "";
          const urlMatch = style.match(/url\(["']?(.*?)["']?\)/);
          imageUrl = urlMatch?.[1] || undefined;
        }

        return { id, title, price, url: fullUrl, location, imageUrl };
      })
      .filter((l) => l.id !== "");
  });
}

// ---------------------------------------------------------------------------
// Oglasnik.hr
// ---------------------------------------------------------------------------

async function extractOglasnikListings(page: Page): Promise<Listing[]> {
  // Dismiss cookie consent popup if present ("Dopusti sve")
  try {
    const cookieButton = page.getByRole("button", { name: "Dopusti sve" });
    await cookieButton.click({ timeout: COOKIE_TIMEOUT });
    console.log("Cookie consent dismissed.");
  } catch {
    // Cookie popup not found or already dismissed — continue
  }

  // Oglasnik redesigned (2025+) — listing cards are Tailwind-based anchors
  await page.waitForSelector('a[href*="-oglas-"]', { timeout: 30_000 });

  return page.$$eval('a[href*="-oglas-"]', (elements) => {
    return elements
      .filter((el) => {
        const href = el.getAttribute("href") ?? "";
        return /oglas-\d+(\?|$)/.test(href) || /-oglas-\d+$/.test(href);
      })
      .map((el) => {
        const href = el.getAttribute("href") ?? "";
        const fullUrl = href.startsWith("http")
          ? href
          : `https://oglasnik.hr${href}`;

        const idMatch = href.match(/oglas-(\d+)/);
        const id = idMatch ? `ogl-${idMatch[1]}` : "";

        // Title: primary line under the image (new UI)
        const titleEl =
          el.querySelector("p.font-medium.text-slate-700") ??
          el.querySelector("h3.classified-title") ??
          el.querySelector("img[alt]");

        let title = titleEl?.textContent?.trim() ?? "";
        if (!title && titleEl instanceof HTMLImageElement) {
          title = titleEl.getAttribute("alt")?.trim() ?? "";
        }

        // Price: bold € line (new) or legacy .price-block .main
        const priceEl =
          el.querySelector("p.text-xl.font-bold") ??
          el.querySelector(".price-block .main");
        const price = priceEl?.textContent?.trim() ?? "";

        // Location (new): region line; legacy: span.location
        const locationEl =
          el.querySelector("p.mt-2.mb-1.text-sm") ??
          el.querySelector("p.text-sm.text-gray-700") ??
          el.querySelector("span.location");
        const location = locationEl?.textContent?.trim() || undefined;

        // Image: first listing image (new) or legacy background-image
        let imageUrl: string | undefined =
          el.querySelector("img.short-ad-first-image")?.getAttribute("src") ||
          el.querySelector("img[src*='media.oglasnik']")?.getAttribute("src") ||
          undefined;

        if (!imageUrl) {
          const imgDiv = el.querySelector(".image-wrapper-bg");
          if (imgDiv) {
            const style = imgDiv.getAttribute("style") ?? "";
            const urlMatch = style.match(/url\(["']?(.*?)["']?\)/);
            const raw = urlMatch?.[1];
            if (raw) {
              imageUrl = raw.startsWith("http")
                ? raw
                : `https://oglasnik.hr${raw}`;
            }
          }
        }

        return { id, title, price, url: fullUrl, location, imageUrl };
      })
      .filter((l) => l.id !== "");
  });
}

// ---------------------------------------------------------------------------
// Nekretnine.hr
// ---------------------------------------------------------------------------

async function extractNekretnineListings(page: Page): Promise<Listing[]> {
  // Dismiss cookie consent popup if present ("agree & close")
  try {
    const cookieButton = page.getByRole("button", { name: "agree & close" });
    await cookieButton.click({ timeout: COOKIE_TIMEOUT });
    console.log("Cookie consent dismissed.");
  } catch {
    // Cookie popup not found or already dismissed — continue
  }

  // Wait for listing cards to render (CSS modules — use partial class match)
  await page.waitForSelector('[class*="Property_card__"]', {
    timeout: 30_000,
  });

  return page.$$eval(
    'div.nd-mediaObject[class*="Property_card__"]',
    (elements) => {
      return elements
        .map((el) => {
          // Title link contains href, title, and text
          const titleEl = el.querySelector('a[class*="Title_title__"]');
          const href = titleEl?.getAttribute("href") ?? "";
          const fullUrl = href.startsWith("http")
            ? href
            : `https://www.nekretnine.hr${href}`;

          // ID from URL — e.g. /oglasi/2636283/
          const idMatch = href.match(/\/oglasi\/(\d+)/);
          const id = idMatch ? `nek-${idMatch[1]}` : "";

          // Title from the element's title attribute or text content
          const title =
            titleEl?.getAttribute("title") ??
            titleEl?.textContent?.trim() ??
            "";

          // Price
          const priceEl = el.querySelector('[class*="Price_price__"] span');
          const price = priceEl?.textContent?.trim() ?? "";

          // No separate location field — it's included in the title
          const location: string | undefined = undefined;

          // First image in the slideshow
          const imgEl = el.querySelector(".nd-slideshow__item.is-current img");
          const imageUrl = imgEl?.getAttribute("src") || undefined;

          return { id, title, price, url: fullUrl, location, imageUrl };
        })
        .filter((l) => l.id !== "");
    }
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
