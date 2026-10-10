// "Winning ad" detection.
//
// Meta does NOT publish spend/ROAS/conversions for commercial ads, so nobody can
// know for certain that an ad is winning. What we can observe are survival
// signals: advertisers don't keep paying for ads that lose money.
//
//   longevity  - how many days it has been running (strongest signal)
//   variants   - how many copies/variations of the creative are live (scaling)
//   reach      - EU/UK reach disclosed under the DSA (only exists for EU/UK ads)
//   active     - still running today
//   platforms  - running on several placements (FB, IG, Messenger, Audience Network)
//   video      - video creatives are what a reels-style feed is for
//
// Signals that are missing for an ad are skipped and the score is renormalised,
// so an ad without reach data is not punished for it.

export const DEFAULTS = {
  minDays: 14, // hard gate: anything that died faster than this is not a winner
  minScore: 70, // 0-100 threshold for the "winners only" feed
  maxPerPage: 3, // diversity: at most this many ads from one advertiser
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function daysBetween(a, b = new Date()) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

export function scoreAd(ad, opts = {}) {
  const { minDays } = { ...DEFAULTS, ...opts };
  const days =
    ad.daysRunning ??
    (ad.startDate ? daysBetween(ad.startDate, ad.endDate || new Date()) : null);

  const parts = []; // { key, weight, value (0-1), label }

  if (days != null) {
    // log curve to one year: 30d ~ 0.58, 90d ~ 0.77, 180d ~ 0.89, 365d = 1
    parts.push({
      key: "longevity",
      weight: 45,
      value: clamp01(Math.log(1 + days) / Math.log(1 + 365)),
      label: `Running ${days} days`,
    });
  }
  if (ad.variants != null) {
    parts.push({
      key: "variants",
      weight: 20,
      value: clamp01(Math.log2(Math.max(1, ad.variants)) / 3), // 1 = no variants, 8+ = fully scaled
      label: `${ad.variants} live variant${ad.variants === 1 ? "" : "s"}`,
    });
  }
  if (ad.impressionRank != null) {
    // Position in Meta's own "sort by impressions" results for the keyword (0 = top).
    // Meta hides the numbers for US ads but still sorts by them, so the order is real signal.
    parts.push({
      key: "impressions",
      weight: 25,
      value: clamp01(1 - ad.impressionRank),
      label: `Top ${Math.max(1, Math.ceil(ad.impressionRank * 100))}% by Meta impressions`,
    });
  }
  if (ad.euReach != null && ad.euReach > 0) {
    parts.push({
      key: "reach",
      weight: 20,
      value: clamp01(Math.log10(ad.euReach) / 6), // 1M reach = full marks
      label: `${compact(ad.euReach)} EU reach`,
    });
  }
  parts.push({
    key: "active",
    weight: 5,
    value: ad.active ? 1 : 0,
    label: ad.active ? "Still active" : "Stopped",
  });
  if (ad.platforms?.length) {
    parts.push({
      key: "platforms",
      weight: 5,
      value: clamp01(ad.platforms.length / 3),
      label: `${ad.platforms.length} placement${ad.platforms.length === 1 ? "" : "s"}`,
    });
  }
  parts.push({
    key: "video",
    weight: 5,
    value: ad.mediaType === "VIDEO" ? 1 : 0,
    label: ad.mediaType === "VIDEO" ? "Video creative" : "Static creative",
  });

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const raw = parts.reduce((s, p) => s + p.weight * p.value, 0);
  const score = Math.round((raw / totalWeight) * 100);

  // Confidence: how many of the strong signals we actually had.
  const strong = ["longevity", "variants", "reach", "impressions"].filter((k) =>
    parts.some((p) => p.key === k)
  ).length;
  const confidence = strong >= 3 ? "high" : strong === 2 ? "medium" : "low";

  const gated = days != null && days < minDays;
  // Only survival time to go on: can't claim elite status.
  const capped = confidence === "low" ? Math.min(score, 74) : score;
  return {
    score: gated ? Math.min(capped, 39) : capped,
    confidence,
    daysRunning: days,
    signals: parts
      .filter((p) => p.key !== "video" && p.key !== "platforms")
      .map((p) => ({ key: p.key, label: p.label, strength: +p.value.toFixed(2) })),
    gated,
  };
}

export function compact(n) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

const norm = (t) => (t || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);

export function rankAds(ads, opts = {}) {
  const { minScore, maxPerPage } = { ...DEFAULTS, ...opts };
  const ranked = ads
    .map((ad) => ({ ...ad, winner: scoreAd(ad, opts) }))
    .filter((ad) => ad.winner.score >= minScore)
    .sort((a, b) => b.winner.score - a.winner.score);
  // Same advertiser often runs the identical creative as many separate ads, and one big brand
  // can fill a whole feed. Drop exact repeats and cap how many a single page gets.
  const seen = new Set();
  const perPage = new Map();
  return ranked.filter((ad) => {
    const page = ad.pageId || ad.pageName || "?";
    const key = `${page}|${norm(ad.text || ad.headline)}|${ad.videoUrl ? "v" : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const n = (perPage.get(page) || 0) + 1;
    perPage.set(page, n);
    return n <= maxPerPage;
  });
}
