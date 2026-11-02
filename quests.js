/* Quest guide: gzwtacmap's tasks (questdata.js, built by tools/build-quests.mjs) with my own tasks and guides on top
   (my-quests.js, in the repo). Edit mode (quests.html?edit, or the page opened locally) adds and edits them. Changes stay
   in this browser (text in localStorage, pictures in IndexedDB) until "Download for the repo" packs my-quests.js and the
   new pictures into a zip, to unzip into the repo and commit; once the page loads that committed file, the browser's copy
   is dropped. Visitors only read. */
const $ = (id) => document.getElementById(id);
const PHOTO = "https://static.gzwtacmap.com/markers/",
  TACMAP = "https://gzwtacmap.com/maps/lamang/tasks/",
  BASE = typeof QUESTDATA !== "undefined" ? QUESTDATA.tasks : [],
  /* every key: [short name, long name], for the editor */
  KEYS = typeof QUESTDATA !== "undefined" ? QUESTDATA.keys || [] : [],
  REPO = typeof MYQUESTS !== "undefined" ? MYQUESTS : { saved: null, entries: [] },
  EDIT = new URLSearchParams(location.search).has("edit") || /^(localhost|127\.0\.0\.1|)$/.test(location.hostname),
  DRAFTKEY = "lamang-quests-draft-v1",
  UIKEY = "lamang-quests-ui-v1",
  TITLE = document.title;
const VNAME = { LabRat: "Lab Rat" },
  vendorName = (v) => VNAME[v] || v;
