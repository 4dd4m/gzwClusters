const $ = (id) => document.getElementById(id);
const T = DATA.types,
  LZ = DATA.lz.map((a) => ({ lat: a[0], lng: a[1], name: a[2], poi: a[3], kind: "lz" })),
  OB = DATA.ob.map((a) => ({ lat: a[0], lng: a[1] }));
const M = DATA.marks.map((a, i) => ({
  i,
  t: a[0],
  lat: a[1],
  lng: a[2],
  label: a[3],
  poi: a[4],
  icon: a[5],
  id: a[6],
}));
const THUMB = new Set(DATA.thumbs || []),
  PHOTO = DATA.photos || {},
  tipImg = new Image();
tipImg.alt = "";
tipImg.className = "tipimg";
tipImg.onload = () => placeTip();
/* linked photos load straight from gzwtacmap's image server; where the page blocks outside images, fall back to the bundled thumbnail or hide */
const BAD = new Set();
tipImg.onerror = () => {
  const id = +tipImg.dataset.id,
    was = tipImg.dataset.src;
  BAD.add(was + id);
  if (was === "remote" && THUMB.has(id)) {
    tipImg.dataset.src = "local";
    tipImg.src = `thumbs/${id}.jpg`;
    return;
  }
  tipImg.remove();
  placeTip();
};
const photoFor = (id) =>
  PHOTO[id] && !BAD.has("remote" + id)
    ? ["remote", "https://static.gzwtacmap.com/markers/" + PHOTO[id]]
    : THUMB.has(id) && !BAD.has("local" + id)
      ? ["local", `thumbs/${id}.jpg`]
      : null;
const IMG = {};
for (const k in DATA.icons) {
  if (!DATA.icons[k]) continue;
  const im = new Image();
  im.src = DATA.icons[k];
  im.onload = () => schedule();
  IMG[k] = im;
}
/* COP icons are drawn tinted blue: the light fill takes the colour, the dark outline stays dark */
const TINT = new Map();
function tinted(im, col) {
  const k = im.src.length + col;
  let c = TINT.get(k);
  if (c) return c;
  if (!im.complete || !im.naturalWidth) return null;
  c = document.createElement("canvas");
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const x = c.getContext("2d");
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = "multiply";
  x.fillStyle = col;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(im, 0, 0);
  TINT.set(k, c);
  return c;
}
/* numbers in the language's own style: 1,234 m / 1 234 m; widths as "850 m" or "1.2 km" / "1,2 km" */
const D = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng),
  fm = (v) => Math.round(v).toLocaleString(locale()),
  fdist = (v) =>
    v >= 1000
      ? (v / 1000).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km"
      : Math.round(v) + " m";
/* start/end points: landing zones, plus COPs when "COP as start point" / "COP as end point" is on */
const COPS = M.filter((m) => T[m.t].name === "COP").map((m) => ({
  lat: m.lat,
  lng: m.lng,
  name: m.label,
  poi: m.poi,
  kind: "cop",
  icon: m.icon,
}));
const nm = (l) => (l.kind === "cop" ? l.name : "LZ " + l.name);
/* "COP as start point" starts every route at one chosen COP; the list shows them A-Z without the "Outpost" prefix */
{
  const sel = $("copStart");
  COPS.map((c) => [c.name.replace(/^Outpost\s+/i, ""), c])
    .sort((a, b) => a[0].localeCompare(b[0], "hu"))
    .forEach(([n, c]) => {
      const o = document.createElement("option");
      o.value = c.name;
      o.textContent = n + (c.poi ? " · " + c.poi : "");
      sel.appendChild(o);
    });
}
const copStartPt = () => COPS.find((c) => c.name === S.copStart) || null;
/* on the map, COPs drop the "Outpost" prefix: "Outpost Ripcord" shows as "Ripcord" */
const short = (t) => t.replace(/^Outpost\s+/i, ""),
  mapNm = (l) => (l.kind === "cop" ? short(l.name) : nm(l));
/* compass heading from a to b: 0° = north (up on the map), clockwise, e.g. "47°" */
const heading = (a, b) =>
  (Math.round(((Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI + 360) % 360) % 360) + "°";
let LZS = LZ,
  LZE = LZ; /* start points and end points: LZs, plus COPs when the matching option is on */
const nearestIn = (set, p) => {
  let b = null,
    bd = 1e18;
  for (const l of set) {
    const d = D(l, p);
    if (d < bd) {
      bd = d;
      b = l;
    }
  }
  return { lz: b, d: bd };
};
const nearestS = (p) => nearestIn(LZS, p);
/* end point: the nearest LZ, or a COP (COP as end point) if it is at most S.copBias metres farther; same rule as the planner */
const nearestE = (p) => {
  let b = null,
    bd = 1e18,
    be = 1e18;
  for (const l of LZE) {
    const d = D(l, p),
      e = d - (l.kind === "cop" ? S.copBias : 0);
    if (e < be) {
      be = e;
      bd = d;
      b = l;
    }
  }
  return { lz: b, d: bd };
};
const AREAS = (DATA.areas || []).map((a) => ({ lat: a[0], lng: a[1], label: a[2] }));
/* zone borders (Blue Lagoon, YBL-1, ...), traced from gzwtacmap's region overlay: "x,y x,y|..." in map metres, x = lng, y = lat */
const ZB =
  "3916,7516 3884,7548 3836,7548 3780,7572 3732,7620 3724,7644 3692,7668 3628,7676 3556,7708 3484,7788 3452,7804 3356,7820 3324,7844 3284,7844 3236,7804 3180,7796 3156,7780 3124,7780 3020,7676 2980,7660 2908,7652 2796,7540 2684,7508 2660,7484 2660,7444 2676,7412 2676,7356 2644,7244 2652,7236 2652,7196 2676,7156 2676,7100 2644,7012 2644,6948 2660,6932 2676,6876 2700,6836 2716,6764 2756,6724 2796,6708 2836,6660 2876,6540 2908,6508 2940,6500 2988,6452 3020,6372 3020,6348 3140,6244 3156,6180 3172,6156 3180,6100 3204,6084 3244,6084 3260,6068 3292,6028 3308,5964 3332,5924 3484,5900 3540,5868 3564,5828 3620,5812 3636,5820 3692,5820 3732,5804 3812,5732 3940,5716 4012,5684 4092,5676 4164,5716 4244,5716 4340,5692 4428,5740 4500,5740 4516,5724|9596,7332 9516,7332 9476,7308 9452,7308 9420,7292 9340,7316 9260,7316 9180,7284 9100,7292 9076,7308 9012,7308 8924,7268 8860,7276 8836,7292 8756,7292 8660,7252 8604,7260 8572,7276 8524,7276 8492,7268 8444,7228 8396,7212 8252,7220 8212,7204 8188,7172 8164,7164 8012,7172 7956,7148 7932,7124 7884,7108 7876,7116 7764,7124 7708,7100 7668,7060|6556,7140 6556,7156 6532,7180 6452,7188 6380,7212 6308,7292 6220,7300 6156,7324 6060,7412 5996,7412 5924,7436 5900,7468 5828,7524 5764,7524 5692,7548 5596,7612 5476,7612 5452,7628 5428,7628 5372,7676 5204,7692 5116,7756 5052,7756 4988,7716 4828,7724 4780,7684 4700,7660 4692,7668 4572,7668 4524,7628 4484,7612 4324,7620 4292,7604 4276,7580 4204,7556 4188,7564 4060,7564 4036,7556 3996,7516 3932,7508 3924,7500 3924,7444 3940,7396 3988,7340 4012,7332 4044,7300 4076,7172 4100,7140 4140,7116 4196,7060 4204,7036 4228,7020 4252,6980 4340,6940 4380,6940 4476,6828 4596,6796 4620,6772 4628,6748 4652,6732 4660,6708 4764,6612 4796,6460 4892,6364 4908,6244 4940,6188 4932,6148 4900,6108 4876,6100 4812,6052 4764,5924 4692,5876 4628,5804 4620,5740 4604,5724 4532,5716 4524,5708 4532,5660 4580,5620 4604,5580 4612,5484 4636,5420 4676,5404 4700,5364 4716,5308 4724,5220 4764,5172 4788,5164 4804,5132|7668,7060 7540,7068 7516,7092 7452,7124 7324,7116 7220,7180 7124,7180 7100,7172 7036,7196 6980,7236 6924,7236 6844,7180 6692,7188 6652,7172 6620,7140 6572,7132 6556,7116 6532,7052 6540,6948 6524,6908 6468,6836 6460,6804 6468,6692 6460,6668 6404,6596 6396,6564 6396,6452 6372,6412 6364,6324 6380,6308 6388,6276 6404,6260 6420,6260 6436,6236 6444,6212 6444,6060 6460,6028 6492,6004 6508,5932 6524,5908 6612,5900 6652,5916 6668,5940 6692,5948 6756,5948 6780,5932 6876,5932 6940,5964 6972,5964 6980,5956 6964,5924 6964,5900 6932,5852 6948,5716 6884,5604 6892,5476|7668,7060 7684,6996 7668,6932 7668,6860 7708,6772 7708,6708 7692,6668 7692,6612 7732,6540 7732,6508 7740,6500 7716,6412 7684,6388 7676,6364 7684,6276 7668,6252 7668,6228 7596,6148 7596,6060 7580,6004 7548,5980 7516,5988 7484,6012 7420,6012 7364,5980 7300,5980 7244,6004 7156,6004 7100,5972 7020,5972 7012,5980 6988,5972|11140,6268 11060,6268 11020,6244 10972,6180 10932,6164 10828,6156 10804,6132 10780,6124 10740,6076 10692,6052 10620,5988 10572,5852 10532,5836 10468,5780 10452,5748 10444,5684 10428,5660 10404,5636 10372,5628 10332,5644 10164,5636 10132,5660 10092,5668 10068,5684 9996,5684 9956,5668 9884,5676 9844,5716 9844,5732 9820,5764 9684,5820 9668,5836 9660,5876 9644,5892 9636,5940 9596,5980 9548,5996 9508,6044 9476,6140 9476,6244 9484,6268 9556,6348 9580,6420 9580,6492 9636,6548 9652,6596 9652,6644 9620,6692 9620,6724 9612,6732 9644,6868 9628,6932 9612,6948 9612,7044 9628,7068 9628,7172 9604,7204 9604,7316 9684,7364 9708,7388 9708,7404 9756,7452 9868,7484 9972,7604 10004,7604 10036,7620 10084,7628 10132,7676 10132,7692 10180,7748 10228,7748 10292,7772 10332,7812 10340,7836 10404,7892 10460,7892 10484,7868 10540,7852 10636,7844 10716,7772 10796,7748 10868,7748 10956,7676 10996,7660 11028,7652 11036,7660 11092,7660 11116,7652 11196,7572 11252,7556 11340,7556 11364,7548 11388,7516 11460,7468 11588,7460 11628,7420 11620,7380 11596,7340 11596,7252 11588,7228 11516,7140 11492,6980 11412,6900 11396,6748 11324,6676 11308,6636 11308,6548 11292,6524 11292,6500 11252,6468 11244,6444 11220,6420 11204,6300 11180,6276 11156,6268|11148,6260 11148,6188 11172,6124 11172,6092 11124,5980 11140,5820 11100,5748 11092,5716 11092,5660 11116,5620 11116,5572 11068,5484 11068,5396 11084,5356 11084,5300 11124,5204 11156,5172 11188,5164 11236,5108 11260,5012 11300,4964 11332,4956 11380,4908 11412,4804 11452,4764 11492,4748 11524,4716 11532,4684 11484,4604 11492,4444 11436,4340 11436,4260 11452,4220 11436,4188 11436,4164 11412,4140 11404,4108 11380,4076 11340,3948 11300,3932 11228,3860 11196,3748 11100,3676 11068,3620 11068,3580 11036,3532 10932,3492 10884,3444 10868,3396 10828,3356 10788,3348 10716,3308 10660,3204 10612,3180 10548,3164 10500,3124 10508,3092 10580,3036 10580,2996 10604,2956 10604,2940 10652,2892 10692,2876 10732,2844 10772,2732 10812,2692 10836,2684 10892,2636 10916,2572 10916,2532|3172,6084 3084,6052 3036,6004 3020,5964 2988,5924 2876,5884 2836,5836 2828,5804 2788,5764 2700,5724 2676,5724 2636,5684 2620,5644 2580,5612 2516,5596 2492,5580 2468,5580 2420,5532 2396,5484 2332,5444 2308,5444 2284,5412 2284,5356 2316,5308 2316,5268 2324,5260 2316,5204 2300,5180 2300,5100 2340,5044 2340,4980 2316,4876 2324,4868 2324,4836 2356,4788 2356,4724 2340,4684 2340,4588 2372,4532 2380,4476 2372,4468 2372,4428 2356,4412 2332,4356 2332,4300 2340,4292 2332,4284 2332,4252 2316,4212 2252,4132 2252,4012 2236,3972 2188,3916 2188,3868 2212,3844 2244,3836 2292,3780 2300,3740 2324,3700 2324,3676 2348,3644 2396,3620 2436,3580 2476,3484 2476,3460 2516,3420 2548,3412 2588,3372 2620,3284 2620,3260 2660,3212 2700,3196 2836,3100 2860,3092 2956,3100 3004,3076 3068,3020 3092,3012 3196,3012 3228,2996 3236,2972|9668,5812 9628,5724 9540,5676 9524,5676 9492,5644 9468,5572 9436,5540 9348,5500 9308,5460 9284,5388 9252,5356 9236,5356 9204,5332 9156,5316 9132,5292 9100,5212 8996,5100 8996,5068 8988,5060 8996,5052 8996,4964 8956,4908 8932,4844|6884,5468 6740,5436 6692,5404 6676,5372 6644,5340 6516,5316 6492,5292 6468,5284 6412,5220 6388,5220 6364,5204 6292,5196 6276,5180 6244,5172 6228,5156 6220,5124 6188,5100 6148,5084 6068,5076 6044,5052 6028,5052 5964,4980 5940,4972 5884,4988 5844,5012 5764,5012 5732,4996 5692,4996 5612,5036 5564,5036 5556,5044 5508,5044 5492,5028 5460,5020 5348,5060 5332,5076 5268,5076 5228,5060 5180,5060 5148,5068 5132,5084 5116,5084 5076,5108 5004,5108 4972,5092 4916,5092 4868,5116 4812,5124|6900,5468 6996,5436 7060,5436 7156,5348 7220,5324 7316,5316 7380,5244 7460,5212 7540,5204 7620,5124 7692,5100 7812,5108 7868,5084 7916,5084 8004,5124 8060,5124 8084,5108 8172,5100 8244,5140 8316,5140 8340,5124 8412,5116 8444,5100 8492,5100 8532,5084 8604,4996 8668,4972 8716,4972 8748,4956 8772,4916 8820,4868 8836,4868 8868,4844 8892,4836 8924,4836 8932,4844|4804,5116 4796,5108 4804,5012 4828,4988 4844,4932 4836,4876 4820,4852 4820,4796 4836,4748 4860,4724 4860,4692 4868,4684 4868,4628 4852,4596 4852,4532 4892,4444 4892,4372 4876,4348 4876,4276 4908,4220 4924,4164 4908,4100 4908,4012 4948,3932 4948,3900 4940,3876 4884,3844 4852,3804 4828,3748 4820,3692 4804,3676 4772,3676 4756,3660|8932,4844 8988,4764 8988,4732 8996,4724 8988,4716 8988,4676 8972,4652 8972,4596 9012,4524 9020,4412 8972,4340 8972,4276 8948,4212 8900,4164 8876,4156 8852,4124 8844,4028 8820,3980 8740,3908 8732,3884 8740,3772 8724,3740 8724,3716 8700,3676 8700,3620 8732,3564 8732,3492 8724,3484|4828,3676 4876,3644 4916,3644 4924,3652 5020,3644 5052,3612 5076,3604 5092,3580 5116,3580 5140,3564 5260,3572 5292,3540 5348,3516 5396,3516 5420,3532 5452,3532 5460,3540 5540,3540 5612,3508 5652,3508 5700,3532 5796,3532 5868,3500 5908,3500 5956,3524 6052,3524 6076,3508 6108,3508 6116,3500 6180,3500 6228,3524 6292,3524 6380,3492 6428,3492 6492,3516 6548,3516 6604,3484 6620,3460 6652,3452 6788,3452 6868,3396 6908,3380 7020,3388 7084,3356 7116,3324 7172,3308 7228,3308 7236,3300 7236,3244 7204,3156 7204,3084 7228,3044 7228,2964 7204,2900 7204,2836 7228,2788 7236,2700|8724,3484 8756,3460 8828,3452 8860,3460 8924,3500 8980,3500 9020,3484 9124,3476 9180,3460|8724,3484 8716,3476 8668,3476 8564,3428 8476,3460 8396,3460 8348,3436 8300,3428 8204,3468 8148,3468 8076,3436 8036,3436 7964,3468 7860,3468 7812,3436 7788,3436 7716,3468 7628,3476 7604,3468 7556,3420 7412,3404 7372,3380 7340,3340 7244,3316|9188,3468 9212,3492 9244,3564 9244,3588 9268,3620 9404,3716 9476,3796 9516,3796 9596,3820 9636,3860 9644,3884 9692,3924 9732,3924 9804,3948 9876,4012 9900,4020 9948,4012 9964,3996 10028,3972 10092,3884 10100,3852 10100,3724 10116,3684 10164,3628 10172,3524 10188,3484 10308,3396 10332,3300 10388,3244 10420,3236 10460,3196 10468,3164 10492,3140|9188,3452 9228,3348 9236,3196 9172,3068 9220,2932 9196,2836 9196,2796 9236,2724 9244,2620 9260,2588 9284,2572 9316,2572 9340,2556 9380,2556 9412,2540 9476,2484 9492,2452 9548,2436 9588,2436 9596,2444 9604,2436 9660,2436 9732,2380 9764,2372 9836,2372 9844,2380 9908,2372 9980,2316 10044,2308 10108,2348 10276,2348 10300,2356 10324,2388 10380,2412 10484,2404 10492,2396 10532,2404 10580,2444 10636,2468 10772,2460 10804,2476 10836,2508 10916,2532|3244,2964 3292,2956 3348,2924 3484,2932 3580,2884 3636,2884 3676,2900 3740,2892 3772,2876 3812,2876 3820,2884 3788,2964 3772,3116 3716,3172 3700,3212 3700,3268 3740,3340 3772,3444 3876,3532 3900,3588 3900,3620 3932,3660 3988,3660 4036,3636 4092,3636 4140,3660 4228,3660 4276,3644 4292,3628 4340,3628 4388,3652 4492,3652 4516,3636 4548,3636 4556,3628 4604,3628 4676,3652 4740,3652 4756,3636 4764,3596 4796,3572 4820,3524 4828,3500 4828,3404 4852,3364 4908,3308 4908,3284 4924,3260 4924,3156 4972,3076 4972,3012 4964,3004 4964,2972 4948,2948 4948,2876 4980,2820 4980,2748 4948,2660 4892,2604 4844,2588 4716,2580 4668,2532 4588,2508 4516,2580 4388,2596 4356,2612 4268,2692 4244,2700 4156,2700 4124,2716 4036,2796 3940,2804 3892,2820 3828,2868|3236,2956 3236,2876 3252,2860 3260,2780 3228,2700 3228,2644 3268,2556 3260,2500 3236,2460 3236,2364 3260,2324 3260,2252 3236,2204 3236,2108 3252,2092 3292,2084 3316,2068 3332,2052 3372,1972 3372,1956 3420,1916 3492,1884 3516,1860 3548,1780 3588,1740 3644,1724 3692,1676 3700,1644 3732,1612 3740,1588 3788,1540 3820,1524 3844,1524 3868,1500 3908,1428 3908,1412 3964,1364 4036,1332 4060,1292 4060,1276 4108,1236 4164,1220 4252,1220 4276,1212 4348,1140 4500,1124 4580,1052 4604,1052 4628,1036 4724,1036 4820,956 4884,940 4972,940 5068,860 5092,852 5220,844 5300,772 5364,764 5372,756 5452,756 5492,716 5516,708 5564,668 5620,668 5668,692 5716,692 5764,668 5804,668 5812,660 5884,668 5900,692 5988,692 6012,676 6060,676 6068,668 6140,668 6148,676|7236,2700 7244,2692 7300,2692 7332,2676 7356,2676 7428,2636 7492,2652 7580,2644 7660,2596 7732,2596 7748,2580 7756,2492 7740,2428 7740,2372 7780,2300 7780,2220 7764,2196 7764,2108 7796,2068 7820,1996 7820,1892 7836,1860 7876,1820 7900,1764 7908,1636 7964,1564 7964,1516 7932,1428 7932,1380 7972,1300 7972,1268 7940,1172 7940,1116 8004,980|7236,2700 7196,2676 7156,2676 7084,2604 7068,2604 7052,2588 7004,2572 6932,2572 6916,2564 6820,2468 6732,2460 6708,2452 6684,2428 6668,2324 6628,2252 6580,2212 6564,2180 6564,2132 6572,2124 6556,2068 6516,2028 6508,1996 6460,1948 6468,1884 6444,1812 6364,1740 6348,1604 6308,1564 6300,1540 6260,1508 6260,1428 6276,1388 6276,1356 6220,1260 6220,1196 6236,1164 6236,1100 6212,1052 6212,1028 6188,1004 6188,932 6204,892 6204,860 6196,828 6156,764 6148,676|10916,2532 10948,2516 11004,2516 11052,2532 11084,2564 11124,2580 11252,2572 11300,2588 11332,2620 11364,2636 11452,2636 11492,2596 11548,2572 11572,2572 11604,2548 11660,2476 11660,2420 11700,2348 11700,2316 11708,2308 11708,2244 11692,2220 11692,2156 11724,2116 11740,2068 11740,1996 11724,1964 11732,1868 11684,1820 11556,1796 11476,1708 11444,1692 11364,1684 11316,1668 11292,1644 11284,1620 11236,1580 11196,1564 11148,1564 11092,1548 11060,1524 11052,1500 11012,1460 10980,1444 10876,1436 10828,1388 10828,1372 10780,1332 10764,1324 10644,1332 10612,1316 10556,1260 10508,1244 10404,1252 10292,1172 10148,1172 10068,1100 10020,1084 9916,1092 9876,1068 9852,1036 9812,1020 9780,1012 9764,1020 9644,1020 9604,980 9524,956 9516,964 9404,972 9380,964 9332,916 9308,916 9276,900 9252,908 9140,908 9092,868 9028,852 8900,860 8876,852 8852,820 8788,796 8716,804 8684,836 8540,836 8428,908 8300,908 8220,948 8188,980 8060,980 8052,988 8020,988 8012,980|8004,972 7980,940 7980,868 8036,796 8036,764 8044,756 8036,628 8084,548 8060,508 8020,492 7932,484 7836,388 7716,372 7628,292 7596,292 7588,284 7484,284 7476,292 7468,284 7436,284 7404,244 7340,220 7316,228 7196,228 7140,180 7084,156 7044,172 6980,236 6844,268 6820,308 6780,348 6756,356 6732,380 6684,380 6620,404 6540,484 6508,500 6452,500 6412,516 6324,612 6292,628 6212,636 6172,652 6148,676"
    .split("|")
    .map((l) =>
      l.split(" ").map((q) => {
        const [x, y] = q.split(",");
        return { lng: +x, lat: +y };
      }),
    );

/* ---------- state ---------- */
const RMIN = 150;
const KEY = "lamang-runs-v2",
  DEF = () => ({
    sel: new Set([T.findIndex((t) => t.name === "Building Material Crate")]),
    r: 300,
    useQ: true,
    q: 3,
    useGZ: false,
    inv: false,
    poiNames: false,
    useCopS: false,
    copStart: "",
    useCopE: false,
    /* COP as end point: a COP wins over a nearer LZ if it is at most this many metres farther (0 = nearest wins) */
    copBias: 200,
    legLen: true,
    legHead: true,
    legNum: false,
    zoneB: true,
    /* Early exfil: green arrows from the selected route's best bail-out stops to the nearest LZ or COP */
    bail: false,
    browse: false,
    /* Segédlet: the route settings' explanations show on hover */
    hints: true,
    noSec: new Set(),
    /* locks added to routes as stops (marker ids), and containers marked looted: position (see mkey) -> when (ms) */
    doorStops: new Set(),
    looted: new Map(),
    /* the looted positions the routes are planned without: a snapshot taken only by Recalculate, so ticks during a run
       (and marks running out) never change the routes until you ask */
    planExcl: new Set(),
    run: null,
  });
const S = DEF(),
  TID = new Map(T.map((t, i) => [t.id, i]));
/* task objectives are not offered in the type list, and a saved selection of them is dropped */
const OFFLIST = new Set(["Task objectives"]);
try {
  localStorage.removeItem("lamang-runs");
  const s = JSON.parse(localStorage.getItem(KEY) || "null");
  if (s) {
    S.sel = new Set(
      (s.types || []).map((id) => TID.get(id)).filter((i) => i !== undefined && !OFFLIST.has(T[i].group)),
    );
    if (s.r > 0) S.r = Math.max(RMIN, +s.r);
    if (typeof s.useQ === "boolean") S.useQ = s.useQ;
    if (s.q > 0) S.q = Math.max(1, Math.round(+s.q));
    S.useGZ = !!s.useGZ;
    S.inv = !!s.inv;
    S.poiNames = !!s.poiNames;
    if (typeof s.copStart === "string") S.copStart = s.copStart;
    if ("useCopS" in s || "useCopE" in s) {
      S.useCopS = !!s.useCopS;
      S.useCopE = !!s.useCopE;
    } else S.useCopS = S.useCopE = !!s.useCop;
    if (typeof s.copBias === "number" && s.copBias >= 0) S.copBias = Math.round(s.copBias);
    if (typeof s.legLen === "boolean") S.legLen = s.legLen;
    if (typeof s.legHead === "boolean") S.legHead = s.legHead;
    if (typeof s.legNum === "boolean") S.legNum = s.legNum;
    if (typeof s.zoneB === "boolean") S.zoneB = s.zoneB;
    if (typeof s.bail === "boolean") S.bail = s.bail;
    S.browse = !!s.browse;
    if (typeof s.hints === "boolean") S.hints = s.hints;
    if (Array.isArray(s.noSec)) S.noSec = new Set(s.noSec.filter((x) => typeof x === "string"));
    if (Array.isArray(s.doorStops)) S.doorStops = new Set(s.doorStops.filter((x) => Number.isInteger(x)));
    /* [[position, time], ...]; the older plain list of positions had no time, so it is dropped as expired */
    if (Array.isArray(s.looted))
      S.looted = new Map(
        s.looted
          .filter((x) => Array.isArray(x) && typeof x[0] === "string" && Number.isFinite(x[1]))
          .slice(0, 2000),
      );
    /* saved before the snapshot existed: start it from the marks still running */
    S.planExcl = Array.isArray(s.planExcl)
      ? new Set(s.planExcl.filter((x) => typeof x === "string").slice(0, 2000))
      : new Set([...S.looted].filter(([, at]) => Date.now() - at < 30 * 60000).map(([k]) => k));
    if (Array.isArray(s.run)) S.run = s.run.filter((k) => typeof k === "string").slice(0, 1000);
    if (typeof s.search === "string") $("tq").value = s.search;
  }
} catch {}
if (!COPS.some((c) => c.name === S.copStart)) S.copStart = $("copStart").options[0]?.value || "";
/* set while an import replaces the stored data and the page reloads: nothing may write over it meanwhile */
let FROZEN = false;
const save = () => {
  if (FROZEN) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        types: [...S.sel].map((i) => T[i].id),
        r: S.r,
        useQ: S.useQ,
        q: S.q,
        useGZ: S.useGZ,
        inv: S.inv,
        poiNames: S.poiNames,
        useCopS: S.useCopS,
        copStart: S.copStart,
        useCopE: S.useCopE,
        copBias: S.copBias,
        legLen: S.legLen,
        legHead: S.legHead,
        legNum: S.legNum,
        zoneB: S.zoneB,
        bail: S.bail,
        browse: S.browse,
        hints: S.hints,
        noSec: [...S.noSec],
        doorStops: [...S.doorStops],
        looted: [...S.looted],
        planExcl: [...S.planExcl],
        run: S.run,
        search: $("tq").value,
      }),
    );
  } catch {}
  /* while a preset is selected, every saved change goes into it too */
  const p = ACTIVE && PRESETS.find((x) => x.name === ACTIVE);
  if (p) {
    p.data = presetData();
    savePresets();
  }
};
/* ---------- presets ---------- */
/* Named copies of what shapes the routes: route settings, container types, forbidden sectors, reverse direction,
   doors added as stops and the selected route (not map display switches, browse only, Segédlet, raid ticks or the
   language). Kept apart from the settings, so Alaphelyzet never wipes them. ACTIVE is the preset being edited. */
