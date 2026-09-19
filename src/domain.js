// ---------- 借调交接台 · 业务规则层（纯函数，可独立核对） ----------

export const PACKAGES = ['标准木箱', '防震恒温箱', '软包卷装', '定制航空箱'];
export const CARRIERS = ['安捷艺术品物流', '华航国际货运', '馆藏自有车队', '顺丰保价专线'];
export const VENUES = ['上海当代艺术博物馆', '北京 UCCA 尤伦斯当代艺术中心', '广州设计三年展展馆', '成都 A4 美术馆', '香港 M+ 博物馆'];

const pad = n => String(n).padStart(2, '0');
export const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => fmt(new Date());
export const nowStr = () => { const d = new Date(); return `${fmt(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const shift = (base, days) => { const d = new Date(base + 'T00:00:00'); d.setDate(d.getDate() + days); return fmt(d); };
export const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

// 仍占用借出时段的记录状态（已归还 / 已作废不再占用）
export const BLOCKING = ['在借', '冻结'];
export const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;

// 同一展品时段冲突检测：excludeId 用于改期时排除自身
export const conflictsFor = (loans, exhibitId, period, excludeId = null) =>
  loans.filter(l => l.exhibitId === exhibitId && l.id !== excludeId && BLOCKING.includes(l.status) && overlaps(l, period));

// 展品当前状态由借出记录推导，不单独存储，避免不一致
export const exhibitStatus = (loans, exhibitId) => {
  const ls = loans.filter(l => l.exhibitId === exhibitId);
  if (ls.some(l => l.status === '冻结')) return '冻结';
  if (ls.some(l => l.status === '暂缓入库')) return '暂缓入库';
  if (ls.some(l => l.status === '在借')) return '在借';
  return '在库';
};

// 归还验收规则：有损毁但缺照片，或归还包装与出库不一致 → 必须暂缓入库
export const inspectReturn = (loan, { damage, photos, packIn }) => {
  const problems = [];
  if (damage && photos.length === 0) problems.push('缺少损毁照片');
  if (packIn !== loan.packOut) problems.push(`包装不一致（出库：${loan.packOut} / 归还：${packIn || '未登记'}）`);
  return problems;
};

let seq = 0;
export const uid = p => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// ---------- 演示数据：日期相对今天生成，保证逾期 / 在借 / 暂缓等状态开箱可见 ----------
export function seed() {
  const t = todayStr();
  const at = (d, h) => `${d} ${h}`;
  const exhibits = [
    { id: 'EX-001', title: '潮汐之后', code: 'MUS-24-001', type: '装置', room: 'A01 · 主展厅', color: '#e6b45d', desc: '一件记录海岸线变化的沉浸式影像装置。' },
    { id: 'EX-002', title: '未寄出的信', code: 'MUS-24-002', type: '档案', room: 'B02 · 纸上时间', color: '#ef8f84', desc: '来自三代人的手写信件与声音档案。' },
    { id: 'EX-003', title: '柔软的边界', code: 'MUS-24-003', type: '互动', room: 'C01 · 新媒介', color: '#83b9b1', desc: '观众的移动会改变墙面上的光影。' },
    { id: 'EX-004', title: '静默的重量', code: 'MUS-24-004', type: '雕塑', room: 'A02 · 主展厅', color: '#9ba7dc', desc: '铸铜与浮石并置的系列雕塑。' },
  ];
  const loans = [
    { id: 'LN-2601', exhibitId: 'EX-001', venue: VENUES[0], carrier: CARRIERS[0], start: shift(t, -18), end: shift(t, 14), packOut: '防震恒温箱', packIn: '', damage: false, photos: [], out: true, status: '在借', createdAt: at(shift(t, -20), '10:02') },
    { id: 'LN-2602', exhibitId: 'EX-002', venue: VENUES[3], carrier: CARRIERS[1], start: shift(t, -46), end: shift(t, -6), packOut: '标准木箱', packIn: '', damage: false, photos: [], out: true, status: '在借', createdAt: at(shift(t, -48), '11:15') },
    { id: 'LN-2603', exhibitId: 'EX-003', venue: VENUES[4], carrier: CARRIERS[2], start: shift(t, -72), end: shift(t, -34), packOut: '定制航空箱', packIn: '定制航空箱', damage: false, photos: [], out: true, status: '已归还', returnedAt: at(shift(t, -35), '16:20'), createdAt: at(shift(t, -75), '14:20') },
    { id: 'LN-2604', exhibitId: 'EX-004', venue: VENUES[2], carrier: CARRIERS[3], start: shift(t, -26), end: shift(t, -4), packOut: '软包卷装', packIn: '标准木箱', damage: true, photos: [], out: true, status: '暂缓入库', holdProblems: ['缺少损毁照片', '包装不一致（出库：软包卷装 / 归还：标准木箱）'], createdAt: at(shift(t, -28), '10:40') },
  ];
  const ev = (at, exhibitId, loanId, type, text) => ({ id: uid('EV'), at, exhibitId, loanId, type, text });
  const events = [
    ev(at(shift(t, -20), '10:02'), 'EX-001', 'LN-2601', 'create', `创建借出单 · 借往 ${VENUES[0]}，时段 ${loans[0].start}~${loans[0].end}，包装 防震恒温箱`),
    ev(at(shift(t, -18), '08:40'), 'EX-001', 'LN-2601', 'out', `出库交接 · ${CARRIERS[0]} 签收，包装 防震恒温箱`),
    ev(at(shift(t, -48), '11:15'), 'EX-002', 'LN-2602', 'create', `创建借出单 · 借往 ${VENUES[3]}，时段 ${loans[1].start}~${loans[1].end}，包装 标准木箱`),
    ev(at(shift(t, -46), '09:05'), 'EX-002', 'LN-2602', 'out', `出库交接 · ${CARRIERS[1]} 签收，包装 标准木箱`),
    ev(at(shift(t, -75), '14:20'), 'EX-003', 'LN-2603', 'create', `创建借出单 · 借往 ${VENUES[4]}，时段 ${loans[2].start}~${loans[2].end}，包装 定制航空箱`),
    ev(at(shift(t, -72), '08:30'), 'EX-003', 'LN-2603', 'out', `出库交接 · ${CARRIERS[2]} 签收，包装 定制航空箱`),
    ev(at(shift(t, -35), '16:20'), 'EX-003', 'LN-2603', 'return', '归还验收通过 · 包装一致，准予入库'),
    ev(at(shift(t, -28), '10:40'), 'EX-004', 'LN-2604', 'create', `创建借出单 · 借往 ${VENUES[2]}，时段 ${loans[3].start}~${loans[3].end}，包装 软包卷装`),
    ev(at(shift(t, -26), '09:10'), 'EX-004', 'LN-2604', 'out', `出库交接 · ${CARRIERS[3]} 签收，包装 软包卷装`),
    ev(at(shift(t, -3), '15:45'), 'EX-004', 'LN-2604', 'hold', '归还验收未通过 · 暂缓入库：缺少损毁照片；包装不一致（出库：软包卷装 / 归还：标准木箱）'),
  ];
  return { exhibits, loans, events, tasks: [] };
}
