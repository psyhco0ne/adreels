import { rankAds } from "./scoring.js";

const feed = document.getElementById("feed");
const empty = document.getElementById("empty");
const hint = document.getElementById("hint");
const panel = document.getElementById("panel");

const state = { hideSeen: true, showExpired: true, minScore: 70, minDays: 14, format: "all", q: "", offset: 0, total: 0, loading: false, muted: true };
let saved;
try { saved = new Set(JSON.parse(localStorage.getItem("adreels.saved") || "[]")); } catch { saved = new Set(); }
// Ads you have actually looked at (2s on screen). Stored per device in this browser.
let seen;
try { seen = new Set(JSON.parse(localStorage.getItem("adreels.seen") || "[]")); } catch { seen = new Set(); }
const saveSeen = () => { try { localStorage.setItem("adreels.seen", JSON.stringify([...seen].slice(-5000))); } catch {} };
const seenTimers = new Map();

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};

const safeUrl = (u) => {
  if (!u) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return url.protocol.startsWith("http") ? url.href : null;
  } catch { return null; }
};

function scoreRing(score) {
  const r = 22, c = 2 * Math.PI * r;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 52 52");
  for (const [stroke, dash] of [["rgba(255,255,255,.18)", 0], ["var(--accent)", c * (1 - score / 100)]]) {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", 26); circle.setAttribute("cy", 26); circle.setAttribute("r", r);
    circle.setAttribute("fill", "none"); circle.setAttribute("stroke-width", 4);
    circle.setAttribute("stroke", stroke); circle.setAttribute("stroke-linecap", "round");
    circle.setAttribute("stroke-dasharray", c); circle.setAttribute("stroke-dashoffset", dash);
    svg.append(circle);
  }
  return svg;
}

// Facebook video links are signed and stop working about 4-5 days after they were scraped.
// The expiry time is inside the link itself (the "oe" value, hex unix seconds).
function videoGone(ad) {
  const m = ad.videoUrl && ad.videoUrl.match(/[?&]oe=([0-9a-f]+)/i);
  return !!m && parseInt(m[1], 16) * 1000 < Date.now() + 3600e3;
}

function expiredCard(ad) {
  let h = 0;
  for (const c of ad.pageName || "x") h = (h * 31 + c.charCodeAt(0)) % 360;
  return el("div", { class: "fallback", style: { background: `radial-gradient(120% 80% at 20% 0%, hsl(${h} 45% 28% / .6), transparent 60%), hsl(${h} 30% 10%)` } },
    el("span", { class: "tag", style: { color: `hsl(${h} 70% 75%)` } }, "Video link expired"),
    el("div", { class: "big" }, ad.headline || (ad.text || "").slice(0, 90)),
    el("a", { class: "cta", href: ad.libraryUrl, target: "_blank", rel: "noopener noreferrer", style: { alignSelf: "flex-start" } }, "Watch in Ad Library ↗")
  );
}

function mediaFor(ad) {
  if (ad.videoUrl && videoGone(ad)) return expiredCard(ad);
  if (ad.videoUrl) {
    const v = el("video", { src: ad.videoUrl, poster: ad.posterUrl || null, loop: true, playsinline: true, preload: "metadata" });
    v.muted = state.muted;
    v.addEventListener("error", () => { const box = v.parentElement; if (box) box.replaceChildren(expiredCard(ad)); }, { once: true });
    return v;
  }
  if (ad.imageUrl) return el("img", { src: ad.imageUrl, alt: "", loading: "lazy" });
  const [a, b] = ad.palette || ["#1d2230", "#7c8cff"];
  return el("div", { class: "fallback", style: { background: `radial-gradient(120% 80% at 20% 0%, ${b}55, transparent 60%), ${a}` } },
    ad.demo ? el("span", { class: "demo" }, "demo creative") : null,
    el("span", { class: "tag", style: { color: b } }, ad.vertical || ad.mediaType.toLowerCase()),
    el("div", { class: "big" }, ad.headline || ad.text.slice(0, 80))
  );
}

