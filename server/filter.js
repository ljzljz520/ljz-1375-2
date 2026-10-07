// “按用户偏好筛选已审路线”——这不是图搜索：
// 它只在管理员已审(reviewed) 的成套路线上做属性匹配，返回整条路线及其保存的来源版本；
// 不按起终点在图上拼路径，也不使用任何未核对路段。
import { buildProfile, difficultyTagFromProfile } from './elevation.js';
import { collectSources, resolveSourceIds } from './sources.js';

const TAG_ORDER = ['easy', 'moderate', 'strenuous', 'very-strenuous'];

export function filterReviewedRoutes(data, prefs = {}) {
  const modes = new Set(prefs.modes || ['foot', 'bus', 'mixed']);
  const maxTag = prefs.maxDifficulty || 'very-strenuous';
  const results = [];

  for (const route of data.routes) {
    if (route.status !== 'reviewed') continue;
    const segs = route.segmentIds.map((id) => data.segments.find((s) => s.id === id));
    if (segs.some((s) => !s)) continue;
    // 只用全部已核对的路段
    if (segs.some((s) => !s.reviewed || s.status !== 'verified')) continue;

    const reasons = [];
    if (!segs.every((s) => modes.has(s.mode))) reasons.push('mode');
    if (prefs.month && !route.seasons.includes(prefs.month)) reasons.push('season');
    if (prefs.maxDailyMinutes && route.maxDailyMinutes > prefs.maxDailyMinutes) reasons.push('daily-cap');
    if (route.difficultyTag && TAG_ORDER.indexOf(route.difficultyTag) > TAG_ORDER.indexOf(maxTag)) reasons.push('difficulty');

    if (reasons.length) continue;

    const profile = buildProfile(segs);
    // 体力标签来源：路线自带的为管理员标注(curated，附依据)；缺失时由剖面机械重算(computed)
    const tag = route.difficultyTag
      ? { tag: route.difficultyTag, provenance: 'curated', basis: route.difficultyBasis,
          boundary: '标签为人工核定的行程量标注；不代表天气/路况/个人安全保证。' }
      : difficultyTagFromProfile(profile, segs.reduce((s, x) => s + x.distanceKm, 0));

    results.push({
      routeId: route.id, name: route.name, version: route.version,
      segmentIds: route.segmentIds,
      profile: profile.stats,
      difficulty: tag,
      matchNote: '整条已审路线的属性匹配，非图算法结果',
      sources: resolveSourceIds(data, collectSources([...segs, route])).map((s) => s.id),
      sourceVersion: route.sourceVersion
    });
  }
  return {
    method: 'preference-filter',
    prefs,
    results,
    comparison: '偏好筛选=在成套已审路线上做属性匹配；受约束图搜索=按起终点/日期在相邻路段图上做时间依赖搜索并处理封路、班期与多日约束。二者共用同一来源版本，但一个不构成路径承诺，另一个也不保证实地安全。',
    safetyBoundary: '体力标签来自累计爬升、里程、最高点等行程量（含其来源编号）。算法无法获取实时天气、落石、积雪、高原反应与个人体能，不保证实地安全，出行前须核对当日公告并自行评估。'
  };
}
