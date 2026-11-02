// Fetch helpers for gzwtacmap.com, shared by build-data.mjs and build-quests.mjs.
import { unflatten } from "./devalue.mjs";

export const SITE = "https://gzwtacmap.com";

export async function get(url, as = "json", tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "kokesz-loot-runs data builder" } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return as === "json" ? await r.json() : as === "text" ? await r.text() : r;
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 800 * i));
    }
  }
}
/* runs fn over items, n at a time */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
/* a SvelteKit page's data: the first node whose root has `key` */
export async function pageData(path, key) {
  const j = await get(`${SITE}${path}/__data.json`);
  for (const n of j.nodes || [])
    if (n && n.data) {
      const d = unflatten(n.data);
      if (d && key in d) return d;
    }
  throw new Error(`${path}: no "${key}" in page data`);
}