const PRESETKEY = "lamang-presets-v1";
let PRESETS = [],
  ACTIVE = null;
try {
  const p = JSON.parse(localStorage.getItem(PRESETKEY) || "null");
  if (p && Array.isArray(p.list))
    PRESETS = p.list.filter(
      (x) => x && typeof x.name === "string" && x.name.trim() && x.data && typeof x.data === "object",
    );
  if (p && PRESETS.some((x) => x.name === p.active)) ACTIVE = p.active;
} catch {}
const savePresets = () => {
  if (FROZEN) return;
  try {
    localStorage.setItem(PRESETKEY, JSON.stringify({ list: PRESETS, active: ACTIVE }));
  } catch {}
};
const presetData = () => ({
  types: [...S.sel].map((i) => T[i].id),
  r: S.r,
  useQ: S.useQ,
  q: S.q,
  useGZ: S.useGZ,
  useCopS: S.useCopS,
  copStart: S.copStart,
  useCopE: S.useCopE,
  copBias: S.copBias,
  noSec: [...S.noSec],
  inv: S.inv,
  doorStops: [...S.doorStops],
  run: S.run,
});
/* a preset's data into the state, checked like a saved state; fields it lacks keep their defaults */
function applyPreset(d) {
  const D0 = DEF();
  S.sel = new Set(
    (Array.isArray(d.types) ? d.types : [])
      .map((id) => TID.get(id))
      .filter((i) => i !== undefined && !OFFLIST.has(T[i].group)),
  );
  S.r = d.r > 0 ? Math.max(RMIN, +d.r) : D0.r;
  S.useQ = typeof d.useQ === "boolean" ? d.useQ : D0.useQ;
  S.q = d.q > 0 ? Math.max(1, Math.round(+d.q)) : D0.q;
  S.useGZ = !!d.useGZ;
  S.useCopS = !!d.useCopS;
  if (COPS.some((c) => c.name === d.copStart)) S.copStart = d.copStart;
  S.useCopE = !!d.useCopE;
  S.copBias = typeof d.copBias === "number" && d.copBias >= 0 ? Math.round(d.copBias) : D0.copBias;
  S.noSec = new Set((Array.isArray(d.noSec) ? d.noSec : []).filter((x) => typeof x === "string"));
  S.inv = !!d.inv;
  S.doorStops = new Set((Array.isArray(d.doorStops) ? d.doorStops : []).filter((x) => Number.isInteger(x)));
  S.run = Array.isArray(d.run) ? d.run.filter((k) => typeof k === "string").slice(0, 1000) : null;
}
/* the selected route is stored as its containers' positions, so it is found again after a reload even if routes are renumbered */
const mkey = (p) => Math.round(p.lat) + "," + Math.round(p.lng);
const syncInputs = () => {
  $("r").value = S.r;
  $("useQ").checked = S.useQ;
  $("q").value = S.q;
  $("useGZ").checked = S.useGZ;
  $("inv").checked = S.inv;
  $("poiNames").checked = S.poiNames;
  $("useCopS").checked = S.useCopS;
  $("copStart").value = S.copStart;
  $("copStart").disabled = !S.useCopS;
  $("useCopE").checked = S.useCopE;
  $("copBias").value = S.copBias;
  $("copBias").disabled = !S.useCopE;
  $("legLen").checked = S.legLen;
  $("legHead").checked = S.legHead;
  $("legNum").checked = S.legNum;
  $("zoneB").checked = S.zoneB;
  $("bail").checked = S.bail;
  $("browse").checked = S.browse;
  $("hints").checked = S.hints;
  document.body.classList.toggle("nohints", !S.hints);
  $("q").disabled = !S.useQ;
  /* the forbidden sectors button carries their count: "Forbidden sectors (7)"; none, no count */
  $("secBtn").textContent = t("sec.btn") + (S.noSec.size ? ` (${S.noSec.size})` : "");
};
syncInputs();
document.body.classList.toggle("browse", S.browse);

/* ---------- type list ---------- */
const typesEl = $("types"),
  tyBoxes = [],
  grpEls = [],
  poiLabels = [];
