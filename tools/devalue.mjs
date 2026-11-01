// Minimal decoder for SvelteKit's "devalue" flat format: index 0 is the root, numbers inside objects/arrays point at other entries.
export function unflatten(values) {
  if (typeof values === "number") return [undefined, undefined, NaN, Infinity, -Infinity, -0][-values];
  const seen = new Map();
  const hydrate = (i) => {
    if (i === -1) return undefined;
    if (i === -3) return NaN;
    if (i === -4) return Infinity;
    if (i === -5) return -Infinity;
    if (i === -6) return -0;
    if (seen.has(i)) return seen.get(i);
    const v = values[i];
    if (!v || typeof v !== "object") {
      seen.set(i, v);
      return v;
    }
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") {
        const t = v[0];
        if (t === "Date") {
          const d = new Date(v[1]);
          seen.set(i, d);
          return d;
        }
        if (t === "Set") {
          const s = new Set();
          seen.set(i, s);
          for (let k = 1; k < v.length; k++) s.add(hydrate(v[k]));
          return s;
        }
        if (t === "Map") {
          const m = new Map();
          seen.set(i, m);
          for (let k = 1; k < v.length; k += 2) m.set(hydrate(v[k]), hydrate(v[k + 1]));
          return m;
        }
        if (t === "null") {
          const o = Object.create(null);
          seen.set(i, o);
          for (let k = 1; k < v.length; k += 2) o[v[k]] = hydrate(v[k + 1]);
          return o;
        }
        if (t === "BigInt") return BigInt(v[1]);
        if (t === "RegExp") return new RegExp(v[1], v[2]);
      }
      const a = new Array(v.length);
      seen.set(i, a);
      v.forEach((x, k) => {
        if (x !== -2) a[k] = hydrate(x);
      });
      return a;
    }
    const o = {};
    seen.set(i, o);
    for (const k in v) o[k] = hydrate(v[k]);
    return o;
  };
  return hydrate(0);
}
