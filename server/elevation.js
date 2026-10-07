// 高程剖面：海拔缺失(null) 是“未测”，绝不当作 0；
// 累计爬升/下降只在相邻两个“均已知”海拔的采样点之间累加，跨缺失段单独留痕。
export function buildProfile(orderedSegments) {
  const samples = [];
  let distKm = 0;
  for (const seg of orderedSegments) {
    const pts = seg.path || [];
    pts.forEach(([lat, lon, alt], idx) => {
      samples.push({
        segmentId: seg.id,
        lat, lon,
        elevation: alt === undefined ? null : alt,
        distanceKm: round1(distKm),
        station: idx === 0 ? { id: seg.from } : undefined
      });
      if (idx > 0) distKm += haversineKm(pts[idx - 1][0], pts[idx - 1][1], lat, lon);
    });
  }
  // 爬升/下降：相邻样本都有海拔才计算
  let gain = 0, loss = 0;
  const missingStretches = [];
  let missStart = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].elevation, b = samples[i].elevation;
    if (a != null && b != null) {
      const d = b - a;
      if (d > 0) gain += d; else loss += -d;
    } else {
      if (missStart == null) missStart = samples[i - 1].distanceKm;
    }
    if ((b != null || i === samples.length - 1) && missStart != null) {
      missingStretches.push({ fromKm: round1(missStart), toKm: round1(samples[i].distanceKm) });
      missStart = null;
    }
  }
  const known = samples.filter((s) => s.elevation != null).map((s) => s.elevation);
  return {
    samples,
    stats: {
      totalDistanceKm: round1(samples.length ? samples[samples.length - 1].distanceKm : 0),
      cumulativeGainM: Math.round(gain),
      cumulativeLossM: Math.round(loss),
      maxKnownElevationM: known.length ? Math.max(...known) : null,
      minKnownElevationM: known.length ? Math.min(...known) : null,
      hasMissingElevation: samples.some((s) => s.elevation == null),
      missingStretches
    }
  };
}

export function difficultyTagFromProfile(profile, totalDistanceKm) {
  const { cumulativeGainM, maxKnownElevationM, hasMissingElevation } = profile.stats;
  // 机械阈值（仅按行程量）。任何输入缺失时，等级会下调置信度并强制标注“数据不全”。
  let tag = 'easy';
  if (cumulativeGainM >= 1000 || maxKnownElevationM >= 3000) tag = 'very-strenuous';
  else if (cumulativeGainM >= 600 || maxKnownElevationM >= 2300 || totalDistanceKm >= 100) tag = 'strenuous';
  else if (cumulativeGainM >= 300 || totalDistanceKm >= 40) tag = 'moderate';
  return {
    tag,
    basis: {
      cumulativeElevationGainM: cumulativeGainM,
      totalDistanceKm: round1(totalDistanceKm),
      highestKnownPointM: maxKnownElevationM,
      dataIncomplete: hasMissingElevation
    },
    provenance: 'computed',
    boundary: '体力标签只来自已核对采样点的累计爬升、里程与已知最高点；海拔缺失段不计入。天气、封路、积雪、落石、高原反应与个人体能均不在算法内，无法保证实地安全。'
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function round1(x) { return Math.round(x * 10) / 10; }