/* a point of interest's name button shows it on the map; its box adds it to the routes (labels redone on a language change) */
function labelTypes() {
  poiLabels.forEach(([nb, cb, n]) => {
    nb.title = t("ty.show", { n });
    cb.setAttribute("aria-label", t("ty.add", { n }));
  });
}
const groups = [...new Set(T.map((t) => t.group))].filter((g) => !OFFLIST.has(g));
/* group names are UI text (grp.<group> in i18n.js), while the data keeps its English keys */
const order = ["Containers", "Points of interest", "General"];
groups.sort((a, b) => order.indexOf(a) - order.indexOf(b));
groups.forEach((g) => {
  const h = document.createElement("div");
  h.className = "grp";
  h.innerHTML = `<em style="font-style:normal"></em><span><button type="button" data-i18n="grp.all"></button><button type="button" data-i18n="grp.none"></button></span>`;
  h.querySelector("em").dataset.i18n = "grp." + g;
  typesEl.appendChild(h);
  grpEls.push(h);
  const idx = T.map((t, i) => i)
    .filter((i) => T[i].group === g)
    .sort((a, b) =>
      g === "Points of interest"
        ? T[b].n - T[a].n || T[a].name.localeCompare(T[b].name)
        : T[a].name.localeCompare(T[b].name),
    );
  const [ba, bn] = h.querySelectorAll("button");
  ba.onclick = () => {
    idx.forEach((i) => S.sel.add(i));
    syncBoxes();
    changed();
  };
  bn.onclick = () => {
    idx.forEach((i) => S.sel.delete(i));
    syncBoxes();
    changed();
  };
  const isPoi = g === "Points of interest";
  idx.forEach((i) => {
    const t = T[i],
      l = document.createElement(isPoi ? "div" : "label");
    l.className = "ty";
    l.dataset.name = (t.name + " " + g).toLowerCase();
    l.innerHTML = isPoi
      ? `<input type="checkbox" id="ty${i}"><img alt=""><button type="button" class="tyname"></button><span class="c">${t.n}</span>`
      : `<input type="checkbox" id="ty${i}"><img alt=""><span></span><span class="c">${t.n}</span>`;
    if (isPoi) {
      const nb = l.querySelector(".tyname");
      nb.textContent = t.name;
      poiLabels.push([nb, l.querySelector("input"), t.name]);
      nb.onclick = () => focusType(i);
    } else l.querySelector("span").textContent = t.name;
    const im = l.querySelector("img");
    if (DATA.icons[t.icon]) im.src = DATA.icons[t.icon];
    else im.style.visibility = "hidden";
    const cb = l.querySelector("input");
    cb.onchange = () => {
      cb.checked ? S.sel.add(i) : S.sel.delete(i);
      changed();
    };
    tyBoxes.push([i, cb, l, h]);
    typesEl.appendChild(l);
  });
});
labelTypes();
applyI18n(typesEl);
const noMatch = document.createElement("p");
noMatch.className = "nomatch";
noMatch.hidden = true;
typesEl.appendChild(noMatch);
function syncBoxes() {
  tyBoxes.forEach(([i, cb]) => (cb.checked = S.sel.has(i)));
  $("tyCount").textContent = `${S.sel.size} / ${tyBoxes.length}`;
  const ch = $("chips");
  ch.textContent = "";
  [...S.sel]
    .sort((a, b) => T[a].name.localeCompare(T[b].name))
    .forEach((i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = t("ty.remove", { n: T[i].name });
      if (DATA.icons[T[i].icon]) {
        const im = document.createElement("img");
        im.src = DATA.icons[T[i].icon];
        im.alt = "";
        b.appendChild(im);
      }
      b.appendChild(document.createTextNode(T[i].name + " ×"));
      b.onclick = () => {
        S.sel.delete(i);
        changed();
      };
      ch.appendChild(b);
    });
}
function filterTypes() {
  const q = $("tq").value.trim().toLowerCase();
  let any = 0;
  tyBoxes.forEach(([i, cb, l]) => {
    l.hidden = !!q && !l.dataset.name.includes(q);
    if (!l.hidden) any++;
  });
  grpEls.forEach((h) => {
    let n = h.nextElementSibling,
      vis = false;
    while (n && n.classList.contains("ty")) {
      if (!n.hidden) vis = true;
      n = n.nextElementSibling;
    }
    h.hidden = !vis;
  });
  noMatch.hidden = any > 0;
  noMatch.textContent = t("ty.nomatch", { q: $("tq").value.trim() });
}
["keyup", "input", "search"].forEach((ev) =>
  $("tq").addEventListener(ev, () => {
    filterTypes();
    save();
  }),
);
filterTypes();
/* clearing every type throws the current routes away, so it asks first; Mégse has the focus, Esc cancels too,
   and a backdrop click does nothing, like the other modals */
{
  const dlg = $("clearDlg");
  $("tyNone").onclick = () => {
    if (!S.sel.size) return;
    tip.hidden = true;
    dlg.showModal();
    $("clearNo").focus();
  };
  $("clearNo").onclick = () => dlg.close();
  $("clearYes").onclick = () => {
    dlg.close();
    S.sel.clear();
    syncBoxes();
    changed();
  };
}
["useQ", "useGZ", "useCopS", "useCopE"].forEach(
  (id) =>
    ($(id).onchange = (e) => {
      S[id] = e.target.checked;
      syncInputs();
      changed();
    }),
);
$("copStart").onchange = (e) => {
  S.copStart = e.target.value;
  changed();
};
/* Segédlet only changes what shows on hover, so nothing is recalculated */
$("hints").onchange = (e) => {
  S.hints = e.target.checked;
  save();
  syncInputs();
};
$("q").oninput = (e) => {
  const v = Math.round(+e.target.value);
  if (v >= 1 && v !== S.q) {
    S.q = v;
    changed();
  }
};
$("q").onchange = (e) => {
  e.target.value = S.q;
}; /* a container count is a whole number: 2,5 becomes 3 */
/* COP advantage: whole metres, 0 or more; an emptied field is left alone while typing and restored when left */
$("copBias").oninput = (e) => {
  const v = Math.round(+e.target.value);
  if (e.target.value !== "" && v >= 0 && v !== S.copBias) {
    S.copBias = v;
    changed();
  }
};
$("copBias").onchange = (e) => {
  e.target.value = S.copBias;
};
/* radius: values from the minimum (150 m) apply while typing; anything lower snaps to it when the field is left */
$("r").oninput = (e) => {
  const v = +e.target.value;
  if (v >= RMIN) {
    S.r = v;
    changed();
  }
};
$("r").onchange = (e) => {
  const v = +e.target.value;
  if (!(v >= RMIN)) {
    S.r = RMIN;
    e.target.value = RMIN;
    changed();
  }
};
syncBoxes();

/* ---------- keys per sector ---------- */
/* Keys come from gzwtacmap's key list (KEYDB): short and long name, sector, picture, and where the lock is (some keys have no marked lock).
   "Saját kulcsaim" ticks the keys the user owns, saved by short name apart from the route settings, so Alaphelyzet keeps them;
   "Kulcsok szektoronként" lists only those, with their pictures. Sectors the selected route passes through get a yellow box and come first. */
const OWNKEY = "lamang-keys-v1",
  OWN = new Set(),
  KSEC = new Map(),
  kpop = $("kpop");
let KP = null,
  kTab = 1,
  kHl = new Set(),
  kCnt = new Map();
KEYDB.keys.forEach(([name, long, sec, img, locs]) => {
  const d = {
    name,
    long,
    sec,
    img: KEYDB.img[img] || null,
    locs: locs.map(([lng, lat, label, id]) => ({ lng, lat, label, id })),
  };
  (KSEC.get(sec) || KSEC.set(sec, []).get(sec)).push(d);
});
KSEC.forEach((l) => l.sort((a, b) => a.name.localeCompare(b.name, "hu")));
const NKEY = KEYDB.keys.length,
  KNAMES = new Set(KEYDB.keys.map((k) => k[0]));
const saveOwn = () => {
  if (FROZEN) return;
  try {
    localStorage.setItem(OWNKEY, JSON.stringify([...OWN]));
  } catch {}
};
/* saved names from before a key was renamed on gzwtacmap (IF Shed is now PCh Shed) carry over to the new name */
try {
  const a = JSON.parse(localStorage.getItem(OWNKEY) || "[]");
  if (Array.isArray(a)) {
    a.forEach((n) => {
      n = KEYDB.renamed[n] || n;
      if (KNAMES.has(n)) OWN.add(n);
    });
    if (a.some((n) => KEYDB.renamed[n])) saveOwn();
  }
} catch {}
if (DATA.icons.locked) $("keysIc").src = DATA.icons.locked;
else $("keysIc").hidden = true;
const kOrder = () => [...KSEC.keys()].sort((a, b) => kHl.has(b) - kHl.has(a) || a.localeCompare(b, "hu"));
function kSection(s, count) {
  const e = document.createElement("section");
  e.className = "ksec" + (kHl.has(s) ? " hl" : "");
  e.innerHTML = `<h3><span></span><small></small></h3><ul></ul>`;
  e.querySelector("span").textContent = s;
  e.querySelector("small").textContent = count;
  return e;
}
function keyRow(d, box) {
  const li = document.createElement("li");
  if (box) {
    const l = document.createElement("label"),
      cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = OWN.has(d.name);
    cb.onchange = () => {
      cb.checked ? OWN.add(d.name) : OWN.delete(d.name);
      saveOwn();
      renderMine();
    };
    l.append(cb, d.name);
    li.appendChild(l);
  } else {
    /* the key's picture (a lock icon where gzwtacmap has none), short name, and the long in-game name under it */
    const im = document.createElement("img"),
      t = document.createElement("span"),
      sm = document.createElement("small");
    im.className = "kimg" + (d.img ? "" : " noimg");
    im.src = d.img || DATA.icons.locked || "";
    im.alt = "";
    t.className = "kname";
    sm.textContent = d.long;
    t.append(d.name, sm);
    li.append(im, t);
  }
  li.onmouseenter = () => showPop(d, li);
  li.onmouseleave = hidePop;
  li.addEventListener("focusin", () => showPop(d, li));
  li.addEventListener("focusout", hidePop);
  return li;
}
/* both tabs, built when the modal opens: the route's sectors are fixed while it is open */
function renderKeys() {
  kHl = new Set(SEL ? SEL.seq.map((p) => p.poi).filter((s) => KSEC.has(s)) : []);
  kCnt = new Map();
  const rn = $("kRoute");
  rn.hidden = !SEL;
  if (SEL)
    rn.lastChild.textContent = kHl.size
      ? t("keys.routeHl", { route: SEL.label, many: kHl.size > 1 })
      : t("keys.routeNone", { route: SEL.label });
  const p2 = $("kpan2");
  p2.textContent = "";
  kOrder().forEach((s) => {
    const e = kSection(s, ""),
      ul = e.querySelector("ul");
    kCnt.set(s, e.querySelector("small"));
    KSEC.get(s).forEach((d) => ul.appendChild(keyRow(d, true)));
    p2.appendChild(e);
  });
  renderMine();
}
/* the owned-keys tab and the counts; re-run on every tick so the checkbox list (and its focus) stays put */
function renderMine() {
  const p1 = $("kpan1");
  p1.textContent = "";
  if (!OWN.size) {
    p1.innerHTML = `<p class="kempty"><span></span><button type="button"></button></p>`;
    p1.querySelector("span").textContent = t("keys.empty");
    p1.querySelector("button").textContent = t("keys.emptyBtn");
    p1.querySelector("button").onclick = () => keyTab(2, true);
  }
  kOrder().forEach((s) => {
    const all = KSEC.get(s),
      own = all.filter((d) => OWN.has(d.name));
    kCnt.get(s).textContent = `${own.length} / ${all.length}`;
    /* a sector the route passes through stays even without keys, to say so */
    if (!own.length && !kHl.has(s)) return;
    const e = kSection(s, t("keys.count", { n: own.length })),
      ul = e.querySelector("ul");
    own.forEach((d) => ul.appendChild(keyRow(d, false)));
    if (!own.length) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = t("keys.none");
      ul.appendChild(li);
    }
    p1.appendChild(e);
  });
  $("kc1").textContent = OWN.size;
  $("kc2").textContent = `${OWN.size} / ${NKEY}`;
}
function keyTab(n, focus) {
  kTab = n;
  hidePop();
  [1, 2].forEach((i) => {
    const tab = $("ktab" + i);
    tab.setAttribute("aria-selected", i === n);
    tab.tabIndex = i === n ? 0 : -1;
    $("kpan" + i).hidden = i !== n;
  });
  $("keysNote").textContent = t(n === 1 ? "keys.note1" : "keys.note2") + t("keys.noteTail");
  if (focus) $("ktab" + n).focus();
}
$("ktab1").onclick = () => keyTab(1);
$("ktab2").onclick = () => keyTab(2);
$("ktabs").onkeydown = (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    keyTab(3 - kTab, true);
    e.preventDefault();
  }
};
$("kpan1").onscroll = $("kpan2").onscroll = () => hidePop();
/* popup: the lock ringed in the middle of a small satellite map, with the walk from its nearest LZ (wide enough to show that LZ),
   then the key's picture and names; keys without a marked lock get the text only */
function showPop(d, el) {
  KP = d;
  const p = d.locs[0],
    c = kpop.querySelector("canvas"),
    im = kpop.querySelector(".kprow img"),
    [b, l1, l2, l3, l4] = kpop.querySelector(".kprow div").children;
  im.hidden = !d.img;
  if (d.img) im.src = d.img;
  b.textContent = d.name;
  l1.textContent = d.long;
  c.hidden = !p;
  if (p) {
    const n = nearestIn(LZ, p);
    l2.textContent = `${d.sec} · ${p.label}`;
    l3.textContent = t("keys.nearestLz", { lz: n.lz.name, d: fm(n.d), h: heading(n.lz, p) });
    l4.textContent = "";
  } else {
    l2.textContent = d.sec;
    l3.textContent = "";
    l4.textContent = t("keys.noDoor");
  }
  drawPop();
  kpop.hidden = false;
  const r = el.getBoundingClientRect(),
    pw = kpop.offsetWidth,
    ph = kpop.offsetHeight;
  let x = r.right + 10;
  if (x + pw > innerWidth - 8) x = r.left - pw - 10;
  kpop.style.left = Math.max(8, x) + "px";
  kpop.style.top = Math.max(8, Math.min(innerHeight - ph - 8, r.top + r.height / 2 - ph / 2)) + "px";
}
function hidePop() {
  KP = null;
  kpop.hidden = true;
}
function drawPop() {
  const k = KP && KP.locs[0];
  if (!k) return;
  const c = kpop.querySelector("canvas"),
    x = c.getContext("2d"),
    pr = devicePixelRatio || 1,
    w = 320,
    h = 190,
    n = nearestIn(LZ, k);
  const vw = Math.min(
      2400,
      Math.max(600, (Math.abs(n.lz.lng - k.lng) + 90) * 2, ((Math.abs(n.lz.lat - k.lat) + 70) * 2 * w) / h),
    ),
    s = w / vw,
    vx = k.lng - vw / 2,
    vy = k.lat + h / s / 2,
    P = (p) => [(p.lng - vx) * s, (vy - p.lat) * s];
  c.width = w * pr;
  c.height = h * pr;
  x.setTransform(pr, 0, 0, pr, 0, 0);
  x.fillStyle = "#1b2a18";
  x.fillRect(0, 0, w, h);
  if (bg.complete && bg.naturalWidth) x.drawImage(bg, -vx * s, (vy - 8000) * s, 14000 * s, 8000 * s);
  paintTiles(x, vx, vy, vw, h / s, s, pr, drawPop);
  x.lineJoin = x.lineCap = "round";
  x.beginPath();
  ZB.forEach((L) =>
    L.forEach((p, i) => {
      const [a, b] = P(p);
      i ? x.lineTo(a, b) : x.moveTo(a, b);
    }),
  );
  x.strokeStyle = "rgba(13,19,11,.55)";
  x.lineWidth = 4;
  x.stroke();
  x.setLineDash([8, 5]);
  x.strokeStyle = "#7dff2e";
  x.lineWidth = 2;
  x.stroke();
  const [lx, ly] = P(n.lz);
  x.setLineDash([5, 4]);
  x.beginPath();
  x.moveTo(lx, ly);
  x.lineTo(w / 2, h / 2);
  x.strokeStyle = "#0d130b";
  x.lineWidth = 4.5;
  x.stroke();
  x.strokeStyle = "#5fd3ff";
  x.lineWidth = 2;
  x.stroke();
  x.setLineDash([]);
  x.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "top";
  LZ.forEach((l) => {
    const [a, b] = P(l);
    if (a < -40 || b < -20 || a > w + 40 || b > h + 20) return;
    if (IMG.landingZone && IMG.landingZone.complete) x.drawImage(IMG.landingZone, a - 7, b - 7, 14, 14);
    x.strokeStyle = "rgba(13,19,11,.85)";
    x.lineWidth = 3;
    x.strokeText(l.name, a, b + 9);
    x.fillStyle = "#f3f6ec";
    x.fillText(l.name, a, b + 9);
  });
  if (IMG.locked && IMG.locked.complete) x.drawImage(IMG.locked, w / 2 - 10, h / 2 - 10, 20, 20);
  x.lineWidth = 4.5;
  x.strokeStyle = "rgba(13,19,11,.7)";
  x.beginPath();
  x.arc(w / 2, h / 2, 17, 0, 7);
  x.stroke();
  x.lineWidth = 2.2;
  x.strokeStyle = "#ffffff";
  x.setLineDash([5, 4]);
  x.beginPath();
  x.arc(w / 2, h / 2, 17, 0, 7);
  x.stroke();
  x.setLineDash([]);
  x.textAlign = "left";
  x.textBaseline = "alphabetic";
  x.font = "10px IBM Plex Mono, monospace";
  const wide = t("keys.wide", { w: fdist(vw) });
  x.fillStyle = "rgba(13,19,11,.75)";
  x.fillRect(4, h - 19, x.measureText(wide).width + 10, 15);
  x.fillStyle = "#f3f6ec";
  x.fillText(wide, 9, h - 8);
}
/* ---------- presets panel ---------- */
/* the dropdown: No preset first, then the presets A-Z; Delete only works on a selected preset */
function renderPresets() {
  const sel = $("preset");
  sel.textContent = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = t("preset.none");
  sel.appendChild(none);
  [...PRESETS]
    .sort((a, b) => a.name.localeCompare(b.name, "hu"))
    .forEach((p) => {
      const o = document.createElement("option");
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    });
  sel.value = ACTIVE || "";
  $("presetDel").disabled = !ACTIVE;
}
/* Picking a preset loads it like a fresh start: its routes are planned and its selected route reopened.
   No preset keeps everything as it is; from then on changes go into no preset. */
