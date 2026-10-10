// Zero-dependency server: static files + a small JSON API.
//   GET /api/ads?minScore=60&minDays=14&format=video&q=sleep&offset=0&limit=20
//   GET /api/meta           -> source info + score distribution

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankAds, scoreAd, DEFAULTS } from "./lib/scoring.js";
import { fromDemo } from "./lib/sources.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

async function loadAds() {
  try {
    const ads = JSON.parse(await readFile(path.join(here, "data", "ads.json"), "utf8"));
    return { ads, source: "data/ads.json" };
  } catch {
    return { ads: await fromDemo(), source: "demo" };
  }
}

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/ads") {
      const q = url.searchParams;
      const minScore = +(q.get("minScore") ?? DEFAULTS.minScore);
      const minDays = +(q.get("minDays") ?? DEFAULTS.minDays);
      const format = q.get("format"); // video | image | all
      const text = (q.get("q") || "").toLowerCase();
      const offset = +(q.get("offset") || 0);
      const limit = Math.min(+(q.get("limit") || 20), 50);

      const { ads, source } = await loadAds();
      let ranked = rankAds(ads, { minScore, minDays });
      if (format === "video") ranked = ranked.filter((a) => a.mediaType === "VIDEO");
      if (format === "image") ranked = ranked.filter((a) => a.mediaType === "IMAGE");
      if (text)
        ranked = ranked.filter((a) =>
          [a.pageName, a.headline, a.text, a.vertical].join(" ").toLowerCase().includes(text)
        );
      return json(res, 200, {
        source,
        total: ranked.length,
        scanned: ads.length,
        ads: ranked.slice(offset, offset + limit),
      });
    }

    if (url.pathname === "/api/meta") {
      const { ads, source } = await loadAds();
      const buckets = { "0-39": 0, "40-59": 0, "60-79": 0, "80-100": 0 };
      for (const a of ads) {
        const s = scoreAd(a).score;
        buckets[s < 40 ? "0-39" : s < 60 ? "40-59" : s < 80 ? "60-79" : "80-100"]++;
      }
      return json(res, 200, { source, count: ads.length, buckets, defaults: DEFAULTS });
    }

    if (url.pathname === "/scoring.js") {
      res.writeHead(200, { "content-type": MIME[".js"] });
      return res.end(await readFile(path.join(here, "lib", "scoring.js")));
    }

    // static
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.normalize(path.join(here, "public", file));
    if (!full.startsWith(path.join(here, "public"))) return json(res, 403, { error: "forbidden" });
    const data = await readFile(full);
    res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e.code === "ENOENT") return json(res, 404, { error: "not found" });
    console.error(e);
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`AdReels running on http://localhost:${PORT}`));
