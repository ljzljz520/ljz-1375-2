// HTTP API + 静态资源（无外部依赖）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import * as store from './store.js';
import { search } from './graph.js';
import { buildProfile, difficultyTagFromProfile } from './elevation.js';
import { filterReviewedRoutes } from './filter.js';
import { snapshotPlan, recheckPlan } from './plan.js';
import { collectSources, resolveSourceIds } from './sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 8080;

function fv() { return store.withBoundVersions(); }

function envelope(data, extra = {}) {
  return { sourceVersion: fv(), generatedAt: new Date().toISOString(), ...data, ...extra };
}

async function readBody(req) {
  let raw = '';
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

function stationDetail(data, id) {
  const s = data.stations.find((x) => x.id === id);
  if (!s) return null;
  // 该驿站相关的“相邻路段”（当代）与“历史叙事引用”分开列出
  const adjacent = data.segments.filter((g) => g.from === id || g.to === id).map((g) => {
    const other = g.from === id ? g.to : g.from;
    return {
      segmentId: g.id, neighborId: other,
      neighborName: data.stations.find((x) => x.id === other)?.name || other,
      mode: g.mode, direction: g.direction, distanceKm: g.distanceKm, baseMinutes: g.baseMinutes,
      reviewed: g.reviewed, status: g.status, window: g.window, sources: g.sources
    };
  });
  const historical = data.historicalTrails
    .filter((h) => h.stationRefs.includes(id))
    .map((h) => ({ id: h.id, name: h.name, era: h.era, disclaimer: h.disclaimer, sources: h.sources }));
  const announcements = data.announcements.filter((a) =>
    adjacent.some((g) => g.segmentId === a.segmentId));
  return {
    station: s,
    sources: resolveSourceIds(data, s.sources || []),
    adjacentSegments: adjacent,
    historicalRefs: historical,
    announcements
  };
}

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, sourceVersion: fv() })],

  ['GET', /^\/api\/stations$/, (d, p, q) => {
    let list = d.stations.map((s) => ({ ...s }));
    if (q.pending === '1') list = list.filter((s) => s.nameStatus === 'pending');
    return { stations: list };
  }],

  ['GET', /^\/api\/stations\/([\w-]+)$/, (d, p) => stationDetail(d, p[0])],

  ['GET', /^\/api\/segments$/, (d) => ({ segments: d.segments })],

  ['GET', /^\/api\/segments\/([\w-]+)\/profile$/, (d, p) => {
    // 单路段高程剖面；缺失海拔段留痕，不当零
    const seg = d.segments.find((s) => s.id === p[0]);
    if (!seg) return { error: 'not found' };
    const profile = buildProfile([seg]);
    return { segmentId: seg.id, reviewed: seg.reviewed, ...profile, sources: resolveSourceIds(d, seg.sources) };
  }],

  ['GET', /^\/api\/historical-trails$/, (d) => ({
    historicalTrails: d.historicalTrails,
    separationNote: '历史叙事与当代通行信息分表存储；历史商路不进入通行图，也不可直接当作现行徒步路线。'
  })],

  ['POST', /^\/api\/search$/, (d, p, q, body) => {
    const { from, to, date, dailyCapMinutes, modes, startClock } = body;
    if (!from || !to || !date) return { error: '需要 from, to, date' };
    const res = search(d, { from, to, date, dailyCapMinutes, modes, startClock });
    return { method: 'constrained-graph-search', ...res,
      sources: envelopeBindings(d, res) };
  }],

  ['GET', /^\/api\/routes$/, (d, p, q) => {
    const prefs = {
      modes: q.modes ? q.modes.split(',') : ['foot', 'bus', 'mixed'],
      month: q.month ? Number(q.month) : null,
      maxDailyMinutes: q.cap ? Number(q.cap) : null,
      maxDifficulty: q.difficulty || 'very-strenuous'
    };
    if (q.prefs === '1') return filterReviewedRoutes(d, prefs);
    return { routes: d.routes.map((r) => ({ id: r.id, name: r.name, status: r.status, version: r.version, sourceVersion: r.sourceVersion, history: r.history })) };
  }],

  ['GET', /^\/api\/routes\/([\w-]+)$/, (d, p) => {
    const r = d.routes.find((x) => x.id === p[0]);
    if (!r) return { error: 'not found' };
    const segs = r.segmentIds.map((id) => d.segments.find((s) => s.id === id));
    const profile = buildProfile(segs);
    const computed = difficultyTagFromProfile(profile, segs.reduce((s, x) => s + (x?.distanceKm || 0), 0));
    return { route: r, profile: profile.stats, samples: profile.samples,
      computedDifficulty: computed,
      tagProvenance: r.difficultyTag
        ? `路线标签“${r.difficultyTag}”为人工核定(curated)，依据：${r.difficultyBasis?.note || ''}`
        : '该路线无人工标签，以下标签由剖面机械计算(computed)',
      sources: resolveSourceIds(d, collectSources([...segs.filter(Boolean), r])) };
  }],

  ['POST', /^\/api\/plans\/snapshot$/, (d, p, q, body) => ({
    saved: snapshotPlan(d, body, fv())
  })],
  ['POST', /^\/api\/plans\/recheck$/, (d, p, q, body) => recheckPlan(d, body.snapshot || body, fv())],

  ['GET', /^\/api\/admin\/log$/, (d) => ({ mutationLog: d.mutationLog })]
];

