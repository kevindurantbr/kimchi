// Runs P2's analysis engine off the main thread. analyzeField takes 0.5-2 s and rotationFit 0.2-1.2 s per
// rotation on 45 years of daily data; in the page thread that froze the map and every control.
// The worker loads the NASA POWER history itself, so the large arrays are never copied between threads.
let A = null, site = null, crops = null;

async function init({ cropsData }) {
  A = await import('../lib/analysis.mjs');
  const r = await fetch(new URL('../data/site_history.json', import.meta.url));
  if (!r.ok) throw new Error(`site_history.json: HTTP ${r.status}`);
  const s = await r.json();
  site = s.sites?.[0] ?? null;
  crops = cropsData;
  return { ok: !!(A.analyzeField && site), hasFit: !!A.rotationFit };
}

self.onmessage = async ({ data }) => {
  const { id, op, args } = data;
  try {
    let result;
    if (op === 'init') result = await init(args);
    else if (op === 'analyze') result = A.analyzeField({ ...args, daily: site.daily, site, crops });
    else if (op === 'fit') result = A.rotationFit({ ...args, daily: site.daily, crops });
    else throw new Error('unknown op ' + op);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