$("preset").onchange = (e) => {
  ACTIVE = e.target.value || null;
  savePresets();
  $("presetDel").disabled = !ACTIVE;
  const p = ACTIVE && PRESETS.find((x) => x.name === ACTIVE);
  if (!p) return;
  applyPreset(p.data);
  SEL = null;
  HOV = null;
  STEP = 0;
  tip.hidden = true;
  syncInputs();
  syncBoxes();
  compute.ran = false;
  changed();
};
/* Create new preset: a name (not empty, not taken, case aside), then the current state is saved under it and selected */
{
  const dlg = $("presetDlg"),
    inp = $("presetName"),
    err = $("presetErr");
  const check = () => {
    const n = inp.value.trim(),
      taken = !!n && PRESETS.some((p) => p.name.toLowerCase() === n.toLowerCase());
    err.textContent = taken ? t("preset.errDup") : "";
    err.hidden = !taken;
    $("presetOk").disabled = !n || taken;
    return !!n && !taken;
  };
  $("presetNew").onclick = () => {
    inp.value = "";
    check();
    tip.hidden = true;
    dlg.showModal();
    inp.focus();
  };
  inp.oninput = check;
  $("presetCancel").onclick = () => dlg.close();
  $("presetForm").onsubmit = (e) => {
    e.preventDefault();
    if (!check()) return;
    const name = inp.value.trim();
    PRESETS.push({ name, data: presetData() });
    ACTIVE = name;
    savePresets();
    renderPresets();
    dlg.close();
  };
}
/* Delete: asks first (No has the focus); the routes stay as they are, now under No preset */
{
  const dlg = $("presetDelDlg");
  $("presetDel").onclick = () => {
    if (!ACTIVE) return;
    $("presetDelD").textContent = t("preset.delText", { name: ACTIVE });
    tip.hidden = true;
    dlg.showModal();
    $("presetDelNo").focus();
  };
  $("presetDelNo").onclick = () => dlg.close();
  $("presetDelYes").onclick = () => {
    PRESETS = PRESETS.filter((p) => p.name !== ACTIVE);
    ACTIVE = null;
    savePresets();
    renderPresets();
    dlg.close();
    $("preset").focus();
  };
}
/* Reset: asks first (No has the focus), then the route setup goes back to the defaults Alaphelyzet would give (no
   container types, default settings, no forbidden sectors or route). With a preset selected that preset is reset and
   stays selected; with No preset just the current route settings are. Other presets, owned keys, the language, map
   switches and raid ticks are left alone either way. */
{
  const dlg = $("presetResetDlg");
  $("presetReset").onclick = () => {
    $("presetResetT").textContent = t(ACTIVE ? "preset.resetTitle" : "preset.resetNoneTitle");
    $("presetResetD").textContent = t(ACTIVE ? "preset.resetText" : "preset.resetNoneText", { name: ACTIVE });
    tip.hidden = true;
    dlg.showModal();
    $("presetResetNo").focus();
  };
  $("presetResetNo").onclick = () => dlg.close();
  $("presetResetYes").onclick = () => {
    dlg.close();
    applyPreset({});
    S.copStart = $("copStart").options[0]?.value || "";
    SEL = null;
    HOV = null;
    STEP = 0;
    syncInputs();
    syncBoxes();
    changed();
    fitFull(true);
  };
}
renderPresets();

/* ---------- forbidden sectors ---------- */
/* every sector with markers except Ground Zero, which has its own switch; ticks apply at once and the routes behind the modal recalculate */
{
  const dlg = $("secDlg"),
    list = $("secList"),
    SECS = [...new Set(M.map((m) => m.poi).filter((s) => s && s !== "Ground Zero"))].sort((a, b) =>
      a.localeCompare(b, "hu"),
    );
  S.noSec.forEach((s) => {
    if (!SECS.includes(s)) S.noSec.delete(s);
  });
  syncInputs();
  const count = (s, off) => {
    if (S.browse) return "";
    const n = SECN.get(s) || 0;
    return !n ? "–" : t(off ? "sec.dropped" : "sec.routes", { n });
  };
  const render = () => {
    list.textContent = "";
    SECS.forEach((s) => {
      const l = document.createElement("label"),
        cb = document.createElement("input"),
        c = document.createElement("small");
      cb.type = "checkbox";
      cb.checked = S.noSec.has(s);
      c.textContent = count(s, cb.checked);
      cb.onchange = () => {
        cb.checked ? S.noSec.add(s) : S.noSec.delete(s);
        c.textContent = count(s, cb.checked);
        syncInputs();
        changed();
      };
      l.append(cb, s, c);
      list.appendChild(l);
    });
  };
  $("secBtn").onclick = () => {
    tip.hidden = true;
    render();
    dlg.showModal();
    list.scrollTop = 0;
  };
  $("secClose").onclick = () => dlg.close();
}
{
  const dlg = $("keys");
  dlg.addEventListener("close", hidePop);
  $("keysBtn").onclick = () => {
    tip.hidden = true;
    renderKeys();
    keyTab(1);
    dlg.showModal();
    $("kpan1").scrollTop = $("kpan2").scrollTop = 0;
  };
  $("keysClose").onclick = () => dlg.close();
}

/* ---------- route planning ---------- */
/* the planner's radius estimate (planner.js) under the radius field, with a button to use the middle of the band */
function showEstimate(e) {
  const el = $("rEst");
  if (!e) {
    el.textContent = "";
    return;
  }
  if (e.none) {
    el.textContent = t("est.none", { q: e.q });
    return;
  }
  el.innerHTML = t("est.band", { lo: e.lo, hi: e.hi, peak: e.peak }) + `<button type="button" id="rUse"></button>`;
  $("rUse").textContent = t("est.btn", { mid: e.mid });
  $("rUse").title = t("est.title", { q: e.q });
  $("rUse").onclick = () => {
    S.r = e.mid;
    syncInputs();
    changed();
  };
}
/* Clicking a point-of-interest name shows every place with that name: map fits them and rings them for a few seconds */
let FOCUS = null,
  focusT = 0;
function focusType(i) {
  const pts = M.filter((m) => m.t === i);
  if (!pts.length) return;
  FOCUS = { t: i, pts };
  clearTimeout(focusT);
  focusT = setTimeout(() => {
    FOCUS = null;
    schedule();
  }, 9000);
  if (pts.length === 1) {
    const p = pts[0];
    fit(p.lng - 300, p.lat + 300, p.lng + 300, p.lat - 300, true);
  } else
    fit(
      Math.min(...pts.map((p) => p.lng)),
      Math.max(...pts.map((p) => p.lat)),
      Math.max(...pts.map((p) => p.lng)),
      Math.min(...pts.map((p) => p.lat)),
      true,
    );
}
function rankRuns() {
  RUNS.sort((a, b) => a.per - b.per);
  RUNS.forEach((r, i) => (r.rank = i + 1));
}
/* routes sharing an area name get numbered in rank order: Tiger Bay 1, Tiger Bay 2 */
function labelRuns() {
  const names = {};
  RUNS.forEach((r) => {
    names[r.name] = (names[r.name] || 0) + 1;
  });
  const seen = {};
  RUNS.forEach((r) => {
    if (names[r.name] > 1) {
      seen[r.name] = (seen[r.name] || 0) + 1;
      r.label = `${r.name} ${seen[r.name]}`;
    } else r.label = r.name;
  });
}
/* after a recalculation, the old selection lives on in the new route holding most of its containers (at least half of the smaller route) */
function sameRoute(old) {
  if (!old) return null;
  const ids = new Set(old.seq.map((p) => p.i));
  let best = null,
    bo = 0;
  RUNS.forEach((r) => {
    const o = r.seq.reduce((s, p) => s + ids.has(p.i), 0);
    if (o > bo) {
      bo = o;
      best = r;
    }
  });
  return best && bo >= Math.min(old.n, best.n) / 2 ? best : null;
}
/* a route's figures from its stops, after reversing it or adding a door: start and end point, legs, totals.
   per (the ranking) counts containers only, so a door added as a stop costs its detour */
function restat(r) {
  r.n = r.seq.length;
  r.A = nearestS(r.seq[0]);
  r.B = nearestE(r.seq[r.n - 1]);
  r.legs = r.seq.map((p, i) => (i ? D(r.seq[i - 1], p) : r.A.d));
  r.path = r.legs.slice(1).reduce((s, v) => s + v, 0);
  r.avg = r.n > 1 ? r.path / (r.n - 1) : 0;
  r.total = r.A.d + r.path;
  r.full = r.total + r.B.d;
  r.boxes = r.seq.filter((p) => !p.door).length;
  r.per = r.total / Math.max(1, r.boxes);
}
function flip(r) {
  r.seq.reverse();
  restat(r);
}
let STEP = 0;
let SHOWPOI = [],
  LOOTPTS = [],
  NFPTS = [];
const ALLPOI = M.filter((m) => T[m.t].group === "Points of interest");
const NOROUTE = (t) => T[t]?.name === "COP";
let RUNS = [],
  SEL = null,
  HOV = null,
  LEFT = new Set(),
  PTS = [],
  timer = 0;
/* SECN counts the would-be routes per sector (forbidden or not), NOSEC maps containers dropped by a forbidden sector to it */
let SECN = new Map(),
  NOSEC = new Map();

/* ---------- keyed doors along a route ---------- */
/* Every marked lock of every key, shaped like a container so it can join a route as a stop. A route lists the locks within
   near() metres of its walk; ticked ones (S.doorStops, by marker id) are added where they lengthen the walk least.
   near() follows the grouping radius (half of it: spread-out routes have longer legs, so a longer detour fits them),
   but is never under 150 m, since a locked room is worth a short walk even on a dense route. */
const near = () => Math.round(Math.max(150, S.r / 2));
const DOORT = T.findIndex((t) => t.name === "Key-locked Doors"),
  DOORS = [...KSEC.values()].flat().flatMap((k) =>
    k.locs.map((l) => ({
      i: "door" + l.id,
      t: DOORT,
      lat: l.lat,
      lng: l.lng,
      label: l.label,
      poi: k.sec,
      icon: "locked",
      id: l.id,
      door: k,
      run: null,
    })),
  ),
  DOOR_BY_ID = new Map(DOORS.map((d) => [d.id, d]));
let HOVDOOR = null;
/* distance from p to the walk start → stops → end */
function routeDist(r, p) {
  const pts = [r.A.lz, ...r.seq, r.B.lz];
  let best = 1e18;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k],
      b = pts[k + 1],
      dx = b.lng - a.lng,
      dy = b.lat - a.lat,
      L = dx * dx + dy * dy,
      t = L ? Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p.lng - a.lng - t * dx, p.lat - a.lat - t * dy));
  }
  return best;
}
/* locks near a route: the ones already its stops, then those you have the key for, then the rest, nearest first */
function nearDoors(r) {
  const ids = new Set(r.seq.map((p) => p.id));
  return DOORS.filter((d) => d.run === r || (!ids.has(d.id) && !d.run && routeDist(r, d) <= near()))
    .map((d) => ({ d, dist: d.run === r ? 0 : routeDist(r, d), own: OWN.has(d.door.name) }))
    .sort((a, b) => (b.d.run === r) - (a.d.run === r) || b.own - a.own || a.dist - b.dist);
}
/* ticked locks join the route they are near (within near()) where they add the least walking */
function addDoors() {
  const taken = new Set(RUNS.flatMap((r) => r.seq.map((p) => p.id)));
  S.doorStops.forEach((id) => {
    const d = DOOR_BY_ID.get(id);
    if (!d || taken.has(id) || S.planExcl.has(mkey(d))) return;
    let best = null,
      cost = 1e18,
      at = 0;
    RUNS.forEach((r) => {
      if (routeDist(r, d) > near()) return;
      const pts = [r.A.lz, ...r.seq, r.B.lz];
      for (let k = 0; k < pts.length - 1; k++) {
        const c = D(pts[k], d) + D(d, pts[k + 1]) - D(pts[k], pts[k + 1]);
        if (c < cost) {
          cost = c;
          best = r;
          at = k;
        }
      }
    });
    if (!best) return;
    best.seq.splice(at, 0, d);
    restat(best);
    taken.add(id);
  });
}
function toggleDoor(id, on) {
  on ? S.doorStops.add(id) : S.doorStops.delete(id);
  save();
  refinish();
  /* the route panel was rebuilt: keep keyboard focus on the same lock */
  $("det").querySelector(`[data-door="${id}"]`)?.focus();
}

/* ---------- planning ---------- */
/* Planning (planner.js) runs in a Web Worker built from planRoutes' source, so a big selection does not freeze the map;
   a newer job replaces a busy worker at once. Where workers are unavailable it runs here instead. The result is kept, so
   adding a door as a stop re-applies it without planning again. */
const PLANNER_SRC = `${planRoutes}\nonmessage = (e) => postMessage({ id: e.data.id, res: planRoutes(e.data.job) });`;
let planner,
  jobId = 0,
  pend = null,
  lastRes = null,
  lastCtx = null;
function makePlanner() {
  try {
    const w = new Worker(URL.createObjectURL(new Blob([PLANNER_SRC], { type: "text/javascript" })));
    w.onmessage = (e) => {
      w.busy = false;
      if (pend && e.data.id === pend.id) finish(e.data.res, pend);
    };
    w.onerror = (e) => {
      e.preventDefault();
      planner = null;
      if (pend) finish(planRoutes(pend.job), pend);
    };
    return w;
  } catch {
    return null;
  }
}
/* Server switch: every looted mark and its timer belong to the server you looted on. Two clicks (the first one arms it for
   3 s), then all marks go and the routes are planned again with every container */
let srvT = 0;
$("srvReset").onclick = (e) => {
  const b = e.currentTarget,
    lbl = b.querySelector("span");
  if (!b.classList.contains("armed")) {
    b.classList.add("armed");
    lbl.textContent = t("server.armed");
    clearTimeout(srvT);
    srvT = setTimeout(() => {
      b.classList.remove("armed");
      lbl.textContent = t("server.btn");
    }, 3000);
    return;
  }
  clearTimeout(srvT);
  b.classList.remove("armed");
  lbl.textContent = t("server.btn");
  S.looted.clear();
  S.planExcl.clear();
  save();
  RUNS.forEach((r) => r.btn && (r.btn.querySelector(".rmeta").textContent = runMeta(r)));
  detail();
  updRecalc();
  clearTimeout(timer);
  compute();
};
$("recalc").onclick = () => {
  S.planExcl = new Set([...S.looted.keys()].filter((k) => lootLeft(k) > 0));
  save();
  clearTimeout(timer);
  compute();
};
function changed() {
  save();
  syncBoxes();
  clearTimeout(timer);
  $("busy").hidden = S.browse;
  timer = setTimeout(compute, 120);
}
function compute() {
  const okGZ = (l) => S.useGZ || l.poi !== "Ground Zero",
    cs = copStartPt(),
    starts = S.useCopS && cs ? [cs] : LZ.filter(okGZ),
    ends = [...LZ, ...(S.useCopE ? COPS : [])].filter(okGZ),
    shown = M.filter((m) => S.sel.has(m.t) && (S.useGZ || m.poi !== "Ground Zero"));
  /* COPs are outposts, not loot: shown on the map, never part of a route. Containers looted in the last LOOT_MIN
     minutes are left out of the plan and only shown, faded with a tick */
  const boxes = shown.filter((m) => !NOROUTE(m.t));
  /* containers on the Not found list are never planned, on any server; they are only shown, faded with a red ✕ */
  const ctx = {
    id: ++jobId,
    starts,
    ends,
    showpoi: shown.filter((m) => NOROUTE(m.t)),
    pts: boxes.filter((m) => !isNF(m) && !S.planExcl.has(mkey(m))),
    looted: boxes.filter((m) => !isNF(m) && S.planExcl.has(mkey(m))),
    nf: boxes.filter(isNF),
    seen: boxes,
  };
  ctx.job = {
    pts: ctx.pts.map((p) => [p.lat, p.lng, p.poi || ""]),
    /* browse only: no grouping or planning, so no routes and nothing left out; switching it off plans afresh */
    plan: !S.browse,
    r: S.r,
    rmin: RMIN,
    q: S.useQ ? S.q : 0,
    noSec: [...S.noSec],
    starts: starts.map((l) => [l.lat, l.lng]),
    ends: ends.map((l) => [l.lat, l.lng, l.kind === "cop" ? 1 : 0]),
    copBias: S.copBias,
    areas: AREAS.map((a) => [a.lat, a.lng, a.label]),
    near: tpl("route.near"),
    wild: tpl("route.wild"),
    budget: 900,
  };
  pend = ctx;
  $("busy").hidden = S.browse;
  if (planner === undefined) planner = makePlanner();
  if (planner && planner.busy) {
    planner.terminate();
    planner = makePlanner();
  }
  if (planner) {
    planner.busy = true;
    planner.postMessage({ id: ctx.id, job: ctx.job });
  } else finish(planRoutes(ctx.job), ctx);
}
const refinish = () => lastCtx && lastCtx.id === jobId && finish(lastRes, lastCtx);
/* a planner result back on the page: routes rebuilt from it (indexes into the job's points and start / end points) */
function finish(res, ctx) {
  if (ctx.id !== jobId) return;
  pend = null;
  lastRes = res;
  lastCtx = ctx;
  LZS = ctx.starts;
  LZE = ctx.ends;
  SHOWPOI = ctx.showpoi;
  PTS = ctx.pts;
  LOOTPTS = ctx.looted;
  NFPTS = ctx.nf;
  SEEN = new Set(ctx.seen.map(mkey));
  NFPLAN = new Set(ctx.nf.map(nfKey));
  SEENNF = new Set(ctx.seen.map(nfKey));
  updRecalc();
  M.forEach((m) => (m.run = null));
  DOORS.forEach((d) => (d.run = null));
  showEstimate(res.est);
  SECN = new Map(res.secn);
  NOSEC = new Map(res.nosec.map(([k, s]) => [PTS[k].i, s]));
  LEFT = new Set(res.left.map((k) => PTS[k].i));
  HOV = null;
  RUNS = res.runs.map((r) => ({
    ...r,
    seq: r.seq.map((k) => PTS[k]),
    A: { lz: LZS[r.A.k], d: r.A.d },
    B: { lz: LZE[r.B.k], d: r.B.d },
    boxes: r.n,
  }));
  addDoors();
  RUNS.forEach((r) => {
    r.seq.forEach((p) => (p.run = r));
    if (S.inv) flip(r);
  });
  rankRuns();
  labelRuns();
  const legs = RUNS.flatMap((r) => r.legs.slice(1));
  $("stContainers").textContent = fm(PTS.length);
  $("stRuns").textContent = RUNS.length;
  $("stLeft").textContent = fm(LEFT.size);
  $("stAvg").textContent = legs.length ? fm(legs.reduce((s, v) => s + v, 0) / legs.length) : "–";
  $("busy").hidden = true;
  const first = !compute.ran;
  compute.ran = true;
  const saved =
    first && S.run ? ((k) => ({ seq: PTS.filter((p) => k.has(mkey(p))), n: k.size }))(new Set(S.run)) : null;
  const keepSel = sameRoute(SEL || saved),
    was = SEL && wps(SEL)[STEP];
  renderRuns();
  /* keep the current view on recalculation; only the first run fits the whole map (or the saved route) */
  if (keepSel) {
    pick(keepSel, false, first);
    /* the step marker stays on the same stop (or the start / end point) if the route still has it */
    if (was) {
      STEP = was.k === "S" ? 0 : was.k === "E" ? keepSel.n + 1 : Math.max(0, keepSel.seq.indexOf(was.p) + 1);
      updNav();
    }
  } else {
    SEL = null;
    if (S.run) {
      S.run = null;
      save();
    }
    detail();
    first ? fitFull(false) : schedule();
  }
  applyBrowse();
}