function slide(ad) {
  const w = ad.winner;
  const landing = safeUrl(ad.landingUrl);
  const isDemo = ad.demo;
  const whyBox = el("div", { class: "why", hidden: true },
    el("h4", {}, "Why it's a winner"),
    w.signals.map((s) => el("div", {}, s.label, el("div", { class: "bar" }, el("i", { style: { width: `${Math.round(s.strength * 100)}%` } })))),
    el("div", { class: "conf" }, `Confidence: ${w.confidence}. Inferred from survival signals, not real ROAS.`)
  );

  const copyEl = el("div", { class: "copy", onclick: (e) => e.currentTarget.classList.toggle("open") }, ad.text);
  const saveBtn = el("button", { class: `rbtn ${saved.has(ad.id) ? "on" : ""}`, "aria-label": "Save",
    onclick: (e) => {
      const b = e.currentTarget;
      saved.has(ad.id) ? saved.delete(ad.id) : saved.add(ad.id);
      try { localStorage.setItem("adreels.saved", JSON.stringify([...saved])); } catch {}
      b.classList.toggle("on", saved.has(ad.id));
    } }, el("span", { class: "c" }, "★"), "Save");

  return el("section", { class: "slide", "data-id": ad.id },
    el("div", { class: "media" }, mediaFor(ad)),
    el("div", { class: "shade" }),
    el("div", { class: "info" },
      el("div", { class: "who" },
        el("span", { class: "dot" }, (ad.pageName || "?")[0].toUpperCase()),
        ad.pageName,
        w.daysRunning != null ? el("span", { class: "days" }, `${w.daysRunning}d live`) : null),
      ad.headline && !ad.demo ? el("div", { style: { fontWeight: 700 } }, ad.headline) : null,
      copyEl,
      el("a", { class: "cta", href: landing && !isDemo ? landing : "#", target: "_blank", rel: "noopener noreferrer",
        "aria-disabled": landing && !isDemo ? "false" : "true" }, ad.cta || "Visit site", " ↗"),
      ad.landingUrl ? el("div", { class: "domain" }, ad.landingUrl.replace(/^https?:\/\//, "").slice(0, 40)) : null),
    whyBox,
    el("div", { class: "rail" },
      el("button", { class: "score", "aria-label": `Winner score ${w.score}`, onclick: () => (whyBox.hidden = !whyBox.hidden) },
        scoreRing(w.score), el("span", { class: "num" }, w.score)),
      saveBtn,
      isDemo ? null : el("a", { class: "rbtn", href: ad.libraryUrl, target: "_blank", rel: "noopener noreferrer" },
        el("span", { class: "c" }, "↗"), "Library"))
  );
}

const muteBtn = document.getElementById("muteBtn");
function setMuted(m) {
  state.muted = m;
  muteBtn.textContent = m ? "🔇" : "🔊";
  feed.querySelectorAll("video").forEach((v) => (v.muted = m));
}
// Must run inside the tap itself: iOS only allows sound when play() follows a user gesture.
function toggleSound() {
  setMuted(!state.muted);
  if (!state.muted) {
    const vis = [...feed.querySelectorAll(".slide")].find((s) => { const r = s.getBoundingClientRect(); return r.top > -r.height / 2 && r.top < r.height / 2; });
    const v = vis && vis.querySelector("video");
    if (v) v.play().catch(() => { setMuted(true); });
  }
}
muteBtn.addEventListener("click", toggleSound);
feed.addEventListener("click", (e) => { if (e.target.tagName === "VIDEO") toggleSound(); });

// play only the visible video
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const id = e.target.dataset.id;
    const onScreen = e.isIntersecting && e.intersectionRatio > 0.6;
    if (onScreen && id && !seen.has(id) && !seenTimers.has(id))
      seenTimers.set(id, setTimeout(() => { seen.add(id); saveSeen(); seenTimers.delete(id); }, 2000));
    if (!onScreen && seenTimers.has(id)) { clearTimeout(seenTimers.get(id)); seenTimers.delete(id); }
    const v = e.target.querySelector("video");
    if (!v) continue;
    if (onScreen) {
      v.muted = state.muted;
      // iOS blocks unmuted autoplay unless it follows a tap; fall back to muted and show it.
      v.play().catch(() => { v.muted = true; setMuted(true); v.play().catch(() => {}); });
    }
    else v.pause();
  }
  const last = feed.lastElementChild;
  if (last && entries.some((e) => e.target === last && e.isIntersecting)) load();
}, { root: feed, threshold: [0, 0.6] });

