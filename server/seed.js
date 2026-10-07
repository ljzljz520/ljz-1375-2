// 茶马古道资料站 —— 种子数据
// 设计原则：
// 1) 当代可通行信息(segments/transports/announcements/routes) 与 历史叙事(historicalTrails) 分别建模存储。
// 2) 每条事实绑定 sources 中的来源条目；sourceVersion 是来源集合的指纹（见 sources.js）。
// 3) 海拔缺失用 elevation:null 显式表示，计算时禁止当零处理。
// 4) 同名驿站通过 nameStatus:'pending' + sameNameGroup + pendingNote 标记“待确认”。

export const stations = [
  {
    id: 'ST-01', name: '普洱', aliases: ['思茅'],
    lat: 22.82, lon: 100.97, elevation: 1300,
    kind: 'town',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  },
  {
    id: 'ST-02', name: '那柯里', aliases: ['马锅田'],
    lat: 22.95, lon: 101.05, elevation: 1420,
    kind: 'post',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  },
  {
    id: 'ST-03', name: '磨黑', aliases: ['磨黑盐井'],
    lat: 23.03, lon: 101.16, elevation: null, // 海拔待核：缺失，不当零
    kind: 'post',
    nameStatus: 'confirmed', sameNameGroup: null,
    pendingNote: '高程资料缺失，剖面与累计爬升在此处留空待核，不得以 0 米代替。',
    sources: ['SRC-FIELDWORK-2023']
  },
  {
    id: 'ST-04', name: '通关', aliases: [],
    lat: 23.18, lon: 101.35, elevation: 1620,
    kind: 'post',
    nameStatus: 'pending', sameNameGroup: 'DUP-TONGGUAN',
    pendingNote: '存在两处“通关”驿站记载（墨江通关哨 / 他郎通关铺），本站对应哪一处尚未核定，列表与打印件均显示“待确认”。',
    sources: ['SRC-HISTORY-1947', 'SRC-FIELDWORK-2023']
  },
  {
    id: 'ST-05', name: '墨江', aliases: ['他郎'],
    lat: 23.43, lon: 101.69, elevation: 1680,
    kind: 'town',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  },
  {
    id: 'ST-06', name: '通关', aliases: ['通关铺'],
    lat: 23.47, lon: 101.74, elevation: 1715,
    kind: 'ruin',
    nameStatus: 'pending', sameNameGroup: 'DUP-TONGGUAN',
    pendingNote: '与 ST-04 同名，二者是否同一驿站待确认；路线引用以站点编号为准，不以名称归并。',
    sources: ['SRC-HISTORY-1947']
  },
  {
    id: 'ST-07', name: '安定', aliases: [],
    lat: 23.61, lon: 101.86, elevation: 1950,
    kind: 'post',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  },
  {
    id: 'ST-08', name: '南涧', aliases: ['定边'],
    lat: 25.04, lon: 100.51, elevation: 1650,
    kind: 'town',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  },
  {
    id: 'ST-09', name: '无量山垭口', aliases: ['无量山口'],
    lat: 24.83, lon: 100.43, elevation: 2380,
    kind: 'pass',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024', 'SRC-WEATHER-2026']
  },
  {
    id: 'ST-10', name: '景东', aliases: ['银生'],
    lat: 24.45, lon: 100.84, elevation: 2050,
    kind: 'town',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  },
  {
    id: 'ST-11', name: '沙溪', aliases: ['寺登街'],
    lat: 26.32, lon: 99.85, elevation: 2100,
    kind: 'post',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-FIELDWORK-2023']
  },
  {
    id: 'ST-12', name: '丽江', aliases: ['大研'],
    lat: 26.87, lon: 100.23, elevation: 2400,
    kind: 'town',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  },
  {
    id: 'ST-13', name: '雪山垭口', aliases: ['白马丫口'],
    lat: 27.02, lon: 100.31, elevation: 3250,
    kind: 'pass',
    nameStatus: 'confirmed', sameNameGroup: null,
    pendingNote: '高海拔垭口，季节性通行；体力标签仅反映累计量与海拔，不代表实时路况或高原反应风险。',
    sources: ['SRC-MODERN-SURVEY-2024', 'SRC-WEATHER-2026']
  },
  {
    id: 'ST-14', name: '香格里拉', aliases: ['中甸'],
    lat: 27.83, lon: 99.70, elevation: 3300,
    kind: 'town',
    nameStatus: 'confirmed', sameNameGroup: null, pendingNote: null,
    sources: ['SRC-MODERN-SURVEY-2024']
  }
];

