import { useEffect, useMemo, useState } from 'react';
import {
  STORAGE_KEY,
  STATUS,
  STATUS_META,
  PACKAGE_OPTIONS,
  localToday,
  dateOffset,
  findConflicts,
  createSeedState,
  applyOverdueRules,
  createLoan,
  rescheduleLoan,
  inspectReturn,
  completeHold,
  addTaskNote,
  addExhibit,
} from './domain.js';

function loadInitialState() {
  const seed = createSeedState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return applyOverdueRules(seed);
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.exhibits) || !Array.isArray(parsed.loans)) {
      return applyOverdueRules(seed);
    }
    return applyOverdueRules({
      version: 1,
      exhibits: parsed.exhibits,
      loans: parsed.loans,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    });
  } catch (error) {
    return applyOverdueRules(seed);
  }
}

const emptyLoanForm = (state) => ({
  exhibitId: state.exhibits[0]?.id || '',
  venue: '',
  carrier: '',
  handler: '',
  startDate: localToday(),
  dueDate: dateOffset(7),
  packageOut: PACKAGE_OPTIONS[0],
});

const emptyExhibitForm = { code: '', title: '', type: '', location: '' };
const conditionOptions = ['完好', '缺损', '损毁'];
const archiveOptions = ['完整', '缺失', '污损'];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysBetween(start, end) {
  return Math.round((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000);
}

function compactPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.62));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function App() {
  const initialState = useMemo(loadInitialState, []);
  const [state, setState] = useState(initialState);
  const [selectedLoanId, setSelectedLoanId] = useState(initialState.loans[0]?.id || '');
  const [loanForm, setLoanForm] = useState(() => emptyLoanForm(initialState));
  const [exhibitForm, setExhibitForm] = useState(emptyExhibitForm);
  const [filter, setFilter] = useState('all');
  const [rightTab, setRightTab] = useState('detail');
  const [showNewExhibit, setShowNewExhibit] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [reschedule, setReschedule] = useState({
    open: false,
    startDate: localToday(),
    dueDate: dateOffset(7),
    reason: '',
    actor: '',
  });
  const [returnForm, setReturnForm] = useState({
    date: localToday(),
    inspector: '',
    condition: '完好',
    archive: '完整',
    packageIn: '',
    note: '',
    photos: [],
  });
  const [holdForm, setHoldForm] = useState({ actor: '', disposition: '', photos: [] });
  const [taskDrafts, setTaskDrafts] = useState({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setStorageError('');
    } catch (storageFailure) {
      setStorageError('浏览器本地存储空间不足，最新照片未能写入；可先导出 JSON 留存。');
    }
  }, [state]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3800);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const timer = setInterval(() => {
      setState((current) => applyOverdueRules(current));
    }, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const exhibitsById = useMemo(
    () => Object.fromEntries(state.exhibits.map((item) => [item.id, item])),
    [state.exhibits],
  );
  const selectedLoan = state.loans.find((loan) => loan.id === selectedLoanId) || state.loans[0];

  useEffect(() => {
    if (selectedLoan?.id) setSelectedLoanId(selectedLoan.id);
  }, [selectedLoan?.id]);

  useEffect(() => {
    if (!selectedLoan) return;
    setReturnForm((current) => ({
      ...current,
      packageIn: current.packageIn || selectedLoan.packageOut,
    }));
  }, [selectedLoan?.id]);

  const filteredLoans = useMemo(() => {
    const sortable = [...state.loans];
    sortable.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filter === 'all') return sortable;
    return sortable.filter((loan) => loan.status === filter);
  }, [state.loans, filter]);

  const openTasks = state.tasks.filter((task) => task.status === 'open');
  const openConflicts = findConflicts(
    state.loans,
    loanForm.exhibitId,
    loanForm.startDate,
    loanForm.dueDate,
  );
  const stats = useMemo(() => {
    const byStatus = (status) => state.loans.filter((loan) => loan.status === status).length;
    const dueToday = state.loans.filter(
      (loan) =>
        [STATUS.active, STATUS.frozen].includes(loan.status) && loan.dueDate < localToday(),
    ).length;
    return {
      active: byStatus(STATUS.active),
      frozen: byStatus(STATUS.frozen),
      held: byStatus(STATUS.held),
      openTasks: openTasks.length,
      exhibits: state.exhibits.length,
      dueToday,
    };
  }, [state.loans, state.exhibits.length, openTasks.length]);

  function run(mutator, success) {
    try {
      const result = mutator();
      setState(result);
      setError('');
      if (success) setNotice(success);
      return result;
    } catch (failure) {
      setError(failure.message);
      setNotice('');
      return null;
    }
  }

  function selectLoan(loan) {
    setSelectedLoanId(loan.id);
    setRightTab('detail');
    setReturnForm({
      date: localToday(),
      inspector: '',
      condition: '完好',
      archive: '完整',
      packageIn: loan.packageOut,
      note: '',
      photos: [],
    });
    setReschedule({
      open: false,
      startDate: localToday(),
      dueDate: dateOffset(7),
      reason: '',
      actor: '',
    });
  }

  async function handlePhotoFiles(files, apply) {
    try {
      const photos = [];
      for (const file of Array.from(files).slice(0, 4)) {
        if (file.type.startsWith('image/')) photos.push(await compactPhoto(file));
      }
      apply(photos);
    } catch {
      setError('照片读取失败，请更换图片后重试。');
    }
  }

  function submitLoan() {
    const result = run(() => createLoan(loanForm, state), '借出登记已建立，时段占用和交接链已记录。');
    if (result) {
      const created = result.loans[0];
      setLoanForm(emptyLoanForm(result));
      selectLoan(created);
    }
  }

  function submitExhibit() {
    run(() => addExhibit(exhibitForm, state), '展品台账已新增。');
    setExhibitForm(emptyExhibitForm);
    setShowNewExhibit(false);
  }

  function submitReschedule() {
    if (!selectedLoan) return;
    const result = run(
      () => rescheduleLoan({ ...reschedule, loanId: selectedLoan.id }, state),
      '原时段已释放，新借调单已重排并保留在同一交接链。',
    );
    if (result) selectLoan(result.loans[0]);
  }

  function submitReturn() {
    if (!selectedLoan) return;
    const anomaly =
      returnForm.condition !== '完好' ||
      returnForm.archive !== '完整' ||
      returnForm.packageIn !== selectedLoan.packageOut;
    run(
      () => inspectReturn({ ...returnForm, loanId: selectedLoan.id }, state),
      anomaly ? '归还异常已记录，展品暂缓入库并生成复核任务。' : '归还核验通过，展品已正式入库。',
    );
  }

  function submitHold() {
    if (!selectedLoan) return;
    run(() => completeHold({ ...holdForm, loanId: selectedLoan.id }, state), '复核处置已归档，展品正式入库。');
    setHoldForm({ actor: '', disposition: '', photos: [] });
  }

  function submitTaskNote(taskId) {
    const draft = taskDrafts[taskId] || { actor: '', text: '' };
    const result = run(() => addTaskNote({ taskId, ...draft }, state), '跟进记录已追加到任务。');
    if (result) setTaskDrafts((current) => ({ ...current, [taskId]: { actor: '', text: '' } }));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `展品借调交接台-${localToday()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice('完整借调、任务和交接链数据已导出。');
  }

  function printLoan() {
    window.print();
  }

  const allEvents = useMemo(
    () =>
      state.loans
        .flatMap((loan) => loan.events.map((eventItem) => ({ ...eventItem, loan })))
        .sort((a, b) => b.at.localeCompare(a.at)),
    [state.loans],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">借</span>
          <div>
            <strong>展品借调交接台</strong>
            <small>Loan Handover Desk</small>
          </div>
        </div>
        <div className="side-section-title">交接状态</div>
        {[
          ['all', '全部记录', state.loans.length],
          [STATUS.active, STATUS_META.active.label, stats.active],
          [STATUS.frozen, STATUS_META.frozen.label, stats.frozen],
          [STATUS.held, STATUS_META.held.label, stats.held],
          [STATUS.returned, STATUS_META.returned.label, state.loans.filter((x) => x.status === STATUS.returned).length],
        ].map(([key, label, count]) => (
          <button
            key={key}
            className={`side-row ${filter === key ? 'active' : ''}`}
            onClick={() => setFilter(key)}
          >
            <span className={`dot ${key}`} />
            <span>{label}</span>
            <b>{count}</b>
          </button>
        ))}
        <div className="side-foot">
          <div className="storage-pill">本地持久化已启用</div>
          <p>刷新后保留借还记录、冲突拦截、催还任务及不可删除的交接链。</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">VERIFIABLE LOAN LEDGER · {localToday()}</span>
            <h1>借调、归还与异常交接核对</h1>
          </div>
          <div className="top-actions">
            <button className="secondary" onClick={exportData}>导出核对 JSON</button>
            <button className="secondary" onClick={printLoan}>打印交接单</button>
          </div>
        </header>

        <section className="metrics">
          <Metric label="借出中" value={stats.active} tone="blue" />
          <Metric label="逾期冻结" value={stats.frozen} tone="red" hint="原记录锁定" />
          <Metric label="暂缓入库" value={stats.held} tone="amber" hint="异常复核" />
          <Metric label="待办任务" value={stats.openTasks} tone="purple" hint="催还/复核" />
          <Metric label="在册展品" value={stats.exhibits} tone="green" />
        </section>

        {storageError && <div className="banner warning">{storageError}</div>}
        {error && (
          <div className="banner error" onAnimationEnd={() => {}}>
            <strong>操作被阻止：</strong>{error}
          </div>
        )}

        <div className="desk-grid">
          <section className="panel loans-panel">
            <div className="panel-head">
              <div>
                <h2>借调记录</h2>
                <p>选择记录核对时段、承运、包装与归还状态。</p>
              </div>
              <button className="text-button" onClick={() => setState(applyOverdueRules(state))}>
                ↻ 重扫逾期
              </button>
            </div>
            <div className="loan-list">
              {filteredLoans.map((loan) => (
                <LoanCard
                  key={loan.id}
                  loan={loan}
                  exhibit={exhibitsById[loan.exhibitId]}
                  selected={selectedLoan?.id === loan.id}
                  today={localToday()}
                  onSelect={() => selectLoan(loan)}
                />
              ))}
              {!filteredLoans.length && <div className="empty">当前筛选下没有记录。</div>}
            </div>

            <div className="exhibit-ledger">
              <div className="subsection-head">
                <div>
                  <h3>展品占用台账</h3>
                  <p>同一展品的时段重叠会在登记前拦截。</p>
                </div>
                <button className="text-button" onClick={() => setShowNewExhibit((value) => !value)}>
                  {showNewExhibit ? '收起' : '＋ 新增展品'}
                </button>
              </div>
              {showNewExhibit && (
                <div className="inline-form">
                  <input
                    placeholder="展品编号，可留空"
                    value={exhibitForm.code}
                    onChange={(eventItem) => setExhibitForm({ ...exhibitForm, code: eventItem.target.value })}
                  />
                  <input
                    placeholder="展品名称 *"
                    value={exhibitForm.title}
                    onChange={(eventItem) => setExhibitForm({ ...exhibitForm, title: eventItem.target.value })}
                  />
                  <input
                    placeholder="类型"
                    value={exhibitForm.type}
                    onChange={(eventItem) => setExhibitForm({ ...exhibitForm, type: eventItem.target.value })}
                  />
                  <input
                    placeholder="库房/展厅位置"
                    value={exhibitForm.location}
                    onChange={(eventItem) => setExhibitForm({ ...exhibitForm, location: eventItem.target.value })}
                  />
                  <button className="primary compact" onClick={submitExhibit}>保存展品</button>
                </div>
              )}
              {state.exhibits.map((exhibit) => (
                <ExhibitTimeline
                  key={exhibit.id}
                  exhibit={exhibit}
                  loans={state.loans.filter((loan) => loan.exhibitId === exhibit.id)}
                  selectedLoanId={selectedLoan?.id}
                  onSelectLoan={selectLoan}
                />
              ))}
            </div>
          </section>

          <section className="panel detail-panel">
            {selectedLoan ? (
              <>
                <div className="tabs">
                  {[
                    ['detail', '交接单'],
                    ['return', '归还核验'],
                    ['tasks', `任务 ${openTasks.length}`],
                    ['chain', '交接链'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      className={rightTab === key ? 'active' : ''}
                      onClick={() => setRightTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {rightTab === 'detail' && (
                  <LoanDetail
                    loan={selectedLoan}
                    exhibit={exhibitsById[selectedLoan.exhibitId]}
                    today={localToday()}
                    reschedule={reschedule}
                    setReschedule={setReschedule}
                    onReschedule={submitReschedule}
                    allLoans={state.loans}
                    exhibitsById={exhibitsById}
                    onGoReturn={() => setRightTab('return')}
                    onResolveHold={() => setRightTab('chain')}
                  />
                )}

                {rightTab === 'return' && (
                  <ReturnPanel
                    loan={selectedLoan}
                    form={returnForm}
                    setForm={setReturnForm}
                    onFiles={handlePhotoFiles}
                    onSubmit={submitReturn}
                  />
                )}

                {rightTab === 'tasks' && (
                  <TasksPanel
                    tasks={state.tasks}
                    loans={state.loans}
                    exhibitsById={exhibitsById}
                    drafts={taskDrafts}
                    setDrafts={setTaskDrafts}
                    onNote={submitTaskNote}
                    onOpenLoan={(loan) => {
                      selectLoan(loan);
                      setRightTab('detail');
                    }}
                  />
                )}

                {rightTab === 'chain' && (
                  <ChainPanel
                    loan={selectedLoan}
                    allLoans={state.loans}
                    allEvents={allEvents}
                    exhibit={exhibitsById[selectedLoan.exhibitId]}
                    onSelectLoan={selectLoan}
                    holdForm={holdForm}
                    setHoldForm={setHoldForm}
                    onHoldFiles={handlePhotoFiles}
                    onCompleteHold={submitHold}
                  />
                )}
              </>
            ) : (
              <div className="empty large">先登记一笔展品借出。</div>
            )}
          </section>
        </div>

        <section className="panel create-panel">
          <div className="panel-head">
            <div>
              <h2>新建借出交接</h2>
              <p>登记成功后立即占用展品时段；归还日前均不能被第二个场馆重复预约。</p>
            </div>
          </div>
          <div className="create-grid">
            <label>
              展品 *
              <select
                value={loanForm.exhibitId}
                onChange={(eventItem) => setLoanForm({ ...loanForm, exhibitId: eventItem.target.value })}
              >
                {state.exhibits.map((exhibit) => (
                  <option key={exhibit.id} value={exhibit.id}>
                    {exhibit.code} · {exhibit.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              借入场馆 *
              <input
                value={loanForm.venue}
                onChange={(eventItem) => setLoanForm({ ...loanForm, venue: eventItem.target.value })}
                placeholder="如：西岸城市美术馆"
              />
            </label>
            <label>
              承运人 / 车组 *
              <input
                value={loanForm.carrier}
                onChange={(eventItem) => setLoanForm({ ...loanForm, carrier: eventItem.target.value })}
                placeholder="物流公司、车牌号、司机/押运人"
              />
            </label>
            <label>
              经办馆员
              <input
                value={loanForm.handler}
                onChange={(eventItem) => setLoanForm({ ...loanForm, handler: eventItem.target.value })}
                placeholder="出库经办人"
              />
            </label>
            <label>
              借出日期 *
              <input
                type="date"
                value={loanForm.startDate}
                onChange={(eventItem) => setLoanForm({ ...loanForm, startDate: eventItem.target.value })}
              />
            </label>
            <label>
              约定归还日 *
              <input
                type="date"
                value={loanForm.dueDate}
                onChange={(eventItem) => setLoanForm({ ...loanForm, dueDate: eventItem.target.value })}
              />
            </label>
            <label className="wide">
              出库包装状态 *
              <select
                value={loanForm.packageOut}
                onChange={(eventItem) => setLoanForm({ ...loanForm, packageOut: eventItem.target.value })}
              >
                {PACKAGE_OPTIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <button className="primary wide" onClick={submitLoan}>登记借出并写入交接链</button>
          </div>
          <ConflictWarning conflicts={openConflicts} exhibitsById={exhibitsById} />
        </section>
      </main>

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function Metric({ label, value, hint, tone }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, tone: 'gray' };
  return <span className={`badge ${meta.tone}`}>{meta.label}</span>;
}

function LoanCard({ loan, exhibit, selected, today, onSelect }) {
  const overdue = [STATUS.active, STATUS.frozen].includes(loan.status) && loan.dueDate < today;
  return (
    <button className={`loan-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="loan-card-top">
        <span className="loan-code">{loan.code}</span>
        <StatusBadge status={loan.status} />
      </div>
      <h3>{exhibit?.title || '未知展品'}</h3>
      <p>{loan.venue}</p>
      <div className="loan-meta">
        <span>{formatDate(loan.startDate)} – {formatDate(loan.dueDate)}</span>
        {overdue && <em>逾期 {daysBetween(loan.dueDate, today)} 天</em>}
      </div>
      <small>{loan.carrier}</small>
    </button>
  );
}

