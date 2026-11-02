// Rebuilds questdata.js (QUESTDATA: every task with its briefing, debriefing and objects) for quests.html from
// gzwtacmap.com's task pages. Needs Node 18+ and nothing else. Run it after build-data.mjs: the objects' map positions
// come from data.js.
//
//   node tools/build-quests.mjs              write questdata.js next to quests.html
//   node tools/build-quests.mjs --dry-run    fetch and report what would change, write nothing
//
// A task page that fails to load keeps its task from the previous questdata.js.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, pageData } from "./site.mjs";

const MAP = "lamang",
  ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."),
  OUT = join(ROOT, "questdata.js"),
  DRY = process.argv.includes("--dry-run");
const log = (...a) => console.log(...a);
/* a generated file's `const NAME={...};` line */
const grab = (file, name) => {
  if (!existsSync(file)) return null;
  const m = readFileSync(file, "utf8").match(new RegExp(`^const ${name}=(.*);$`, "m"));
  return m ? JSON.parse(m[1]) : null;
};

const DATA = grab(join(ROOT, "data.js"), "DATA"),
  KEYDB = grab(join(ROOT, "data.js"), "KEYDB");
if (!DATA || !KEYDB) throw new Error("data.js not found: run tools/build-data.mjs first");
/* marker id -> [lat, lng], from data.js */
const pos = new Map(DATA.marks.filter((m) => m[6] != null).map((m) => [m[6], [m[1], m[2]]]));
const old = new Map((grab(OUT, "QUESTDATA")?.tasks || []).map((q) => [q.id, q]));
/* the small maps' landmarks, from data.js: landing zones, COPs (named without "Outpost", as on the planner) and POI names */
const copType = DATA.types.findIndex((t) => t.name === "COP"),
  poiTypes = new Set(DATA.types.flatMap((t, i) => (t.group === "Points of interest" ? [i] : []))),
  layers = {
    lz: DATA.lz.map((l) => [l[0], l[1], l[2]]),
    cops: DATA.marks.filter((m) => m[0] === copType).map((m) => [m[1], m[2], m[3].replace(/^Outpost\s+/i, "")]),
    pois: DATA.marks.filter((m) => poiTypes.has(m[0])).map((m) => [m[1], m[2], m[3]]),
    icons: { lz: DATA.icons.landingZone || "", cop: DATA.icons[DATA.types[copType]?.icon] || "" },
  };

log("task list…");
const list = (await pageData(`/maps/${MAP}/tasks`, "tasksData")).tasksData;
log(`  ${list.length} tasks\ntask pages…`);
let failed = 0;
const pages = await pool(list, 6, async (k) => {
  try {
    return (await pageData(`/maps/${MAP}/tasks/${k.slug}`, "task")).task;
  } catch {
    failed++;
    return null;
  }
});
/* which key opens a locked objective: the doors in its marker page's unlock requirements, and their keys. Asked for the
   objectives marked as locked doors and for every objective of a task that needs a key */