/* the game's map grid square, as on the planner's ruler */
const grid = (lat, lng) => Math.floor((lng + 10000) / 100) + ", " + Math.floor((lat + 10000) / 100);
const rnd = () => Math.random().toString(36).slice(2, 8);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
/* plain text as paragraphs: an empty line starts a new one, a single line break stays; with links, web addresses link */
function paras(s, links) {
  return String(s || "")
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => {
      let h = esc(p.trim());
      if (links)
        h = h.replace(
          /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,
          (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`,
        );
      return `<p>${h.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}
/* for search: lower case, no accents, one kind of apostrophe */
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’`]/g, "'");
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
};
/* pictures added in edit mode, until they are in the repo: path -> Blob */
const IDB = (() => {
  let open;
  const db = () =>
    (open ||= new Promise((ok, no) => {
      const r = indexedDB.open("lamang-quests", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("img");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    }));
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((ok, no) => {
      const tx = d.transaction("img", mode),
        req = fn(tx.objectStore("img"));
      tx.oncomplete = () => ok(req.result);
      tx.onerror = tx.onabort = () => no(tx.error);
    });
  };
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    put: (k, v) => run("readwrite", (s) => s.put(v, k)),
    del: (k) => run("readwrite", (s) => s.delete(k)),
    clear: () => run("readwrite", (s) => s.clear()),
  };
})();

/* ---------- my entries: the repo's, or this browser's edited copy of them ---------- */
let DRAFT = EDIT ? store.get(DRAFTKEY) : null;
if (DRAFT && !Array.isArray(DRAFT.entries)) DRAFT = null;
/* the repo has the file downloaded from this copy, with no edits since: the copy is done, its pictures are in the repo */
if (DRAFT && !DRAFT.dirty && DRAFT.saved && DRAFT.saved === REPO.saved) dropDraft();
const entries = () => (DRAFT ? DRAFT.entries : REPO.entries);
function dropDraft() {
  DRAFT = null;
  store.set(DRAFTKEY, null);
  IDB.clear().catch(() => {});
}
/* entries added, changed or removed against the repo's */
function changes() {
  if (!DRAFT) return 0;
  const a = new Map(REPO.entries.map((e) => [String(e.id), JSON.stringify(e)]));
  let n = 0;
  for (const e of DRAFT.entries) if (a.get(String(e.id)) !== JSON.stringify(e)) n++;
  const b = new Set(DRAFT.entries.map((e) => String(e.id)));
  for (const k of a.keys()) if (!b.has(k)) n++;
  return n;
}
/* fn edits the entries; the copy is kept, or dropped when it no longer differs from the repo */
function edit(fn) {
  if (!DRAFT) DRAFT = { from: REPO.saved, saved: null, dirty: true, entries: structuredClone(REPO.entries) };
  fn(DRAFT.entries);
  DRAFT.dirty = true;
  if (!changes()) dropDraft();
  else if (!store.set(DRAFTKEY, DRAFT)) alert(t("q.storeFail"));
  refresh();
}

/* what an entry may change on one of gzwtacmap's tasks (a task of my own has them all): the texts, and the objectives
   ([marker id or null, name, step, lat, lng, photo, locked door], the whole list when changed) */
const TEXTS = ["name", "vendor", "loc", "type", "brief", "debrief"],
  FIELDS = [...TEXTS, "objs"];
/* an entry on a gzwtacmap task that no longer changes anything */
const idle = (e) => !e.deleted && !e.desc && !e.pics?.length && !FIELDS.some((f) => f in e);
/* every task: gzwtacmap's with my changes and guide over it, then my own */
let ALL = [];
function refresh() {
  const mine = new Map(entries().map((e) => [e.id, e]));
  ALL = BASE.map((b) => {
    const e = mine.get(b.id) || null,
      q = {
        ...b,
        key: b.slug,
        own: false,
        my: e,
        base: b,
        deleted: !!e?.deleted,
        edited: !!e && FIELDS.some((f) => f in e),
      };
    if (e) for (const f of FIELDS) if (f in e) q[f] = e[f];
    return q;
  });
  for (const e of entries())
    if (typeof e.id === "string")
      ALL.push({
        id: e.id,
        key: e.id,
        own: true,
        my: e,
        base: null,
        deleted: false,
        edited: false,
        name: e.name || "?",
        vendor: e.vendor || "",
        loc: e.loc || "",
        type: e.type || "",
        ver: null,
        keyed: false,
        choice: null,
        hidden: false,
        brief: e.brief || "",
        debrief: e.debrief || "",
        objs: e.objs || [],
      });
  for (const q of ALL) {
    /* the keys its objectives are behind; a task the site marks as needing a key may not name it */
    q.keys = [...new Set(q.objs.flatMap((o) => (o[7] ? o[7].split(/,s*/) : [])))];
    q.needsKey = q.keyed || q.keys.length > 0;
    q.hay = norm(
      [q.name, q.vendor, vendorName(q.vendor), q.loc, ...q.objs.map((o) => o[1]), ...q.keys, q.my?.desc].join(" "),
    );
  }
  renderBar();
  renderList();
  renderDetail();
}
const hasGuide = (q) => !!(q.my && (q.my.desc || q.my.pics?.length));

/* ---------- the list ---------- */
const UI = Object.assign({ group: "vendor", show: "all", closed: [] }, store.get(UIKEY) || {});
const VORDER = [...new Set(BASE.map((q) => q.vendor))];
const SHOW = {
  all: () => true,
  main: (q) => q.type === "main",
  side: (q) => q.type === "side",
  contract: (q) => q.type === "contract" || q.type === "ltc",
  mine: (q) => q.own || hasGuide(q),
  /* edit mode: the tasks deleted there, to restore */
  deleted: (q) => q.deleted,
};
if (!EDIT && UI.show === "deleted") UI.show = "all";
$("qShow").querySelector('[value="deleted"]').hidden = !EDIT;
const ICON_KEY =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="5" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h7M12.5 8v3M14.5 8v2" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>',
  ICON_GUIDE =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 2h7l3 3v9H3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 7.5h5M5.5 10.5h5" stroke="currentColor" stroke-width="1.4"/></svg>';
const typeLabel = (q) => (q.type ? t("q.type." + q.type) : "");
/* "Key needed", with the keys where the objectives name them */
const keyLine = (q) => t("q.keyed") + (q.keys.length ? ": " + q.keys.join(", ") : "");
function renderList() {
  const words = norm($("qSearch").value).split(/\s+/).filter(Boolean),
    show = SHOW[UI.show] || SHOW.all,
    hits = ALL.filter((q) => (UI.show === "deleted" || !q.deleted) && show(q) && words.every((w) => q.hay.includes(w))),
    cur = decodeURIComponent(location.hash.slice(1)),
    groups = new Map();
  for (const q of hits) {
    const g =
      UI.group === "loc"
        ? q.loc || t("q.noLoc")
        : q.vendor
          ? vendorName(q.vendor)
          : q.own
            ? t("q.myGroup")
            : t("q.noLoc");
    (groups.get(g) || groups.set(g, []).get(g)).push(q);
  }
  const rank = (g) => {
    if (UI.group === "loc") return g === t("q.noLoc") ? "~" : g;
    const i = VORDER.findIndex((v) => vendorName(v) === g);
    return i >= 0 ? String(i).padStart(3, "0") : g === t("q.myGroup") ? "~~" : "~" + g;
  };
  const order = [...groups.keys()].sort((a, b) => rank(a).localeCompare(rank(b)));
  $("qCount").textContent = t("q.count", { n: hits.length });
  $("qGroups").innerHTML = hits.length
    ? order
        .map((g) => {
          const L = groups.get(g),
            open = words.length || !UI.closed.includes(UI.group + ":" + g);
          return `<details class="qgrp" data-g="${esc(g)}"${open ? " open" : ""}><summary><span>${esc(g)}</span><small>${L.length}</small></summary><ul>${L.map(
            (q) =>
              `<li><a class="qitem" href="#${encodeURIComponent(q.key)}"${q.key === cur ? ' aria-current="true"' : ""}><span class="qname">${esc(q.name)}</span><span class="qtags">${
                q.type
                  ? `<i class="qb ${q.type === "main" ? "main" : ""}">${esc(typeLabel(q))}</i>`
                  : q.own
                    ? `<i class="qb main">${esc(t("q.mineTag"))}</i>`
                    : ""
              }${EDIT && q.edited ? `<i class="qb">${esc(t("q.edited"))}</i>` : ""}${
                q.needsKey ? `<i class="qi" title="${esc(keyLine(q))}">${ICON_KEY}</i>` : ""
              }${
                hasGuide(q) ? `<i class="qi guide" title="${esc(t("q.guideTag"))}">${ICON_GUIDE}</i>` : ""
              }</span></a></li>`,
          ).join("")}</ul></details>`;
        })
        .join("")
    : `<p class="qempty">${esc(t("q.none"))}</p>`;
}
/* a group folded by hand stays folded (per grouping), except while searching */
$("qGroups").addEventListener(
  "toggle",
  (e) => {
    const d = e.target;
    if (!d.matches(".qgrp") || norm($("qSearch").value).trim()) return;
    const k = UI.group + ":" + d.dataset.g;
    UI.closed = UI.closed.filter((x) => x !== k);
    if (!d.open) UI.closed.push(k);
    store.set(UIKEY, UI);
  },
  true,
);
$("qSearch").addEventListener("input", renderList);
$("qGroup").value = UI.group;
$("qShow").value = UI.show;
$("qGroup").onchange = $("qShow").onchange = () => {
  UI.group = $("qGroup").value;
  UI.show = $("qShow").value;
  store.set(UIKEY, UI);
  renderList();
};

/* ---------- the open task ---------- */
let DMAP = null;
const REDUCED = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/* an objective's photo: one of mine (quests/img/…, maybe only in this browser yet) or gzwtacmap's */
const ownPic = (p) => p.startsWith("quests/"),
  objImg = (p) =>
    ownPic(p)
      ? `<img data-pic="${esc(p)}" alt="" loading="lazy" />`
      : `<img src="${esc(PHOTO + p)}" alt="" loading="lazy" />`;
function renderDetail() {
  const key = decodeURIComponent(location.hash.slice(1)),
    q = ALL.find((x) => x.key === key && (EDIT || !x.deleted)),
    det = $("qDetail");
  document.body.classList.toggle("qsel", !!q);
  document
    .querySelectorAll(".qitem")
    .forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === "#" + encodeURIComponent(key)));
  if (DMAP) DMAP.destroy();
  DMAP = null;
  if (!q) {
    det.innerHTML = `<p class="qempty">${esc(t("q.pick"))}</p>`;
    document.title = TITLE;
    return;
  }
  document.title = `${q.name} – ${t("q.heading")} | Kokesz Loot Runs`;
  const my = q.my || {},
    pics = my.pics || [],
    /* objective numbers: the site's steps where they tell the objectives apart, else their order */
    steps = q.objs.map((o) => o[2]),
    useSteps = steps.every((s) => s != null) && new Set(steps).size === steps.length,
    num = (o, i) => (useSteps ? o[2] : i + 1),
    other = q.choice != null && BASE.find((x) => x.id === q.choice),
    meta = [vendorName(q.vendor), q.loc, typeLabel(q), q.ver != null ? t("q.ver", { v: q.ver }) : ""].filter(Boolean),
    flags = [
      q.needsKey && `<span class="qflag key">${ICON_KEY}${esc(keyLine(q))}</span>`,
      other &&
        `<span class="qflag">${esc(t("q.choice"))} <a href="#${encodeURIComponent(other.slug)}">${esc(other.name)}</a></span>`,
      q.hidden && `<span class="qflag">${esc(t("q.hidden"))}</span>`,
      q.own && `<span class="qflag mine">${esc(t("q.mineTag"))}</span>`,
      EDIT && q.edited && `<span class="qflag mine">${esc(t("q.edited"))}</span>`,
    ].filter(Boolean),
    points = q.objs
      .map(
        (o, i) => o[3] != null && { lat: o[3], lng: o[4], n: num(o, i), label: `${num(o, i)}. ${o[1]}`, id: "o-" + i },
      )
      .filter(Boolean);
  det.innerHTML = `
    <div class="qdhead">
      <a class="qback" href="#">← ${esc(t("q.back"))}</a>
      <h2 class="qtitle">${esc(q.name)}</h2>
      ${meta.length ? `<p class="qmeta">${meta.map(esc).join(" · ")}</p>` : ""}
      ${flags.length ? `<p class="qflags">${flags.join("")}</p>` : ""}
      ${q.deleted ? `<p class="qdeleted">${esc(t("q.deleted"))} <button type="button" id="qRestore">${esc(t("q.restore"))}</button></p>` : ""}
      ${EDIT ? `<p class="qedbtns"><button type="button" id="qEditBtn">${esc(t("q.edit"))}</button></p>` : ""}
    </div>
    <div class="qbody">
      ${
        hasGuide(q)
          ? `<section class="qsec qguide"><h3>${esc(t("q.guide"))}</h3>${paras(my.desc, true)}${
              pics.length
                ? `<div class="qpics">${pics.map((p, i) => `<button type="button" data-pic-i="${i}"><img data-pic="${esc(p)}" alt="" loading="lazy" /></button>`).join("")}</div>`
                : ""
            }</section>`
          : ""
      }
      ${
        points.length
          ? `<section class="qsec"><h3>${esc(t("q.map"))}</h3><div class="qmap"><canvas id="qMap"></canvas><div class="qmtip" hidden></div></div><p class="qhint">${esc(t("q.mapHint"))}</p></section>`
          : ""
      }
      <section class="qsec"><h3>${esc(t("q.objs"))}${q.objs.length ? `<small>${q.objs.length}</small>` : ""}</h3>${
        q.objs.length
          ? `<ol class="qobjs">${q.objs
              .map(
                (o, i) =>
                  `<li class="qobj" id="o-${i}">${
                    o[5]
                      ? `<button type="button" class="qphoto" data-obj-i="${i}">${objImg(o[5])}</button>`
                      : `<div class="qphoto"></div>`
                  }<div class="qotext"><b><span class="qnum">${esc(num(o, i))}</span>${
                    o[3] != null
                      ? `<button type="button" class="qolink" data-pt="o-${i}">${esc(o[1] || "–")}</button>`
                      : esc(o[1] || "–")
                  }</b>${o[7] ? `<small>${esc(t("q.keyIs", { k: o[7] }))}</small>` : ""}</div></li>`,
              )
              .join("")}</ol>`
          : `<p class="qhint">${esc(t("q.noObjs"))}</p>`
      }</section>
      ${q.brief ? `<section class="qsec"><h3>${esc(t("q.brief"))}</h3>${paras(q.brief)}</section>` : ""}
      ${q.debrief ? `<details class="qsec"><summary><h3>${esc(t("q.debrief"))}</h3></summary>${paras(q.debrief)}</details>` : ""}
      ${!q.own ? `<p class="qsrc">${t("q.src", { url: esc(TACMAP + q.slug) })}</p>` : ""}
    </div>`;
  hydrate(det);
  /* a photo the server will not give: the card keeps its dark frame instead of a broken picture */
  det.querySelectorAll(".qphoto img, .qpics img").forEach((im) => (im.onerror = () => im.remove()));
  det.querySelectorAll("[data-pic-i]").forEach(
    (b) =>
      (b.onclick = () =>
        openPics(
          pics.map((p) => ({ src: p, own: true })),
          +b.dataset.picI,
        )),
  );
  const objPics = q.objs
    .map(
      (o, i) => o[5] && { src: ownPic(o[5]) ? o[5] : PHOTO + o[5], own: ownPic(o[5]), cap: `${num(o, i)}. ${o[1]}`, i },
    )
    .filter(Boolean);
  det.querySelectorAll("[data-obj-i]").forEach(
    (b) =>
      (b.onclick = () =>
        openPics(
          objPics,
          objPics.findIndex((p) => p.i === +b.dataset.objI),
        )),
  );
  if (EDIT) $("qEditBtn").onclick = () => openEditor(q);
  if (q.deleted)
    $("qRestore").onclick = () =>
      edit((E) => {
        const i = E.findIndex((x) => x.id === q.id);
        delete E[i].deleted;
        if (idle(E[i])) E.splice(i, 1);
      });
  if (points.length) {
    DMAP = miniMap($("qMap"), {
      /* a point on the map: its card below, flashed */
      open: (p) => {
        const el = document.getElementById(p.id);
        if (!el) return;
        el.scrollIntoView({ behavior: REDUCED() ? "auto" : "smooth", block: "center" });
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
      },
    });
    DMAP.set(points, true);
    /* an objective's name: up to the map, which centres on it */
    det.querySelectorAll("[data-pt]").forEach(
      (b) =>
        (b.onclick = () => {
          $("qMap").scrollIntoView({ behavior: REDUCED() ? "auto" : "smooth", block: "center" });
          DMAP.focus(b.dataset.pt);
        }),
    );
  }
}
function onHash() {
  renderDetail();
  /* a task opened from the list starts at its top */
  const top = $("qDetail").getBoundingClientRect().top;
  if (top < 0 || matchMedia("(max-width: 900px)").matches) $("qDetail").scrollIntoView({ block: "start" });
}
addEventListener("hashchange", onHash);

/* ---------- pictures: my own (from the repo, or this browser while not there yet) and the objects' ---------- */
const URLS = new Map();
async function picSrc(path) {
  if (!EDIT) return path;
  if (URLS.has(path)) return URLS.get(path);
  let b = null;
  try {
    b = await IDB.get(path);
  } catch {}
  if (!b) return path;
  const u = URL.createObjectURL(b);
  URLS.set(path, u);
  return u;
}
const hydrate = (root) =>
  root.querySelectorAll("img[data-pic]").forEach(async (im) => (im.src = await picSrc(im.dataset.pic)));
let PICS = [],
  PI = 0;
function openPics(list, i) {
  PICS = list;
  PI = Math.max(0, i);
  showPic();
  $("qPic").showModal();
}
async function showPic() {
  const p = PICS[PI];
  $("qPicT").textContent = p.cap || t("q.picOf", { k: PI + 1, n: PICS.length });
  $("qPicImg").src = p.own ? await picSrc(p.src) : p.src;
  $("qPicPrev").hidden = $("qPicNext").hidden = PICS.length < 2;
}
const stepPic = (d) => {
  PI = (PI + d + PICS.length) % PICS.length;
  showPic();
};
$("qPicPrev").onclick = () => stepPic(-1);
$("qPicNext").onclick = () => stepPic(1);
$("qPicClose").onclick = () => $("qPic").close();
$("qPic").addEventListener("click", (e) => e.target === $("qPic") && $("qPic").close());
$("qPic").addEventListener("keydown", (e) => {
  if (PICS.length > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) stepPic(e.key === "ArrowLeft" ? -1 : 1);
});

/* ---------- small map: gzwtacmap's tiles (lamang.jpg zoomed out), the game grid, numbered points ---------- */
const RM = 20037508.342789244,
  TILE = (z, x, y) => `https://cdn.gzwtacmap.com/0.5/lamang/${z}/${x}/${y}.png`,
  TC = new Map(),
  MAPS = new Set();
let BG = null,
  tileErr = 0;
const redrawMaps = () => MAPS.forEach((m) => m.draw());
/* landmarks under the task's points: landing zones, COPs and POI names (questdata.js), drawn as on the planner */
const LAYERS = typeof QUESTDATA !== "undefined" ? QUESTDATA.map : null;
const icon = (src) => {
  if (!src) return null;
  const im = new Image();
  im.onload = redrawMaps;
  im.src = src;
  return im;
};
const LZIM = icon(LAYERS?.icons.lz),
  COPIM = icon(LAYERS?.icons.cop);
let COPBLUE = null;
/* the COP icon tinted blue like the planner's: the light fill takes the colour, the dark outline stays */
function copIcon() {
  if (COPBLUE || !COPIM || !COPIM.complete || !COPIM.naturalWidth) return COPBLUE;
  const cv = document.createElement("canvas"),
    x = cv.getContext("2d");
  cv.width = COPIM.naturalWidth;
  cv.height = COPIM.naturalHeight;
  x.drawImage(COPIM, 0, 0);
  x.globalCompositeOperation = "multiply";
  x.fillStyle = "#3d9bff";
  x.fillRect(0, 0, cv.width, cv.height);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(COPIM, 0, 0);
  return (COPBLUE = cv);
}
/* the stitched map picture: under the tiles, and alone when zoomed out past them or when they cannot be had */
function bg() {
  if (!BG) {
    BG = new Image();
    BG.onload = redrawMaps;
    BG.src = "lamang.jpg";
  }
  return BG.complete && BG.naturalWidth ? BG : null;
}
function tile(z, x, y) {
  const k = z + "/" + x + "/" + y;
  let im = TC.get(k);
  if (!im) {
    im = new Image();
    im.onload = redrawMaps;
    im.onerror = () => tileErr++;
    im.src = TILE(z, x, y);
    TC.set(k, im);
    if (TC.size > 300) TC.delete(TC.keys().next().value);
  }
  return im;
}
/* opts.open(point): a click on a point; opts.pick({lat, lng}): a click elsewhere on the map; opts.move(point): a point
   dragged to a new spot (its lat, lng changed) */
function miniMap(cv, opts = {}) {
  const c = cv.getContext("2d"),
    box = cv.parentElement,
    tipEl = box.querySelector(".qmtip");
  let W = 0,
    H = 0,
    V = { x: 0, y: 8000, w: 14000 },
    P = [],
    hov = null,
    sel = null,
    raf = 0,
    glide = 0,
    drag = null;
  const sc = () => W / V.w,
    toS = (p) => [(p.lng - V.x) * sc(), (V.y - p.lat) * sc()];
  const clamp = (v) => {
    v.w = Math.max(150, Math.min(v.w, Math.max(14000, H ? (8000 * W) / H : 14000)));
    const vh = (v.w * H) / W;
    v.x = v.w >= 14000 ? (14000 - v.w) / 2 : Math.min(Math.max(v.x, 0), 14000 - v.w);
    v.y = vh >= 8000 ? 8000 + (vh - 8000) / 2 : Math.min(Math.max(v.y, vh), 8000);
    return v;
  };
  function size() {
    const r = box.getBoundingClientRect(),
      d = devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    W = r.width;
    H = r.height;
    cv.width = Math.round(W * d);
    cv.height = Math.round(H * d);
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    V = clamp(V);
    draw();
  }
  const draw = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(paint);
  };
  function paint() {
    if (!W || !H) return;
    const d = devicePixelRatio || 1,
      s = sc(),
      vh = (V.w * H) / W;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.fillStyle = "#1b2a18";
    c.fillRect(0, 0, W, H);
    const zf = Math.log2((2 * RM * s * d) / 256),
      im = bg();
    if (im) c.drawImage(im, -V.x * s, (V.y - 8000) * s, 14000 * s, 8000 * s);
    if (zf > 13.4 && tileErr < 20) {
      const z = Math.max(14, Math.min(19, Math.round(zf))),
        ts = (2 * RM) / 2 ** z,
        x0 = Math.max(V.x, 0),
        x1 = Math.min(V.x + V.w, 14000),
        yT = Math.min(V.y, 8000),
        yB = Math.max(V.y - vh, 0);
      if (x1 > x0 && yT > yB)
        for (let tx = Math.floor((x0 + RM) / ts); tx <= Math.floor((x1 + RM) / ts); tx++)
          for (let ty = Math.floor((RM - yT) / ts); ty <= Math.floor((RM - yB) / ts); ty++) {
            const t = tile(z, tx, ty);
            if (t.complete && t.naturalWidth)
              c.drawImage(
                t,
                Math.floor((tx * ts - RM - V.x) * s),
                Math.floor((V.y - (RM - ty * ts)) * s),
                Math.ceil(ts * s + 1),
                Math.ceil(ts * s + 1),
              );
          }
    }
    /* the game grid, labelled as in game */
    const step = V.w > 4000 ? 1000 : V.w > 1500 ? 200 : 100;
    c.lineWidth = 1;
    c.strokeStyle = "rgba(255,255,255,.13)";
    c.font = "10px IBM Plex Mono, monospace";
    c.fillStyle = "rgba(243,246,236,.8)";
    for (let x = Math.ceil((V.x + 10000) / step) * step - 10000; x < V.x + V.w; x += step) {
      const sx = (x - V.x) * s;
      c.beginPath();
      c.moveTo(sx, 0);
      c.lineTo(sx, H);
      c.stroke();
      c.fillText((x + 10000) / 100, sx + 3, 11);
    }
    for (let y = Math.floor((V.y + 10000) / step) * step - 10000; y > V.y - vh; y -= step) {
      const sy = (V.y - y) * s;
      c.beginPath();
      c.moveTo(0, sy);
      c.lineTo(W, sy);
      c.stroke();
      c.fillText((y + 10000) / 100, 3, sy - 3);
    }
    /* landing zones and COPs (icon, name under it), then POI names where there is room; names keep off each other and
       off the task's points */
    if (LAYERS) {
      const boxes = P.map((p) => {
          const [x, y] = toS(p);
          return [x - 12, y - 12, x + 12, y + 12];
        }),
        free = (r) => !boxes.some((b) => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]),
        seen = (x, y) => x > -80 && y > -20 && x < W + 80 && y < H + 20,
        name = (text, x, y) => {
          const w = c.measureText(text).width,
            r = [x - w / 2 - 2, y - 1, x + w / 2 + 2, y + 13];
          if (!free(r)) return false;
          boxes.push(r);
          c.strokeStyle = "rgba(13,19,11,.85)";
          c.lineWidth = 3;
          c.strokeText(text, x, y);
          c.fillStyle = "#f3f6ec";
          c.fillText(text, x, y);
          return true;
        },
        lzIm = LZIM && LZIM.complete && LZIM.naturalWidth ? LZIM : null,
        copIm = copIcon();
      c.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "top";
      c.lineJoin = "round";
      for (const [lat, lng, n] of LAYERS.lz) {
        const [x, y] = toS({ lat, lng });
        if (!seen(x, y)) continue;
        if (lzIm) c.drawImage(lzIm, x - 7, y - 7, 14, 14);
        name(n, x, y + 10);
      }
      for (const [lat, lng, n] of LAYERS.cops) {
        const [x, y] = toS({ lat, lng });
        if (!seen(x, y)) continue;
        if (copIm) c.drawImage(copIm, x - 8, y - 8, 16, 16);
        name(n, x, y + 11);
      }
      for (const [lat, lng, n] of LAYERS.pois) {
        const [x, y] = toS({ lat, lng });
        if (!seen(x, y)) continue;
        const w = c.measureText(n).width,
          r = [x - w / 2 - 2, y - 3, x + w / 2 + 2, y + 18];
        if (!free(r)) continue;
        boxes.push(r);
        c.fillStyle = "#ffffff";
        c.beginPath();
        c.arc(x, y, 2.4, 0, 7);
        c.fill();
        c.strokeStyle = "rgba(13,19,11,.85)";
        c.lineWidth = 3;
        c.strokeText(n, x, y + 4);
        c.fillStyle = "#f3f6ec";
        c.fillText(n, x, y + 4);
      }
    }
    /* the task's points, the hovered or centred one on top */
    const L = [...P].sort((a, b) => (a === hov || a === sel) - (b === hov || b === sel));
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const p of L) {
      const [x, y] = toS(p),
        r = p === hov || p === sel ? 11 : 9.5;
      /* the objective centred from its name: a white ring around it */
      if (p === sel) {
        c.beginPath();
        c.arc(x, y, r + 5, 0, 7);
        c.lineWidth = 3;
        c.strokeStyle = "#ffffff";
        c.stroke();
      }
      c.beginPath();
      c.arc(x, y, r, 0, 7);
      c.fillStyle = "#ffa21f";
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = p === hov || p === sel ? "#ffffff" : "#0d130b";
      c.stroke();
      c.fillStyle = "#0d130b";
      c.font = "600 11px IBM Plex Sans, system-ui, sans-serif";
      c.fillText(String(p.n), x, y + 0.5);
    }
    c.globalAlpha = 1;
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
  }
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const hit = (x, y) => {
    let b = null,
      bd = 14;
    for (const p of P) {
      const [px, py] = toS(p),
        dd = Math.hypot(px - x, py - y);
      if (dd < bd) {
        bd = dd;
        b = p;
      }
    }
    return b;
  };
  function showTip(p, x, y) {
    if (!p) return (tipEl.hidden = true);
    tipEl.textContent = p.label;
    tipEl.hidden = false;
    tipEl.style.left = Math.max(4, Math.min(x + 12, W - tipEl.offsetWidth - 4)) + "px";
    tipEl.style.top = (y + 14 + tipEl.offsetHeight > H ? y - tipEl.offsetHeight - 10 : y + 14) + "px";
  }
  const toMap = (x, y) => ({
    lat: Math.round((V.y - y / sc()) * 10) / 10,
    lng: Math.round((V.x + x / sc()) * 10) / 10,
  });
  /* a press on a point that can move drags the point, anywhere else it pans */
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    cancelAnimationFrame(glide);
    const [x, y] = at(e);
    drag = { x, y, sx: x, sy: y, moved: false, p: opts.move ? hit(x, y) : null };
    if (sel) {
      sel = null;
      draw();
    }
  });
  cv.addEventListener("pointermove", (e) => {
    const [x, y] = at(e);
    if (drag) {
      if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) > 4) drag.moved = true;
      if (drag.moved && drag.p) Object.assign(drag.p, toMap(x, y));
      else if (drag.moved) {
        V = clamp({ x: V.x - (x - drag.x) / sc(), y: V.y + (y - drag.y) / sc(), w: V.w });
        drag.x = x;
        drag.y = y;
      }
      if (drag.moved) {
        tipEl.hidden = true;
        draw();
      }
      return;
    }
    const h = hit(x, y);
    if (h !== hov) {
      hov = h;
      draw();
    }
    cv.style.cursor = h ? (opts.move ? "move" : "pointer") : opts.pick ? "crosshair" : "grab";
    showTip(h, x, y);
  });
  cv.addEventListener("pointerup", (e) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved) return d.p && opts.move(d.p);
    const [x, y] = at(e),
      h = hit(x, y);
    if (h && opts.open) opts.open(h);
    else if (!h && opts.pick) opts.pick(toMap(x, y));
  });
  cv.addEventListener("pointercancel", () => (drag = null));
  cv.addEventListener("pointerleave", () => {
    if (hov) {
      hov = null;
      draw();
    }
    tipEl.hidden = true;
  });
  const zoom = (f, x, y) => {
    const mx = V.x + x / sc(),
      my = V.y - y / sc(),
      w = clamp({ x: 0, y: 0, w: V.w * f }).w;
    V = clamp({ x: mx - (x * w) / W, y: my + (y * w) / W, w });
    draw();
  };
  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [x, y] = at(e);
      zoom(Math.pow(1.0018, e.deltaMode ? e.deltaY * 33 : e.deltaY), x, y);
    },
    { passive: false },
  );
  /* + and − for touch screens, where there is no wheel */
  const zb = document.createElement("div");
  zb.className = "qmzoom";
  zb.innerHTML = '<button type="button" aria-label="+">+</button><button type="button" aria-label="−">−</button>';
  zb.children[0].onclick = () => zoom(0.6, W / 2, H / 2);
  zb.children[1].onclick = () => zoom(1 / 0.6, W / 2, H / 2);
  box.appendChild(zb);
  const ro = new ResizeObserver(size);
  ro.observe(box);
  const self = {
    draw,
    size,
    /* points: [{lat, lng, n, label, id}]; fit: zoom to them (all the map without any) */
    set(points, fit) {
      P = points;
      size();
      if (fit) {
        const L = P.length ? P : null;
        if (!L) V = clamp({ x: 0, y: 8000, w: 14000 });
        else {
          const x0 = Math.min(...L.map((p) => p.lng)),
            x1 = Math.max(...L.map((p) => p.lng)),
            y0 = Math.min(...L.map((p) => p.lat)),
            y1 = Math.max(...L.map((p) => p.lat)),
            w = Math.max(x1 - x0 + 500, ((y1 - y0 + 500) * W) / H, 900);
          V = clamp({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 + (w * H) / W / 2, w });
        }
      }
      draw();
    },
    /* the point with this id: centred (closer in when the view is wide), ringed, its name shown */
    focus(id) {
      const p = P.find((x) => x.id === id);
      if (!p) return;
      sel = p;
      const w = Math.min(V.w, 900),
        to = clamp({ x: p.lng - w / 2, y: p.lat + (w * H) / W / 2, w }),
        from = { ...V },
        t0 = performance.now(),
        step = (n) => {
          const k = REDUCED() ? 1 : Math.min(1, (n - t0) / 450),
            e = 1 - Math.pow(1 - k, 3);
          V = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e };
          paint();
          if (k < 1) glide = requestAnimationFrame(step);
          else showTip(p, ...toS(p));
        };
      cancelAnimationFrame(glide);
      glide = requestAnimationFrame(step);
    },
    destroy() {
      cancelAnimationFrame(glide);
      ro.disconnect();
      MAPS.delete(self);
      cancelAnimationFrame(raf);
      zb.remove();
    },
  };
  MAPS.add(self);
  return self;
}

