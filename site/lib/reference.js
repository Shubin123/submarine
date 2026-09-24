// Published reference data used by the verification demos and tests.

// Ghia, Ghia & Shin (1982), J. Comput. Phys. 48, 387–411, Re = 100 lid-driven cavity.
export const GHIA_RE100_U = [
  [1.0, 1.0], [0.9766, 0.84123], [0.9688, 0.78871], [0.9609, 0.73722], [0.9531, 0.68717],
  [0.8516, 0.23151], [0.7344, 0.00332], [0.6172, -0.13641], [0.5, -0.20581], [0.4531, -0.2109],
  [0.2813, -0.15662], [0.1719, -0.1015], [0.1016, -0.06434], [0.0703, -0.04775], [0.0625, -0.04192],
  [0.0547, -0.03717], [0.0, 0.0],
].map(([y, u]) => ({ y, u }));

export const GHIA_RE100_V = [
  [1.0, 0.0], [0.9688, -0.05906], [0.9609, -0.07391], [0.9531, -0.08864], [0.9453, -0.10313],
  [0.9063, -0.16914], [0.8594, -0.22445], [0.8047, -0.24533], [0.5, 0.05454], [0.2344, 0.17527],
  [0.2266, 0.17507], [0.1563, 0.16077], [0.0938, 0.12317], [0.0781, 0.1089], [0.0703, 0.10091],
  [0.0625, 0.09233], [0.0, 0.0],
].map(([x, v]) => ({ x, v }));

// Schäfer & Turek (1996) benchmark 2D-1 (Re = 20, steady): reference bands.
export const TUREK_2D1 = {
  cd: [5.57, 5.59],
  cl: [0.0104, 0.011],
};

// Schäfer & Turek (1996) benchmark 2D-2 (Re = 100, unsteady): reference bands.
export const TUREK_2D2 = {
  cdMax: [3.22, 3.24],
  clMax: [0.99, 1.01],
  strouhal: [0.295, 0.305],
};

// Linear interpolation of samples sorted or unsorted by `key`.
export function interp(samples, key, val, at) {
  const s = [...samples].sort((a, b) => a[key] - b[key]);
  if (at <= s[0][key]) return s[0][val];
  for (let i = 1; i < s.length; i++) {
    if (at <= s[i][key]) {
      const t = (at - s[i - 1][key]) / (s[i][key] - s[i - 1][key]);
      return s[i - 1][val] + t * (s[i][val] - s[i - 1][val]);
    }
  }
  return s[s.length - 1][val];
}

// Max absolute deviation of a computed profile from a reference profile.
export function maxDeviation(computed, reference, key, val) {
  let m = 0;
  for (const r of reference) m = Math.max(m, Math.abs(interp(computed, key, val, r[key]) - r[val]));
  return m;
}
