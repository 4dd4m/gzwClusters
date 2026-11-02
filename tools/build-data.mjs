// Rebuilds data.js (DATA: marker types, markers, landing zones, bases, area labels, icons, photos; KEYDB: keys)
// from gzwtacmap.com's live data. Needs Node 18+ and nothing else.
//
//   node tools/build-data.mjs              write data.js next to index.html
//   node tools/build-data.mjs --dry-run    fetch and report what would change, write nothing
//   node tools/build-data.mjs --all-photos also re-check photos of markers already known (one request per marker, slow)
//
// Photos: the marker list has none, each marker's own page does. Photos already in data.js are kept and only new
// markers are looked up, unless --all-photos. Keys renamed on the site (matched by key id) are recorded in
// KEYDB.renamed so the page can carry over the user's saved keys.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unflatten } from "./devalue.mjs";
import { SITE, get, pool, pageData } from "./site.mjs";

const MAP = "lamang",
  ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."),
  OUT = join(ROOT, "data.js"),
  args = new Set(process.argv.slice(2)),
  DRY = args.has("--dry-run"),
  ALL_PHOTOS = args.has("--all-photos");
/* nav items that are not marker types: landing zones, operation bases, empty "Place of Interest", area labels (H1),
   and sub-POI labels, which become one type per POI name instead */
const NAV_LZ = 1,
  NAV_OB = 2,
  NAV_SUBPOI = 4,
  NAV_AREA = 37,
  NAV_SKIP = new Set([1, 2, 4, 5, 37]);

const r1 = (v) => Math.round(v * 10) / 10;
const log = (...a) => console.log(...a);
/* The marker list comes from a SvelteKit remote function whose URL has a build hash that changes on every deploy.
   Find it by walking the site's JS modules from the page's entry scripts. */
