import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  PACKAGES, CARRIERS, VENUES,
  todayStr, nowStr, dayDiff,
  conflictsFor, exhibitStatus, inspectReturn,
  uid, seed,
} from './domain';

const KEY = 'loan-station-v1';
const load = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.exhibits) return d; } catch { } return seed(); };
const mkEv = fields => ({ id: uid('EV'), at: nowStr(), ...fields });

// 逾期扫描：在借且已过归还截止 → 冻结原记录并生成催还任务（幂等，可反复执行）
const sweepOverdue = prev => {
  const t = todayStr();
  let changed = false;
  const extraEvents = [], extraTasks = [];
  const loans = prev.loans.map(l => {
    if (l.status === '在借' && l.end < t) {
      changed = true;
      extraEvents.push(mkEv({ exhibitId: l.exhibitId, loanId: l.id, type: 'freeze', text: `逾期未还 · 借出记录冻结（应还 ${l.end}）` }));
      if (!prev.tasks.some(x => x.loanId === l.id && !x.done)) {
        extraTasks.push({ id: uid('TK'), loanId: l.id, exhibitId: l.exhibitId, createdAt: nowStr(), done: false });
        extraEvents.push(mkEv({ exhibitId: l.exhibitId, loanId: l.id, type: 'remind', text: `生成催还任务 · 请向 ${l.venue} 催告归还` }));
      }
      return { ...l, status: '冻结', frozenAt: t };
    }
    return l;
  });
  return changed ? { ...prev, loans, events: [...prev.events, ...extraEvents], tasks: [...prev.tasks, ...extraTasks] } : prev;
};

const BADGE = { '在库': 'b-stock', '在借': 'b-out', '冻结': 'b-frozen', '暂缓入库': 'b-hold', '已归还': 'b-done', '已作废': 'b-void' };
const Badge = ({ s }) => <span className={'badge ' + (BADGE[s] || '')}>{s}</span>;

const ICON = { create: '＋', out: '⇢', return: '✓', hold: '⏸', resolve: '⏵', freeze: '❄', remind: '⚑', conflict: '⊘', reschedule: '↻', void: '×', task: '✓' };
const Timeline = ({ events, asc = true }) => {
  const list = [...events].sort((a, b) => asc ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at));
  return <div className="timeline">{list.map(e =>
    <div className="tl-item" key={e.id}>
      <span className={'tl-ico t-' + e.type}>{ICON[e.type] || '·'}</span>
      <div><div className="tl-text">{e.text}</div><div className="tl-time">{e.at}</div></div>
    </div>)}
  </div>;
};

const PhotoPicker = ({ photos, onAdd, onRemove }) => (
  <div className="photos">
    {photos.map((p, i) =>
      <span className="photo-chip" key={i}>
        {p.url ? <img src={p.url} alt={p.name} /> : <i>▦</i>}
        <em>{p.name}</em>
        <button type="button" onClick={() => onRemove(i)}>×</button>
      </span>)}
    <label className="photo-add">＋ 上传损毁照片
      <input type="file" accept="image/*" multiple hidden onChange={onAdd} />
    </label>
  </div>
);

// 读取上传照片为 dataURL，保证刷新后仍可核对
const readPhotos = (files, cb, onTooBig) => {
  [...files].forEach(f => {
    if (f.size > 300 * 1024) { onTooBig(f.name); return; }
    const r = new FileReader();
    r.onload = () => cb({ name: f.name, url: r.result });
    r.readAsDataURL(f);
  });
};

