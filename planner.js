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
    STARTS = job.starts.map(([lat, lng]) => ({ lat, lng })),
    ENDS = job.ends.map(([lat, lng, cop]) => ({ lat, lng, cop: !!cop })),
    AREAS = job.areas.map(([lat, lng, label]) => ({ lat, lng, label })),
    D = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);
  const nearestIn = (set, p) => {
    let k = -1,
      bd = 1e18;
    set.forEach((l, i) => {
      const d = D(l, p);
      if (d < bd) {
        bd = d;
        k = i;
      }
    });
    return { k, d: bd };
  };
  const nearestS = (p) => nearestIn(STARTS, p);
  /* the end point: nearest by distance less the COP advantage (e), so a slightly farther COP beats an LZ; d is the real walk */
  const nearestE = (p) => {
    let k = -1,
      bd = 1e18,
      be = 1e18;
    ENDS.forEach((l, i) => {
      const d = D(l, p),
        e = d - (l.cop ? job.copBias || 0 : 0);
      if (e < be) {
        be = e;
        bd = d;
        k = i;
      }
    });
    return { k, d: bd, e: be };
  };
  /* a group's sector: where most of its stops are, ties alphabetical; routes are named after it and forbidden sectors drop it */
  const sectorOf = (g) => {
    const c = {};
    g.forEach((p) => {
      if (p.poi) c[p.poi] = (c[p.poi] || 0) + 1;
    });
    return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b))[0];
  };

  /* groups: containers closer than R chain together (single linkage), found through a grid of R-sized cells */
  function cluster(pts, R) {
    const cell = new Map(),
      key = (x, y) => x + "," + y;
    pts.forEach((p, i) => {
      const k = key(Math.floor(p.lng / R), Math.floor(p.lat / R));
      (cell.get(k) || cell.set(k, []).get(k)).push(i);
    });
    const lab = new Int32Array(pts.length).fill(-1),
      out = [];
    for (let i = 0; i < pts.length; i++) {
      if (lab[i] >= 0) continue;
      const c = [],
        st = [i];
      lab[i] = out.length;
      while (st.length) {
        const j = st.pop(),
          p = pts[j];
        c.push(p);
        const cx = Math.floor(p.lng / R),
          cy = Math.floor(p.lat / R);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const b = cell.get(key(cx + dx, cy + dy));
            if (!b) continue;
            for (const k of b)
              if (lab[k] < 0 && D(p, pts[k]) <= R) {
                lab[k] = out.length;
                st.push(k);
              }
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
      grid = new Map(),
      key = (x, y) => x + "," + y;
    pts.forEach((p, i) => {
      const k = key(Math.floor(p.lng / C), Math.floor(p.lat / C));
      (grid.get(k) || grid.set(k, []).get(k)).push(i);
    });
    const edges = [],
      K = 8;
    pts.forEach((p, i) => {
      const cx = Math.floor(p.lng / C),
        cy = Math.floor(p.lat / C),
        best = [];
      for (let ring = 0; ring <= 8; ring++) {
        for (let dx = -ring; dx <= ring; dx++)
          for (let dy = -ring; dy <= ring; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const b = grid.get(key(cx + dx, cy + dy));
            if (!b) continue;
            for (const j of b) if (j !== i) best.push([D(p, pts[j]), j]);
          }
        if (best.length >= K) {
          best.sort((a, b) => a[0] - b[0]);
          if (best[K - 1][0] <= ring * C) break;
        }
      }
      best.sort((a, b) => a[0] - b[0]);
      best.slice(0, K).forEach(([d, j]) => edges.push([d, i, j]));
    });
    edges.sort((a, b) => a[0] - b[0]);
    const par = Int32Array.from({ length: n }, (_, i) => i),
      sz = new Int32Array(n).fill(1),
      f = (x) => {
        while (par[x] !== x) {
          par[x] = par[par[x]];
          x = par[x];
        }
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

  /* one route: the shortest open walk through a group, from the nearer start point to the nearer end point */
  function plan(g, deadline) {
    const n = g.length;
    /* one attempt: nearest-neighbour walk from container s, then 2-opt with the start point fixed in front of the path */
    const attempt = (s, dl) => {
      const lz0 = STARTS[nearestS(g[s]).k];
      const left = new Set(g.map((p, i) => i));
      let cur = s,
        seq = [];
      left.delete(s);
      seq.push(g[s]);
      while (left.size) {
        let b = -1,
          bd = 1e18;
        for (const k of left) {
          const d = D(g[cur], g[k]);
          if (d < bd) {
            bd = d;
            b = k;
          }
        }
        left.delete(b);
        seq.push(g[b]);
        cur = b;
      }
      let imp = true;
      while (imp && performance.now() < dl) {
        imp = false;
        for (let i = 0; i < n - 1; i++) {
          for (let j = i + 1; j < n; j++) {
            /* reversing a prefix also pays for the new walk in from the start point */
            const a = i > 0 ? seq[i - 1] : lz0,
              b = seq[i],
              c = seq[j],
              d = j < n - 1 ? seq[j + 1] : null;
            const before = D(a, b) + (d ? D(c, d) : 0),
              after = D(a, c) + (d ? D(b, d) : 0);
            if (after < before - 1e-6) {
              let x = i,
                y = j;
              while (x < y) {
                const t = seq[x];
                seq[x] = seq[y];
                seq[y] = t;
                x++;
                y--;
              }
              imp = true;
            }
          }
          if (performance.now() > dl) break;
        }
      }
      let A = nearestS(seq[0]),
        B = nearestE(seq[n - 1]);
      /* the other direction gets its own start and end point; take the shorter walk in + walk out (the walk out less any
         COP advantage), ties go to the shorter walk in */
      const A2 = nearestS(seq[n - 1]),
        B2 = nearestE(seq[0]),
        f = A.d + B.e,
        r2 = A2.d + B2.e;
      if (r2 < f - 1e-6 || (Math.abs(r2 - f) <= 1e-6 && A2.d < A.d)) {
        seq.reverse();
        A = A2;
        B = B2;
      }
      let path = 0;
      for (let i = 1; i < n; i++) path += D(seq[i - 1], seq[i]);
      return { seq, A, B, cost: A.d + path };
    };
    /* try several first stops (closest to a start point, and the two outermost containers) and keep the shortest */
    const byLZ = g
      .map((p, i) => [nearestS(p).d, i])
      .sort((a, b) => a[0] - b[0])
      .slice(0, 4)
      .map((x) => x[1]);
    const gy = g.reduce((s, p) => s + p.lat, 0) / n,
      gx = g.reduce((s, p) => s + p.lng, 0) / n;
    const outer = g
      .map((p, i) => [Math.hypot(p.lat - gy, p.lng - gx), i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map((x) => x[1]);
    const starts = [...new Set([...byLZ, ...outer])];
    let bestTry = null;
    starts.forEach((s, k) => {
      const now = performance.now(),
        r = attempt(s, now + Math.max(2, (deadline - now) / (starts.length - k)));
      if (!bestTry || r.cost < bestTry.cost) bestTry = r;
    });
    const { seq, A, B } = bestTry;
    const legs = seq.map((p, i) => (i ? D(seq[i - 1], p) : A.d)),
      path = legs.slice(1).reduce((s, v) => s + v, 0);
    const cy = seq.reduce((s, p) => s + p.lat, 0) / n,
      cx = seq.reduce((s, p) => s + p.lng, 0) / n,
      radius = Math.max(...seq.map((p) => Math.hypot(p.lat - cy, p.lng - cx)));
    let name = sectorOf(seq);
    if (!name && AREAS.length) {
      let b = null,
        bd = 1e18;
      AREAS.forEach((m) => {
        const d = Math.hypot(m.lat - cy, m.lng - cx);
        if (d < bd) {
          bd = d;
          b = m;
        }
      });
      name = b ? (job.near || "{a}").replace("{a}", b.label) : job.wild || "–";
    }
    const total = A.d + path;
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
      radius,
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
  const tot = keep.reduce((s, g) => s + g.length, 0) || 1;
  let used = performance.now();
  const runs = keep.map((g) => {
    const r = plan(g, used + Math.max(15, (job.budget * g.length) / tot));
    used = performance.now();
    return r;
  });
  return { est, runs, left, nosec, secn: [...secn] };
}
