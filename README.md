# Kokesz Loot Runs – Gray Zone Warfare loot run planner

**Live: https://4dd4m.github.io/gzwClusters/**

A loot run planner for the Lamang map of [Gray Zone Warfare](https://grayzonewarfare.com). Pick the container types you
want; the planner groups them into routes, puts each route in the shortest walking order and starts it from the nearest
landing zone, a COP or your own position on the map. In English and Hungarian.

## Features

- **Loot routes**: containers grouped by a radius you set, best routes first (metres per container), with leg lengths,
  headings and stop numbers; reverse a route, or bail out early to the nearest exfil.
- **Start points**: the nearest landing zone, a chosen COP, or your own position picked on the map.
- **Raid tracking**: tick containers as looted (out of the routes for 30 minutes), mark ones that are not there.
- **Keys**: key-locked doors along the route, your own keys, each lock shown on a small map.
- **Notes and custom POIs**: notes on containers, doors and POIs; your own points with an icon, which can join the routes
  as a container type of your own.
- **Trader sell prices** from the player-kept list on [gzwitems.com](https://gzwitems.com).
- **Presets, display settings, export / import** of any part of your data.
- **Quest guide** (`quests.html`): every task by vendor or location, searchable, with its briefing and its objectives
  with photos, on a small map with the game's grid, landing zones, COPs and POI names (an objective's name centres the
  map on it).

## Editing the quest guide

Open `quests.html` locally (or add `?edit` to its address) to get **Add task** and an **Edit** button on every task: name,
vendor, location, type, briefing, debriefing, your own guide text and pictures, and the objectives (add them on the map,
drag to move, rename, reorder, mark locked doors, give them a photo, delete); gzwtacmap's tasks can also be
deleted (hidden) and restored, or reset to the site's version. Changes stay in that browser until **Download for the
repo**, which gives `my-quests.js` (zipped with `quests/img/` when there are new pictures). Put it in this folder,
commit and push; the page lays it over gzwtacmap's tasks, keeping only the fields you changed, so a later
`build-quests.mjs` still updates the rest.

## Running it

It is a static page: open `index.html`, or serve the folder (`python -m http.server`). Everything you set is kept in the
browser.

## Map data

Markers, keys, map tiles and icons come from [gzwtacmap.com](https://gzwtacmap.com). `node tools/build-data.mjs` (Node 18+)
rebuilds `data.js` from the site; add `--dry-run` to see what changed first. After it, `node tools/build-quests.mjs`
rebuilds `questdata.js`, the tasks with their briefings and objects.

Gray Zone Warfare is a game by MADFINGER Games; this is a fan-made tool, not affiliated with them.