const locked = [
  ...new Set(
    list.flatMap((k, i) => (pages[i]?.markers || []).filter((m) => m.isLockedDoor || k.isKeyRequired).map((m) => m.id)),
  ),
];
log(`locks of ${locked.length} objectives…`);
const keyOf = new Map();
let lockFailed = 0;
await pool(locked, 6, async (id) => {
  try {
    const m = (await pageData(`/maps/${MAP}/place/${id}`, "marker")).marker,
      keys = [...new Set((m.unlockRequirements || []).flatMap((u) => (u.keyLocked || []).map((k) => k.name.trim())))];
    if (keys.length) keyOf.set(id, keys.join(", "));
  } catch {
    lockFailed++;
  }
});
/* the site keeps line breaks in the texts as a backslash and an n */
const text = (s) =>
  (s || "")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const tasks = list.map((k, i) => {
  const d = pages[i];
  if (!d && old.has(k.id)) return old.get(k.id);
  const objs = ((d && d.markers) || k.markers || []).map((m) => {
    const p = pos.get(m.id);
    return [
      m.id,
      (m.name || "").trim(),
      m.step ?? null,
      p ? p[0] : null,
      p ? p[1] : null,
      (m.preview || "").replace(/^https:\/\/static\.gzwtacmap\.com\/markers\//, ""),
      m.isLockedDoor || keyOf.has(m.id) ? 1 : 0,
      keyOf.get(m.id) || "",
    ];
  });
  return {
    id: k.id,
    name: k.name.trim(),
    slug: k.slug,
    type: k.type || "",
    vendor: k.vendor || "",
    loc: k.location || "",
    ver: k.updated_to ?? null,
    keyed: !!k.isKeyRequired,
    choice: k.choice_related ?? null,
    hidden: !!(d && d.is_hidden),
    brief: text(d && d.briefing),
    debrief: text(d && d.debriefing),
    objs,
  };
});

/* objectives in step order (the site lists some as 2, 3, 1); the same step keeps the site's order, no step goes last */
for (const q of tasks) q.objs.sort((a, b) => (a[2] == null) - (b[2] == null) || (a[2] ?? 0) - (b[2] ?? 0));
/* The same job at several places: a run of steps with the same number of objectives each (Secret Compassion: supplies,
   then a box, at three houses) goes place by place, each objective after the nearest one of the step before, so the
   numbers that sit together on the map follow on (1 → 2 at one house, 3 → 4 at the next) */
const dist = (a, b) => Math.hypot(a[3] - b[3], a[4] - b[4]);
function byPlace(objs) {
  const steps = [],
    out = [];
  for (const o of objs) {
    const s = steps[steps.length - 1];
    if (s && o[2] != null && s.step === o[2]) s.list.push(o);
    else steps.push({ step: o[2], list: [o] });
  }
  const placed = (s) => s.step != null && s.list.every((o) => o[3] != null);
  for (let i = 0; i < steps.length; ) {
    const k = steps[i].list.length;
    let j = i + 1;
    if (k > 1 && placed(steps[i])) while (j < steps.length && steps[j].list.length === k && placed(steps[j])) j++;
    if (j - i < 2) {
      out.push(...steps[i].list);
      i++;
      continue;
    }
    /* each place a chain, grown a step at a time by the closest pairs first */
    const chains = steps[i].list.map((o) => [o]);
    for (let s = i + 1; s < j; s++) {
      const pairs = [],
        cUsed = new Set(),
        oUsed = new Set();
      chains.forEach((c, ci) => steps[s].list.forEach((o, oi) => pairs.push([dist(c[c.length - 1], o), ci, oi])));
      pairs.sort((a, b) => a[0] - b[0]);
      for (const [, ci, oi] of pairs)
        if (!cUsed.has(ci) && !oUsed.has(oi)) {
          chains[ci].push(steps[s].list[oi]);
          cUsed.add(ci);
          oUsed.add(oi);
        }
    }
    for (const c of chains) out.push(...c);
    i = j;
  }
  return out;
}
for (const q of tasks) q.objs = byPlace(q.objs);

/* one spelling per location, the most used one: the site has "Hunter's Paradise" next to "Hunters Paradise" */
const locKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ""),
  spellings = new Map();
for (const q of tasks)
  if (q.loc) {
    const m = spellings.get(locKey(q.loc)) || spellings.set(locKey(q.loc), new Map()).get(locKey(q.loc));
    m.set(q.loc, (m.get(q.loc) || 0) + 1);
  }
for (const q of tasks) if (q.loc) q.loc = [...spellings.get(locKey(q.loc))].sort((a, b) => b[1] - a[1])[0][0];

const objs = tasks.flatMap((q) => q.objs),
  placed = objs.filter((o) => o[3] != null).length,
  added = tasks.filter((q) => !old.has(q.id)).map((q) => q.name),
  gone = [...old.values()].filter((q) => !tasks.some((t) => t.id === q.id)).map((q) => q.name);
log(
  `\n${tasks.length} tasks (was ${old.size || "–"}), ${objs.length} objects, ${placed} of them on the map, ` +
    `${tasks.filter((q) => !q.brief).length} without a briefing, ${objs.filter((o) => o[7]).length} behind a known key`,
);
if (old.size && added.length) log("new:", added.join(", "));
if (old.size && gone.length) log("gone:", gone.join(", "));
if (lockFailed) log(`${lockFailed} objective page(s) failed; their keys were left out`);
if (failed) log(`${failed} task page(s) failed; kept from the previous questdata.js where there was one`);
if (tasks.length < 100) {
  console.error(`Refusing to write questdata.js: only ${tasks.length} tasks`);
  process.exit(1);
}
if (DRY) {
  log("\n--dry-run: nothing written");
  process.exit(0);
}
writeFileSync(
  OUT,
  `/* Tasks from gzwtacmap.com, fetched ${new Date().toISOString().slice(0, 10)}, for quests.html. Generated by tools/build-quests.mjs; do not edit by hand.\n` +
    `   QUESTDATA.tasks: {id, name, slug, type (main, side, contract, ltc), vendor, loc, ver (game update), keyed (needs a key),\n` +
    `   choice (id of the task it is an either-or with), hidden, brief, debrief,\n` +
    `   objs: [[marker id, name, step, lat, lng (null: not on the map), photo under static.gzwtacmap.com/markers/, locked door,\n` +
    `   key(s) that open it]]}; QUESTDATA.keys: [[short name, long name]], every key, for the editor;\n` +
    `   QUESTDATA.map: the small maps' landing zones, COPs and POI names ([[lat, lng, name]]) and the LZ and COP icons */\n` +
    `const QUESTDATA=${JSON.stringify({ tasks, keys: KEYDB.keys.map((k) => [k[0], k[1]]), map: layers })};\n`,
);
log(`\nwrote ${OUT}`);