/* ---------- lists ---------- */
/* Looted marks: a container ticked off (or clicked on the map) is kept by position with the time, so the mark survives a
   recalculation or reload. For LOOT_MIN minutes it stays out of the routes; after that the mark lapses by itself.
   Ticking never changes the routes (the route you are walking must not jump): only Recalculate, e.g. when you go out again
   after going home, takes a new snapshot of the running marks (S.planExcl). Every other replan reuses the last snapshot. */
const LOOT_MIN = 30,
  LOOT_MS = LOOT_MIN * 60000;
const lootLeft = (k) => (S.looted.has(k) ? LOOT_MS - (Date.now() - S.looted.get(k)) : 0),
  isLooted = (p) => lootLeft(mkey(p)) > 0,
  setLooted = (p, on) => (on ? S.looted.set(mkey(p), Date.now()) : S.looted.delete(mkey(p)));
const clock = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
/* every position the last plan looked at (the selected types) */
let SEEN = new Set();
/* marks that differ from the snapshot the routes use (new ticks, or lapsed ones), counted on the Recalculate button */
function updRecalc() {
  let n = 0;
  for (const k of new Set([...S.looted.keys(), ...S.planExcl]))
    if (SEEN.has(k) && lootLeft(k) > 0 !== S.planExcl.has(k)) n++;
  for (const k of new Set([...NF.keys(), ...NFPLAN])) if (SEENNF.has(k) && NF.has(k) !== NFPLAN.has(k)) n++;
  const b = $("recalc"),
    c = $("recalcN");
  c.hidden = !n;
  c.textContent = n;
  b.classList.toggle("due", n > 0);
  let fresh = 0;
  for (const k of S.looted.keys()) if (lootLeft(k) > 0) fresh++;
  $("stLooted").textContent = fresh;
  /* nothing to clear: no marks, and the routes are planned with none left out */
  $("srvReset").disabled = !S.looted.size && !S.planExcl.size;
}
/* every half minute: lapsed marks are dropped, and the ticks, the map and the button follow */
setInterval(() => {
  let gone = false;
  for (const k of [...S.looted.keys()])
    if (!(lootLeft(k) > 0)) {
      S.looted.delete(k);
      gone = true;
    }
  if (gone) {
    save();
    RUNS.forEach((r) => r.btn && (r.btn.querySelector(".rmeta").textContent = runMeta(r)));
    detail();
    schedule();
  }
  updRecalc();
}, 30000);
const runMeta = (r) => {
  const doors = r.n - r.boxes,
    done = r.seq.filter(isLooted).length;
  return t("runs.meta", { boxes: r.boxes, doors, per: fm(r.per), avg: fm(r.avg), lz: nm(r.A.lz), done, n: r.n });
};
/* after ticks change: the route's line in the list, its panel (keyboard focus back on the same row's box) and the map */
function lootChanged(r, focusRow) {
  save();
  updRecalc();
  if (r && r.btn) r.btn.querySelector(".rmeta").textContent = runMeta(r);
  detail();
  if (focusRow != null) $("wp").children[focusRow]?.querySelector("input")?.focus();
  schedule();
}
/* Enter: tick off the stop you are at (the highlighted row) and go on to the next one not yet looted (or the end point) */
function doneStep() {
  const r = SEL || RUNS[0];
  if (!r) return;
  if (SEL === r && STEP >= 1 && STEP <= r.n) {
    setLooted(r.seq[STEP - 1], true);
    lootChanged(r);
  }
  let k = STEP + 1;
  while (k <= r.n && isLooted(r.seq[k - 1])) k++;
  go(k);
}
/* ---------- early exfil ---------- */
/* Where to leave the selected route early when the bag is full, and come back in after the drop-off. Every stop but the first and the last gets its nearest
   exfil (any LZ or COP; Ground Zero ones only with Ground Zero on). A stop is an early exfil point where that distance
   dips: no farther than at the stop before and the one after. When two such dips in a row lead to the same exfil, only
   the nearer one stays. The map shows the ones from the step marker on, so passed ones drop off during the run. */
function bailOuts(r) {
  if (!r || r.n < 3) return [];
  const ex = [...LZ, ...COPS].filter((l) => S.useGZ || l.poi !== "Ground Zero"),
    nr = r.seq.map((p) => nearestIn(ex, p)),
    out = [];
  for (let i = 1; i < r.n - 1; i++) {
    const d = nr[i].d;
    if (d > nr[i - 1].d || d > nr[i + 1].d) continue;
    const b = { i, p: r.seq[i], ex: nr[i].lz, d, back: r.seq[i + 1], bd: D(nr[i].lz, r.seq[i + 1]) },
      last = out[out.length - 1];
    if (last && last.ex === b.ex) {
      if (d < last.d) out[out.length - 1] = b;
    } else out.push(b);
  }
  return out;
}
/* the ones still ahead: from the stop the step marker is on (or all of them at the start) */
const bailAhead = (r) => {
  const from = r === SEL ? (STEP > r.n ? r.n : Math.max(0, STEP - 1)) : 0;
  return bailOuts(r).filter((b) => b.i >= from);
};
/* ---------- not found ---------- */
/* Containers that are not where the map says (moved or removed in a patch, wrong marker...). Kept by marker id in their own
   storage key, apart from the settings, so Server switch and Reset leave them alone. They are never put on a route until
   taken off the list (the Not found window, right-click on the map, or ✕ in the stop list). Like looted marks, a change
   applies at the next plan (the Recalculate count includes it), so the route you are walking does not jump. */
const NFKEY = "lamang-notfound-v1";
const nfKey = (m) => (m.id != null ? "id" + m.id : "p" + mkey(m));
const NF = new Map();
try {
  const a = JSON.parse(localStorage.getItem(NFKEY) || "[]");
  if (Array.isArray(a))
    a.slice(0, 5000).forEach((e) => {
      if (Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1]))
        NF.set(e[0], { at: e[1], type: String(e[2] || ""), label: String(e[3] || ""), poi: String(e[4] || "") });
    });
} catch {}
let NFPLAN = new Set(),
  SEENNF = new Set(),
  NFBYKEY = null;
