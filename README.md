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

## Running it

It is a static page: open `index.html`, or serve the folder (`python -m http.server`). Everything you set is kept in the
browser.

## Map data

Markers, keys, map tiles and icons come from [gzwtacmap.com](https://gzwtacmap.com). `node tools/build-data.mjs` (Node 18+)
rebuilds `data.js` from the site; add `--dry-run` to see what changed first.

Gray Zone Warfare is a game by MADFINGER Games; this is a fan-made tool, not affiliated with them.
