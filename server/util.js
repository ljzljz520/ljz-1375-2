// 通用工具：确定性哈希（用于来源版本指纹）
export function hashString(str) {
  // FNV-1a 32bit，确定性、无外部依赖
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fmtAbs(abs) {
  const day = Math.floor(abs / 1440) + 1;
  const t = abs % 1440;
  const h = String(Math.floor(t / 60)).padStart(2, '0');
  const m = String(t % 60).padStart(2, '0');
  return { day, label: `D${day} ${h}:${m}`, clock: `${h}:${m}` };
}