// Local server exposes /api/ads. On static hosting there is no API, so fall back to
// ads.json (written by build.mjs) and rank in the browser with the same scoring code.
let staticAds = null;
async function getAds(p) {
  try {
    const res = await fetch(`api/ads?${p}`);
    if (res.ok && (res.headers.get("content-type") || "").includes("json")) return await res.json();
  } catch {}
  staticAds ??= await (await fetch(`ads.json?t=${Date.now()}`, { cache: "no-store" })).json();
  const q = Object.fromEntries(p);
  // Catalog ads carry unfilled "{{product.name}}" templates; drop those so real copy shows instead.
  for (const a of staticAds.ads) if (/\{\{.*\}\}/.test(a.headline || "")) a.headline = "";
  let ranked = rankAds(staticAds.ads, { minScore: +q.minScore, minDays: +q.minDays });
  if (q.format === "video") ranked = ranked.filter((a) => a.mediaType === "VIDEO");
  if (q.format === "image") ranked = ranked.filter((a) => a.mediaType === "IMAGE");
  const unseenTotal = ranked.filter((a) => !seen.has(a.id)).length;
  if (state.hideSeen) ranked = ranked.filter((a) => !seen.has(a.id));
  // Playable videos first; ads whose video link expired go to the end (or are hidden).
  const live = ranked.filter((a) => !videoGone(a));
  ranked = state.showExpired ? [...live, ...ranked.filter(videoGone)] : live;
  const t = (q.q || "").toLowerCase();
  if (t) ranked = ranked.filter((a) => [a.pageName, a.headline, a.text, a.vertical].join(" ").toLowerCase().includes(t));
  const off = +q.offset || 0, lim = +q.limit || 10;
  const when = staticAds.builtAt ? `, updated ${new Date(staticAds.builtAt).toLocaleDateString()}` : "";
  return { source: `${staticAds.source}${when}`, total: ranked.length, scanned: staticAds.ads.length, unseenTotal, ads: ranked.slice(off, off + lim) };
}

async function load(reset = false) {
  if (state.loading) return;
  if (reset) { state.offset = 0; feed.replaceChildren(); }
  else if (state.offset >= state.total && state.total) return;
  state.loading = true;
  const p = new URLSearchParams({ minScore: state.minScore, minDays: state.minDays, format: state.format, q: state.q, offset: state.offset, limit: 10 });
  const data = await getAds(p);
  state.total = data.total;
  state.offset += data.ads.length;
  for (const ad of data.ads) { const s = slide(ad); feed.append(s); io.observe(s); }
  empty.hidden = feed.children.length > 0;
  const allSeen = !feed.children.length && state.hideSeen && (data.unseenTotal === 0);
  document.getElementById("emptyMsg").textContent = allSeen ? "You've seen every winner for now." : "No ads clear that bar.";
  document.getElementById("emptyHint").textContent = allSeen ? "New ones arrive with the next refresh." : "Lower the tier or the minimum days.";
  document.getElementById("srcLine").textContent =
    `${data.total} ads in this view, ${data.scanned} scanned in total. Source: ${data.source}.`;
  state.loading = false;
}

// controls
document.getElementById("tier").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  document.querySelectorAll("#tier .chip").forEach((c) => c.classList.toggle("on", c === b));
  state.minScore = +b.dataset.min; load(true);
});
document.getElementById("filterBtn").onclick = () => (panel.hidden = !panel.hidden);
document.getElementById("apply").onclick = () => {
  state.format = document.getElementById("format").value;
  state.minDays = +document.getElementById("minDays").value || 0;
  state.q = document.getElementById("q").value.trim();
  state.hideSeen = document.getElementById("hideSeen").checked;
  state.showExpired = document.getElementById("showExpired").checked;
  panel.hidden = true; load(true);
};
document.getElementById("resetSeen").onclick = () => {
  seen.clear(); saveSeen(); panel.hidden = true; load(true);
};
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select")) return;
  if (e.key === "ArrowDown" || e.key === "j") feed.scrollBy({ top: feed.clientHeight, behavior: "smooth" });
  if (e.key === "ArrowUp" || e.key === "k") feed.scrollBy({ top: -feed.clientHeight, behavior: "smooth" });
  if (e.key.toLowerCase() === "m") {
    toggleSound();
  }
});
feed.addEventListener("scroll", () => hint.classList.add("gone"), { once: true });

load(true);