/* ---------- edit mode: a task of my own, or one of gzwtacmap's ---------- */
let ED = null,
  EMAP = null,
  PHOTOFOR = -1;
function openEditor(q) {
  const own = !q || q.own,
    my = (q && q.my) || {};
  ED = {
    q,
    own,
    id: q ? q.id : "my-" + rnd(),
    pics: [...(my.pics || [])],
    objs: (q ? q.objs : []).map((o) => [...o]),
    /* pictures stored in this browser during this editing, and saved ones taken out of it */
    added: [],
    removed: [],
  };
  $("qEditT").textContent = t(q ? "q.dlg.edit" : "q.dlg.add");
  $("qBaseNote").hidden = own;
  $("qName").value = q ? q.name : "";
  $("qVendor").value = q ? q.vendor : "";
  $("qLoc").value = q ? q.loc : "";
  $("qType").value = q ? q.type || "" : "";
  $("qBrief").value = q ? q.brief : "";
  $("qDebrief").value = q ? q.debrief : "";
  $("qDesc").value = my.desc || "";
  /* delete: a task of my own goes, one of gzwtacmap's is hidden; reset: drop every change to one of gzwtacmap's */
  $("qDel").hidden = !q || q.deleted;
  $("qDel").textContent = t("q.del");
  $("qReset").hidden = !q || own || !q.my;
  $("qErr").hidden = true;
  $("qVendors").innerHTML = VORDER.map((v) => `<option value="${esc(v)}"></option>`).join("");
  $("qKeys").innerHTML = KEYS.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("");
  $("qLocs").innerHTML = [...new Set(BASE.map((x) => x.loc).filter(Boolean))]
    .sort()
    .map((l) => `<option value="${esc(l)}"></option>`)
    .join("");
  $("qEdit").showModal();
  if (!EMAP)
    EMAP = miniMap($("qEditMap"), {
      /* a click on the map: a new objective there, its name to fill in */
      pick: (p) => {
        ED.objs.push([null, "", null, p.lat, p.lng, "", 0, ""]);
        editObjs();
        $("qObjs").lastElementChild?.querySelector("input[type=text]")?.focus({ preventScroll: true });
      },
      /* a point dragged: its objective moves there */
      move: (p) => {
        ED.objs[p.i][3] = p.lat;
        ED.objs[p.i][4] = p.lng;
        editObjs();
      },
      open: (p) => $("qObjs").children[p.i]?.querySelector("input[type=text]")?.focus({ preventScroll: true }),
    });
  editThumbs();
  editObjs(true);
  (q ? $("qDesc") : $("qName")).focus();
}
/* the objectives on the editor's map, and their rows under it: number, name, locked door, grid square, photo, order,
   remove */
