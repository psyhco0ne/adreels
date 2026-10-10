# AdReels

TikTok/Reels-style vertical feed of *winning* ads from the Meta Ad Library.

## Run it
    node server.js          # http://localhost:3000, needs Node 18+, no npm install
It starts on demo data (12 fictional ads). Swipe, or use ↑ ↓, M to mute.

## Load real ads
    # official Graph API (free, needs a token from developers.facebook.com)
    META_TOKEN=... node ingest.js --source graph --query "collagen" --countries EE,DE,FR

    # third-party scraper on Apify (gets video + image URLs, covers US ads)
    APIFY_TOKEN=... APIFY_ACTOR=user~actor APIFY_INPUT='{"searchTerms":"collagen"}' node ingest.js --source apify

Ingest merges by ad id into data/ads.json, so you build up history. Delete that file to go back to demo.

## What "winning" means (lib/scoring.js)
Meta publishes no spend/ROAS for commercial ads, so winners are inferred from survival signals:
days running (45%), live variants (20%), EU/UK reach (20%), still active, placements, video.
Ads that died in under 14 days are capped below the winner bar. Missing signals are skipped, not penalised.

## Known limits
- Graph API: commercial ads exist only if delivered to the EU/UK. US-only advertisers are invisible. No video file URLs.
- Apify field mapping (mapApify in lib/sources.js) is untested against a live run; adjust to your actor's output.
- Video URLs on fbcdn expire, so re-ingest regularly or copy videos to your own storage.
- Scraping the Ad Library is against Meta's terms; republishing other advertisers' creatives has copyright risk.

## Host it so it runs while your PC is off (free)
The site is static, and a GitHub Action refreshes the ads daily. Nothing runs on your computer.

1. Create a GitHub repo and push this folder to the `main` branch.
2. Repo Settings > Pages > Source: **GitHub Actions**.
3. Settings > Secrets and variables > Actions:
   - Secret `META_TOKEN` (Graph API) and/or secret `APIFY_TOKEN`
   - Variables (optional): `AD_QUERIES` (comma separated, e.g. `sleep,collagen`), `AD_COUNTRIES` (e.g. `EE,DE,FR`);
     for Apify also `APIFY_ACTOR` and `APIFY_INPUT`
4. Actions tab > "Refresh ads and deploy" > Run workflow. Your link is `https://<user>.github.io/<repo>/`.
   With no tokens set it publishes the demo ads, which is a fine first test.

Notes: GitHub Pages sites are public to anyone with the link (private-repo Pages needs a paid plan).
Cloudflare Pages is a free alternative that can sit behind a login. Facebook video URLs expire,
so the daily refresh matters; a video that expired mid-day shows as blank until the next run.