const isNF = (m) => NF.has(nfKey(m)),
  canNF = (m) => m && !m.door && !NOROUTE(m.t),
  nfMarker = (k) => (NFBYKEY ||= new Map(M.map((m) => [nfKey(m), m]))).get(k),
  fdate = (ms) =>
    new Date(ms).toLocaleString(locale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
function saveNF() {
  if (FROZEN) return;
  try {
    localStorage.setItem(NFKEY, JSON.stringify([...NF].map(([k, v]) => [k, v.at, v.type, v.label, v.poi])));
  } catch {}
}
function nfChanged() {
  saveNF();
  $("nfCount").textContent = NF.size || "";
  updRecalc();
  detail();
  schedule();
  if ($("nfDlg").open) renderNF();
}
function setNF(m, on) {
  if (!canNF(m)) return;
  if (on) NF.set(nfKey(m), { at: Date.now(), type: T[m.t].name, label: m.label, poi: m.poi || "" });
  else NF.delete(nfKey(m));
  nfChanged();
}
/* a single marker ringed on the map for a few seconds (also when its type is not selected) */
function focusPt(m) {
  FOCUS = { t: m.t, pts: [m] };
  clearTimeout(focusT);
  focusT = setTimeout(() => {
    FOCUS = null;
    schedule();
  }, 9000);
  fit(m.lng - 300, m.lat + 300, m.lng + 300, m.lat - 300, true);
}
function renderNF() {
  const list = $("nfList");
  list.textContent = "";
  $("nfClear").disabled = !NF.size;
  if (!NF.size) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("nf.empty");
    list.appendChild(p);
    return;
  }
  [...NF]
    .sort((a, b) => b[1].at - a[1].at)
    .forEach(([k, v]) => {
      const m = nfMarker(k),
        row = document.createElement("div"),
        ph = document.createElement("div"),
        info = document.createElement("div"),
        acts = document.createElement("div");
      row.className = "nfrow";
      ph.className = "ph";
      const photo = m && photoFor(m.id);
      if (photo) ph.style.backgroundImage = `url("${photo[1]}")`;
      else if (m && IMG[m.icon]) {
        const im = document.createElement("img");
        im.alt = "";
        im.src = IMG[m.icon].src;
        ph.appendChild(im);
      }
      const b = document.createElement("b"),
        sp = document.createElement("span"),
        sm = document.createElement("small");
      b.textContent = v.label || v.type;
      sp.textContent = [v.label && v.label !== v.type ? v.type : "", v.poi].filter(Boolean).join(" · ");
      sm.textContent = t("nf.added", { date: fdate(v.at) }) + (m ? "" : " · " + t("nf.gone"));
      info.append(b, sp, sm);
      acts.className = "acts";
      const show = document.createElement("button"),
        del = document.createElement("button");
      show.type = del.type = "button";
      show.textContent = t("nf.show");
      show.disabled = !m;
      show.onclick = () => {
        $("nfDlg").close();
        focusPt(m);
      };
      del.textContent = t("nf.del");
      del.title = t("nf.delTitle");
      del.onclick = () => {
        NF.delete(k);
        nfChanged();
        $("nfList").querySelector("button")?.focus();
      };
      acts.append(show, del);
      row.append(ph, info, acts);
      list.appendChild(row);
    });
}
{
  const dlg = $("nfDlg");
  let armT = 0;
  const disarm = () => {
    clearTimeout(armT);
    $("nfClear").classList.remove("armed");
    $("nfClear").textContent = t("nf.clearAll");
  };
  $("nfBtn").onclick = () => {
    tip.hidden = true;
    disarm();
    renderNF();
    dlg.showModal();
    $("nfList").scrollTop = 0;
  };
  $("nfClose").onclick = () => dlg.close();
  /* clearing the whole list takes two clicks (the first one arms it for 3 s) */
  $("nfClear").onclick = (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("armed")) {
      b.classList.add("armed");
      b.textContent = t("nf.clearArmed");
      clearTimeout(armT);
      armT = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    NF.clear();
    nfChanged();
  };
  $("nfCount").textContent = NF.size || "";
}
function renderRuns() {
  const el = $("runs");
  el.textContent = "";
  if (!RUNS.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t(
      S.browse
        ? "runs.browse"
        : NOSEC.size
          ? "runs.allForbidden"
          : PTS.length
            ? "runs.belowMin"
            : SHOWPOI.length
              ? "runs.copOnly"
              : "runs.pick",
    );
    el.appendChild(p);
    return;
  }
  const mx = Math.max(...RUNS.map((r) => r.per));
  RUNS.forEach((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "run";
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<span class="rank">${String(r.rank).padStart(2, "0")}</span><span class="rname"></span><span class="rlen">${fm(r.total)} m</span><span class="rmeta"></span><span class="bar"><i style="width:${(r.per / mx) * 100}%"></i></span>`;
    b.querySelector(".rname").textContent = r.label;
    b.querySelector(".rmeta").textContent = runMeta(r);
    b.onclick = () => pick(r);
    b.onmouseenter = b.onfocus = () => {
      HOV = r;
      schedule();
    };
    b.onmouseleave = b.onblur = () => {
      if (HOV === r) {
        HOV = null;
        schedule();
      }
    };
    r.btn = b;
    el.appendChild(b);
  });
}
function pick(r, anim = true, fitView = true) {
  if (SEL !== r) STEP = 0;
  SEL = r;
  S.run = r.seq.map(mkey);
  save();
  RUNS.forEach((x) => x.btn && x.btn.setAttribute("aria-pressed", x === r ? "true" : "false"));
  if (r.btn) {
    const l = $("runs"),
      lb = l.getBoundingClientRect(),
      bb = r.btn.getBoundingClientRect();
    if (bb.top < lb.top) l.scrollTop += bb.top - lb.top;
    else if (bb.bottom > lb.bottom) l.scrollTop += bb.bottom - lb.bottom;
  }
  detail();
  if (!fitView) {
    schedule();
    return;
  }
  const all = [...r.seq, r.A.lz, r.B.lz];
  fit(
    Math.min(...all.map((p) => p.lng)),
    Math.max(...all.map((p) => p.lat)),
    Math.max(...all.map((p) => p.lng)),
    Math.min(...all.map((p) => p.lat)),
    anim,
  );
}
function detail() {
  const r = SEL || RUNS[0],
    det = $("det"),
    tb = $("wp");
  det.textContent = "";
  tb.textContent = "";
  if (!r) {
    $("dT").textContent = t("det.route");
    det.innerHTML = `<p class="empty" style="grid-column:1/-1;padding:0"></p>`;
    det.firstChild.textContent = t("det.none");
    $("inv").disabled = true;
    return;
  }
  $("dT").textContent = r.label;
  const kv = (k, v) => {
    const d = document.createElement("div");
    d.innerHTML = `<div class="k"></div><div class="v"></div>`;
    d.firstChild.textContent = k;
    d.lastChild.textContent = v;
    det.appendChild(d);
  };
  const lzRow = (tag, l, d, txt) => {
    const e = document.createElement("div");
    e.className = "lz";
    e.innerHTML = `<span class="k"></span><b></b><span class="v">${fm(d)} m</span><span class="k" style="grid-column:1/-1;text-transform:none;letter-spacing:0;font-weight:400"></span>`;
    e.firstChild.textContent = tag;
    e.querySelector("b").textContent = nm(l);
    e.lastChild.textContent = txt;
    det.appendChild(e);
  };
  /* a COP end point may have won over a nearer LZ thanks to the COP advantage: then say which LZ was nearer */
  const endTxt = () => {
    if (r.B.lz.kind !== "cop") return t("det.endLz");
    const last = r.seq[r.n - 1],
      lz = nearestIn(
        LZE.filter((l) => l.kind !== "cop"),
        last,
      );
    return lz.lz && lz.d < r.B.d
      ? t("det.endCopBias", { lz: nm(lz.lz), d: fm(lz.d), bias: fm(S.copBias) })
      : t("det.endCop");
  };
  lzRow(t("det.start"), r.A.lz, r.A.d, t(r.A.lz.kind === "cop" ? "det.startCop" : "det.startLz"));
  kv(t("det.containers"), r.boxes + (r.n > r.boxes ? t("det.doors", { n: r.n - r.boxes }) : ""));
  kv(t("det.avg"), fm(r.avg) + " m");
  kv(t("det.path"), fm(r.path) + " m");
  kv(t("det.total"), fm(r.total) + " m");
  lzRow(t("det.end"), r.B.lz, r.B.d, r.B.lz === r.A.lz ? t("det.endSame", { cop: r.A.lz.kind === "cop" }) : endTxt());
  /* raid checklist progress, with a way to start the route over */
  const done = r.seq.filter(isLooted).length,
    prog = document.createElement("div");
  prog.className = "prog";
  prog.innerHTML = `<span class="k"></span><span class="v">${done} / ${r.n}</span>`;
  prog.firstChild.textContent = t("det.looted");
  if (done) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t("det.clearTicks");
    b.title = t("det.clearTicksTitle");
    b.onclick = () => {
      r.seq.forEach((p) => setLooted(p, false));
      lootChanged(r);
    };
    prog.appendChild(b);
  }
  det.appendChild(prog);
  /* locked rooms near the walk: tick one to add it as a stop; the ones you have the key for are marked */
  const nearby = nearDoors(r);
  if (nearby.length) {
    const box = document.createElement("div");
    box.className = "doors";
    box.innerHTML = `<div class="k">${t("doors.title", { near: fm(near()) })}</div>`;
    nearby.forEach(({ d, dist, own }) => {
      const l = document.createElement("label"),
        cb = document.createElement("input"),
        im = document.createElement("img"),
        nameEl = document.createElement("span"),
        sm = document.createElement("small");
      cb.type = "checkbox";
      cb.checked = d.run === r;
      cb.dataset.door = d.id;
      cb.title = t("doors.stopTitle");
      cb.onchange = () => toggleDoor(d.id, cb.checked);
      im.src = d.door.img || DATA.icons.locked || "";
      im.alt = "";
      if (!d.door.img) im.className = "noimg";
      nameEl.className = "dname";
      sm.textContent = `${d.label} · ${d.run === r ? t("doors.stop") : fm(dist) + " m"}`;
      nameEl.append(d.door.name, sm);
      l.append(cb, im, nameEl);
      if (own) {
        const o = document.createElement("span");
        o.className = "own";
        o.textContent = t("doors.own");
        o.title = t("doors.ownTitle");
        l.appendChild(o);
      }
      l.onmouseenter = () => {
        HOVDOOR = d;
        schedule();
      };
      l.onmouseleave = () => {
        if (HOVDOOR === d) {
          HOVDOOR = null;
          schedule();
        }
      };
      box.appendChild(l);
    });
    det.appendChild(box);
  }
  const row = (n, name, p, leg, tot, cls, stop) => {
    const tr = document.createElement("tr");
    if (cls) tr.className = cls;
    [n, name, leg == null ? "–" : fm(leg), tot == null ? "–" : fm(tot)].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
    /* the ✓ box: ticks the stop off without moving the step marker */
    const td = document.createElement("td");
    if (stop) {
      const cb = document.createElement("input"),
        at = tb.children.length;
      cb.type = "checkbox";
      cb.checked = isLooted(stop);
      cb.setAttribute("aria-label", t("row.looted", { name }));
      if (cb.checked) {
        const at0 = S.looted.get(mkey(stop));
        cb.title = t("row.lootedAt", { at: clock(at0), until: clock(at0 + LOOT_MS) });
      }
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => {
        setLooted(stop, cb.checked);
        lootChanged(r, at);
      };
      td.appendChild(cb);
      tr.classList.toggle("done", cb.checked);
    }
    tr.appendChild(td);
    /* the ✕ button: marks the stop as not found (it leaves every route from the next plan) */
    const td2 = document.createElement("td");
    if (stop && canNF(stop)) {
      const nb = document.createElement("button"),
        on = isNF(stop),
        at = tb.children.length;
      nb.type = "button";
      nb.className = "nfb";
      nb.textContent = "✕";
      nb.setAttribute("aria-pressed", on);
      nb.setAttribute("aria-label", t("row.nf", { name }));
      nb.title = t(on ? "row.nfOn" : "row.nfOff");
      nb.onclick = (e) => {
        e.stopPropagation();
        setNF(stop, !on);
        $("wp").children[at]?.querySelector(".nfb")?.focus();
      };
      td2.appendChild(nb);
      tr.classList.toggle("nf", on);
    }
    tr.appendChild(td2);
    tb.appendChild(tr);
  };
  const BO = S.bail && !S.browse ? new Map(bailOuts(r).map((b) => [b.i, b])) : new Map();
  row("S", nm(r.A.lz), r.A.lz, null, 0, "lzrow");
  let sum = 0;
  r.seq.forEach((p, i) => {
    sum += r.legs[i];
    row(i + 1, p.label, p, r.legs[i], sum, null, p);
    const b = BO.get(i);
    if (b) {
      const sm = document.createElement("small");
      sm.className = "bail";
      sm.textContent = t("bail.row", { name: nm(b.ex), d: fm(b.d), back: fm(b.bd) });
      sm.title = t("bail.rowTitle");
      tb.lastElementChild.children[1].appendChild(sm);
    }
  });
  row("E", nm(r.B.lz), r.B.lz, r.B.d, sum + r.B.d, "lzrow");
  [...tb.children].forEach((tr, i) => (tr.onclick = () => go(i)));
  updNav();
}
const wps = (r) => [{ p: r.A.lz, k: "S" }, ...r.seq.map((p, i) => ({ p, k: i + 1 })), { p: r.B.lz, k: "E" }];
function updNav() {
  const r = SEL || RUNS[0],
    L = r ? wps(r) : [];
  if (r) STEP = Math.min(STEP, L.length - 1);
  $("inv").disabled = !r;
  [...$("wp").children].forEach((tr, i) => tr.classList.toggle("cur", !!SEL && i === STEP));
  const cur = $("wp").children[STEP];
  if (SEL && cur) {
    const box = $("wp").closest(".tbl"),
      top = cur.offsetTop - box.querySelector("thead").offsetHeight;
    if (top < box.scrollTop || top + cur.offsetHeight > box.scrollTop + box.clientHeight - 30)
      box.scrollTop = top - box.clientHeight / 2;
  }
}
function go(i) {
  const r = SEL || RUNS[0];
  if (!r) return;
  const L = wps(r),
    fresh = SEL !== r;
  if (fresh) pick(r, true);
  STEP = Math.max(0, Math.min(L.length - 1, i));
  updNav();
  if (fresh) {
    schedule();
    return;
  }
  const p = L[STEP].p,
    [x, y] = toS(p);
  if (x < 50 || y < 50 || x > W - 50 || y > H - 50) {
    const vh = (V.w * H) / W;
    tween(clampV({ x: p.lng - V.w / 2, y: p.lat + vh / 2, w: V.w }), true);
  } else schedule();
}
$("poiNames").onchange = (e) => {
  S.poiNames = e.target.checked;
  save();
  schedule();
};
["legNum", "legLen", "legHead", "zoneB"].forEach(
  (id) =>
    ($(id).onchange = (e) => {
      S[id] = e.target.checked;
      save();
      schedule();
    }),
);
$("bail").onchange = (e) => {
  S.bail = e.target.checked;
  save();
  detail();
  schedule();
};
$("inv").onchange = (e) => {
  S.inv = e.target.checked;
  save();
  RUNS.forEach(flip);
  rankRuns();
  labelRuns();
  STEP = SEL ? Math.max(0, SEL.n + 1 - STEP) : 0;
  renderRuns();
  RUNS.forEach((x) => x.btn && x.btn.setAttribute("aria-pressed", x === SEL ? "true" : "false"));
  detail();
  schedule();
};
/* browse only: on, the selection clears and the routes panel slides out at once (nothing to plan);
   off, the app starts over like a fresh load: routes are planned, then the panel slides back in and the whole map fits */
let animT = 0;
function applyBrowse() {
  const b = document.body;
  if (b.classList.contains("browse") === S.browse) return;
  b.classList.add("anim");
  b.classList.toggle("browse", S.browse);
  clearTimeout(animT);
  animT = setTimeout(() => b.classList.remove("anim"), 400);
}
$("browse").onchange = (e) => {
  S.browse = e.target.checked;
  SEL = null;
  HOV = null;
  STEP = 0;
  S.run = null;
  tip.hidden = true;
  if (S.browse) {
    save();
    syncBoxes();
    clearTimeout(timer);
    compute();
  } else {
    compute.ran = false;
    changed();
  }
};
addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select") || document.querySelector("dialog[open]")) return;
  const k = e.key;
  if (k === "ArrowRight") {
    go(STEP + 1);
    e.preventDefault();
  } else if (k === "ArrowLeft") {
    go(STEP - 1);
    e.preventDefault();
  } else if (k === "Home" && SEL) {
    go(0);
    e.preventDefault();
  } else if (k === "End" && SEL) {
    go(SEL.n + 1);
    e.preventDefault();
  } else if (k === "Enter" && !e.target.closest("button,a,label,[role=tab]")) {
    doneStep();
    e.preventDefault();
  }
});
/* ---------- map ---------- */
const cv = $("cv"),
  ctx = cv.getContext("2d"),
  tip = $("tip"),
  bg = new Image();
bg.src = "lamang.jpg";
bg.onload = () => schedule();
if (IMG.landingZone)
  $("lgLz").innerHTML = `<img src="${DATA.icons.landingZone}" alt="" width="14" height="14"> Landing zone`;
let W = 0,
  H = 0,
  dpr = 1,
  V = { x: 0, y: 8000, w: 14000 },
  raf = 0,
  drawn = [];
const sc = () => W / V.w,
  toS = (p) => [(p.lng - V.x) * sc(), (V.y - p.lat) * sc()];
function size() {
  const box = $("mapbox"),
    w = box.clientWidth,
    wide = matchMedia("(min-width:1301px)").matches,
    /* wide screens: the map fills the column to the bottom, under its toolbar (and the box's 1px borders);
       narrower screens keep the map's shape */
    avail = wide
      ? document.querySelector(".layout").clientHeight - box.querySelector(".maptools").offsetHeight - 3
      : innerHeight - 150,
    h = Math.max(320, wide ? avail : Math.min(w / 1.75, avail));
  /* wide screens: the column scrolls only when the window is too short for the smallest map; otherwise the map fits,
     and a scrollbar coming and going there would narrow the map and could stay */
  box.parentElement.style.overflowY = wide ? (avail < 320 ? "auto" : "hidden") : "";
  box.querySelector(".zoomctl").style.top = box.querySelector(".maptools").offsetHeight + 10 + "px";
  dpr = devicePixelRatio || 1;
  W = w;
  H = h;
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.style.height = h + "px";
  schedule();
}
/* Live tiles from gzwtacmap's tile server (web-mercator XYZ, map meters = mercator meters near 0,0).
   The stitched lamang.jpg stays underneath as a fallback while tiles load or when offline. */
const RM = 20037508.342789244,
  TILE_URL = (z, x, y) => `https://cdn.gzwtacmap.com/0.5/lamang/${z}/${x}/${y}.png`,
  TC = new Map();
let tilesOff = false,
  tileErr = 0;
function tileImg(z, x, y) {
  const k = z + "/" + x + "/" + y;
  let t = TC.get(k);
  if (t) {
    TC.delete(k);
    TC.set(k, t);
    return t;
  }
  t = new Image();
  t.onload = () => schedule();
  t.onerror = () => {
    t.bad = true;
    if (++tileErr > 25 && ![...TC.values()].some((i) => i.complete && i.naturalWidth)) tilesOff = true;
  };
  t.src = TILE_URL(z, x, y);
  TC.set(k, t);
  if (TC.size > 700) {
    const old = TC.keys().next().value;
    TC.delete(old);
  }
  return t;
}
/* tiles for a view (top-left vx,vy; vw x vh metres; s px per metre; pr device pixel ratio) onto context c; false if none could be drawn.
   onWait runs when a tile still loading arrives (the main map is redrawn by tileImg's own onload instead) */
function paintTiles(c, vx, vy, vw, vh, s, pr, onWait) {
  if (tilesOff) return false;
  const z = Math.max(14, Math.min(19, Math.round(Math.log2((2 * RM * s * pr) / 256)))),
    ts = (2 * RM) / 2 ** z;
  const x0 = Math.max(vx, 0),
    x1 = Math.min(vx + vw, 14000),
    yTop = Math.min(vy, 8000),
    yBot = Math.max(vy - vh, 0);
  if (x1 <= x0 || yTop <= yBot) return false;
  const tx0 = Math.floor((x0 + RM) / ts),
    tx1 = Math.floor((x1 + RM) / ts),
    ty0 = Math.floor((RM - yTop) / ts),
    ty1 = Math.floor((RM - yBot) / ts);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 400) return false;
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) {
      const im = tileImg(z, tx, ty);
      if (!im.complete) {
        if (onWait && !im.waiting) {
          im.waiting = true;
          im.addEventListener(
            "load",
            () => {
              im.waiting = false;
              onWait();
            },
            { once: true },
          );
        }
        continue;
      }
      if (!im.naturalWidth) continue;
      const L = (tx * ts - RM - vx) * s,
        T = (vy - (RM - ty * ts)) * s,
        S = ts * s;
      c.drawImage(im, Math.floor(L), Math.floor(T), Math.ceil(S + 1), Math.ceil(S + 1));
    }
  return true;
}
function drawTiles(s) {
  if (paintTiles(ctx, V.x, V.y, V.w, (V.w * H) / W, s, dpr)) $("zlvl").textContent = t("zlvl", { w: fdist(V.w) });
}
/* the widest view is the area that has markers (plus 300 m), not the whole 14 x 8 km tile extent; panning stays inside it */
const PB = (() => {
  const P = [...M, ...LZ, ...OB],
    pad = 300;
  return {
    x0: Math.max(0, Math.min(...P.map((p) => p.lng)) - pad),
    x1: Math.min(14000, Math.max(...P.map((p) => p.lng)) + pad),
    y0: Math.max(0, Math.min(...P.map((p) => p.lat)) - pad),
    y1: Math.min(8000, Math.max(...P.map((p) => p.lat)) + pad),
  };
})();
function clampV(v) {
  const pw = PB.x1 - PB.x0,
    ph = PB.y1 - PB.y0;
  v.w = Math.max(120, Math.min(v.w, Math.max(pw, (ph * W) / H)));
  const vh = (v.w * H) / W;
  v.x = v.w >= pw ? PB.x0 - (v.w - pw) / 2 : Math.min(Math.max(v.x, PB.x0), PB.x1 - v.w);
  v.y = vh >= ph ? PB.y1 + (vh - ph) / 2 : Math.min(Math.max(v.y, PB.y0 + vh), PB.y1);
  return v;
}
function fit(x0, y0, x1, y1, anim) {
  const pad = Math.max(250, (x1 - x0) * 0.12);
  let w = Math.max(x1 - x0 + 2 * pad, ((y0 - y1 + 2 * pad) * W) / H, 1200);
  const vh = (w * H) / W;
  const t = clampV({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 + vh / 2, w });
  tween(t, anim);
}
function fitFull(anim) {
  tween(clampV({ x: PB.x0, y: PB.y1, w: Math.max(PB.x1 - PB.x0, ((PB.y1 - PB.y0) * W) / H) }), anim);
}
function tween(t, anim) {
  const f = { ...V };
  if (!anim || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    V = t;
    schedule();
    return;
  }
  const t0 = performance.now();
  const step = (n) => {
    const k = Math.min(1, (n - t0) / 320),
      e = 1 - Math.pow(1 - k, 3);
    V = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, w: f.w + (t.w - f.w) * e };
    draw();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}
function draw() {
  const s = sc();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#1b2a18";
  ctx.fillRect(0, 0, W, H);
  if (bg.complete && bg.naturalWidth) ctx.drawImage(bg, (0 - V.x) * s, (V.y - 8000) * s, 14000 * s, 8000 * s);
  drawTiles(s);
  const step = V.w > 7000 ? 1000 : V.w > 3000 ? 500 : 250;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,.13)";
  ctx.font = "10px IBM Plex Mono, monospace";
  ctx.fillStyle = "rgba(243,246,236,.8)";
  for (let x = Math.ceil(V.x / step) * step; x < V.x + V.w; x += step) {
    const sx = (x - V.x) * s;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, H);
    ctx.stroke();
    ctx.fillText(x, sx + 3, 12);
  }
  for (let y = Math.floor(V.y / step) * step; y > V.y - (V.w * H) / W; y -= step) {
    const sy = (V.y - y) * s;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(W, sy);
    ctx.stroke();
    ctx.fillText(y, 3, sy - 3);
  }
  drawn = [];
  const css = getComputedStyle(document.documentElement),
    RC = css.getPropertyValue("--m-route").trim(),
    LC = css.getPropertyValue("--m-lz").trim(),
    COPC = css.getPropertyValue("--m-cop").trim() || "#3d9bff",
    HALO = css.getPropertyValue("--m-halo").trim();
  const line = (pts, color, w, dash, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.setLineDash(dash);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = toS(p);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = HALO;
    ctx.lineWidth = w + 3.5;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };
  if (S.zoneB) {
    /* zone borders: dashed lime line on a dark halo, under routes and markers */
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    ZB.forEach((L) =>
      L.forEach((p, i) => {
        const [x, y] = toS(p);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }),
    );
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(13,19,11,.55)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = "#7dff2e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
  }
  const F = HOV || SEL;
  [...RUNS.filter((r) => r !== F), ...(F ? [F] : [])].forEach((r) => {
    const on = !F || F === r,
      a = on ? 1 : 0.3,
      w = F === r ? 2.6 : 1.6;
    line([r.A.lz, r.seq[0]], LC, w * 0.8, [5, 4], a);
    line([r.seq[r.n - 1], r.B.lz], LC, w * 0.8, [2, 4], a);
    line(r.seq, RC, w, [], a);
    /* arrowheads just before each stop show the walking direction */
    const iz = (V.w > 9000 ? 15 : V.w > 4000 ? 18 : 22) + (F === r ? 4 : 0),
      ah = F === r ? 7 : 5;
    ctx.globalAlpha = a;
    const legs = [
      [r.A.lz, r.seq[0], LC],
      ...r.seq.slice(1).map((p, i) => [r.seq[i], p, RC]),
      [r.seq[r.n - 1], r.B.lz, LC],
    ];
    legs.forEach(([u, v, col]) => {
      const [x1, y1] = toS(u),
        [x2, y2] = toS(v),
        dx = x2 - x1,
        dy = y2 - y1,
        L = Math.hypot(dx, dy),
        gap = (v === r.B.lz ? 11 : iz / 2) + 4;
      if (L < gap + ah * 2.5) return;
      const ux = dx / L,
        uy = dy / L,
        tx = x2 - ux * gap,
        ty = y2 - uy * gap,
        bx = tx - ux * ah * 1.6,
        by = ty - uy * ah * 1.6,
        px = -uy * ah,
        py = ux * ah;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx + px, by + py);
      ctx.lineTo(bx - px, by - py);
      ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = HALO;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  });
  /* early exfil, under the markers: a solid black line with an arrowhead from each bail-out stop still ahead to its exfil
     (the drop-off path), and a dashed one from that exfil back in to the next stop (the infil). Black on a light outline,
     so it shows on the dark satellite map */
  const BK = "#111111",
    BH = "rgba(255,255,255,.85)",
    BAIL = S.bail && SEL && !S.browse ? bailAhead(SEL) : [],
    biz = (V.w > 9000 ? 15 : V.w > 4000 ? 18 : 22) + 4;
  const blk = (u, v, dash, gap) => {
    const [x1, y1] = toS(u),
      [x2, y2] = toS(v);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = BH;
    ctx.lineWidth = 5.5;
    ctx.stroke();
    ctx.strokeStyle = BK;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.setLineDash([]);
    const dx = x2 - x1,
      dy = y2 - y1,
      L = Math.hypot(dx, dy),
      ah = 7;
    if (L < gap + ah * 2.5) return;
    const ux = dx / L,
      uy = dy / L,
      tx = x2 - ux * gap,
      ty = y2 - uy * gap,
      bx = tx - ux * ah * 1.6,
      by = ty - uy * ah * 1.6;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(bx - uy * ah, by + ux * ah);
    ctx.lineTo(bx + uy * ah, by - ux * ah);
    ctx.closePath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = BH;
    ctx.stroke();
    ctx.fillStyle = BK;
    ctx.fill();
  };
  BAIL.forEach((b) => {
    blk(b.ex, b.back, [7, 6], biz / 2 + 4);
    blk(b.p, b.ex, [], 13);
  });
  /* leg distance labels on the selected route */
  /* leg label: distance on the first line, compass heading to walk underneath */
  const tag = (x, y, lines, fg, bgc) => {
    ctx.font = "500 11px IBM Plex Mono, monospace";
    const tw = Math.max(...lines.map((t) => ctx.measureText(t).width)),
      h = lines.length * 13 + 2;
    ctx.fillStyle = bgc;
    ctx.fillRect(x - tw / 2 - 3, y - 8, tw + 6, h);
    ctx.textAlign = "center";
    lines.forEach((t, k) => {
      ctx.fillStyle = k ? "#f3f6ec" : fg;
      ctx.fillText(t, x, y + 3 + k * 13);
    });
    ctx.textAlign = "left";
  };
  /* LZs and bases */
  const lzIm = IMG.landingZone,
    obIm = IMG.operationBase,
    labelBoxes = [];
  LZ.forEach((l) => {
    const [x, y] = toS(l);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return;
    const hi = F && (F.A.lz === l || F.B.lz === l),
      z = hi ? 22 : 15;
    ctx.globalAlpha = F && !hi ? 0.6 : 1;
    if (lzIm && lzIm.complete) ctx.drawImage(lzIm, x - z / 2, y - z / 2, z, z);
    else {
      ctx.fillStyle = LC;
      ctx.beginPath();
      ctx.moveTo(x, y - z / 2);
      ctx.lineTo(x + z / 2, y + z / 2);
      ctx.lineTo(x - z / 2, y + z / 2);
      ctx.fill();
    }
    /* landing zone name always sits under the icon, styled like POI names; its box is reserved so POI names avoid it */
    ctx.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    const ty = y + z / 2 + 3,
      tw = ctx.measureText(l.name).width;
    ctx.strokeStyle = "rgba(13,19,11,.85)";
    ctx.lineWidth = 3;
    ctx.strokeText(l.name, x, ty);
    ctx.fillStyle = "#f3f6ec";
    ctx.fillText(l.name, x, ty);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    labelBoxes.push([x - tw / 2 - 2, ty - 1, x + tw / 2 + 2, ty + 13]);
    ctx.globalAlpha = 1;
    drawn.push({ x, y, r: z / 2 + 3, kind: "lz", o: l });
  });
  const copNamed = new Set(); /* COP start/end points carry their name under the icon, like landing zones */
  if (!S.browse && (S.useCopS || S.useCopE))
    [...new Set([...LZS, ...LZE])].forEach((l) => {
      if (l.kind !== "cop") return;
      const [x, y] = toS(l);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return;
      const hi = F && (F.A.lz === l || F.B.lz === l),
        z = hi ? 24 : 16;
      ctx.globalAlpha = F && !hi ? 0.6 : 1;
      const im = IMG[l.icon] && tinted(IMG[l.icon], COPC);
      if (im) ctx.drawImage(im, x - z / 2, y - z / 2, z, z);
      else {
        ctx.fillStyle = COPC;
        ctx.fillRect(x - z / 3, y - z / 3, z / 1.5, z / 1.5);
      }
      ctx.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      const cn = mapNm(l),
        ty = y + z / 2 + 3,
        tw = ctx.measureText(cn).width;
      ctx.strokeStyle = "rgba(13,19,11,.85)";
      ctx.lineWidth = 3;
      ctx.strokeText(cn, x, ty);
      ctx.fillStyle = "#f3f6ec";
      ctx.fillText(cn, x, ty);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      labelBoxes.push([x - tw / 2 - 2, ty - 1, x + tw / 2 + 2, ty + 13]);
      copNamed.add(mkey(l));
      ctx.globalAlpha = 1;
      drawn.push({ x, y, r: z / 2 + 3, kind: "lz", o: l });
    });
  OB.forEach((b) => {
    const [x, y] = toS(b),
      z = 20;
    if (obIm && obIm.complete) ctx.drawImage(obIm, x - z / 2, y - z / 2, z, z);
    drawn.push({ x, y, r: 12, kind: "ob", o: b });
  });
  /* locks near the shown route that are not stops: small lock icons, a yellow ring where you have the key; click adds one */
  const zb = V.w > 9000 ? 15 : V.w > 4000 ? 18 : 22;
  if (F && !S.browse)
    nearDoors(F).forEach(({ d, own }) => {
      if (d.run) return;
      const [x, y] = toS(d);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return;
      const z = Math.max(13, zb - 5);
      if (own) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#ffd23f";
        ctx.beginPath();
        ctx.arc(x, y, z / 2 + 3, 0, 7);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.85;
      if (IMG.locked && IMG.locked.complete) ctx.drawImage(IMG.locked, x - z / 2, y - z / 2, z, z);
      ctx.globalAlpha = 1;
      drawn.push({ x, y, r: z / 2 + 3, kind: "door", o: d });
    });
  /* containers, and locks that are route stops; stops ticked off as looted fade and get a check */
  const draws = [
    ...SHOWPOI,
    ...NFPTS,
    ...LOOTPTS,
    ...[...PTS, ...DOORS.filter((d) => d.run)].sort((a, b) => (a.run === F) - (b.run === F)),
  ];
  draws.forEach((p) => {
    const [x, y] = toS(p);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return;
    const inSel = F && p.run === F,
      z = inSel ? zb + 4 : zb,
      gone = canNF(p) && isNF(p),
      done = !gone && !NOROUTE(p.t) && isLooted(p);
    ctx.globalAlpha = NOROUTE(p.t) ? (F ? 0.7 : 1) : done || gone ? 0.3 : LEFT.has(p.i) || (!p.run && S.planExcl.has(mkey(p))) ? 0.4 : F && !inSel ? 0.55 : 1;
    const im = NOROUTE(p.t) ? IMG[p.icon] && tinted(IMG[p.icon], COPC) : IMG[p.icon];
    if (im && (im.tagName === "CANVAS" || (im.complete && im.naturalWidth)))
      ctx.drawImage(im, x - z / 2, y - z / 2, z, z);
    else {
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (gone) {
      /* not found: red ✕ in the corner */
      const cx = x + z / 2 - 2,
        cy = y + z / 2 - 2;
      ctx.fillStyle = "#d23b3b";
      ctx.strokeStyle = HALO;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, 7);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - 2.5, cy - 2.5);
      ctx.lineTo(cx + 2.5, cy + 2.5);
      ctx.moveTo(cx + 2.5, cy - 2.5);
      ctx.lineTo(cx - 2.5, cy + 2.5);
      ctx.stroke();
    } else if (done) {
      const cx = x + z / 2 - 2,
        cy = y + z / 2 - 2;
      ctx.fillStyle = "#3fbf5a";
      ctx.strokeStyle = HALO;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, 7);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy);
      ctx.lineTo(cx - 1, cy + 2.2);
      ctx.lineTo(cx + 3, cy - 2.2);
      ctx.stroke();
    }
    drawn.push({ x, y, r: z / 2 + 2, kind: "container", o: p });
  });
  if (F) {
    const r = F;
    /* leg labels follow the "Show Leg length" / "Show Leg Heading" switches */
    const legTag = (u, v, dist, fg, k) => {
      const lines = [S.legLen ? fm(dist) + " m" : null, S.legHead ? heading(u, v) : null].filter(Boolean);
      if (!lines.length) return;
      const [a, b] = toS(u),
        [c, d] = toS(v);
      if (Math.hypot(c - a, d - b) <= 46) return;
      tag((a + c) / 2, (b + d) / 2, lines, fg, "rgba(13,19,11,.82)");
    };
    r.seq.forEach((p, i) => {
      if (i) legTag(r.seq[i - 1], p, r.legs[i], RC, i + 1);
    });
    legTag(r.A.lz, r.seq[0], r.A.d, LC, 1);
    legTag(r.seq[r.n - 1], r.B.lz, r.B.d, LC, r.n + 1);
    /* stop numbers in small orange badges, behind the "Show Leg number" switch */
    if (S.legNum)
      r.seq.forEach((p, i) => {
        const [x, y] = toS(p);
        ctx.font = "600 10px IBM Plex Mono, monospace";
        const t = String(i + 1),
          tw = Math.max(14, ctx.measureText(t).width + 6);
        ctx.fillStyle = RC;
        ctx.beginPath();
        ctx.roundRect
          ? ctx.roundRect(x + zb / 2 - 2, y - zb / 2 - 12, tw, 14, 7)
          : ctx.rect(x + zb / 2 - 2, y - zb / 2 - 12, tw, 14);
        ctx.fill();
        ctx.fillStyle = HALO;
        ctx.textAlign = "center";
        ctx.fillText(t, x + zb / 2 - 2 + tw / 2, y - zb / 2 - 2);
        ctx.textAlign = "left";
      });
    const lab = (l, txt, dy) => {
      const [x, y] = toS(l);
      ctx.font = "700 13px Saira Condensed, Arial Narrow, sans-serif";
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = "rgba(13,19,11,.85)";
      ctx.fillRect(x + 14, y + dy - 11, tw + 10, 17);
      ctx.fillStyle = LC;
      ctx.fillText(txt, x + 19, y + dy + 2);
    };
    if (r.A.lz === r.B.lz) lab(r.A.lz, `${t("map.startEnd")} · ${mapNm(r.A.lz)}`, 0);
    else {
      lab(r.A.lz, `${t("map.start")} · ${mapNm(r.A.lz)} · ${fm(r.A.d)} m`, 0);
      lab(r.B.lz, `${t("map.end")} · ${mapNm(r.B.lz)} · ${fm(r.B.d)} m`, 0);
    }
  }
  if (SHOWPOI.length) {
    /* ticked COPs always carry their names, styled like POI names */
    ctx.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    SHOWPOI.forEach((p) => {
      if (copNamed.has(mkey(p))) return;
      const [x, y] = toS(p);
      if (x < -80 || y < -30 || x > W + 80 || y > H + 20) return;
      const ty = y + zb / 2 + 3;
      ctx.globalAlpha = F ? 0.75 : 1;
      ctx.strokeStyle = "rgba(13,19,11,.85)";
      ctx.lineWidth = 3;
      const cn = short(p.label);
      ctx.strokeText(cn, x, ty);
      ctx.fillStyle = "#f3f6ec";
      ctx.fillText(cn, x, ty);
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  if (S.poiNames) {
    /* every point-of-interest name, placed greedily so labels never overlap */
    const placed = labelBoxes,
      hitR = (a) => placed.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
    /* name centred under its dot */
    ctx.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ALLPOI.forEach((p) => {
      const [x, y] = toS(p);
      if (x < -80 || y < -20 || x > W + 80 || y > H + 20) return;
      const tw = ctx.measureText(p.label).width,
        r = [x - tw / 2 - 2, y - 3, x + tw / 2 + 2, y + 18];
      if (hitR(r)) return;
      placed.push(r);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(13,19,11,.85)";
      ctx.lineWidth = 3;
      ctx.strokeText(p.label, x, y + 4);
      ctx.fillStyle = "#f3f6ec";
      ctx.fillText(p.label, x, y + 4);
    });
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  if (BAIL.length) {
    /* early exfil labels on top: "EXFIL · 230 m" with the target on the solid line, "INFIL · 250 m" with the next stop on
       the dashed one (both on white), a black ring on the stop, and a COP target's icon and name when COPs are not shown
       otherwise */
    const wtag = (x, y, lines) => {
      ctx.font = "600 11px IBM Plex Mono, monospace";
      const tw = Math.max(...lines.map((s) => ctx.measureText(s).width)),
        h = lines.length * 13 + 2;
      ctx.fillStyle = "rgba(255,255,255,.93)";
      ctx.fillRect(x - tw / 2 - 4, y - 9, tw + 8, h + 2);
      ctx.strokeStyle = BK;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - tw / 2 - 4, y - 9, tw + 8, h + 2);
      ctx.textAlign = "center";
      lines.forEach((s, k) => {
        ctx.font = (k ? "500" : "700") + " 11px IBM Plex Mono, monospace";
        ctx.fillStyle = k ? "#333" : BK;
        ctx.fillText(s, x, y + 3 + k * 13);
      });
      ctx.textAlign = "left";
    };
    BAIL.forEach((b) => {
      const [x, y] = toS(b.p),
        [ex, ey] = toS(b.ex),
        [nx, ny] = toS(b.back);
      ctx.lineWidth = 5;
      ctx.strokeStyle = BH;
      ctx.beginPath();
      ctx.arc(x, y, zb * 0.75 + 5, 0, 7);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = BK;
      ctx.beginPath();
      ctx.arc(x, y, zb * 0.75 + 5, 0, 7);
      ctx.stroke();
      if (b.ex.kind === "cop" && !copNamed.has(mkey(b.ex))) {
        const im = IMG[b.ex.icon] && tinted(IMG[b.ex.icon], COPC),
          z = 18;
        if (im) ctx.drawImage(im, ex - z / 2, ey - z / 2, z, z);
        ctx.font = "500 11px IBM Plex Sans, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(13,19,11,.85)";
        ctx.lineWidth = 3;
        ctx.strokeText(mapNm(b.ex), ex, ey + z / 2 + 3);
        ctx.fillStyle = "#f3f6ec";
        ctx.fillText(mapNm(b.ex), ex, ey + z / 2 + 3);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        drawn.push({ x: ex, y: ey, r: z / 2 + 3, kind: "lz", o: b.ex });
      }
      if (Math.hypot(ex - x, ey - y) > 46)
        wtag((x + ex) / 2, (y + ey) / 2, [
          `${t("bail.map")} · ${fm(b.d)} m`,
          mapNm(b.ex) + (S.legHead ? " · " + heading(b.p, b.ex) : ""),
        ]);
      if (Math.hypot(nx - ex, ny - ey) > 46)
        wtag((ex + nx) / 2, (ey + ny) / 2, [
          `${t("bail.infil")} · ${fm(b.bd)} m`,
          t("bail.next", { k: b.i + 2 }) + (S.legHead ? " · " + heading(b.ex, b.back) : ""),
        ]);
    });
  }
  if (FOCUS) {
    const name = T[FOCUS.t].name;
    FOCUS.pts.forEach((p) => {
      const [x, y] = toS(p);
      if (x < -30 || y < -30 || x > W + 30 || y > H + 30) return;
      if (!S.sel.has(p.t)) {
        const im = IMG[p.icon];
        if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x - zb / 2, y - zb / 2, zb, zb);
        drawn.push({ x, y, r: zb / 2 + 2, kind: "container", o: p });
      }
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = "rgba(13,19,11,.7)";
      ctx.beginPath();
      ctx.arc(x, y, zb * 0.9 + 8, 0, 7);
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#ffffff";
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(x, y, zb * 0.9 + 8, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 13px Saira Condensed, Arial Narrow, sans-serif";
      const tw = ctx.measureText(name).width;
      ctx.fillStyle = "rgba(13,19,11,.85)";
      ctx.fillRect(x + zb + 6, y - 9, tw + 10, 17);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(name, x + zb + 11, y + 4);
    });
  }
  /* the lock under the mouse in the route panel's door list */
  if (HOVDOOR) {
    const [x, y] = toS(HOVDOOR),
      rad = Math.max(14, zb * 0.9 + 4);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = "rgba(13,19,11,.7)";
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, 7);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "#ffd23f";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (SEL && F === SEL) {
    const w = wps(SEL)[Math.min(STEP, SEL.n + 1)];
    if (w) {
      const [x, y] = toS(w.p),
        rad = Math.max(16, zb * 0.9 + 6);
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = "rgba(13,19,11,.7)";
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#ffffff";
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  /* Szögmérés: white line from the first click to the second (or to the cursor until then), heading and distance on it */
  if (MEAS_ON && MEAS) {
    const e = MEAS.b || MHOV,
      [x1, y1] = toS(MEAS.a),
      dot = (x, y) => {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 7);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = HALO;
        ctx.stroke();
      };
    if (e) {
      const [x2, y2] = toS(e),
        L = Math.hypot(x2 - x1, y2 - y1);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = HALO;
      ctx.lineWidth = 5.5;
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash(MEAS.b ? [] : [6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (L > 16) {
        const ux = (x2 - x1) / L,
          uy = (y2 - y1) / L,
          tx = x2 - ux * 6,
          ty = y2 - uy * 6,
          bx = tx - ux * 11,
          by = ty - uy * 11;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx - uy * 6, by + ux * 6);
        ctx.lineTo(bx + uy * 6, by - ux * 6);
        ctx.closePath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = HALO;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      if (MEAS.b) dot(x2, y2);
      const lines = [heading(MEAS.a, e), fm(D(MEAS.a, e)) + " m"];
      if (L >= 70) tag((x1 + x2) / 2, (y1 + y2) / 2, lines, "#ffffff", "rgba(13,19,11,.88)");
      else {
        const ux = L ? (x2 - x1) / L : 1,
          uy = L ? (y2 - y1) / L : 0;
        tag(x2 + ux * 34, y2 + uy * 24, lines, "#ffffff", "rgba(13,19,11,.88)");
      }
    }
    dot(x1, y1);
  }
}
function hit(e) {
  const b = cv.getBoundingClientRect(),
    x = e.clientX - b.left,
    y = e.clientY - b.top;
  let best = null,
    bd = 1e9;
  for (let i = drawn.length - 1; i >= 0; i--) {
    const d = drawn[i],
      dd = Math.hypot(d.x - x, d.y - y);
    if (dd <= d.r && dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return { best, x, y };
}
cv.addEventListener("mousemove", (e) => {
  if (MEAS_ON) {
    tip.hidden = true;
    if (MEAS && !MEAS.b) {
      MHOV = measPt(e);
      schedule();
    }
    return;
  }
  if (ptrs.size) {
    return;
  }
  const { best, x, y } = hit(e);
  if (!best) {
    tip.hidden = true;
    cv.style.cursor = "";
    return;
  }
  cv.style.cursor = (best.kind === "container" && best.o.run) || best.kind === "door" ? "pointer" : "default";
  const L = [];
  const o = best.o;
  /* a key's lock: which key opens it and whether you have it */
  const keyLine = (d) => t("tip.key", { name: d.door.name, own: OWN.has(d.door.name) });
  if (best.kind === "door") {
    L.push(o.label, keyLine(o), t("tip.door", { d: fm(routeDist(HOV || SEL, o)) }));
  } else if (best.kind === "lz") {
    L.push(mapNm(o) + (o.kind === "cop" ? " (COP)" : ""));
    SEL && SEL.A.lz === o && L.push(t("tip.lzStart", { route: SEL.label, d: fm(SEL.A.d) }));
    SEL && SEL.B.lz === o && L.push(t("tip.lzEnd", { route: SEL.label, d: fm(SEL.B.d) }));
  } else if (best.kind === "ob") L.push("Operation Base");
  else {
    L.push(NOROUTE(o.t) ? short(o.label) : o.label);
    L.push((o.door ? t("tip.keyDoor") : T[o.t].name) + (o.poi ? " · " + o.poi : ""));
    if (o.door) L.push(keyLine(o));
    if (o.run) {
      const k = o.run.seq.indexOf(o);
      L.push(t("tip.stop", { route: o.run.label, k: k + 1, n: o.run.n, looted: isLooted(o) }));
      const bo = S.bail && o.run === SEL && bailOuts(SEL).find((b) => b.i === k);
      if (bo) L.push(t("bail.tip", { name: nm(bo.ex), d: fm(bo.d), h: heading(o, bo.ex), back: fm(bo.bd), k: k + 2 }));
      L.push(t("tip.prev", { d: fm(o.run.legs[k]), from: k ? t("tip.prevStop", { k }) : nm(o.run.A.lz) }));
    } else if (NOROUTE(o.t))
      L.push(
        !S.browse && (S.useCopS || S.useCopE)
          ? S.useCopS && o.label === S.copStart
            ? t("tip.copStart", { alsoEnd: S.useCopE })
            : S.useCopE
              ? t("tip.copEnd")
              : t("tip.copShown")
          : t("tip.copShown"),
      );
    else if (NOSEC.has(o.i)) L.push(t("tip.nosec", { s: NOSEC.get(o.i) }));
    else if (LEFT.has(o.i)) L.push(t("tip.left"));
    /* off-route containers: how long a looted mark still keeps it out, and the click that marks or unmarks it */
    if (canNF(o) && isNF(o)) L.push(t("nf.tip", { date: fdate(NF.get(nfKey(o)).at) }));
    else if (!o.run && !o.door && !NOROUTE(o.t)) {
      const left = lootLeft(mkey(o));
      if (left > 0) L.push(t("tip.looted", { at: clock(S.looted.get(mkey(o))), min: Math.ceil(left / 60000) }));
      else if (S.planExcl.has(mkey(o))) L.push(t("tip.lapsed"));
      L.push(t(left > 0 ? "tip.unmark" : "tip.mark", { min: LOOT_MIN }));
    }
    if (canNF(o)) L.push(t(isNF(o) ? "nf.tipUnmark" : "nf.tipMark"));
  }
  tip.textContent = "";
  const ph = best.kind === "container" && photoFor(o.id);
  if (ph) {
    if (tipImg.dataset.id != String(o.id) || tipImg.dataset.src !== ph[0]) {
      tipImg.dataset.id = o.id;
      tipImg.dataset.src = ph[0];
      tipImg.src = ph[1];
    }
    tip.appendChild(tipImg);
  }
  L.forEach((l, i) => {
    if (i) tip.appendChild(document.createElement("br"));
    tip.appendChild(document.createTextNode(l));
  });
  tip.hidden = false;
  TP = { x, y };
  placeTip();
});
let TP = { x: 0, y: 0 };
function placeTip() {
  if (tip.hidden) return;
  const ox = cv.offsetTop,
    tw = tip.offsetWidth,
    th = tip.offsetHeight;
  let tx = TP.x + 14,
    ty = TP.y + ox + 14;
  if (tx + tw > W - 6) tx = TP.x - tw - 14;
  if (tx < 6) tx = 6;
  if (ty + th > ox + H - 6) ty = Math.max(ox + 6, TP.y + ox - th - 14);
  tip.style.left = tx + "px";
  tip.style.top = ty + "px";
}
cv.addEventListener("mouseleave", () => {
  tip.hidden = true;
  if (MHOV) {
    MHOV = null;
    schedule();
  }
});
let moved = false;
cv.addEventListener("click", (e) => {
  if (MEAS_ON) {
    measClick(e);
    return;
  }
  if (moved) {
    moved = false;
    return;
  }
  const { best } = hit(e);
  if (best && best.kind === "door") toggleDoor(best.o.id, true);
  else if (best && best.kind === "container" && best.o.run) {
    /* a route stop: open its route if it is not the open one, then put the step marker (white dashed ring) and the
       highlighted row of the stop list on that stop */
    const r = best.o.run;
    if (SEL !== r) pick(r);
    STEP = r.seq.indexOf(best.o) + 1;
    updNav();
    schedule();
  } else if (best && best.kind === "container" && !best.o.door && !NOROUTE(best.o.t) && !isNF(best.o)) {
    /* a container on no route (left out, or already looted): click marks it looted, or takes the mark off */
    setLooted(best.o, !isLooted(best.o));
    lootChanged(null);
    tip.hidden = true;
  } else if (best && best.kind === "lz" && SEL && (SEL.A.lz === best.o || SEL.B.lz === best.o)) {
    /* the open route's start or end point: the first or the last row */
    STEP = SEL.A.lz === best.o ? 0 : SEL.n + 1;
    updNav();
    schedule();
  }
});
function zoomAt(f, sx, sy) {
  const mx = V.x + sx / sc(),
    my = V.y - sy / sc(),
    w = V.w * f,
    t = clampV({ x: 0, y: 0, w });
  const s2 = W / t.w;
  V = clampV({ x: mx - sx / s2, y: my + sy / s2, w: t.w });
  schedule();
}
cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (MEAS_ON) return;
    const b = cv.getBoundingClientRect();
    zoomAt(Math.pow(1.0018, e.deltaMode ? e.deltaY * 33 : e.deltaY), e.clientX - b.left, e.clientY - b.top);
    tip.hidden = true;
  },
  { passive: false },
);
cv.addEventListener("dblclick", (e) => {
  if (MEAS_ON) return;
  const b = cv.getBoundingClientRect();
  zoomAt(0.5, e.clientX - b.left, e.clientY - b.top);
});
const ptrs = new Map();
let pinch = null;
/* right-click on a container: puts it on the Not found list, or takes it off */
cv.addEventListener("contextmenu", (e) => {
  if (MEAS_ON) return;
  const { best } = hit(e);
  if (!best || best.kind !== "container" || !canNF(best.o)) return;
  e.preventDefault();
  setNF(best.o, !isNF(best.o));
  tip.hidden = true;
});
cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  moved = false;
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
});
cv.addEventListener("pointermove", (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p || MEAS_ON) return;
  const dx = e.clientX - p.x,
    dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (Math.hypot(p.x - p.sx, p.y - p.sy) > 4) moved = true;
  if (!moved) return;
  tip.hidden = true;
  cv.classList.add("dragging");
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()],
      d = Math.hypot(a.x - b.x, a.y - b.y),
      r = cv.getBoundingClientRect();
    if (d > 0) {
      zoomAt(pinch.d / d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch.d = d;
    }
    return;
  }
  if (ptrs.size === 1) {
    V = clampV({ x: V.x - dx / sc(), y: V.y + dy / sc(), w: V.w });
    schedule();
  }
});
const endPtr = (e) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (!ptrs.size) cv.classList.remove("dragging");
};
cv.addEventListener("pointerup", endPtr);
cv.addEventListener("pointercancel", endPtr);
$("zIn").onclick = () => zoomAt(0.6, W / 2, H / 2);
$("zOut").onclick = () => zoomAt(1 / 0.6, W / 2, H / 2);
/* Szögmérés (not saved): while on the map is frozen; 1st click = start, 2nd = end, 3rd clears. Clicking an icon snaps to it. */
let MEAS_ON = false,
  MEAS = null,
  MHOV = null;