function editObjs(fit) {
  const n = ED.objs.length,
    lbl = (k, i) => esc(t(k) + " " + (i + 1));
  EMAP.set(
    ED.objs
      .map((o, i) => o[3] != null && { lat: o[3], lng: o[4], n: i + 1, label: `${i + 1}. ${o[1]}`, i })
      .filter(Boolean),
    fit,
  );
  $("qObjs").innerHTML = ED.objs
    .map(
      (o, i) => `<li>
        <span class="qnum">${i + 1}</span>
        <input type="text" maxlength="80" data-i="${i}" value="${esc(o[1])}" placeholder="${esc(t("q.fObjPh"))}" aria-label="${lbl("q.fObjPh", i)}" />
        <label class="qlock"><input type="checkbox" data-lock="${i}"${o[6] ? " checked" : ""} />${esc(t("q.locked"))}</label>
        <input type="text" class="qekey" maxlength="60" list="qKeys" data-key="${i}" value="${esc(o[7] || "")}" placeholder="${esc(t("q.fKeyPh"))}" aria-label="${lbl("q.fKeyPh", i)}" />
        <small>${o[3] != null ? esc(t("gridAt", { g: grid(o[3], o[4]) })) : esc(t("q.noPos"))}</small>
        <span class="qeopic">${
          o[5]
            ? `<button type="button" class="qeothumb" data-photo="${i}" title="${esc(t("q.fObjPhoto"))}">${objImg(o[5])}</button><button type="button" data-unphoto="${i}" aria-label="${lbl("q.fObjUnphoto", i)}">×</button>`
            : `<button type="button" data-photo="${i}">${esc(t("q.fObjPhoto"))}</button>`
        }</span>
        <span class="qeord"><button type="button" data-up="${i}" aria-label="${lbl("q.up", i)}"${i ? "" : " disabled"}>↑</button><button type="button" data-down="${i}" aria-label="${lbl("q.down", i)}"${
          i < n - 1 ? "" : " disabled"
        }>↓</button></span>
        <button type="button" class="qerm" data-rm="${i}" aria-label="${lbl("q.remove", i)}">×</button>
      </li>`,
    )
    .join("");
  hydrate($("qObjs"));
  $("qObjs")
    .querySelectorAll(".qeothumb img")
    .forEach((im) => (im.onerror = () => im.remove()));
}
$("qObjs").addEventListener("input", (e) => {
  const { i, key } = e.target.dataset;
  if (i != null) ED.objs[+i][1] = e.target.value;
  /* a key named: the objective is behind a locked door */
  if (key != null) {
    ED.objs[+key][7] = e.target.value;
    if (e.target.value.trim()) {
      ED.objs[+key][6] = 1;
      $("qObjs").querySelector(`[data-lock="${key}"]`).checked = true;
    }
  }
});
$("qObjs").addEventListener("change", (e) => {
  const i = e.target.dataset.lock;
  if (i != null) ED.objs[+i][6] = e.target.checked ? 1 : 0;
});
$("qObjs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset,
    O = ED.objs;
  if (d.photo != null) {
    PHOTOFOR = +d.photo;
    $("qObjPicFile").click();
    return;
  }
  if (d.unphoto != null) {
    dropPic(O[+d.unphoto][5]);
    O[+d.unphoto][5] = "";
  } else if (d.rm != null) dropPic(O.splice(+d.rm, 1)[0][5]);
  else if (d.up != null) O.splice(+d.up - 1, 0, ...O.splice(+d.up, 1));
  else if (d.down != null) O.splice(+d.down + 1, 0, ...O.splice(+d.down, 1));
  else return;
  editObjs();
});
$("qObjPicFile").onchange = async (e) => {
  const f = e.target.files[0],
    o = ED.objs[PHOTOFOR];
  e.target.value = "";
  if (!f || !o) return;
  edErr("");
  try {
    const p = await storePic(f);
    dropPic(o[5]);
    o[5] = p;
  } catch (m) {
    edErr(m);
  }
  editObjs();
};
function editThumbs() {
  $("qThumbs").innerHTML = ED.pics
    .map(
      (p, i) =>
        `<div class="qeth"><img data-pic="${esc(p)}" alt="" /><button type="button" data-rmpic="${i}" aria-label="${esc(t("q.remove"))}">×</button></div>`,
    )
    .join("");
  hydrate($("qThumbs"));
}
$("qThumbs").addEventListener("click", (e) => {
  const i = e.target.dataset.rmpic;
  if (i == null) return;
  dropPic(ED.pics.splice(+i, 1)[0]);
  editThumbs();
});
/* a picture no longer used: one added in this editing goes now, one saved before when this is saved */
function dropPic(p) {
  if (!p || !ownPic(p)) return;
  if (ED.added.includes(p)) {
    ED.added = ED.added.filter((x) => x !== p);
    IDB.del(p).catch(() => {});
  } else ED.removed.push(p);
}
const edErr = (msg) => {
  $("qErr").textContent = msg;
  $("qErr").hidden = !msg;
};
/* a picture made at most 1600 px on its long side, as WebP (JPEG where the browser cannot write WebP) */
async function shrink(file) {
  const bm = await createImageBitmap(file),
    k = Math.min(1, 1600 / Math.max(bm.width, bm.height)),
    cv = document.createElement("canvas");
  cv.width = Math.round(bm.width * k);
  cv.height = Math.round(bm.height * k);
  cv.getContext("2d").drawImage(bm, 0, 0, cv.width, cv.height);
  bm.close?.();
  let b = await new Promise((ok) => cv.toBlob(ok, "image/webp", 0.85));
  if (!b || b.type !== "image/webp") b = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.88));
  if (!b) throw new Error("encode");
  return b;
}
/* a picture file, shrunk and kept in this browser under the path it will have in the repo; throws the message to show */
async function storePic(f) {
  let b;
  try {
    b = await shrink(f);
  } catch {
    throw t("q.picFail", { name: f.name });
  }
  const base = String(ED.q && !ED.own ? ED.q.slug : ED.id).replace(/[^\w-]+/g, "-"),
    path = `quests/img/${base}-${rnd()}.${b.type === "image/webp" ? "webp" : "jpg"}`;
  try {
    await IDB.put(path, b);
  } catch {
    throw t("q.storeFail");
  }
  ED.added.push(path);
  return path;
}
$("qAddPics").onclick = () => $("qPicFile").click();
$("qPicFile").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  edErr("");
  for (const f of files)
    try {
      ED.pics.push(await storePic(f));
    } catch (m) {
      edErr(m);
      if (m === t("q.storeFail")) break;
    }
  editThumbs();
};
/* leaving without saving: pictures added meanwhile are not kept */
function closeEditor() {
  ED.added.forEach((p) => IDB.del(p).catch(() => {}));
  ED = null;
  $("qEdit").close();
}
$("qCancel").onclick = closeEditor;
$("qEdit").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeEditor();
});
const area = (id) => $(id).value.replace(/\r/g, "").trim();
/* objectives compared without their steps, which a save numbers anew */
const sameObjs = (a, b) =>
  JSON.stringify(a.map((o) => [o[0], o[1], o[3], o[4], o[5], o[6] ? 1 : 0, o[7] || ""])) ===
  JSON.stringify(b.map((o) => [o[0], o[1], o[3], o[4], o[5], o[6] ? 1 : 0, o[7] || ""]));
