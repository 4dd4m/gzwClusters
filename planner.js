/* Route planning, kept self-contained (no globals, no DOM) so app.js can run it in a Web Worker built from this
   function's source, or call it directly where workers are unavailable.

   job: {
     pts:    [[lat, lng, sector]]   the selected containers
     plan:   false = radius estimate only (browse only mode)
     r:      grouping radius (m);  rmin: smallest radius the estimate tries
     q:      minimum group size, 0 = none
     noSec:  forbidden sectors
     starts: [[lat, lng]]  possible start points;  ends: [[lat, lng, isCop]]  possible end points
     copBias: a COP end point wins over a nearer LZ if it is at most this many metres farther
     areas:  [[lat, lng, label]]  names for routes outside any sector, as near ("near {a}") or, with no area, wild
     budget: ms of 2-opt improvement shared by all routes
   }
   returns, referring to pts / starts / ends by index:
   {
     est:   radius estimate {lo, hi, mid, peak, q}, or {none: true, q}, or null (fewer points than the minimum)
     runs:  [{seq, A: {k, d}, B: {k, d}, legs, path, avg, total, full, per, cx, cy, radius, name, n}]
     left:  points in no route (their group is below the minimum or belongs to a forbidden sector)
     nosec: [[point, sector]] for points left out because of a forbidden sector
     secn:  [[sector, routes]] would-be routes per sector, forbidden or not
   } */