async function remoteHash() {
  const html = await get(`${SITE}/maps/${MAP}`, "text");
  const queue = [...html.matchAll(/["'(](\.{0,2}\/?_app\/immutable\/entry\/[\w.-]+\.js)/g)].map(
    (m) => new URL(m[1].replace(/^\.\.?\//, "/"), SITE).href,
  );
  const seen = new Set();
  while (queue.length && seen.size < 400) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let js;
    try {
      js = await get(url, "text", 2);
    } catch {
      continue;
    }
    const m = js.match(/[`"']([a-z0-9]+)\/fetchMapMarkers[`"']/);
    if (m) return m[1];
    for (const i of js.matchAll(/["'`](\.{1,2}\/[^"'`\s]+?\.js)["'`]/g)) queue.push(new URL(i[1], url).href);
  }
  throw new Error("fetchMapMarkers not found in the site's scripts");
}
const dataUri = async (url) => {
  const r = await get(url, "raw"),
    buf = Buffer.from(await r.arrayBuffer());
  return {
    uri: `data:${(r.headers.get("content-type") || "image/png").split(";")[0]};base64,${buf.toString("base64")}`,
    hash: createHash("md5").update(buf).digest("hex"),
  };
};
/* the previous data.js, if any: photos and key renames carry over, and the report compares against it */
function previous() {
  if (!existsSync(OUT)) return { DATA: null, KEYDB: null };
  const src = readFileSync(OUT, "utf8"),
    grab = (name) => {
      const m = src.match(new RegExp(`^const ${name}=(.*);$`, "m"));
      return m ? JSON.parse(m[1]) : null;
    };
  return { DATA: grab("DATA"), KEYDB: grab("KEYDB") };
}

const old = previous();
log("map page…");
const mapPage = await pageData(`/maps/${MAP}`, "mapData"),
  mapId = mapPage.mapData.id;
const sidebar = (await pageData(`/maps/${MAP}`, "sidebarData")).sidebarData;
const navItems = [];
for (const [cat, subs] of Object.entries(sidebar))
  for (const items of Object.values(subs)) for (const it of items) navItems.push({ id: it.id, name: it.name, cat });
log("remote function hash…");
const hash = await remoteHash();
log("  ", hash, "\nmarkers…");
const payload = Buffer.from(JSON.stringify([{ mapUrl: 1, mapId: 2 }, MAP, mapId])).toString("base64url");
const res = await get(`${SITE}/_app/remote/${hash}/fetchMapMarkers?payload=${payload}`);
if (res.type !== "result") throw new Error("fetchMapMarkers: unexpected response " + JSON.stringify(res).slice(0, 200));
const live = unflatten(JSON.parse(res.data))._;
const byNav = new Map(Object.entries(live.markers).map(([k, g]) => [+k, g.markersArray]));
const tasks = Object.values(live.taskMarkers).flatMap((g) => g.markersArray);
const poiName = new Map();
for (const list of byNav.values())
  for (const m of list) if (m.poi && m.poi.id != null) poiName.set(m.poi.id, m.poi.name);
const sectorOf = (m) => (m.poi && typeof m.poi === "object" ? m.poi.name : poiName.get(m.poi)) || "";

/* ---------- types and marks ---------- */
const oldType = new Map((old.DATA?.types || []).map((t) => [t.id, t]));
const modeIcon = (list) => {
  const c = new Map();
  for (const m of list) c.set(m.icon, (c.get(m.icon) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0][0];
};
const types = [],
  marks = [];
const addType = (id, name, group, list, label) => {
  const t = types.length;
  types.push({ id, name, group, n: list.length, icon: modeIcon(list) });
  for (const m of list) marks.push([t, r1(m.lat), r1(m.lng), label(m), sectorOf(m), m.icon, m.id]);
};
for (const it of navItems) {
  const list = byNav.get(it.id);
  if (NAV_SKIP.has(it.id) || !list || !list.length) continue;
  /* group: kept from the previous build (Building Material Crate is filed under "0.5" on the site but is a container) */
  const group = oldType.get(String(it.id))?.group || (it.cat === "containers" ? "Containers" : "General");
  addType(String(it.id), it.name, group, list, (m) => m.name);
}
const pois = new Map();
/* one type per POI name; the site has stray trailing spaces and case differences ("Riverside Shack ", "Dumping ground") */
for (const m of byNav.get(NAV_SUBPOI) || []) {
  const k = m.name.trim().toLowerCase();
  (pois.get(k) || pois.set(k, []).get(k)).push(m);
}
for (const [k, list] of pois)
  addType("poi-" + k, list[0].name.trim(), "Points of interest", list, (m) => m.name.trim());
const vendors = new Map();
for (const m of tasks) {
  const v = m.taskData?.vendor || "Other";
  (vendors.get(v) || vendors.set(v, []).get(v)).push(m);
}
for (const [v, list] of [...vendors].sort((a, b) => a[0].localeCompare(b[0])))
  addType("task-" + v, v, "Task objectives", list, (m) => `${m.taskData?.name}: ${m.name}`);

const lz = (byNav.get(NAV_LZ) || []).map((m) => [
  r1(m.lat),
  r1(m.lng),
  m.tooltip || m.name.replace(/^Landing Zone\s*-\s*/i, ""),
  sectorOf(m),
]);
const ob = (byNav.get(NAV_OB) || []).map((m) => [r1(m.lat), r1(m.lng)]);
const areas = (byNav.get(NAV_AREA) || []).map((m) => [r1(m.lat), r1(m.lng), m.name]);

/* ---------- icons ---------- */
log("icons…");
const iconList = await get(`${SITE}/api/icons`),
  iconPath = new Map(iconList.map((i) => [i.name, i.path]));
const used = new Set([
  ...marks.map((m) => m[5]),
  ...types.map((t) => t.icon),
  "landingZone",
  "operationBase",
  "locked",
  "coded",
  "key",
]);
const icons = {},
  missingIcons = [];
await pool([...used].filter(Boolean).sort(), 6, async (name) => {
  const p = iconPath.get(name);
  if (!p) {
    missingIcons.push(name);
    if (old.DATA?.icons?.[name]) icons[name] = old.DATA.icons[name];
    return;
  }
  try {
    icons[name] = (await dataUri(p)).uri;
  } catch (e) {
    missingIcons.push(name);
    if (old.DATA?.icons?.[name]) icons[name] = old.DATA.icons[name];
  }
});

/* ---------- photos ---------- */
const ids = [...new Set(marks.map((m) => m[6]).filter((id) => id != null))];
const knownIds = new Set((old.DATA?.marks || []).map((m) => m[6]).filter((id) => id != null));
const photos = {};
for (const id of ids) if (old.DATA?.photos?.[id] && !ALL_PHOTOS) photos[id] = old.DATA.photos[id];
const look = ALL_PHOTOS ? ids : ids.filter((id) => !knownIds.has(id));
log(`photos: kept ${Object.keys(photos).length}, looking up ${look.length} marker page(s)…`);
let photoErrors = 0;
await pool(look, 6, async (id) => {
  try {
    const m = (await pageData(`/maps/${MAP}/place/${id}`, "marker")).marker,
      img = (m.images || []).find((i) => i.isMain) || (m.images || [])[0];
    if (img && img.url) photos[id] = img.url.replace(/^https:\/\/static\.gzwtacmap\.com\/markers\//, "");
    else delete photos[id];
  } catch {
    photoErrors++;
  }
});

/* ---------- keys ---------- */
log("keys…");
const keyList = (await pageData(`/maps/${MAP}/keys`, "keysData")).keysData;
const details = await pool(keyList, 6, async (k) => (await pageData(`/maps/${MAP}/keys/${k.slug}`, "keyData")).keyData);
/* where each key's lock is: every marker that names the key */
const locks = new Map();
for (const list of byNav.values())
  for (const m of list)
    for (const k of m.key || []) (locks.get(k.entity_id) || locks.set(k.entity_id, []).get(k.entity_id)).push(m);
const keyImg = [],
  imgByHash = new Map();
const keyEntries = await pool(details, 6, async (d, i) => {
  const k = keyList[i];
  let img = -1;
  if (d.src) {
    try {
      const { uri, hash } = await dataUri(d.src);
      img = imgByHash.has(hash)
        ? imgByHash.get(hash)
        : (keyImg.push(uri), imgByHash.set(hash, keyImg.length - 1), keyImg.length - 1);
    } catch {
      img = -1;
    }
  }
  const at = (locks.get(k.id) || []).map((m) => [r1(m.lng), r1(m.lat), m.name, m.id]);
  return [
    d.short_name || k.short_name,
    d.long_name || k.long_name || "",
    (k.poi && k.poi.name) || (at[0] && sectorOf((locks.get(k.id) || [])[0])) || "",
    img,
    at,
    k.id,
  ];
});
/* renames: earlier ones carry over (chained), new ones are found by key id */
const renamed = { ...(old.KEYDB?.renamed || {}) };
for (const e of old.KEYDB?.keys || []) {
  const now = e[5] != null && keyEntries.find((k) => k[5] === e[5]);
  if (now && now[0] !== e[0]) {
    for (const k in renamed) if (renamed[k] === e[0]) renamed[k] = now[0];
    renamed[e[0]] = now[0];
  }
}

/* ---------- checks and report ---------- */
const problems = [];
if (marks.length < 3000) problems.push(`only ${marks.length} markers`);
if (lz.length < 30) problems.push(`only ${lz.length} landing zones`);
if (!types.some((t) => t.name === "COP")) problems.push("no COP type");
if (keyEntries.length < 50) problems.push(`only ${keyEntries.length} keys`);
if (problems.length) {
  console.error("Refusing to write data.js:", problems.join("; "));
  process.exit(1);
}

const count = (D) => new Map((D?.types || []).map((t) => [t.id, t]));
const before = count(old.DATA),
  after = count({ types });
const changes = [];
for (const [id, t] of after) {
  const o = before.get(id);
  if (!o) changes.push(`+ ${t.name} (${t.n})`);
  else if (o.n !== t.n || o.name !== t.name)
    changes.push(`~ ${o.name}${o.name !== t.name ? " → " + t.name : ""}: ${o.n} → ${t.n}`);
}
for (const [id, o] of before) if (!after.has(id)) changes.push(`- ${o.name} (${o.n})`);
log(
  `\n${marks.length} markers in ${types.length} types (was ${old.DATA?.marks?.length ?? "–"} in ${old.DATA?.types?.length ?? "–"}), ${lz.length} LZs, ${ob.length} bases, ${areas.length} areas, ${Object.keys(icons).length} icons, ${Object.keys(photos).length} photos`,
);
log(
  `${keyEntries.length} keys (was ${old.KEYDB?.keys?.length ?? "–"}), ${keyImg.length} distinct key pictures, ${keyEntries.filter((k) => !k[4].length).length} keys without a marked lock`,
);
if (changes.length)
  log(
    "type changes:\n  " +
      changes.slice(0, 60).join("\n  ") +
      (changes.length > 60 ? `\n  … ${changes.length - 60} more` : ""),
  );
if (Object.keys(renamed).length) log("renamed keys:", JSON.stringify(renamed));
if (missingIcons.length) log("icons not on the site (kept old ones where there were):", missingIcons.join(", "));
if (photoErrors) log(`${photoErrors} marker page(s) failed; their photos were left out`);
if (DRY) {
  log("\n--dry-run: nothing written");
  process.exit(0);
}

const DATA = { photos, types, marks, lz, ob, areas, icons };
const KEYDB = { img: keyImg, keys: keyEntries, renamed };
writeFileSync(
  OUT,
  `/* Map and key data from gzwtacmap.com, fetched ${new Date().toISOString().slice(0, 10)}. Generated by tools/build-data.mjs; do not edit by hand.\n` +
    `   DATA.marks: [type index, lat (north, m), lng (east, m), label, sector, icon, marker id]\n` +
    `   KEYDB.keys: [short name, long name, sector, picture index into KEYDB.img (-1 none), [[lng, lat, lock label, marker id]], key id];\n` +
    `   KEYDB.renamed maps old short names to current ones */\n` +
    `const DATA=${JSON.stringify(DATA)};\nconst KEYDB=${JSON.stringify(KEYDB)};\n`,
);
log(`\nwrote ${OUT}`);