/* the pictures of an entry: my guide's and its objectives' */
const entryPics = (e) => [...(e?.pics || []), ...(e?.objs || []).map((o) => o[5]).filter((p) => p && ownPic(p))];
$("qForm").onsubmit = (e) => {
  e.preventDefault();
  const v = {
    name: $("qName").value.trim(),
    vendor: $("qVendor").value.trim(),
    loc: $("qLoc").value.trim(),
    type: $("qType").value,
    brief: area("qBrief"),
    debrief: area("qDebrief"),
  };
  if (!v.name) {
    edErr(t("q.needName"));
    $("qName").focus();
    return;
  }
  const { id, removed, own, q } = ED,
    objs = ED.objs.map((o, i) => {
      const key = (o[7] || "").trim();
      return [o[0], (o[1] || "").trim(), i + 1, o[3], o[4], o[5] || "", o[6] || key ? 1 : 0, key];
    }),
    entry = { id };
  /* one of gzwtacmap's tasks keeps only what differs from the site, so the rest follows its updates */
  if (own) Object.assign(entry, v, { objs });
  else {
    for (const f of TEXTS) if (v[f] !== (q.base[f] || "")) entry[f] = v[f];
    if (!sameObjs(objs, q.base.objs)) entry.objs = objs;
  }
  if (q?.deleted) entry.deleted = true;
  entry.desc = area("qDesc");
  entry.pics = ED.pics;
  edit((E) => {
    const i = E.findIndex((x) => x.id === id);
    if (!own && idle(entry)) i >= 0 && E.splice(i, 1);
    else if (i >= 0) E[i] = entry;
    else E.push(entry);
  });
  removed.forEach((p) => IDB.del(p).catch(() => {}));
  ED = null;
  $("qEdit").close();
  if (!q) location.hash = encodeURIComponent(id);
};
/* drops the editor and pictures no longer used by the task; then fn edits the entries */
function leave(pics, fn) {
  ED.added.forEach((p) => IDB.del(p).catch(() => {}));
  ED = null;
  $("qEdit").close();
  edit(fn);
  pics.forEach((p) => IDB.del(p).catch(() => {}));
}
$("qDel").onclick = () => {
  const { q, own } = ED;
  if (!confirm(t("q.delConfirm", { name: q.name }))) return;
  leave(own ? entryPics(q.my) : [], (E) => {
    const i = E.findIndex((x) => x.id === q.id);
    if (own) E.splice(i, 1);
    else if (i >= 0) E[i].deleted = true;
    else E.push({ id: q.id, deleted: true });
  });
  if (own) location.hash = "";
};
$("qReset").onclick = () => {
  const { q } = ED;
  if (!confirm(t("q.resetConfirm", { name: q.base.name }))) return;
  leave(entryPics(q.my), (E) => {
    const i = E.findIndex((x) => x.id === q.id);
    if (i >= 0) E.splice(i, 1);
  });
};
$("qAdd").onclick = () => openEditor(null);