function envelopeBindings(d, res) {
  const ids = new Set();
  (res.legs || []).forEach((l) => l.sources.forEach((s) => ids.add(s)));
  (res.blockingEdges || []).forEach((b) => {
    const seg = d.segments.find((s) => s.id === b.segmentId);
    seg?.sources.forEach((x) => ids.add(x));
  });
  return resolveSourceIds(d, [...ids]);
}

// 管理端（POST/PUT/DELETE）
const adminRoutes = [
  [/^\/api\/admin\/segments\/([\w-]+)\/review$/, (d, p, body) => store.reviewSegment(p[0], body.reviewed, body.note)],
  [/^\/api\/admin\/segments$/, (d, p, body) => store.upsertSegment(body)],
  [/^\/api\/admin\/transports\/([\w-]+)$/, (d, p, body) => store.updateTransport(p[0], body)],
  [/^\/api\/admin\/announcements$/, (d, p, body) => store.addAnnouncement(body)],
  [/^\/api\/admin\/stations\/([\w-]+)\/confirm$/, (d, p, body) => store.confirmStation(p[0], body.note)],
  [/^\/api\/admin\/routes\/([\w-]+)\/save$/, (d, p, body) => store.saveRoute(p[0], body)],
  [/^\/api\/admin\/routes\/([\w-]+)\/rollback$/, (d, p, body) => store.rollbackRoute(p[0], body.targetVersion, body.note)],
  [/^\/api\/admin\/reset$/, () => { store.reset(); store.withBoundVersions(); return { reset: true, sourceVersion: fv() }; }]
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(ROOT, 'public', urlPath));
  if (!filePath.startsWith(join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[filePath.slice(filePath.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (!path.startsWith('/api/')) return serveStatic(req, res);
  try {
    const data = store.load();
    store.withBoundVersions();
    if (req.method !== 'GET') {
      const body = await readBody(req);
      for (const [re, fn] of adminRoutes) {
        const m = path.match(re);
        if (m) {
          const out = fn(data, m.slice(1), body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(envelope(out)));
        }
      }
      // POST 业务接口
      const post = routes.find(([meth, re]) => meth === 'POST' && re.test(path));
      if (post) {
        const out = post[2](data, path.match(post[1]), q, body);
        res.writeHead(out?.error ? 400 : 200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(envelope(out)));
      }
    } else {
      for (const [meth, re, fn] of routes) {
        if (meth !== 'GET') continue;
        const m = path.match(re);
        if (m) {
          const out = fn(data, m.slice(1), q);
          res.writeHead(out?.error ? 404 : 200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(envelope(out)));
        }
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no route' }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  store.load(); store.withBoundVersions();
  server.listen(PORT, () => console.log(`茶马古道资料站 http://localhost:${PORT}`));
}
export { server };
