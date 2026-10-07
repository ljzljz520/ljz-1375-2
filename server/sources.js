// 来源登记与版本指纹：
// 页面上每条事实标注的来源（entity.sources）与服务器计算结果（plan/search/filter 响应）
// 必须绑定“同一组来源版本”。指纹随来源登记或任一事实变化而变化。
import { hashString, stableStringify } from './util.js';

export function sourceFingerprint(data) {
  const payload = {
    sources: data.sources,
    stations: data.stations,
    segments: data.segments,
    transports: data.transports,
    announcements: data.announcements,
    historicalTrails: data.historicalTrails,
    routes: data.routes.map((r) => ({ id: r.id, version: r.version, segmentIds: r.segmentIds, status: r.status }))
  };
  return 'fv-' + hashString(stableStringify(payload));
}

export function resolveSourceIds(data, ids) {
  return ids.map((id) => data.sources.find((s) => s.id === id) || { id, label: id + '（来源缺失）', kind: 'missing' });
}

// 收集一组对象所引用的全部来源
export function collectSources(objs) {
  const set = new Set();
  for (const o of objs) (o.sources || []).forEach((id) => set.add(id));
  return [...set];
}