function measPt(e) {
  const { best, x, y } = hit(e);
  return best ? { lat: best.o.lat, lng: best.o.lng } : { lat: V.y - y / sc(), lng: V.x + x / sc() };
}
function measHint() {
  const h = $("mhint");
  h.hidden = !MEAS_ON;
  h.textContent = !MEAS ? t("meas.start") : !MEAS.b ? t("meas.end") : t("meas.clear");
}
function measClick(e) {
  if (!MEAS) MEAS = { a: measPt(e) };
  else if (!MEAS.b) {
    MEAS.b = measPt(e);
    MHOV = null;
  } else {
    MEAS = null;
    MHOV = null;
  }
  measHint();
  schedule();
}
function setMeasure(on) {
  MEAS_ON = on;
  MEAS = null;
  MHOV = null;
  $("measure").checked = on;
  cv.classList.toggle("measuring", on);
  cv.style.cursor = "";
  $("zIn").disabled = $("zOut").disabled = on;
  if (on) {
    tip.hidden = true;
    ptrs.clear();
    pinch = null;
    moved = false;
    cv.classList.remove("dragging");
  }
  measHint();
  schedule();
}
$("measure").onchange = (e) => setMeasure(e.target.checked);
cv.addEventListener("keydown", (e) => {
  if (MEAS_ON) {
    if (e.key === "Escape" && MEAS) {
      MEAS = null;
      MHOV = null;
      measHint();
      schedule();
    }
    return;
  }
  if (e.key === "+" || e.key === "=") {
    zoomAt(0.6, W / 2, H / 2);
    e.preventDefault();
  } else if (e.key === "-") {
    zoomAt(1 / 0.6, W / 2, H / 2);
    e.preventDefault();
  }
});
let resetT = 0;
$("reset").onclick = (e) => {
  const b = e.currentTarget;
  if (!b.classList.contains("armed")) {
    b.classList.add("armed");
    b.textContent = t("reset.armed");
    clearTimeout(resetT);
    resetT = setTimeout(() => {
      b.classList.remove("armed");
      b.textContent = t("reset.btn");
    }, 3000);
    return;
  }
  clearTimeout(resetT);
  b.classList.remove("armed");
  b.textContent = t("reset.btn");
  /* stop saving into the selected preset first, so the reset never wipes it */
  if (ACTIVE) {
    ACTIVE = null;
    savePresets();
    renderPresets();
  }
  try {
    localStorage.removeItem(KEY);
  } catch {}
  const keepLoot = S.looted,
    keepExcl = S.planExcl;
  Object.assign(S, DEF());
  S.looted = keepLoot;
  S.planExcl = keepExcl;
  S.sel.clear();
  $("tq").value = "";
  syncInputs();
  setMeasure(false);
  filterTypes();
  SEL = null;
  HOV = null;
  STEP = 0;
  changed();
  fitFull(true);
  const sn = $("savedNote");
  sn.hidden = false;
  setTimeout(() => (sn.hidden = true), 4000);
};
$("full").onclick = () => {
  SEL = null;
  STEP = 0;
  S.run = null;
  save();
  RUNS.forEach((x) => x.btn && x.btn.setAttribute("aria-pressed", "false"));
  detail();
  fitFull(true);
};
/* in browse only the scale and top-left corner stay put, so a widening map uncovers more terrain to the right instead of zooming */
let lastW = 0,
  lastH = 0;