function planRoutes(job) {
  const P = job.pts.map(([lat, lng, poi], i) => ({ i, lat, lng, poi })),
    STARTS = job.starts.map(([lat, lng]) => ({ lat, lng, bias: 0 })),
    ENDS = job.ends.map(([lat, lng, cop]) => ({ lat, lng, bias: cop ? job.copBias || 0 : 0 })),
    AREAS = job.areas.map(([lat, lng, label]) => ({ lat, lng, label, bias: 0 })),
    D = (a, b) => Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2),
    sum = (a) => a.reduce((s, v) => s + v, 0);
  /* the nearest of a set by distance less its bias, so a slightly farther COP end point beats an LZ; d is the real walk */
  const nearest = (set, p) => {
    let k = -1,
      d = 1e18,
      e = 1e18;
    set.forEach((l, i) => {
      const dl = D(l, p);
      if (dl - l.bias < e) {
        e = dl - l.bias;
        d = dl;
        k = i;
      }
    });
    return { k, d, e };
  };
  const nearestS = (p) => nearest(STARTS, p),
    nearestE = (p) => nearest(ENDS, p);
  /* a group's sector: where most of its stops are, ties alphabetical; routes are named after it and forbidden sectors drop it */
  const sectorOf = (g) => {
    const c = {};
    g.forEach((p) => {
      if (p.poi) c[p.poi] = (c[p.poi] || 0) + 1;
    });
    return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b))[0];
  };
  /* points by grid cell of size C, for neighbour searches; map coordinates are metres well under 1e5, so x * 1e5 + y is unique */
  const cellKey = (x, y) => x * 1e5 + y;
  function grid(pts, C) {
    const cells = new Map();
    pts.forEach((p, i) => {
      const k = cellKey(Math.floor(p.lng / C), Math.floor(p.lat / C));
      (cells.get(k) || cells.set(k, []).get(k)).push(i);
    });
    return cells;
  }

  /* groups: containers closer than R chain together (single linkage), found through a grid of R-sized cells */
  function cluster(pts, R) {
    const cells = grid(pts, R),
      lab = new Int32Array(pts.length).fill(-1),
      out = [];
    for (let i = 0; i < pts.length; i++) {
      if (lab[i] >= 0) continue;
      const c = [],
        st = [i];
      lab[i] = out.length;
      while (st.length) {
        const p = pts[st.pop()],
          cx = Math.floor(p.lng / R),
          cy = Math.floor(p.lat / R);
        c.push(p);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const k of cells.get(cellKey(cx + dx, cy + dy)) || [])
              if (lab[k] < 0 && D(p, pts[k]) <= R) {
                lab[k] = out.length;
                st.push(k);
              }
      }
      out.push(c);
    }
    return out;
  }

  /* Radius estimate: sweep radii over an approximate minimum spanning tree (8 nearest neighbours per container)
     and count how many groups reach the minimum quantity. The optimal band is where that count stays within 80% of its peak:
     below it most containers sit alone, above it neighbouring areas merge into fewer, longer routes. */
  function estimate(pts, q) {
    const n = pts.length;
    if (n < q) return null;
    const C = 250,
      K = 8,
      cells = grid(pts, C),
      edges = [];
    pts.forEach((p, i) => {
      const cx = Math.floor(p.lng / C),
        cy = Math.floor(p.lat / C),
        best = [];
      for (let ring = 0; ring <= 8; ring++) {
        for (let dx = -ring; dx <= ring; dx++)
          for (let dy = -ring; dy <= ring; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            for (const j of cells.get(cellKey(cx + dx, cy + dy)) || []) if (j !== i) best.push([D(p, pts[j]), j]);
          }
        best.sort((a, b) => a[0] - b[0]);
        if (best.length >= K && best[K - 1][0] <= ring * C) break;
      }
      best.slice(0, K).forEach(([d, j]) => edges.push([d, i, j]));
    });
    edges.sort((a, b) => a[0] - b[0]);
    const par = Int32Array.from({ length: n }, (_, i) => i),
      sz = new Int32Array(n).fill(1),
      f = (x) => {
        while (par[x] !== x) x = par[x] = par[par[x]];
        return x;
      };
    let groups = q <= 1 ? n : 0,
      e = 0;
    const curve = [];
    for (let R = job.rmin; R <= 2500; R += 25) {
      while (e < edges.length && edges[e][0] <= R) {
        const [, a, b] = edges[e++];
        let x = f(a),
          y = f(b);
        if (x === y) continue;
        if (sz[x] >= q) groups--;
        if (sz[y] >= q) groups--;
        if (sz[x] < sz[y]) [x, y] = [y, x];
        par[y] = x;
        sz[x] += sz[y];
        if (sz[x] >= q) groups++;
      }
      curve.push([R, groups]);
    }
    const peak = Math.max(...curve.map((c) => c[1]));
    if (!peak) return { none: true, q };
    const ok = curve.filter((c) => c[1] >= peak * 0.8),
      lo = ok[0][0],
      hi = ok[ok.length - 1][0];
    return { lo, hi, mid: Math.round((lo + hi) / 2 / 25) * 25, peak, q };
  }

  /* one route: the shortest open walk through a group, from the nearer start point to the nearer end point.
     The walk works on stop indexes over flat coordinate arrays, which keeps big groups fast. */
  function plan(g, deadline) {
    const n = g.length,
      xs = Float64Array.from(g, (p) => p.lng),
      ys = Float64Array.from(g, (p) => p.lat),
      dist = (a, b) => Math.sqrt((xs[a] - xs[b]) ** 2 + (ys[a] - ys[b]) ** 2),
      toS = g.map((p) => nearestS(p));
    /* one attempt: nearest-neighbour walk from container s, then 2-opt with the start point fixed in front of the path */
    const attempt = (s, dl) => {
      const lz = STARTS[toS[s].k],
        fromLz = Float64Array.from(g, (p) => D(lz, p)),
        seq = new Int32Array(n),
        rest = Int32Array.from({ length: n }, (_, i) => i);
      /* rest[0..m) are the containers not yet walked to: the chosen one swaps out with the last */
      let m = n - 1;
      rest[s] = m;
      rest[m] = s;
      seq[0] = s;
      for (let k = 1; k < n; k++) {
        const c = seq[k - 1];
        let b = 0,
          bd = Infinity;
        for (let j = 0; j < m; j++) {
          const d = (xs[rest[j]] - xs[c]) ** 2 + (ys[rest[j]] - ys[c]) ** 2;
          if (d < bd) {
            bd = d;
            b = j;
          }
        }
        seq[k] = rest[b];
        rest[b] = rest[--m];
      }
      let imp = true;
      while (imp && performance.now() < dl) {
        imp = false;
        for (let i = 0; i < n - 1; i++) {
          const a = i > 0 ? seq[i - 1] : -1;
          for (let j = i + 1; j < n; j++) {
            /* reversing a prefix also pays for the new walk in from the start point */
            const b = seq[i],
              c = seq[j],
              d = j < n - 1 ? seq[j + 1] : -1;
            const before = (a < 0 ? fromLz[b] : dist(a, b)) + (d < 0 ? 0 : dist(c, d)),
              after = (a < 0 ? fromLz[c] : dist(a, c)) + (d < 0 ? 0 : dist(b, d));
            if (after < before - 1e-6) {
              seq.subarray(i, j + 1).reverse();
              imp = true;
            }
          }
          if (performance.now() > dl) break;
        }
      }
      let A = toS[seq[0]],
        B = nearestE(g[seq[n - 1]]);
      /* the other direction gets its own start and end point; take the shorter walk in + walk out (the walk out less any
         COP advantage), ties go to the shorter walk in */
      const A2 = toS[seq[n - 1]],
        B2 = nearestE(g[seq[0]]),
        f = A.d + B.e,
        r2 = A2.d + B2.e;
      if (r2 < f - 1e-6 || (Math.abs(r2 - f) <= 1e-6 && A2.d < A.d)) {
        seq.reverse();
        A = A2;
        B = B2;
      }
      let path = 0;
      for (let k = 1; k < n; k++) path += dist(seq[k - 1], seq[k]);
      return { seq, A, B, cost: A.d + path };
    };
    /* try several first stops (closest to a start point, and the two outermost containers) and keep the shortest;
       once the time is up, the best so far stands */
    const cy = sum(g.map((p) => p.lat)) / n,
      cx = sum(g.map((p) => p.lng)) / n,
      mid = { lat: cy, lng: cx },
      firstOf = (score, k) =>
        g
          .map((p, i) => [score(p, i), i])
          .sort((a, b) => a[0] - b[0])
          .slice(0, k)
          .map((x) => x[1]);
    const tries = [...new Set([...firstOf((p, i) => toS[i].d, 4), ...firstOf((p) => -D(p, mid), 2)])];
    let best = null;
    for (let k = 0; k < tries.length; k++) {
      const now = performance.now();
      if (best && now > deadline) break;
      const r = attempt(tries[k], now + Math.max(2, (deadline - now) / (tries.length - k)));
      if (!best || r.cost < best.cost) best = r;
    }
    const { A, B } = best,
      seq = Array.from(best.seq, (k) => g[k]),
      legs = seq.map((p, i) => (i ? D(seq[i - 1], p) : A.d)),
      path = sum(legs.slice(1)),
      total = A.d + path;
    const name =
      sectorOf(seq) ||
      (AREAS.length ? (job.near || "{a}").replace("{a}", AREAS[nearest(AREAS, mid).k].label) : job.wild || "–");
    return {
      seq: seq.map((p) => p.i),
      A,
      B,
      legs,
      path,
      avg: n > 1 ? path / (n - 1) : 0,
      total,
      full: total + B.d,
      per: total / n,
      cx,
      cy,
      radius: Math.max(...seq.map((p) => D(p, mid))),
      name,
      n,
    };
  }

  const est = estimate(P, Math.max(2, job.q || 2));
  if (!job.plan) return { est, runs: [], left: [], nosec: [], secn: [] };
  const gs = cluster(P, job.r),
    big = job.q ? gs.filter((g) => g.length >= job.q) : gs,
    noSec = new Set(job.noSec),
    secn = new Map(),
    nosec = [];
  const keep = big.filter((g) => {
    const s = sectorOf(g);
    if (s) secn.set(s, (secn.get(s) || 0) + 1);
    if (!noSec.has(s)) return true;
    g.forEach((p) => nosec.push([p.i, s]));
    return false;
  });
  const kept = new Set(keep),
    left = gs.filter((g) => !kept.has(g)).flatMap((g) => g.map((p) => p.i));
  /* the improvement budget is shared out by group size */
  const tot = sum(keep.map((g) => g.length)) || 1;
  let used = performance.now();
  const runs = keep.map((g) => {
    const r = plan(g, used + Math.max(15, (job.budget * g.length) / tot));
    used = performance.now();
    return r;
  });
  return { est, runs, left, nosec, secn: [...secn] };
}