function ExhibitDetail({ ex, loans, events, act, flash }) {
  const exLoans = loans.filter(l => l.exhibitId === ex.id);
  const active = exLoans.find(l => ['在借', '冻结', '暂缓入库'].includes(l.status));
  const status = exhibitStatus(loans, ex.id);
  const today = todayStr();

  const blank = { venue: '', carrier: '', start: '', end: '', packOut: PACKAGES[0] };
  const [form, setForm] = useState(blank);
  const [newErr, setNewErr] = useState('');
  const [mode, setMode] = useState(null); // 'return' | 'reschedule'
  const [ret, setRet] = useState({ damage: false, photos: [], packIn: '' });
  const [rs, setRs] = useState({ start: '', end: '' });
  const [rsErr, setRsErr] = useState('');

  const submitNew = () => {
    if (!form.venue.trim() || !form.carrier.trim() || !form.start || !form.end) return setNewErr('请完整填写场馆、承运人与借出时段');
    if (form.start > form.end) return setNewErr('归还截止不能早于借出开始');
    const r = act.addLoan(ex.id, form);
    if (!r.ok) {
      setNewErr(`时段冲突：与 ${r.conflicts.map(c => `${c.venue}（${c.start}~${c.end}）`).join('、')} 重叠，同一展品不得同时借给两个场馆`);
    } else {
      setNewErr(''); setForm(blank); flash('借出单已登记，时段已锁定');
    }
  };

  const openReturn = () => { setRet({ damage: false, photos: [], packIn: active.packOut }); setMode('return'); };
  const openReschedule = () => { setRs({ start: active.start, end: active.end }); setRsErr(''); setMode('reschedule'); };

  const submitReturn = () => {
    const held = act.submitReturn(active, ret);
    setMode(null);
    flash(held ? '验收未通过 · 已暂缓入库' : '验收通过 · 已入库');
  };

  const submitReschedule = () => {
    if (!rs.start || !rs.end) return setRsErr('请选择新的借出时段');
    if (rs.start > rs.end) return setRsErr('归还截止不能早于借出开始');
    const r = act.reschedule(active, rs.start, rs.end);
    if (!r.ok) return setRsErr(`改期冲突：新时段与 ${r.conflicts.map(c => `${c.venue}（${c.start}~${c.end}）`).join('、')} 重叠`);
    setMode(null); flash('已释放原时段并重排');
  };

  return <>
    <section className="detail-head card">
      <span className="thumb big" style={{ background: ex.color }}>{ex.code.slice(-3)}</span>
      <div className="detail-title">
        <h2>{ex.title}</h2>
        <small>{ex.code} · {ex.room} · {ex.type}</small>
        <p>{ex.desc}</p>
      </div>
      <Badge s={status} />
    </section>

    {active && active.status !== '暂缓入库' && (
      <section className="card loan-card">
        <div className="card-head"><h3>当前借出 · {active.id}</h3><Badge s={active.status} /></div>
        {active.status === '冻结' && <div className="banner danger">逾期未还 · 借出记录已冻结（{active.frozenAt}），催还任务已生成，归还验收前不可改借他人</div>}
        <div className="kv">
          <div><small>借入场馆</small><strong>{active.venue}</strong></div>
          <div><small>承运人</small><strong>{active.carrier}</strong></div>
          <div><small>借出时段</small><strong>{active.start} → {active.end}</strong>
            {active.status === '在借' && <em className="sub">剩余 {dayDiff(today, active.end)} 天</em>}
            {active.status === '冻结' && <em className="sub red">已逾期 {dayDiff(active.end, today)} 天</em>}
          </div>
          <div><small>出库包装</small><strong>{active.packOut}</strong></div>
          <div><small>出库交接</small><strong>{active.out ? '承运人已签收' : '待出库'}</strong></div>
        </div>
        <div className="actions">
          {!active.out && <button className="primary" onClick={() => { act.checkout(active); flash('出库交接完成'); }}>确认出库交接</button>}
          <button className="secondary" onClick={openReschedule}>改期重排</button>
          {active.out && <button className="secondary" onClick={openReturn}>办理归还</button>}
          {!active.out && <button className="ghost-danger" onClick={() => { act.voidLoan(active); flash('借出单已作废，时段已释放'); }}>作废借出单</button>}
        </div>

        {mode === 'reschedule' && (
          <div className="subform">
            <div className="subform-title">改期重排 <span className="hint">提交后原时段 {active.start}~{active.end} 立即释放，再按新时段重新校验冲突</span></div>
            <div className="two">
              <label>新的开始日期<input type="date" value={rs.start} onChange={e => setRs({ ...rs, start: e.target.value })} /></label>
              <label>新的归还截止<input type="date" value={rs.end} onChange={e => setRs({ ...rs, end: e.target.value })} /></label>
            </div>
            {rsErr && <div className="err">{rsErr}</div>}
            <div className="actions">
              <button className="primary" onClick={submitReschedule}>释放原时段并重排</button>
              <button className="ghost" onClick={() => setMode(null)}>取消</button>
            </div>
          </div>
        )}

        {mode === 'return' && (
          <div className="subform">
            <div className="subform-title">归还验收 <span className="hint">缺损毁照片或包装不一致将暂缓入库</span></div>
            <div className="two">
              <label>损毁情况
                <select value={ret.damage ? '有损毁' : '无损毁'} onChange={e => setRet({ ...ret, damage: e.target.value === '有损毁' })}>
                  <option>无损毁</option><option>有损毁</option>
                </select>
              </label>
              <label>归还包装
                <select value={ret.packIn} onChange={e => setRet({ ...ret, packIn: e.target.value })}>
                  {PACKAGES.map(p => <option key={p}>{p}</option>)}
                </select>
              </label>
            </div>
            {ret.damage && <>
              <PhotoPicker
                photos={ret.photos}
                onAdd={e => readPhotos(e.target.files, p => setRet(r => ({ ...r, photos: [...r.photos, p] })), n => flash(`照片 ${n} 超过 300KB，未收录`))}
                onRemove={i => setRet(r => ({ ...r, photos: r.photos.filter((_, j) => j !== i) }))}
              />
              {ret.photos.length === 0 && <div className="hint warn-text">已申报损毁但未上传照片，提交后将暂缓入库</div>}
            </>}
            {ret.packIn !== active.packOut && <div className="hint warn-text">归还包装与出库（{active.packOut}）不一致，提交后将暂缓入库</div>}
            <div className="actions">
              <button className="primary" onClick={submitReturn}>提交验收</button>
              <button className="ghost" onClick={() => setMode(null)}>取消</button>
            </div>
          </div>
        )}
      </section>
    )}

    {active && active.status === '暂缓入库' && (
      <section className="card loan-card">
        <div className="card-head"><h3>归还暂缓 · {active.id}</h3><Badge s={active.status} /></div>
        <div className="banner warn">暂缓入库 · 验收未通过，补齐材料并复核前不得再次借出
          <ul>{(active.holdProblems || []).map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
        <div className="kv">
          <div><small>借入场馆</small><strong>{active.venue}</strong></div>
          <div><small>出库包装</small><strong>{active.packOut}</strong></div>
        </div>
        <label>归还包装（按实际归还登记）
          <select value={active.packIn} onChange={e => act.updateLoan(active.id, { packIn: e.target.value })}>
            {PACKAGES.map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
        <PhotoPicker
          photos={active.photos}
          onAdd={e => readPhotos(e.target.files, p => act.updateLoan(active.id, { photos: [...active.photos, p] }), n => flash(`照片 ${n} 超过 300KB，未收录`))}
          onRemove={i => act.updateLoan(active.id, { photos: active.photos.filter((_, j) => j !== i) })}
        />
        <div className="actions">
          <button className="primary" onClick={() => act.resolveHold(active)}>重新验收并入库</button>
        </div>
      </section>
    )}

    {!active && (
      <section className="card">
        <div className="card-head"><h3>新建借出</h3><span className="hint">登记即锁定时段</span></div>
        <div className="two">
          <label>借入场馆<input list="venues" placeholder="选择或输入场馆" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} /></label>
          <label>承运人<input list="carriers" placeholder="选择或输入承运人" value={form.carrier} onChange={e => setForm({ ...form, carrier: e.target.value })} /></label>
        </div>
        <div className="two">
          <label>借出开始<input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></label>
          <label>归还截止<input type="date" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></label>
        </div>
        <label>出库包装
          <select value={form.packOut} onChange={e => setForm({ ...form, packOut: e.target.value })}>
            {PACKAGES.map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
        {newErr && <div className="err">{newErr}</div>}
        <button className="primary full" onClick={submitNew}>登记借出（自动校验时段冲突）</button>
        <datalist id="venues">{VENUES.map(v => <option key={v} value={v} />)}</datalist>
        <datalist id="carriers">{CARRIERS.map(v => <option key={v} value={v} />)}</datalist>
      </section>
    )}

    <section className="card">
      <div className="card-head"><h3>借出记录与交接链</h3><span className="hint">{exLoans.length} 条记录</span></div>
      {exLoans.length === 0 && <div className="empty">暂无借出记录</div>}
      {[...exLoans].sort((a, b) => b.start.localeCompare(a.start)).map(loan =>
        <div className="loan-block" key={loan.id}>
          <div className="loan-line">
            <Badge s={loan.status} />
            <strong>{loan.venue}</strong>
            <span className="mono">{loan.start} ~ {loan.end}</span>
            <span className="hint">{loan.carrier}</span>
          </div>
          <Timeline events={events.filter(e => e.loanId === loan.id)} />
        </div>)}
    </section>
  </>;
}

function App() {
  const [db, setDb] = useState(load);
  const [view, setView] = useState('ledger');
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('全部');
  const [chainFilter, setChainFilter] = useState('全部');
  const [notice, setNotice] = useState('');

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(db)); }, [db]);
  useEffect(() => { setDb(prev => sweepOverdue(prev)); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 3400); return () => clearTimeout(t); }, [notice]);

  const flash = msg => setNotice(msg);
  const current = db.exhibits.find(x => x.id === selected) || db.exhibits[0];
  const today = todayStr();

  // ---------- 借还操作（全部写入交接链事件，随 db 持久化） ----------
  const act = {
    addLoan(exhibitId, form) {
      const conflicts = conflictsFor(db.loans, exhibitId, form);
      if (conflicts.length) {
        setDb(prev => ({ ...prev, events: [...prev.events, mkEv({ exhibitId, loanId: null, type: 'conflict', text: `冲突拦截 · ${form.venue} ${form.start}~${form.end} 与 ${conflicts.map(c => `${c.venue}（${c.start}~${c.end}）`).join('、')} 重叠，已拒绝登记` })] }));
        return { ok: false, conflicts };
      }
      const loan = { id: uid('LN'), exhibitId, venue: form.venue.trim(), carrier: form.carrier.trim(), start: form.start, end: form.end, packOut: form.packOut, packIn: '', damage: false, photos: [], out: false, status: '在借', createdAt: nowStr() };
      setDb(prev => ({ ...prev, loans: [...prev.loans, loan], events: [...prev.events, mkEv({ exhibitId, loanId: loan.id, type: 'create', text: `创建借出单 · 借往 ${loan.venue}，时段 ${loan.start}~${loan.end}，包装 ${loan.packOut}` })] }));
      return { ok: true };
    },
    checkout(loan) {
      setDb(prev => ({ ...prev, loans: prev.loans.map(l => l.id === loan.id ? { ...l, out: true } : l), events: [...prev.events, mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: 'out', text: `出库交接 · ${loan.carrier} 签收，包装 ${loan.packOut}` })] }));
    },
    submitReturn(loan, ret) {
      const problems = inspectReturn(loan, ret);
      setDb(prev => ({
        ...prev,
        loans: prev.loans.map(l => l.id === loan.id ? { ...l, packIn: ret.packIn, damage: ret.damage, photos: ret.photos, status: problems.length ? '暂缓入库' : '已归还', holdProblems: problems, returnedAt: problems.length ? l.returnedAt : nowStr() } : l),
        events: [...prev.events, mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: problems.length ? 'hold' : 'return', text: problems.length ? `归还验收未通过 · 暂缓入库：${problems.join('；')}` : `归还验收通过 · 包装一致（${loan.packOut}），准予入库` })],
      }));
      return problems.length > 0;
    },
    resolveHold(loan) {
      const problems = inspectReturn(loan, { damage: loan.damage, photos: loan.photos, packIn: loan.packIn });
      setDb(prev => problems.length
        ? { ...prev, loans: prev.loans.map(l => l.id === loan.id ? { ...l, holdProblems: problems } : l), events: [...prev.events, mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: 'hold', text: `复核仍未通过 · ${problems.join('；')}` })] }
        : { ...prev, loans: prev.loans.map(l => l.id === loan.id ? { ...l, status: '已归还', holdProblems: [], returnedAt: nowStr() } : l), events: [...prev.events, mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: 'resolve', text: '暂缓解除 · 复核通过，准予入库' })] });
      flash(problems.length ? '仍不满足入库条件' : '暂缓解除 · 已入库');
    },
    updateLoan(id, patch) {
      setDb(prev => ({ ...prev, loans: prev.loans.map(l => l.id === id ? { ...l, ...patch } : l) }));
    },
    reschedule(loan, start, end) {
      const conflicts = conflictsFor(db.loans, loan.exhibitId, { start, end }, loan.id);
      if (conflicts.length) {
        setDb(prev => ({ ...prev, events: [...prev.events, mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: 'conflict', text: `改期冲突 · 新时段 ${start}~${end} 与 ${conflicts.map(c => `${c.venue}（${c.start}~${c.end}）`).join('、')} 重叠，未执行` })] }));
        return { ok: false, conflicts };
      }
      const unfreeze = loan.status === '冻结' && end >= todayStr();
      const evs = [mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: 'reschedule', text: `改期重排 · 释放原时段 ${loan.start}~${loan.end}，重排为 ${start}~${end}` })];
      if (unfreeze) evs.push(mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: 'resolve', text: '冻结解除 · 改期后恢复在借，催还任务自动核销' }));
      setDb(prev => ({
        ...prev,
        loans: prev.loans.map(l => l.id === loan.id ? { ...l, start, end, status: unfreeze ? '在借' : l.status } : l),
        events: [...prev.events, ...evs],
        tasks: unfreeze ? prev.tasks.map(t => t.loanId === loan.id && !t.done ? { ...t, done: true, doneAt: nowStr(), note: '改期后自动核销' } : t) : prev.tasks,
      }));
      return { ok: true };
    },
    voidLoan(loan) {
      setDb(prev => ({ ...prev, loans: prev.loans.map(l => l.id === loan.id ? { ...l, status: '已作废' } : l), events: [...prev.events, mkEv({ exhibitId: loan.exhibitId, loanId: loan.id, type: 'void', text: `借出单作废 · 时段 ${loan.start}~${loan.end} 已释放` })] }));
    },
    completeTask(task) {
      setDb(prev => {
        const loan = prev.loans.find(l => l.id === task.loanId);
        return { ...prev, tasks: prev.tasks.map(t => t.id === task.id ? { ...t, done: true, doneAt: nowStr() } : t), events: [...prev.events, mkEv({ exhibitId: task.exhibitId, loanId: task.loanId, type: 'task', text: `催还处理 · 已向 ${loan ? loan.venue : '借入方'} 发出催告` })] };
      });
      flash('已登记催告');
    },
  };

  const stats = useMemo(() => {
    const by = s => db.exhibits.filter(e => exhibitStatus(db.loans, e.id) === s).length;
    return { stock: by('在库'), out: by('在借'), frozen: by('冻结'), hold: by('暂缓入库'), tasks: db.tasks.filter(t => !t.done).length };
  }, [db]);

  const visible = db.exhibits.filter(e => filter === '全部' || exhibitStatus(db.loans, e.id) === filter);
  const openTasks = db.tasks.filter(t => !t.done);
  const doneTasks = db.tasks.filter(t => t.done);
  const chainEvents = db.events
    .filter(e => chainFilter === '全部' || e.exhibitId === chainFilter)
    .sort((a, b) => b.at.localeCompare(a.at));

  const exportData = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: nowStr(), ...db }, null, 2)], { type: 'application/json' }));
    a.download = 'loan-handover.json'; a.click(); flash('已导出台账 JSON');
  };
  const resetAll = () => { localStorage.removeItem(KEY); setDb(seed()); setSelected(null); flash('已重置为演示数据'); };

  return <div className="app">
    <aside>
      <div className="brand"><span className="mark">M</span><span>借调交接台</span></div>
      <div className="side-label">LOAN DESK</div>
      <nav>
        <button className={view === 'ledger' ? 'active' : ''} onClick={() => setView('ledger')}>▧ <span>借调台账</span><b>{db.exhibits.length}</b></button>
        <button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}>⚑ <span>催还任务</span>{openTasks.length > 0 && <b>{openTasks.length}</b>}</button>
        <button className={view === 'chain' ? 'active' : ''} onClick={() => setView('chain')}>⌁ <span>交接链</span><b>{db.events.length}</b></button>
      </nav>
      <div className="side-foot">
        <button onClick={resetAll}>↺ 重置演示数据</button>
        <small>已自动保存 · 刷新后保留</small>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div><span className="eyebrow">LOAN HANDOVER DESK</span><h1>展品借调交接台</h1></div>
        <div className="top-actions">
          <span className="date-chip">今日 {today}</span>
          <button className="secondary" onClick={exportData}>↓ 导出 JSON</button>
        </div>
      </header>

      {view === 'ledger' && <>
        <div className="stats">
          <div className="stat"><b>{stats.stock}</b><span>在库</span></div>
          <div className="stat"><b>{stats.out}</b><span>在借</span></div>
          <div className="stat warn"><b>{stats.frozen}</b><span>逾期冻结</span></div>
          <div className="stat warn"><b>{stats.hold}</b><span>暂缓入库</span></div>
          <div className="stat"><b>{stats.tasks}</b><span>待办催还</span></div>
        </div>
        <div className="content">
          <section className="list-pane">
            <div className="filters">
              {['全部', '在库', '在借', '冻结', '暂缓入库'].map(x =>
                <button key={x} className={filter === x ? 'selected' : ''} onClick={() => setFilter(x)}>{x}</button>)}
            </div>
            <div className="exhibit-list">
              {visible.length === 0 && <div className="empty">该状态下暂无展品</div>}
              {visible.map(x => {
                const st = exhibitStatus(db.loans, x.id);
                const actLoan = db.loans.find(l => l.exhibitId === x.id && ['在借', '冻结', '暂缓入库'].includes(l.status));
                return <button className={'exhibit-row ' + (current.id === x.id ? 'chosen' : '')} key={x.id} onClick={() => setSelected(x.id)}>
                  <span className="thumb" style={{ background: x.color }}>{x.code.slice(-3)}</span>
                  <span className="row-copy">
                    <strong>{x.title}</strong>
                    <small>{x.room} · {x.type}</small>
                    {actLoan && <small className="row-sub">→ {actLoan.venue} · 止 {actLoan.end}{actLoan.status === '冻结' ? ` · 逾期 ${dayDiff(actLoan.end, today)} 天` : ''}</small>}
                  </span>
                  <Badge s={st} />
                </button>;
              })}
            </div>
          </section>
          <section className="detail-pane">
            <ExhibitDetail key={current.id} ex={current} loans={db.loans} events={db.events} act={act} flash={flash} />
          </section>
        </div>
      </>}

      {view === 'tasks' && (
        <div className="page">
          <h2 className="page-title">催还任务</h2>
          {openTasks.length === 0 && <div className="empty">暂无待办催还任务</div>}
          {openTasks.map(t => {
            const loan = db.loans.find(l => l.id === t.loanId);
            const ex = db.exhibits.find(e => e.id === t.exhibitId);
            return <div className="task-card" key={t.id}>
              <div>
                <strong>催还 · {ex ? ex.title : t.exhibitId}</strong>
                <div className="hint">{loan ? `${loan.venue} · 应还 ${loan.end} · 已逾期 ${dayDiff(loan.end, today)} 天` : ''}</div>
                <div className="hint">任务生成于 {t.createdAt}</div>
              </div>
              <button className="primary" onClick={() => act.completeTask(t)}>标记已催告</button>
            </div>;
          })}
          {doneTasks.length > 0 && <>
            <h3 className="page-sub">已处理</h3>
            {doneTasks.map(t => {
              const ex = db.exhibits.find(e => e.id === t.exhibitId);
              return <div className="task-card done" key={t.id}>
                <div><strong>催还 · {ex ? ex.title : t.exhibitId}</strong>
                  <div className="hint">{t.note || '已催告'} · {t.doneAt}</div></div>
                <span className="badge b-done">已完成</span>
              </div>;
            })}
          </>}
        </div>
      )}

      {view === 'chain' && (
        <div className="page">
          <div className="page-head">
            <h2 className="page-title">交接链</h2>
            <select value={chainFilter} onChange={e => setChainFilter(e.target.value)}>
              <option>全部</option>
              {db.exhibits.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </div>
          <div className="chain">
            {chainEvents.length === 0 && <div className="empty">暂无交接记录</div>}
            {chainEvents.map(e => {
              const ex = db.exhibits.find(x => x.id === e.exhibitId);
              return <div className="chain-row" key={e.id}>
                <span className={'tl-ico t-' + e.type}>{ICON[e.type] || '·'}</span>
                <div className="chain-body">
                  <div>{e.text}</div>
                  <small>{e.at} · {ex ? ex.title : e.exhibitId}{e.loanId ? ` · ${e.loanId}` : ''}</small>
                </div>
              </div>;
            })}
          </div>
        </div>
      )}
    </main>
    {notice && <div className="toast">{notice}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
