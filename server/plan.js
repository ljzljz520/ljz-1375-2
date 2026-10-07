// 已收藏计划：保存“原依据”（查询条件 + 结果 + 来源版本）。
// 重连后不静默改写：用当前数据重算并逐条指出变化（封路/迟到公告/季节冲突/版本回退）。
import { search } from './graph.js';
import { buildProfile } from './elevation.js';

export function snapshotPlan(data, query, sourceVersion) {
  const result = search(data, { ...query, sourceVersion });
  const segs = (result.legs || []).map((l) => data.segments.find((s) => s.id === l.segmentId));
  const profile = result.reachable ? buildProfile(segs).stats : null;
  return {
    query,
    savedAt: new Date().toISOString(),
    sourceVersion,
    reachable: result.reachable,
    legIds: result.reachable ? result.legs.map((l) => l.segmentId) : [],
    totalMinutes: result.reachable ? result.totalMinutes : null,
    totalDays: result.reachable ? result.totalDays : null,
    profile
  };
}

export function recheckPlan(data, snapshot, currentVersion) {
  const changes = [];
  const current = search(data, { ...snapshot.query });

  if (currentVersion !== snapshot.sourceVersion) {
    changes.push({ kind: 'source-version', from: snapshot.sourceVersion, to: currentVersion,
      text: `来源版本由 ${snapshot.sourceVersion} 变为 ${currentVersion}，依据已更新。` });
  }
  if (snapshot.reachable && !current.reachable) {
    changes.push({ kind: 'now-unreachable', text: '收藏时可通行，现在不可达。' });
    current.blockingEdges?.forEach((b) => {
      changes.push({
        kind: b.reason === 'closure' ? 'closure' : b.reason === 'season-conflict' ? 'season-conflict' : 'blocked',
        segmentId: b.segmentId, text: b.reasonText,
        latePublished: !!b.latePublished
      });
    });
  } else if (!snapshot.reachable && current.reachable) {
    changes.push({ kind: 'now-reachable', text: '收藏时不可达，现在已可通行。' });
  } else if (current.reachable) {
    const nowIds = current.legs.map((l) => l.segmentId);
    if (nowIds.join('|') !== snapshot.legIds.join('|')) {
      changes.push({ kind: 'path-changed', from: snapshot.legIds, to: nowIds, text: '最优路段组合已变化。' });
    }
    if (current.totalMinutes !== snapshot.totalMinutes) {
      changes.push({ kind: 'duration-changed', from: snapshot.totalMinutes, to: current.totalMinutes,
        text: `总移动时长由 ${snapshot.totalMinutes} 分钟变为 ${current.totalMinutes} 分钟（含换乘等待与多日累计）。` });
    }
  }
  // 迟到公告：即便日期仍在封路期，也单独提示
  for (const a of data.announcements) {
    if (a.latePublished) {
      const affects = snapshot.legIds.includes(a.segmentId) ||
        (!snapshot.reachable && current.blockingEdges?.some((b) => b.segmentId === a.segmentId));
      if (affects) {
        changes.push({ kind: 'late-announcement', announcementId: a.id, segmentId: a.segmentId,
          issuedAt: a.issuedAt, effectiveFrom: a.effectiveFrom,
          text: `公告 ${a.id} 迟到：生效 ${a.effectiveFrom}，但 ${a.issuedAt} 才发布。收藏计划保留原依据，供你对照。` });
      }
    }
  }
  // 路线版本回退提示（若计划使用的路线编号被回退）——由前端在路线详情中核对版本；此处保留依据不覆盖。
  return {
    preserved: snapshot,
    current: {
      reachable: current.reachable,
      totalMinutes: current.reachable ? current.totalMinutes : null,
      legIds: current.reachable ? current.legs.map((l) => l.segmentId) : [],
      gaps: current.reachable ? null : { blockingEdges: current.blockingEdges, historicalOnlyGaps: current.historicalOnlyGaps }
    },
    sourceVersion: currentVersion,
    hasChanges: changes.length > 0,
    changes
  };
}
