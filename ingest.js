// Pull ads from a source, score them, and write data/ads.json (what the server reads).
//
//   node ingest.js --source demo
//   META_TOKEN=... node ingest.js --source graph --query "collagen" --countries EE,DE,FR
//   APIFY_TOKEN=... APIFY_ACTOR=user~actor APIFY_INPUT='{"searchTerms":"collagen"}' node ingest.js --source apify
//
// Re-running merges into the existing file by ad id, so you build up history
// (Meta drops stopped ads after a year, and outside the EU/UK they vanish right away).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromDemo, fromGraph, fromApify } from "./lib/sources.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "data", "ads.json");

// Surface failures as a GitHub Actions annotation so they show on the run summary page.
for (const ev of ["uncaughtException", "unhandledRejection"])
  process.on(ev, (e) => {
    const msg = String(e?.message || e).replace(/\r?\n/g, " ").slice(0, 600);
    console.log(`::error title=Ingest failed::${msg}`);
    console.error(e);
    process.exit(1);
  });

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]);
    return acc;
  }, [])
);

// Build the actor input from plain keywords, e.g. APIFY_QUERIES="sleep,collagen" APIFY_COUNTRY=US
function apifyInputsFromQueries() {
  const country = process.env.APIFY_COUNTRY || "US";
  const media = process.env.APIFY_MEDIA || "video";
  const limit = +(process.env.APIFY_LIMIT || 60);
  const all = (process.env.APIFY_QUERIES || "vaginal dryness,urinary incontinence,menopause").split(",").map((q) => q.trim()).filter(Boolean);
  // With a long keyword list, scrape only a slice per run and rotate every 12 hours.
  // Re-scraping the same top ads costs money and adds nothing new.
  const perRun = Math.max(1, +(process.env.APIFY_PER_RUN || 3));
  let queries = all;
  if (all.length > perRun) {
    const slot = Math.floor(Date.now() / (12 * 3600e3));
    queries = Array.from({ length: perRun }, (_, i) => all[(slot * perRun + i) % all.length]);
  }
  const actor = process.env.APIFY_ACTOR || "";
  return queries.map((q) => {
    const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&is_targeted_country=false&media_type=${media}&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;
    // apify/facebook-ads-scraper takes startUrls; curious_coder/facebook-ads-library-scraper takes urls.
    if (actor.startsWith("apify~") || actor.startsWith("apify/"))
      return { startUrls: [{ url }], resultsLimit: limit };
    return {
      urls: [{ url }], // this actor wants request objects, not bare strings
      limitPerSource: limit,
      scrapePageAds: { activeStatus: "active", sortBy: "impressions_desc", countryCode: country },
    };
  });
}

const source = args.source || "demo";
let ads;
if (source === "demo") ads = await fromDemo();
else if (source === "graph")
  ads = await fromGraph({
    token: process.env.META_TOKEN,
    query: args.query || "",
    countries: (args.countries || "EE").split(","),
    active: args.status || "ACTIVE",
  });
else if (source === "apify") {
  const common = { token: process.env.APIFY_TOKEN, actor: process.env.APIFY_ACTOR };
  if (process.env.APIFY_INPUT) {
    ads = await fromApify({ ...common, input: JSON.parse(process.env.APIFY_INPUT) });
  } else {
    // One scrape per keyword. Results come back in Meta's impressions order, so a
    // position in the list tells us how that ad ranks against others for the keyword.
    const best = new Map();
    let failed = 0;
    const inputs = apifyInputsFromQueries();
    for (const input of inputs) {
      try {
        const batch = await fromApify({ ...common, input });
        batch.forEach((a, i) => {
          a.impressionRank = batch.length > 1 ? i / (batch.length - 1) : 0;
          const prev = best.get(a.id);
          if (!prev || a.impressionRank < prev.impressionRank) best.set(a.id, a);
        });
      } catch (e) {
        failed++;
        console.log(`::warning title=Keyword scrape failed::${String(e.message).replace(/\r?\n/g, " ").slice(0, 400)}`);
      }
    }
    if (failed === inputs.length) throw new Error("every keyword scrape failed (see warnings above)");
    ads = [...best.values()];
  }
}
else throw new Error(`unknown --source ${source}`);

let existing = [];
try {
  existing = JSON.parse(await readFile(OUT, "utf8"));
} catch {}
const byId = new Map(existing.map((a) => [a.id, a]));
for (const ad of ads) byId.set(ad.id, { ...byId.get(ad.id), ...ad, seenAt: new Date().toISOString() });

await writeFile(OUT, JSON.stringify([...byId.values()], null, 2));
console.log(`ingested ${ads.length} ads from ${source}; ${byId.size} total in data/ads.json`);
