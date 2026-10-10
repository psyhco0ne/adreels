// Build the static site into dist/ (no server needed to host it).
//   node build.mjs
// Uses data/ads.json if it exists (real ingested ads), otherwise the demo ads.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromDemo } from "./lib/sources.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(here, "public"), dist, { recursive: true });
await cp(path.join(here, "lib", "scoring.js"), path.join(dist, "scoring.js"));

let ads, source;
try {
  ads = JSON.parse(await readFile(path.join(here, "data", "ads.json"), "utf8"));
  source = "Meta Ad Library";
} catch {
  ads = await fromDemo();
  source = "demo data";
}
await writeFile(path.join(dist, "ads.json"), JSON.stringify({ source, builtAt: new Date().toISOString(), ads }));
console.log(`dist/ ready: ${ads.length} ads (${source})`);
