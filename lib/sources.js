// Ad sources. Every adapter returns ads in one normalised shape:
//
// { id, pageId, pageName, text, headline, cta, landingUrl,
//   mediaType: "VIDEO"|"IMAGE"|"NONE", videoUrl, imageUrl,
//   startDate, endDate, active, daysRunning, platforms[], variants,
//   euReach, countries[], libraryUrl, snapshotUrl }
//
// Sources:
//   graph  - Meta's official Graph API /ads_archive. Free, needs a token.
//            Commercial ads are only in it if they were delivered to the EU/UK.
//            Gives copy + dates + EU reach, but NO direct video file URL.
//   apify  - a third-party Ad Library scraper on Apify. Gets video/image URLs
//            and landing pages, covers US ads too. Costs money, and scraping
//            Meta is against Meta's terms - your call, your risk.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

const libraryUrl = (id) => `https://www.facebook.com/ads/library/?id=${id}`;

// ---------- demo ----------
export async function fromDemo() {
  const raw = JSON.parse(await readFile(path.join(here, "..", "data", "demo.json"), "utf8"));
  const now = Date.now();
  // demo file stores "startedDaysAgo" so the numbers never go stale
  return raw.map((a) => ({
    ...a,
    startDate: new Date(now - a.startedDaysAgo * 86400000).toISOString(),
    endDate: a.active ? null : new Date(now - (a.startedDaysAgo - a.ranDays) * 86400000).toISOString(),
    daysRunning: a.active ? a.startedDaysAgo : a.ranDays,
    libraryUrl: libraryUrl(a.id),
  }));
}

// ---------- official Graph API ----------
export async function fromGraph({ token, query, countries = ["EE"], active = "ACTIVE", limit = 100, version = "v25.0" }) {
  if (!token) throw new Error("META_TOKEN is not set");
  const fields = [
    "id", "page_id", "page_name",
    "ad_creation_time", "ad_delivery_start_time", "ad_delivery_stop_time",
    "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_captions",
    "ad_snapshot_url", "publisher_platforms", "languages", "eu_total_reach",
  ].join(",");
  const params = new URLSearchParams({
    access_token: token,
    search_terms: query,
    ad_reached_countries: JSON.stringify(countries),
    ad_active_status: active,
    ad_type: "ALL",
    fields,
    limit: String(limit),
  });
  const out = [];
  let url = `https://graph.facebook.com/${version}/ads_archive?${params}`;
  for (let page = 0; page < 5 && url; page++) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(`Graph API: ${body?.error?.message || res.status}`);
    for (const a of body.data || []) {
      const start = a.ad_delivery_start_time;
      out.push({
        id: a.id,
        pageId: a.page_id,
        pageName: a.page_name,
        text: (a.ad_creative_bodies || [])[0] || "",
        headline: (a.ad_creative_link_titles || [])[0] || "",
        cta: "",
        landingUrl: (a.ad_creative_link_captions || [])[0] || "",
        mediaType: "NONE", // Graph API doesn't say, and doesn't give media files
        videoUrl: null,
        imageUrl: null,
        startDate: start,
        endDate: a.ad_delivery_stop_time || null,
        active: !a.ad_delivery_stop_time,
        platforms: (a.publisher_platforms || []).map((p) => p.toLowerCase()),
        // distinct copies of this ad = a rough "variants" count
        variants: (a.ad_creative_bodies || []).length || 1,
        euReach: a.eu_total_reach ?? null,
        countries,
        libraryUrl: libraryUrl(a.id),
        snapshotUrl: a.ad_snapshot_url,
      });
    }
    url = body.paging?.next || null;
  }
  return out;
}

// ---------- Apify (third-party scraper) ----------
// Field names below follow what the brilliant_gum/facebook-ads-library-scraper actor
// documents (mediaType, creatives[].videoUrl, daysRunning, ...). Other actors name
// things differently, so the mapper is deliberately forgiving. Check your actor's
// output and adjust `mapApify` if something comes back empty.
export async function fromApify({ token, actor, input }) {
  if (!token) throw new Error("APIFY_TOKEN is not set");
  if (!actor) throw new Error("APIFY_ACTOR is not set (e.g. brilliant_gum~facebook-ads-library-scraper)");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input || {}),
  });
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const items = await res.json();
  return items.map(mapApify).filter(Boolean);
}

// Ad Library scrapers return the same underlying data in camelCase (apify/facebook-ads-scraper)
// or Meta's raw snake_case (several others, e.g. curious_coder). Read both.
const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k];
  return undefined;
};
const toIso = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date((v < 1e11 ? v * 1000 : v)).toISOString(); // unix seconds or ms
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
};

function mapApify(r) {
  const snap = r.snapshot || {};
  const id = String(pick(r, "adArchiveID", "adArchiveId", "ad_archive_id", "id", "adId") ?? "");
  if (!id) return null;
  const card = (snap.cards || [])[0] || {};
  const video = (snap.videos || [])[0] || {};
  const image = (snap.images || [])[0] || {};
  const videoUrl = pick(video, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url") ||
    pick(card, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url") || r.videoUrl || null;
  const imageUrl = pick(image, "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url") ||
    pick(card, "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url") || r.imageUrl || null;
  const posterUrl = pick(video, "videoPreviewImageUrl", "video_preview_image_url") ||
    pick(card, "videoPreviewImageUrl", "video_preview_image_url") || imageUrl || null;
  const active = !!pick(r, "isActive", "is_active", "active");
  // For active ads the "end date" is only the last day Meta saw the ad, not a stop date.
  const end = active ? null : toIso(pick(r, "endDateFormatted", "endDate", "end_date"));
  const bodyRaw = snap.body;
  let text = (typeof bodyRaw === "string" ? bodyRaw : bodyRaw?.text) ?? r.adText ?? "";
  if (/\{\{.*\}\}/.test(text)) text = card.body || ""; // catalog ads carry unfilled {{product.name}} templates
  return {
    id,
    pageId: String(pick(r, "pageID", "pageId", "page_id") ?? snap.page_id ?? ""),
    pageName: pick(snap, "pageName", "page_name") ?? pick(r, "pageName", "page_name") ?? "",
    text,
    headline: snap.title ?? card.title ?? "",
    cta: pick(snap, "ctaText", "cta_text") ?? pick(card, "ctaText", "cta_text") ?? "",
    landingUrl: pick(snap, "linkUrl", "link_url") ?? pick(card, "linkUrl", "link_url") ?? "",
    mediaType: videoUrl ? "VIDEO" : imageUrl ? "IMAGE" : "NONE",
    videoUrl,
    imageUrl,
    posterUrl,
    startDate: toIso(pick(r, "startDateFormatted", "startDate", "start_date")),
    endDate: end,
    active,
    daysRunning: null, // computed from startDate when scoring
    platforms: (pick(r, "publisherPlatform", "publisher_platform") || []).map((p) => String(p).toLowerCase()),
    variants: pick(r, "collationCount", "collation_count") ?? null,
    euReach: pick(r, "reachEstimate", "reach_estimate", "euTotalReach", "eu_total_reach") ?? null,
    impressions: pick(r, "impressionsWithIndex", "impressions_with_index") ?? null, // usually null for US ads
    spend: pick(r, "spend") ?? null, // usually null for US ads
    countries: [],
    libraryUrl: libraryUrl(id),
    snapshotUrl: null,
  };
}
