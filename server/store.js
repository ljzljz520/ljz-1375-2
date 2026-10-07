// 持久化存储：当代通行信息与历史叙事在同一库中分表存放（见 seed.js 的不同集合）。
// 所有维护动作写入只增审计日志；路线编辑产生新版本，支持回退。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as seed from './seed.js';
import { sourceFingerprint } from './sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'db.json');

function fresh() {
  return {
    stations: structuredClone(seed.stations),
    segments: structuredClone(seed.segments),
    transports: structuredClone(seed.transports),
    announcements: structuredClone(seed.announcements),
    historicalTrails: structuredClone(seed.historicalTrails),
    routes: structuredClone(seed.routes),
    sources: structuredClone(seed.sources),
    mutationLog: []
  };
}

let state = null;
export function load() {
  if (state) return state;
  if (existsSync(DB_PATH)) {
    try { state = JSON.parse(readFileSync(DB_PATH, 'utf8')); return state; } catch { /* 损坏则重建 */ }
  }
  state = fresh();
  return state;
}
export function reset() { state = fresh(); persist(); return state; }
function persist() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

export function versionOf() {
  return sourceFingerprint(state);
}

function log(type, detail, before) {
  state.mutationLog.push({
    seq: state.mutationLog.length + 1, at: new Date().toISOString(),
    type, detail,
    sourceVersionBefore: before, sourceVersionAfter: versionOf()
  });
}

function mutate(type, detail, fn) {
  const before = versionOf();
  fn();
  log(type, detail, before);
  persist();
  return { sourceVersion: versionOf(), type, detail };
}

// —— 管理端维护动作 ——
export function reviewSegment(id, reviewed, note = '') {
  return mutate('segment-review', { id, reviewed, note }, () => {
    const seg = state.segments.find((s) => s.id === id);
    if (!seg) throw new Error('segment not found: ' + id);
    seg.reviewed = !!reviewed;
    seg.status = reviewed ? 'verified' : 'unverified';
  });
}
export function upsertSegment(patch) {
  return mutate('segment-upsert', { id: patch.id }, () => {
    const i = state.segments.findIndex((s) => s.id === patch.id);
    if (i >= 0) state.segments[i] = { ...state.segments[i], ...patch };
    else state.segments.push({ status: 'unverified', reviewed: false, window: { seasonal: null }, path: [], ...patch });
  });
}
export function updateTransport(id, patch) {
  return mutate('transport-update', { id, patch }, () => {
    const t = state.transports.find((x) => x.id === id);
    if (!t) state.transports.push({ id, minTransferMinutes: 10, departures: [], ...patch });
    else Object.assign(t, patch);
  });
}
export function addAnnouncement(a) {
  return mutate('announcement-add', { id: a.id }, () => {
    state.announcements.push({ id: 'AN-' + String(state.announcements.length + 1).padStart(3, '0'), ...a });
  });
}
export function confirmStation(id, note) {
  return mutate('station-confirm', { id, note }, () => {
    const s = state.stations.find((x) => x.id === id);
    if (!s) throw new Error('station not found');
    s.nameStatus = 'confirmed';
    if (note) s.pendingNote = note;
  });
}
// 路线版本：编辑即新版本；回退只是再追加一个“恢复到旧内容”的新版本，历史链不丢
export function saveRoute(id, patch) {
  return mutate('route-save', { id }, () => {
    const r = state.routes.find((x) => x.id === id);
    if (!r) throw new Error('route not found');
    const nextVersion = (r.version || 1) + 1;
    r.history.push({ version: nextVersion, at: new Date().toISOString().slice(0, 10), note: patch.note || '编辑', segmentIds: patch.segmentIds || r.segmentIds });
    if (patch.segmentIds) r.segmentIds = patch.segmentIds;
    if (patch.name) r.name = patch.name;
    if (patch.status) r.status = patch.status;
    r.version = nextVersion;
  });
}
export function rollbackRoute(id, targetVersion, note = '') {
  return mutate('route-rollback', { id, targetVersion }, () => {
    const r = state.routes.find((x) => x.id === id);
    const snap = r.history.find((h) => h.version === targetVersion);
    if (!snap) throw new Error('version not found');
    const nv = (r.version || 1) + 1;
    r.history.push({ version: nv, at: new Date().toISOString().slice(0, 10),
      note: note || `回退到 v${targetVersion}（以新版本形式保留，可再撤销）`, segmentIds: [...snap.segmentIds] });
    r.segmentIds = [...snap.segmentIds];
    r.version = nv;
  });
}

// 填充每条路线当前来源版本
export function withBoundVersions() {
  const fv = versionOf();
  state.routes.forEach((r) => { r.sourceVersion = fv; });
  return fv;
}

export { fresh };