/* ---------- edit mode: what is not in the repo yet, and the zip that puts it there ---------- */
function renderBar() {
  $("qAdd").hidden = !EDIT;
  const bar = $("qBar");
  bar.hidden = !EDIT;
  if (!EDIT) return;
  const n = changes(),
    done = DRAFT && !DRAFT.dirty && DRAFT.saved;
  let msg = !n ? t("q.editOn") : done ? t(DRAFT.zip ? "q.downloaded" : "q.downloadedJs") : t("q.pending", { n });
  if (n && !done && DRAFT.from !== REPO.saved && DRAFT.saved !== REPO.saved) msg += " " + t("q.conflict");
  $("qBarText").textContent = msg;
  $("qDownload").hidden = $("qDiscard").hidden = !n;
  $("qDownload").textContent = t(done ? "q.downloadAgain" : "q.download");
  bar.classList.toggle("on", n > 0);
}
$("qDiscard").onclick = () => {
  if (!confirm(t("q.discardConfirm"))) return;
  dropDraft();
  refresh();
};
const HEAD = `/* My changes to the quest guide (quests.html), laid over gzwtacmap's tasks in questdata.js. Written by the page's
   "Download for the repo" (edit mode); commit it, with the pictures in quests/img/.
   entries: {id: "my-…" (a task of my own) or a gzwtacmap task id; name, vendor, loc, type, brief, debrief (on gzwtacmap's
   tasks only the ones changed); objs: [[gzwtacmap marker id or null, name, step, lat, lng, photo, locked door, key]] (the
   whole list, when changed); deleted (hidden from the list); desc (my guide), pics: [path]} */
`;
/* my-quests.js alone, or zipped with the pictures not in the repo yet */
$("qDownload").onclick = async () => {
  const saved = new Date().toISOString(),
    js = new TextEncoder().encode(`${HEAD}const MYQUESTS=${JSON.stringify({ saved, entries: entries() }, null, 2)};\n`),
    files = [{ name: "my-quests.js", data: js }];
  for (const p of new Set(entries().flatMap(entryPics))) {
    let b = null;
    try {
      b = await IDB.get(p);
    } catch {}
    if (b) files.push({ name: p, data: new Uint8Array(await b.arrayBuffer()) });
  }
  const a = document.createElement("a"),
    zipped = files.length > 1;
  a.href = URL.createObjectURL(zipped ? zip(files) : new Blob([js], { type: "text/javascript" }));
  a.download = zipped ? `my-quests-${saved.slice(0, 10)}.zip` : "my-quests.js";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  Object.assign(DRAFT, { saved, dirty: false, zip: zipped });
  store.set(DRAFTKEY, DRAFT);
  renderBar();
};
/* a zip of [{name, data: Uint8Array}], stored as is (the pictures are compressed already) */
const CRC = (() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    T[n] = c >>> 0;
  }
  return T;
})();
const crc32 = (d) => {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(files) {
  const enc = new TextEncoder(),
    now = new Date(),
    time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
    date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    parts = [],
    dir = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name),
      crc = crc32(f.data),
      n = f.data.length,
      h = new DataView(new ArrayBuffer(30)),
      e = new DataView(new ArrayBuffer(46));
    /* local header: version 2.0, UTF-8 names, stored */
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, n, true);
    h.setUint32(22, n, true);
    h.setUint16(26, name.length, true);
    parts.push(h, name, f.data);
    /* its central directory entry */
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    e.setUint16(6, 20, true);
    e.setUint16(8, 0x0800, true);
    e.setUint16(12, time, true);
    e.setUint16(14, date, true);
    e.setUint32(16, crc, true);
    e.setUint32(20, n, true);
    e.setUint32(24, n, true);
    e.setUint16(28, name.length, true);
    e.setUint32(42, off, true);
    dir.push(e, name);
    off += 30 + name.length + n;
  }
  const size = dir.reduce((s, p) => s + p.byteLength, 0),
    end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, off, true);
  return new Blob([...parts, ...dir, end], { type: "application/zip" });
}

/* ---------- language ---------- */
function setLang(l) {
  if (l === LANG || !Object.hasOwn(I18N, l)) return;
  LANG = l;
  try {
    localStorage.setItem(LANGKEY, l);
  } catch {}
  applyI18n();
  refresh();
}
document.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
refresh();
