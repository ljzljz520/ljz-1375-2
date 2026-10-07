const I18N = {
  zh: {
    title:"茶马古道资料站", stations:"驿站", planner:"路线规划", compare:"方案比较",
    favorites:"收藏计划", historic:"历史商路", announcements:"公告", profile:"高程剖面",
    admin:"管理后台", catalog:"编号目录 / 打印", search:"搜索", plan:"开始规划",
    save_fav:"收藏此计划", offline:"离线", online:"在线", pending:"待确认",
    pending_verify:"待核", closed:"封闭", missing_elev:"海拔缺失",
    estimated_elev:"估计海拔", effort:"体力", effort_src:"标签来源",
    depart:"出发时间", from:"起点", to:"终点", days:"天数", minutes:"总分钟",
    unreachable:"不可达", blocked_seg:"中断路段", reason:"原因", gap_no_line:"缺口不以直线连接",
    curated:"已审路线（按偏好筛选）", graph:"受约束图搜索", conflicts:"冲突",
    disclaimer:"体力标签来自标注来源，仅供参考；算法结果不能保证实地安全，出行前请向当地管理方核实。",
    historic_note:"历史叙事内容，不能直接视为现行徒步路线。",
    changes_since:"重连后发现的变化", late_ann:"迟到公告", seg_updated:"路段已更新",
    route_changed:"路线版本已变更", same_name:"同名驿站，需确认", load_bundle:"下载离线包",
    data_version:"数据版本", transfer_wait:"换乘等待", window:"窗口",
    seasonal:"季节性开放", mode_walk:"徒步", mode_bus:"班车", mode_mule:"马帮",
    print:"打印", elevation:"海拔", verify:"核验状态", no_straight:"地图不以直线跨越缺口",
  },
  en: {
    title:"Tea Horse Road Archive", stations:"Stations", planner:"Route planner",
    compare:"Compare", favorites:"Saved plans", historic:"Historic routes",
    announcements:"Announcements", profile:"Elevation profile",
    admin:"Admin", catalog:"Catalog / Print", search:"Search", plan:"Plan",
    save_fav:"Save plan", offline:"Offline", online:"Online", pending:"Pending confirmation",
    pending_verify:"Pending", closed:"Closed", missing_elev:"Elevation missing",
    estimated_elev:"Estimated elevation", effort:"Effort", effort_src:"Label source",
    depart:"Depart", from:"From", to:"To", days:"Days", minutes:"Total minutes",
    unreachable:"Unreachable", blocked_seg:"Blocked segment", reason:"Reason",
    gap_no_line:"Gap is not bridged by a straight line",
    curated:"Curated routes (filtered by prefs)", graph:"Constrained graph search",
    conflicts:"Conflicts",
    disclaimer:"Effort labels come from cited sources and are indicative only; algorithmic results cannot guarantee on-site safety. Verify with local authorities.",
    historic_note:"Historical narrative; not a current hiking route.",
    changes_since:"Changes since reconnect", late_ann:"Late announcement",
    seg_updated:"Segment updated", route_changed:"Route version changed",
    same_name:"Same-name stations, confirm needed", load_bundle:"Download offline bundle",
    data_version:"Data version", transfer_wait:"Transfer wait", window:"Window",
    seasonal:"Seasonal", mode_walk:"Walk", mode_bus:"Bus", mode_mule:"Mule",
    print:"Print", elevation:"Elevation", verify:"Verify status", no_straight:"Map never bridges gaps with straight lines",
  }
};
let LANG = localStorage.getItem("lang") || "zh";
function t(k){ return (I18N[LANG] && I18N[LANG][k]) || I18N.zh[k] || k; }
function setLang(l){ LANG=l; localStorage.setItem("lang",l); applyI18n(); }
function applyI18n(){
  document.querySelectorAll("[data-i18n]").forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
}
function pick(obj, zhKey, enKey){ return LANG === "zh" ? obj[zhKey] : (obj[enKey] || obj[zhKey]); }