// path: 当代相邻路段的走向采样点 [lat, lon, elevation|null]
export const segments = [
  {
    id: 'SG-001', from: 'ST-01', to: 'ST-02',
    mode: 'foot', status: 'verified', reviewed: true,
    distanceKm: 18, baseMinutes: 300,
    direction: 'northbound',
    window: { seasonal: null, note: '全年可徒步，雨季注意溜滑' },
    path: [
      [22.82, 100.97, 1300], [22.86, 100.99, 1340], [22.90, 101.01, 1390],
      [22.93, 101.03, 1415], [22.95, 101.05, 1420]
    ],
    sources: ['SRC-FIELDWORK-2023']
  },
  {
    id: 'SG-002', from: 'ST-02', to: 'ST-03',
    mode: 'foot', status: 'verified', reviewed: true,
    distanceKm: 16, baseMinutes: 270,
    direction: 'northbound',
    window: { seasonal: null, note: null },
    path: [
      [22.95, 101.05, 1420], [22.98, 101.09, 1460],
      [23.00, 101.12, null] /* 中段海拔缺测 */, [23.03, 101.16, null]
    ],
    sources: ['SRC-FIELDWORK-2023']
  },
  {
    id: 'SG-003', from: 'ST-03', to: 'ST-04',
    mode: 'mixed', status: 'verified', reviewed: true,
    distanceKm: 27, baseMinutes: 360,
    direction: 'northbound',
    window: { seasonal: null, note: '碎石路+步道混合' },
    path: [[23.03, 101.16, null], [23.10, 101.25, 1550], [23.18, 101.35, 1620]],
    sources: ['SRC-FIELDWORK-2023']
  },
  {
    id: 'SG-004', from: 'ST-05', to: 'ST-06',
    mode: 'foot', status: 'verified', reviewed: true,
    distanceKm: 7, baseMinutes: 100,
    direction: 'northbound',
    window: { seasonal: null, note: null },
    path: [[23.43, 101.69, 1680], [23.45, 101.71, 1695], [23.47, 101.74, 1715]],
    sources: ['SRC-FIELDWORK-2023']
  },
  {
    id: 'SG-005', from: 'ST-06', to: 'ST-07',
    mode: 'bus', status: 'verified', reviewed: true,
    distanceKm: 21, baseMinutes: 45,
    direction: 'bidirectional',
    scheduleRef: 'TR-01',
    window: { seasonal: null, note: '县乡班车，按班次发车' },
    path: [[23.47, 101.74, 1715], [23.54, 101.80, 1820], [23.61, 101.86, 1950]],
    sources: ['SRC-TRANSIT-2026']
  },
  // 缺口：ST-04(墨江通关哨候选) 与 ST-05 之间没有任何已核对路段。
  // 历史商路在此附近有记载，但历史叙事≠现行通行，因此图上形成不可跨越的缺口，不得直线连接。
  {
    id: 'SG-006', from: 'ST-07', to: 'ST-08',
    mode: 'bus', status: 'verified', reviewed: true,
    distanceKm: 210, baseMinutes: 240,
    direction: 'bidirectional',
    scheduleRef: 'TR-02',
    window: { seasonal: null, note: '城际客运，需在安定换乘并留够换乘时间' },
    path: [[23.61, 101.86, 1950], [24.20, 101.30, 1780], [24.60, 100.90, 1700], [25.04, 100.51, 1650]],
    sources: ['SRC-TRANSIT-2026']
  },
  {
    id: 'SG-007', from: 'ST-08', to: 'ST-09',
    mode: 'foot', status: 'verified', reviewed: true,
    distanceKm: 24, baseMinutes: 420,
    direction: 'bidirectional',
    window: { seasonal: { months: [3, 4, 5, 6, 7, 8, 9, 10, 11] }, note: '冬春垭口可能积雪封山' },
    path: [[25.04, 100.51, 1650], [24.97, 100.49, 1850], [24.90, 100.46, 2100], [24.83, 100.43, 2380]],
    sources: ['SRC-FIELDWORK-2023', 'SRC-WEATHER-2026']
  },
  {
    id: 'SG-008', from: 'ST-09', to: 'ST-10',
    mode: 'mixed', status: 'verified', reviewed: true,
    distanceKm: 52, baseMinutes: 480,
    direction: 'bidirectional',
    window: { seasonal: { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, note: null },
    path: [[24.83, 100.43, 2380], [24.70, 100.55, 2250], [24.58, 100.70, 2150], [24.45, 100.84, 2050]],
    sources: ['SRC-FIELDWORK-2023']
  },
  {
    id: 'SG-009', from: 'ST-10', to: 'ST-11',
    mode: 'foot', status: 'verified', reviewed: true,
    distanceKm: 130, baseMinutes: 2640, // 多日步道
    direction: 'bidirectional',
    window: { seasonal: { months: [3, 4, 5, 9, 10, 11] }, note: '垭口段 6–8 月雨季塌方多发、12–2 月封山' },
    path: [[24.45, 100.84, 2050], [24.90, 100.60, 2400], [25.40, 100.30, 2580], [25.90, 100.05, 2350], [26.32, 99.85, 2100]],
    sources: ['SRC-FIELDWORK-2023', 'SRC-WEATHER-2026']
  },
  {
    id: 'SG-010', from: 'ST-11', to: 'ST-12',
    mode: 'bus', status: 'verified', reviewed: true,
    distanceKm: 120, baseMinutes: 150,
    direction: 'bidirectional',
    scheduleRef: 'TR-03',
    window: { seasonal: null, note: null },
    path: [[26.32, 99.85, 2100], [26.50, 100.00, 2220], [26.70, 100.15, 2310], [26.87, 100.23, 2400]],
    sources: ['SRC-TRANSIT-2026']
  },
  {
    id: 'SG-011', from: 'ST-12', to: 'ST-13',
    mode: 'mixed', status: 'verified', reviewed: true,
    distanceKm: 35, baseMinutes: 480,
    direction: 'bidirectional',
    window: { seasonal: { months: [4, 5, 6, 7, 8, 9, 10] }, note: '雪山垭口 11–3 月封闭（见公告 AN-002，发布晚于通行季开始）' },
    path: [[26.87, 100.23, 2400], [26.93, 100.26, 2700], [26.98, 100.29, 3050], [27.02, 100.31, 3250]],
    sources: ['SRC-MODERN-SURVEY-2024', 'SRC-WEATHER-2026']
  },
  {
    id: 'SG-012', from: 'ST-13', to: 'ST-14',
    mode: 'foot', status: 'verified', reviewed: true,
    distanceKm: 40, baseMinutes: 600,
    direction: 'bidirectional',
    window: { seasonal: { months: [4, 5, 6, 7, 8, 9, 10] }, note: '高海拔，需防范高原反应' },
    path: [[27.02, 100.31, 3250], [27.25, 100.15, 3450], [27.55, 99.90, 3380], [27.83, 99.70, 3300]],
    sources: ['SRC-MODERN-SURVEY-2024', 'SRC-WEATHER-2026']
  },
  // 一条“未核对”的当代路段：管理端可核对后才进入图
  {
    id: 'SG-013', from: 'ST-04', to: 'ST-06',
    mode: 'foot', status: 'unverified', reviewed: false,
    distanceKm: 55, baseMinutes: 900,
    direction: 'bidirectional',
    window: { seasonal: null, note: '踏勘口述路径，未经核对：即便空间上接近，也不纳入通行图' },
    path: [[23.18, 101.35, 1620], [23.30, 101.50, 1660], [23.47, 101.74, 1715]],
    sources: ['SRC-LOCAL-REPORT-2025']
  }
];

// 交通班期（仅对 mode='bus' 路段生效）
export const transports = [
  {
    id: 'TR-01', segmentId: 'SG-005', name: '墨江—安定县乡班车',
    departures: ['08:00', '13:30'], minTransferMinutes: 10,
    sources: ['SRC-TRANSIT-2026']
  },
  {
    id: 'TR-02', segmentId: 'SG-006', name: '安定—南涧城际客运',
    departures: ['07:30', '14:00'], minTransferMinutes: 20,
    sources: ['SRC-TRANSIT-2026']
  },
  {
    id: 'TR-03', segmentId: 'SG-010', name: '沙溪—丽江班车',
    departures: ['09:10', '16:00'], minTransferMinutes: 10,
    sources: ['SRC-TRANSIT-2026']
  }
];

// 公告：含“迟到发布”的封路公告（封路开始日早于发布日）与“季节条件冲突”公告
export const announcements = [
  {
    id: 'AN-001', segmentId: 'SG-007', title: '无量山垭口小雪提示',
    issuedAt: '2026-11-02', effectiveFrom: '2026-11-15', effectiveTo: '2026-11-20',
    kind: 'advisory',
    body: '垭口可能短时积雪，步道未封闭，建议结队并携带防滑装备。',
    sources: ['SRC-WEATHER-2026']
  },
  {
    id: 'AN-002', segmentId: 'SG-011', title: '雪山垭口冬季封闭',
    issuedAt: '2026-11-10', effectiveFrom: '2026-11-01', effectiveTo: '2027-03-31',
    kind: 'closure',
    latePublished: true,
    body: '垭口自 11 月 1 日起封闭，但本公告 11 月 10 日才发布（迟到 9 天）。11 月 1–9 日已据此出行的收藏计划会在重连后提示依据变化。',
    sources: ['SRC-WEATHER-2026']
  },
  {
    id: 'AN-003', segmentId: 'SG-009', title: '景东—沙溪步道秋季踏勘开放（与季节窗口冲突）',
    issuedAt: '2026-09-01', effectiveFrom: '2026-12-05', effectiveTo: '2026-12-20',
    kind: 'advisory',
    conflictsWithSeason: true,
    body: '公告称 12 月上旬可组织踏勘通行，但路段已核对的季节窗口为 3–5、9–11 月。二者冲突时保守处理：季节窗口优先，判定为不可通行，并在页面标注冲突待核。',
    sources: ['SRC-LOCAL-REPORT-2025', 'SRC-WEATHER-2026']
  }
];

// 历史叙事：与当代通行完全分开存储；不进入通行图，也不可直接当作徒步路线
export const historicalTrails = [
  {
    id: 'HT-01', name: '普洱茶马古道北线（叙事）',
    era: '清代—民国',
    body: '由普洱经那柯里、磨黑、墨江一带北上，翻越无量山、经景东通往滇西北。史料记载的线路与今之公路、步道并不重合，部分垭口已无路径。',
    stationRefs: ['ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05', 'ST-06', 'ST-07'],
    path: [[22.82, 100.97, 1300], [23.03, 101.16, null], [23.43, 101.69, 1680], [23.61, 101.86, 1950]],
    disclaimer: '历史商路仅作文物与叙事展示，依据为史籍与田野调查，不等于现行可徒步路线；缺失高程不补零。',
    sources: ['SRC-HISTORY-1947', 'SRC-FIELDWORK-2023']
  },
  {
    id: 'HT-02', name: '滇藏茶马道（叙事）',
    era: '明清',
    body: '自丽江经雪山垭口通往中甸并深入藏区的马帮路线。现代垭口公路/步道的季节与古代商队通行季节不同，不能混用。',
    stationRefs: ['ST-12', 'ST-13', 'ST-14'],
    path: [[26.87, 100.23, 2400], [27.02, 100.31, 3250], [27.83, 99.70, 3300]],
    disclaimer: '叙事性线路，非现行徒步导航数据。',
    sources: ['SRC-HISTORY-1947']
  }
];

// 已审路线（可被“按偏好筛选”）。快照保存创建时的来源版本，支持回退。
export const routes = [
  {
    id: 'RT-01',
    name: '普洱—大理方向轻线（3 日）',
    status: 'reviewed', version: 2,
    modes: ['foot', 'bus'], maxDailyMinutes: 480,
    seasons: [3, 4, 5, 9, 10, 11],
    difficultyTag: 'moderate',
    difficultyBasis: {
      cumulativeElevationGainM: 760,
      totalDistanceKm: 303,
      highestPointM: 2380,
      note: '标签由已核对路段的累计爬升、总里程与最高点机械计算（见 SRC-FIELDWORK-2023）；不包含天气、积雪、个人体能等实地因素。'
    },
    segmentIds: ['SG-001', 'SG-002', 'SG-003', 'SG-004', 'SG-005', 'SG-006', 'SG-007'],
    sourceVersion: null, // 由 sources 指纹在运行期填充
    history: [
      { version: 1, at: '2026-01-10', note: '初版：终点为南涧，不翻无量山垭口', segmentIds: ['SG-001', 'SG-002', 'SG-003', 'SG-004', 'SG-005', 'SG-006'] },
      { version: 2, at: '2026-04-02', note: '核对后加入无量山垭口段 SG-007', segmentIds: ['SG-001', 'SG-002', 'SG-003', 'SG-004', 'SG-005', 'SG-006', 'SG-007'] }
    ]
  },
  {
    id: 'RT-02',
    name: '景东—沙溪古商道体验线（5 日）',
    status: 'reviewed', version: 1,
    modes: ['foot'], maxDailyMinutes: 540,
    seasons: [3, 4, 5, 9, 10, 11],
    difficultyTag: 'strenuous',
    difficultyBasis: {
      cumulativeElevationGainM: 980,
      totalDistanceKm: 130,
      highestPointM: 2580,
      note: '累计爬升大、多日无补给点。标签仅为行程量指标，算法无法保证步道实时安全。'
    },
    segmentIds: ['SG-009'],
    sourceVersion: null,
    history: [{ version: 1, at: '2026-02-15', note: '初版', segmentIds: ['SG-009'] }]
  },
  {
    id: 'RT-03',
    name: '丽江—香格里拉高海拔线（3 日）',
    status: 'reviewed', version: 1,
    modes: ['foot', 'mixed'], maxDailyMinutes: 420,
    seasons: [4, 5, 6, 7, 8, 9, 10],
    difficultyTag: 'very-strenuous',
    difficultyBasis: {
      cumulativeElevationGainM: 1230,
      totalDistanceKm: 75,
      highestPointM: 3450,
      note: '最高点 3450 米，含高原反应与天气风险；体力标签不代表安全保证，需自行评估并查询当日公告。'
    },
    segmentIds: ['SG-011', 'SG-012'],
    sourceVersion: null,
    history: [{ version: 1, at: '2026-03-01', note: '初版', segmentIds: ['SG-011', 'SG-012'] }]
  },
  {
    // 未审：偏好筛选不得返回
    id: 'RT-04',
    name: '墨江“通关”捷径（踏勘草稿）',
    status: 'draft', version: 1,
    modes: ['foot'], maxDailyMinutes: 300,
    seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    difficultyTag: null,
    difficultyBasis: null,
    segmentIds: ['SG-013'],
    sourceVersion: null,
    history: [{ version: 1, at: '2026-05-01', note: '草稿，含未核对路段', segmentIds: ['SG-013'] }]
  }
];

export const sources = [
  { id: 'SRC-MODERN-SURVEY-2024', label: '当代测绘高程表（2024 核校版）', kind: 'modern-survey', at: '2024-11-01' },
  { id: 'SRC-FIELDWORK-2023', label: '田野踏勘路段记录（2023）', kind: 'fieldwork', at: '2023-09-20' },
  { id: 'SRC-HISTORY-1947', label: '民国县志·驿站考（1947 影印本）', kind: 'historical', at: '1947-01-01' },
  { id: 'SRC-WEATHER-2026', label: '交通气象与封路公告（2026 季度）', kind: 'advisory', at: '2026-09-01' },
  { id: 'SRC-TRANSIT-2026', label: '县乡/城际班期公示（2026 夏秋）', kind: 'transit', at: '2026-06-01' },
  { id: 'SRC-LOCAL-REPORT-2025', label: '地方口述与踏勘报告（2025，未全核对）', kind: 'unverified', at: '2025-08-10' }
];