const relayout = () => {
  const w = $("mapbox").clientWidth,
    h = innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w;
  lastH = h;
  const ow = W;
  size();
  if (SEL) pick(SEL, false);
  else if (S.browse && ow) tween(clampV({ x: V.x, y: V.y, w: (V.w * W) / ow }), false);
  else fitFull(false);
  /* resizing clears the canvas: redraw before this frame paints, or the map blinks dark while the routes panel slides */
  cancelAnimationFrame(raf);
  draw();
};
new ResizeObserver(relayout).observe($("mapbox"));
addEventListener("resize", relayout);
/* The map's height is what the column leaves under its toolbar. When the toolbar changes height (its switches wrap
   differently), only the height is redone and the view kept; left alone, the column would overflow. */
let toolsH = 0;
new ResizeObserver(() => {
  const h = $("mapbox").querySelector(".maptools").offsetHeight;
  if (h === toolsH) return;
  toolsH = h;
  size();
  V = clampV(V);
  cancelAnimationFrame(raf);
  draw();
}).observe($("mapbox").querySelector(".maptools"));
/* ---------- import / export ---------- */
/* Export saves this app's browser storage (every "lamang-" key: settings with raid ticks, presets, owned keys and the
   language) to a dated JSON file. Import reads such a file and, once confirmed, replaces those keys and reloads the
   page with them. Other data the browser keeps for local files is never read or touched. */
const IO_APP = "kokesz-loot-runs";
function appKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("lamang-")) out.push(k);
    }
  } catch {}
  return out;
}
$("exportBtn").onclick = () => {
  save();
  savePresets();
  const data = {};
  appKeys().forEach((k) => {
    try {
      data[k] = localStorage.getItem(k);
    } catch {}
  });
  const blob = new Blob(
      [JSON.stringify({ app: IO_APP, version: 1, exported: new Date().toISOString(), data }, null, 2)],
      {
        type: "application/json",
      },
    ),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kokesz-loot-runs-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
{
  const dlg = $("ioDlg"),
    file = $("importFile");
  let pending = null;
  /* one dialog for both: a Yes / No question, or a message with just OK */
  const show = (title, text, ask) => {
    $("ioT").textContent = title;
    $("ioD").textContent = text;
    $("ioYes").hidden = !ask;
    $("ioNo").textContent = t(ask ? "preset.no" : "io.ok");
    tip.hidden = true;
    if (!dlg.open) dlg.showModal();
    $("ioNo").focus();
  };
  $("importBtn").onclick = () => {
    file.value = "";
    file.click();
  };
  file.onchange = async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    let parsed = null;
    try {
      parsed = JSON.parse(await f.text());
    } catch {}
    /* cleared once read, so picking the same file again (e.g. after No) still counts as a choice */
    file.value = "";
    /* only this app's keys with text values are taken from the file */
    const data =
      parsed && parsed.app === IO_APP && parsed.data && typeof parsed.data === "object"
        ? Object.entries(parsed.data).filter(([k, v]) => /^lamang-[\w.-]+$/.test(k) && typeof v === "string")
        : [];
    if (!data.length) {
      pending = null;
      show(t("io.errTitle"), t("io.errText", { name: f.name }), false);
      return;
    }
    pending = data;
    const when = new Date(parsed.exported);
    show(
      t("io.importConfirm"),
      t("io.importText", { name: f.name, date: isNaN(when) ? "?" : when.toLocaleString(locale()) }),
      true,
    );
  };
  $("ioNo").onclick = () => {
    pending = null;
    dlg.close();
  };
  $("ioYes").onclick = () => {
    if (!pending) return;
    /* nothing may save the old state over the import before the page has reloaded */
    FROZEN = true;
    clearTimeout(timer);
    if (planner) planner.terminate();
    try {
      appKeys().forEach((k) => localStorage.removeItem(k));
      pending.forEach(([k, v]) => localStorage.setItem(k, v));
    } catch {
      FROZEN = false;
      show(t("io.errTitle"), t("io.storeErr"), false);
      return;
    }
    location.reload();
  };
}

/* ---------- language ---------- */
/* EN / HU next to the stats: saved apart from the route settings (i18n.js). Switching redoes every text, and replans,
   so names the planner gives (e.g. "near Tiger Bay") follow too */
function setLang(l) {
  if (l === LANG || !Object.hasOwn(I18N, l)) return;
  LANG = l;
  try {
    localStorage.setItem(LANGKEY, l);
  } catch {}
  tip.hidden = true;
  applyI18n();
  labelTypes();
  syncBoxes();
  filterTypes();
  syncInputs();
  measHint();
  renderPresets();
  changed();
  schedule();
}
document.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
size();
compute();