function ConflictWarning({ conflicts, exhibitsById }) {
  if (!conflicts.length) return null;
  return (
    <div className="conflict-box">
      <strong>检测到同展品时段冲突</strong>
      {conflicts.map((loan) => (
        <div key={loan.id} className="conflict-item">
          <span className="badge red">{STATUS_META[loan.status].label}</span>
          <div>
            <strong>{exhibitsById[loan.exhibitId]?.title}</strong>
            <p>
              {loan.code} · {loan.venue} · {formatDate(loan.startDate)} 至 {formatDate(loan.dueDate)}
            </p>
          </div>
        </div>
      ))}
      <p className="rule">系统不会保存该借出；请更换展品或调整时段。</p>
    </div>
  );
}

function LoanDetail({ loan, exhibit, today, reschedule, setReschedule, onReschedule, allLoans, exhibitsById, onGoReturn, onResolveHold }) {
  const rescheduleConflicts = reschedule.open
    ? findConflicts(
        allLoans.map((item) =>
          item.id === loan.id
            ? { ...item, status: STATUS.released }
            : item,
        ),
        loan.exhibitId,
        reschedule.startDate,
        reschedule.dueDate,
        loan.id,
      )
    : [];
  const overdueDays = [STATUS.active, STATUS.frozen].includes(loan.status) && loan.dueDate < today
    ? daysBetween(loan.dueDate, today)
    : 0;

  return (
    <div className="detail-scroll">
      <div className="detail-hero">
        <div>
          <span className="eyebrow">{loan.code}</span>
          <h2>{exhibit?.title}</h2>
          <p>{exhibit?.code} · {exhibit?.type} · {exhibit?.location}</p>
        </div>
        <StatusBadge status={loan.status} />
      </div>

      <div className="check-grid">
        <CheckItem label="借入场馆" value={loan.venue} />
        <CheckItem label="承运人 / 车组" value={loan.carrier} />
        <CheckItem label="经办馆员" value={loan.handler} />
        <CheckItem label="借出时段" value={`${formatDate(loan.startDate)} – ${formatDate(loan.dueDate)}`} />
        <CheckItem label="出库包装" value={loan.packageOut} full />
        <CheckItem label="建立时间" value={formatDateTime(loan.createdAt)} />
        {loan.frozenAt && <CheckItem label="冻结时间" value={formatDateTime(loan.frozenAt)} danger />}
      </div>

      {loan.status === STATUS.frozen && (
        <div className="notice-box red">
          <strong>原借出记录已冻结</strong>
          <p>已逾期 {overdueDays} 天。时段、场馆、承运人和包装字段锁定，催还任务已自动生成。</p>
        </div>
      )}
      {loan.status === STATUS.active && loan.dueDate < today && (
        <div className="notice-box red">
          <strong>该记录已过归还日</strong>
          <p>保存或重扫后会冻结记录并生成催还任务。</p>
        </div>
      )}
      {loan.status === STATUS.released && (
        <div className="notice-box gray">
          <strong>原时段已经释放</strong>
          <p>新交接单：{allLoans.find((item) => item.id === loan.replacedById)?.code || '待匹配'}</p>
        </div>
      )}

      {loan.return && (
        <div className="return-summary">
          <h3>归还核验记录</h3>
          <CheckItem label="实际归还日" value={formatDate(loan.return.date)} />
          <CheckItem label="核验人" value={loan.return.inspector} />
          <CheckItem label="展品状况" value={loan.return.condition} danger={loan.return.condition !== '完好'} />
          <CheckItem label="随箱档案/照片" value={loan.return.archive} danger={loan.return.archive !== '完整'} />
          <CheckItem
            label="归还包装"
            value={loan.return.packageIn}
            danger={loan.return.packageIn !== loan.packageOut}
            full
          />
          {loan.return.note && <p className="anomaly-note">异常说明：{loan.return.note}</p>}
          {loan.return.disposition && <p className="disposition">复核处置：{loan.return.disposition}</p>}
          {!!loan.return.photos?.length && (
            <div className="photo-strip">
              {loan.return.photos.map((photo, index) => (
                <a key={index} href={photo} target="_blank" rel="noreferrer">
                  <img src={photo} alt={`归还照片 ${index + 1}`} />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="action-row">
        {[STATUS.active, STATUS.frozen].includes(loan.status) && (
          <button className="primary" onClick={onGoReturn}>办理归还核验</button>
        )}
        {loan.status === STATUS.held && (
          <button className="primary" onClick={onResolveHold}>填写暂缓入库复核</button>
        )}
        {loan.status === STATUS.active && (
          <button
            className="secondary"
            onClick={() => setReschedule({ ...reschedule, open: !reschedule.open })}
          >
            申请改期
          </button>
        )}
        {loan.status === STATUS.frozen && (
          <div className="frozen-note">逾期冻结期间不能直接改期；先归还或解冻后再重排。</div>
        )}
      </div>

      {reschedule.open && loan.status === STATUS.active && (
        <div className="subpanel">
          <h3>改期：释放原时段后重排</h3>
          <p className="muted">提交后原单状态变为“已释放改期”，新单沿用同一交接链编号。</p>
          <div className="two-col">
            <label>新借出日期
              <input
                type="date"
                value={reschedule.startDate}
                onChange={(eventItem) => setReschedule({ ...reschedule, startDate: eventItem.target.value })}
              />
            </label>
            <label>新归还日期
              <input
                type="date"
                value={reschedule.dueDate}
                onChange={(eventItem) => setReschedule({ ...reschedule, dueDate: eventItem.target.value })}
              />
            </label>
          </div>
          <label>经办人
            <input
              value={reschedule.actor}
              onChange={(eventItem) => setReschedule({ ...reschedule, actor: eventItem.target.value })}
              placeholder="确认改期的馆员"
            />
          </label>
          <label>改期原因 *
            <textarea
              rows="3"
              value={reschedule.reason}
              onChange={(eventItem) => setReschedule({ ...reschedule, reason: eventItem.target.value })}
              placeholder="场馆布展调整、运输限制、修复需求等"
            />
          </label>
          <ConflictWarning conflicts={rescheduleConflicts} exhibitsById={exhibitsById} />
          <button className="primary" disabled={!!rescheduleConflicts.length} onClick={onReschedule}>
            释放原时段并生成新单
          </button>
        </div>
      )}
    </div>
  );
}

function CheckItem({ label, value, full, danger }) {
  return (
    <div className={`check-item ${full ? 'full' : ''} ${danger ? 'danger' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReturnPanel({ loan, form, setForm, onFiles, onSubmit }) {
  const disabled = ![STATUS.active, STATUS.frozen].includes(loan.status);
  const packageMismatch = form.packageIn && form.packageIn !== loan.packageOut;
  const damaged = form.condition !== '完好';
  const archiveIssue = form.archive !== '完整';
  const anomaly = packageMismatch || damaged || archiveIssue;

  return (
    <div className="detail-scroll">
      <div className="panel-head compact">
        <div>
          <h2>归还核验</h2>
          <p>{loan.code} · {loan.venue}</p>
        </div>
      </div>
      {disabled && <div className="notice-box gray">该记录已完成归还或已释放，不能重复提交。</div>}

      <div className="return-form">
        <div className="two-col">
          <label>实际归还日期 *
            <input
              type="date"
              disabled={disabled}
              value={form.date}
              onChange={(eventItem) => setForm({ ...form, date: eventItem.target.value })}
            />
          </label>
          <label>核验人 *
            <input
              disabled={disabled}
              value={form.inspector}
              onChange={(eventItem) => setForm({ ...form, inspector: eventItem.target.value })}
              placeholder="现场验收馆员"
            />
          </label>
        </div>

        <div className="check-choice">
          <strong>展品状况</strong>
          {conditionOptions.map((option) => (
            <button
              key={option}
              disabled={disabled}
              className={form.condition === option ? 'selected' : ''}
              onClick={() => setForm({ ...form, condition: option })}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="check-choice">
          <strong>随箱档案 / 借出照片</strong>
          {archiveOptions.map((option) => (
            <button
              key={option}
              disabled={disabled}
              className={form.archive === option ? 'selected' : ''}
              onClick={() => setForm({ ...form, archive: option })}
            >
              {option}
            </button>
          ))}
        </div>

        <label>归还时包装状态 *
          <select
            disabled={disabled}
            value={form.packageIn}
            onChange={(eventItem) => setForm({ ...form, packageIn: eventItem.target.value })}
          >
            {PACKAGE_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>

        <div className="compare-row">
          <div>
            <span>出库包装</span>
            <p>{loan.packageOut}</p>
          </div>
          <b>→</b>
          <div className={packageMismatch ? 'danger-text' : ''}>
            <span>归还包装</span>
            <p>{form.packageIn || '—'}</p>
          </div>
        </div>

        <label>现场 / 缺损照片
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={disabled}
            onChange={(eventItem) =>
              onFiles(eventItem.target.files, (photos) =>
                setForm((current) => ({ ...current, photos: [...current.photos, ...photos].slice(0, 4) })),
              )
            }
          />
        </label>
        {!!form.photos.length && (
          <div className="photo-strip editable">
            {form.photos.map((photo, index) => (
              <span key={index} className="photo-thumb">
                <img src={photo} alt={`待上传 ${index + 1}`} />
                <button
                  onClick={() => setForm({ ...form, photos: form.photos.filter((_, itemIndex) => itemIndex !== index) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <label>异常说明 {anomaly ? '*' : ''}
          <textarea
            rows="4"
            disabled={disabled}
            value={form.note}
            onChange={(eventItem) => setForm({ ...form, note: eventItem.target.value })}
            placeholder={anomaly ? '必须描述缺损、档案或包装不一致情况。' : '无异常可留空。'}
          />
        </label>

        {anomaly ? (
          <div className="notice-box amber">
            <strong>提交后将暂缓入库并生成复核任务</strong>
            <p>
              {damaged && '展品非“完好”必须附带照片；'}
              {packageMismatch && '包装与出库不一致必须说明；'}
              {archiveIssue && '随箱资料异常必须说明。'}
            </p>
          </div>
        ) : (
          <div className="notice-box green">
            <strong>核验项一致：提交后可正式入库</strong>
          </div>
        )}

        <button className="primary wide" disabled={disabled} onClick={onSubmit}>
          {anomaly ? '提交异常并暂缓入库' : '核验通过，确认入库'}
        </button>
      </div>
    </div>
  );
}

function TasksPanel({ tasks, loans, exhibitsById, drafts, setDrafts, onNote, onOpenLoan }) {
  const sorted = [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return (
    <div className="detail-scroll tasks">
      <div className="panel-head compact">
        <div>
          <h2>催还与暂缓任务</h2>
          <p>逾期自动催还；归还异常自动生成暂缓入库任务。</p>
        </div>
      </div>
      {sorted.map((task) => {
        const loan = loans.find((item) => item.id === task.loanId);
        const exhibit = exhibitsById[task.exhibitId];
        const draft = drafts[task.id] || { actor: '', text: '' };
        return (
          <article key={task.id} className={`task-card ${task.status}`}>
            <div className="task-head">
              <div>
                <span className={`task-kind ${task.kind}`}>{task.kind === 'dunning' ? '催还' : '暂缓入库'}</span>
                <h3>{task.title}</h3>
                <p>{exhibit?.title} · {loan?.code} · {loan?.venue}</p>
              </div>
              <span className={`badge ${task.status === 'open' ? 'red' : 'green'}`}>
                {task.status === 'open' ? '待处理' : '已完结'}
              </span>
            </div>
            <button className="text-button" onClick={() => loan && onOpenLoan(loan)}>打开对应交接单 →</button>
            <div className="note-list">
              {task.notes.map((note) => (
                <div key={note.id} className="note">
                  <div><strong>{note.actor}</strong><time>{formatDateTime(note.at)}</time></div>
                  <p>{note.text}</p>
                </div>
              ))}
              {task.resolution && (
                <div className="note resolution">
                  <div><strong>{task.resolvedBy || '系统'} · 完结</strong><time>{formatDateTime(task.resolvedAt)}</time></div>
                  <p>{task.resolution}</p>
                </div>
              )}
            </div>
            {task.status === 'open' && (
              <div className="task-note-form">
                <input
                  placeholder="跟进人"
                  value={draft.actor}
                  onChange={(eventItem) => setDrafts({ ...drafts, [task.id]: { ...draft, actor: eventItem.target.value } })}
                />
                <textarea
                  rows="2"
                  placeholder="记录电话、承运反馈、照片回传或修复安排…"
                  value={draft.text}
                  onChange={(eventItem) => setDrafts({ ...drafts, [task.id]: { ...draft, text: eventItem.target.value } })}
                />
                <button className="secondary compact" onClick={() => onNote(task.id)}>追加跟进</button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ChainPanel({
  loan,
  allLoans,
  allEvents,
  exhibit,
  onSelectLoan,
  holdForm,
  setHoldForm,
  onHoldFiles,
  onCompleteHold,
}) {
  const chainLoans = allLoans
    .filter((item) => item.chainId === loan.chainId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const exhibitEvents = allEvents
    .filter((item) => item.loan.exhibitId === loan.exhibitId)
    .slice(0, 12);

  return (
    <div className="detail-scroll chain">
      <div className="panel-head compact">
        <div>
          <h2>不可删除交接链</h2>
          <p>{exhibit?.title} · 当前链 {loan.chainId}</p>
        </div>
      </div>

      <h3>本借调链</h3>
      <div className="chain-steps">
        {chainLoans.map((item, index) => (
          <button
            key={item.id}
            className={`chain-step ${item.id === loan.id ? 'current' : ''}`}
            onClick={() => onSelectLoan(item)}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{item.code}</strong>
              <p>{formatDate(item.startDate)} – {formatDate(item.dueDate)}</p>
              <small>{item.venue}</small>
            </div>
            <StatusBadge status={item.status} />
          </button>
        ))}
      </div>

      {loan.status === STATUS.held && (
        <HoldResolution
          loan={loan}
          form={holdForm}
          setForm={setHoldForm}
          onFiles={onHoldFiles}
          onSubmit={onCompleteHold}
        />
      )}

      <h3>该展品最近交接事件</h3>
      <Timeline events={exhibitEvents} />
    </div>
  );
}

function HoldResolution({ loan, form, setForm, onFiles, onSubmit }) {
  return (
    <div className="subpanel hold-resolution">
      <h3>暂缓入库复核</h3>
      <p className="muted">缺损/包装差异处置完成前，该展品不会进入可再借状态。</p>
      <label>复核人 *
        <input
          value={form.actor}
          onChange={(eventItem) => setForm({ ...form, actor: eventItem.target.value })}
          placeholder="负责批准入库的馆员"
        />
      </label>
      <label>处置结论 *
        <textarea
          rows="4"
          value={form.disposition}
          onChange={(eventItem) => setForm({ ...form, disposition: eventItem.target.value })}
          placeholder="修复评估、保险/馆方确认、重新包装、差异责任认定等"
        />
      </label>
      <label>复核照片或文件照片
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(eventItem) =>
            onFiles(eventItem.target.files, (photos) =>
              setForm((current) => ({ ...current, photos: [...current.photos, ...photos].slice(0, 4) })),
            )
          }
        />
      </label>
      {!!form.photos.length && (
        <div className="photo-strip editable">
          {form.photos.map((photo, index) => (
            <span key={index} className="photo-thumb">
              <img src={photo} alt={`复核照片 ${index + 1}`} />
              <button
                onClick={() => setForm({ ...form, photos: form.photos.filter((_, itemIndex) => itemIndex !== index) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <button className="primary" onClick={onSubmit}>完成复核，正式入库（{loan.code}）</button>
    </div>
  );
}

function Timeline({ events }) {
  const typeLabel = {
    outbound: '出库',
    returned: '入库',
    held: '暂缓',
    frozen: '冻结',
    'rescheduled-out': '释放',
    'rescheduled-in': '重排',
    task: '任务',
  };
  return (
    <div className="timeline">
      {events.map((eventItem) => (
        <div key={eventItem.id} className="timeline-item">
          <span className="timeline-type">{typeLabel[eventItem.type] || eventItem.type}</span>
          <div>
            <strong>{eventItem.summary}</strong>
            <p>{eventItem.detail}</p>
            <time>{formatDateTime(eventItem.at)} · {eventItem.actor} · {eventItem.loan.code}</time>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExhibitTimeline({ exhibit, loans, selectedLoanId, onSelectLoan }) {
  const occupied = loans.filter((loan) =>
    [STATUS.active, STATUS.frozen, STATUS.held, STATUS.returned].includes(loan.status),
  );
  return (
    <div className="exhibit-row">
      <div className="exhibit-info">
        <span className="color-chip" style={{ background: exhibit.color }}>{exhibit.code}</span>
        <div>
          <strong>{exhibit.title}</strong>
          <small>{exhibit.type} · {exhibit.location}</small>
        </div>
      </div>
      <div className="mini-timeline">
        {occupied.length === 0 && <span className="muted">暂无占用时段</span>}
        {occupied.map((loan) => (
          <button
            key={loan.id}
            className={`mini-period ${loan.status} ${selectedLoanId === loan.id ? 'current' : ''}`}
            onClick={() => onSelectLoan(loan)}
            title={`${loan.code} ${loan.startDate} 至 ${loan.dueDate}`}
          >
            <span>{formatDate(loan.startDate)}–{formatDate(loan.dueDate)}</span>
            <small>{loan.venue}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
