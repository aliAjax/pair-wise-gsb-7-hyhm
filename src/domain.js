export const STORAGE_KEY = 'artwork-loan-desk-v1';

export const STATUS = {
  active: 'active',
  frozen: 'frozen',
  held: 'held',
  returned: 'returned',
  released: 'released',
};

export const STATUS_META = {
  active: { label: '借出中', tone: 'blue' },
  frozen: { label: '逾期冻结', tone: 'red' },
  held: { label: '暂缓入库', tone: 'amber' },
  returned: { label: '已入库', tone: 'green' },
  released: { label: '已释放改期', tone: 'gray' },
};

export const PACKAGE_OPTIONS = [
  '木箱固定 + 温湿度标签',
  '瓦楞纸箱 + 缓冲棉',
  '档案盒 + 无酸隔层',
  '定制箱 + 防震封条',
  '裸装专运 + 专人押运',
];

const OCCUPYING = new Set([STATUS.active, STATUS.frozen, STATUS.held]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function localToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateOffset(days, from = localToday()) {
  const date = new Date(`${from}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function validPeriod(startDate, dueDate) {
  return Boolean(startDate && dueDate && startDate <= dueDate);
}

export function periodsOverlap(startA, dueA, startB, dueB) {
  return startA <= dueB && startB <= dueA;
}

export function occupiesPeriod(loan) {
  return OCCUPYING.has(loan.status);
}

export function findConflicts(loans, exhibitId, startDate, dueDate, ignoreLoanId = null) {
  if (!exhibitId || !validPeriod(startDate, dueDate)) return [];
  return loans.filter((loan) => {
    if (loan.id === ignoreLoanId || loan.exhibitId !== exhibitId) return false;
    if (!occupiesPeriod(loan)) return false;
    return periodsOverlap(startDate, dueDate, loan.startDate, loan.dueDate);
  });
}

function event(type, actor = '系统', summary, detail = '') {
  return { id: uid('evt'), at: new Date().toISOString(), type, actor, summary, detail };
}

export function createSeedState() {
  const exhibits = [
    {
      id: 'ex_1',
      code: 'CZ-001',
      title: '潮汐之后',
      type: '装置',
      location: 'A01 · 主展厅',
      color: '#e6b45d',
    },
    {
      id: 'ex_2',
      code: 'DAS-018',
      title: '未寄出的信',
      type: '档案',
      location: 'B02 · 纸上时间',
      color: '#ef8f84',
    },
    {
      id: 'ex_3',
      code: 'XMT-042',
      title: '柔软的边界',
      type: '互动媒介',
      location: 'C01 · 新媒介',
      color: '#83b9b1',
    },
  ];

  const loans = [
    {
      id: 'loan_1',
      number: 1,
      code: 'JTD-0001',
      exhibitId: 'ex_1',
      venue: '西岸城市美术馆',
      carrier: '安展物流 · 张启明车组',
      handler: '林策',
      startDate: dateOffset(-3),
      dueDate: dateOffset(6),
      packageOut: PACKAGE_OPTIONS[0],
      status: STATUS.active,
      createdAt: new Date(dateOffset(-3) + 'T09:00:00').toISOString(),
      chainId: 'chain_1',
      rescheduledFromId: null,
      replacedById: null,
      return: null,
      events: [
        event(
          'outbound',
          '林策',
          '借出登记并完成出库交接',
          '承运方：安展物流 · 张启明车组；出库包装：木箱固定 + 温湿度标签。',
        ),
      ],
    },
    {
      id: 'loan_2',
      number: 2,
      code: 'JTD-0002',
      exhibitId: 'ex_2',
      venue: '北岸当代艺术中心',
      carrier: '城际文博运输 · 03 车',
      handler: '周闻',
      startDate: dateOffset(-12),
      dueDate: dateOffset(-2),
      packageOut: PACKAGE_OPTIONS[2],
      status: STATUS.active,
      createdAt: new Date(dateOffset(-12) + 'T10:30:00').toISOString(),
      chainId: 'chain_2',
      rescheduledFromId: null,
      replacedById: null,
      return: null,
      events: [
        event(
          'outbound',
          '周闻',
          '借出登记并完成出库交接',
          '承运方：城际文博运输 · 03 车；出库包装：档案盒 + 无酸隔层。',
        ),
      ],
    },
    {
      id: 'loan_3',
      number: 3,
      code: 'JTD-0003',
      exhibitId: 'ex_3',
      venue: '港口艺术空间',
      carrier: '自提 · 借馆馆员陈默',
      handler: '林策',
      startDate: dateOffset(-31),
      dueDate: dateOffset(-23),
      packageOut: PACKAGE_OPTIONS[1],
      status: STATUS.returned,
      createdAt: new Date(dateOffset(-31) + 'T11:00:00').toISOString(),
      returnedAt: new Date(dateOffset(-23) + 'T16:20:00').toISOString(),
      chainId: 'chain_3',
      rescheduledFromId: null,
      replacedById: null,
      return: {
        date: dateOffset(-23),
        inspector: '许安全',
        condition: '完好',
        archive: '完整',
        packageIn: PACKAGE_OPTIONS[1],
        note: '外包装、封条与随箱资料一致。',
        photos: [],
      },
      events: [
        event('outbound', '林策', '借出登记并完成出库交接', '承运方：自提 · 借馆馆员陈默。'),
        event(
          'returned',
          '许安全',
          '归还核验通过，已入库',
          '状况完好；随箱档案完整；包装与出库一致。',
        ),
      ],
    },
    {
      id: 'loan_4',
      number: 4,
      code: 'JTD-0004',
      exhibitId: 'ex_3',
      venue: '河口设计博物馆',
      carrier: '安展物流 · 李禾车组',
      handler: '周闻',
      startDate: dateOffset(-17),
      dueDate: dateOffset(-10),
      packageOut: PACKAGE_OPTIONS[3],
      status: STATUS.held,
      createdAt: new Date(dateOffset(-17) + 'T09:30:00').toISOString(),
      returnedAt: new Date(dateOffset(-9) + 'T15:10:00').toISOString(),
      chainId: 'chain_4',
      rescheduledFromId: null,
      replacedById: null,
      return: {
        date: dateOffset(-9),
        inspector: '许安全',
        condition: '缺损',
        archive: '完整',
        packageIn: PACKAGE_OPTIONS[3],
        note: '右下角固定件缺失，已拍照并通知馆方确认。',
        photos: [],
      },
      events: [
        event('outbound', '周闻', '借出登记并完成出库交接', '承运方：安展物流 · 李禾车组。'),
        event(
          'held',
          '许安全',
          '归还发现缺损，暂缓入库',
          '状况：缺损；右下角固定件缺失。需馆方确认与修复评估后入库。',
        ),
      ],
    },
  ];

  const tasks = [
    {
      id: 'task_1',
      kind: 'hold',
      loanId: 'loan_4',
      exhibitId: 'ex_3',
      status: 'open',
      title: '归还核验未通过：缺损待处置',
      createdAt: new Date(dateOffset(-9) + 'T15:10:00').toISOString(),
      resolvedAt: null,
      resolution: '',
      notes: [
        {
          id: uid('note'),
          at: new Date(dateOffset(-8) + 'T10:00:00').toISOString(),
          actor: '周闻',
          text: '已向河口设计博物馆发出状况确认函，等待承运与馆方回传交接照片。',
        },
      ],
    },
  ];

  return { version: 1, exhibits, loans, tasks };
}

export function applyOverdueRules(input, today = localToday()) {
  const state = {
    version: 1,
    exhibits: input.exhibits || [],
    loans: input.loans || [],
    tasks: input.tasks || [],
  };

  const frozenIds = new Set();
  state.loans = state.loans.map((loan) => {
    if (loan.status === STATUS.active && loan.dueDate < today) {
      frozenIds.add(loan.id);
      return {
        ...loan,
        status: STATUS.frozen,
        frozenAt: new Date().toISOString(),
        events: [
          ...loan.events,
          event(
            'frozen',
            '系统',
            '超过约定归还日，原借出记录冻结',
            `约定归还日：${loan.dueDate}。时段、场馆、承运人与包装信息锁定；自动生成催还任务。`,
          ),
        ],
      };
    }
    return loan;
  });

  const newTasks = [...state.tasks];
  frozenIds.forEach((loanId) => {
    const loan = state.loans.find((item) => item.id === loanId);
    const exists = state.tasks.some(
      (task) => task.loanId === loanId && task.kind === 'dunning' && task.status === 'open',
    );
    if (loan && !exists) {
      newTasks.push({
        id: uid('task'),
        kind: 'dunning',
        loanId,
        exhibitId: loan.exhibitId,
        status: 'open',
        title: '逾期未归还：联系场馆与承运人催还',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        resolution: '',
        notes: [],
      });
    }
  });
  state.tasks = newTasks;
  return state;
}

function requireValues(input) {
  const exhibitId = input.exhibitId?.trim();
  const venue = input.venue?.trim();
  const carrier = input.carrier?.trim();
  const packageOut = input.packageOut?.trim();
  const handler = input.handler?.trim() || '未署名';
  if (!exhibitId) throw new Error('请选择展品。');
  if (!venue) throw new Error('请填写借入场馆。');
  if (!carrier) throw new Error('请填写承运人或承运车组。');
  if (!packageOut) throw new Error('请记录出库包装状态。');
  if (!validPeriod(input.startDate, input.dueDate)) {
    throw new Error('借出时段无效，开始日不能晚于归还日。');
  }
  return { exhibitId, venue, carrier, packageOut, handler };
}

export function createLoan(input, state) {
  const values = requireValues(input);
  const conflicts = findConflicts(
    state.loans,
    values.exhibitId,
    input.startDate,
    input.dueDate,
  );
  if (conflicts.length) {
    const error = new Error('该展品在重叠时段已借给其他场馆，不能重复借出。');
    error.conflicts = conflicts;
    throw error;
  }

  const number = Math.max(0, ...state.loans.map((loan) => loan.number || 0)) + 1;
  const id = uid('loan');
  const loan = {
    id,
    number,
    code: `JTD-${String(number).padStart(4, '0')}`,
    ...values,
    startDate: input.startDate,
    dueDate: input.dueDate,
    status: STATUS.active,
    createdAt: new Date().toISOString(),
    frozenAt: null,
    returnedAt: null,
    chainId: uid('chain'),
    rescheduledFromId: null,
    replacedById: null,
    return: null,
    events: [
      event(
        'outbound',
        values.handler,
        '借出登记并完成出库交接',
        `借入场馆：${values.venue}；承运方：${values.carrier}；借出时段：${input.startDate} 至 ${input.dueDate}；出库包装：${values.packageOut}。`,
      ),
    ],
  };

  return { ...state, loans: [loan, ...state.loans] };
}

export function rescheduleLoan(input, state) {
  const loan = state.loans.find((item) => item.id === input.loanId);
  if (!loan) throw new Error('未找到原借出记录。');
  if (loan.status !== STATUS.active) throw new Error('只有未冻结的借出记录可以改期。');
  if (!validPeriod(input.startDate, input.dueDate)) {
    throw new Error('改期时段无效，开始日不能晚于归还日。');
  }
  const reason = input.reason?.trim();
  if (!reason) throw new Error('请填写改期原因，以便交接链核对。');
  const actor = input.actor?.trim() || '未署名';

  // 先释放原记录，再用新记录占用新时段。
  const releasedLoan = {
    ...loan,
    status: STATUS.released,
    replacedById: 'pending',
    releasedAt: new Date().toISOString(),
    events: [
      ...loan.events,
      event(
        'rescheduled-out',
        actor,
        '改期确认：原借出时段已释放',
        `原时段 ${loan.startDate} 至 ${loan.dueDate} 不再占用。原因：${reason}。`,
      ),
    ],
  };
  const provisionalLoans = state.loans.map((item) => (item.id === loan.id ? releasedLoan : item));
  const conflicts = findConflicts(
    provisionalLoans,
    loan.exhibitId,
    input.startDate,
    input.dueDate,
    loan.id,
  );
  if (conflicts.length) {
    const error = new Error('新时段仍与该展品其他借调记录冲突。');
    error.conflicts = conflicts;
    throw error;
  }

  const chainSequence = state.loans.filter((item) => item.chainId === loan.chainId).length + 1;
  const number = Math.max(0, ...state.loans.map((item) => item.number || 0)) + 1;
  const newId = uid('loan');
  const newLoan = {
    ...loan,
    id: newId,
    number,
    code: `${loan.code}-R${chainSequence}`,
    startDate: input.startDate,
    dueDate: input.dueDate,
    status: STATUS.active,
    createdAt: new Date().toISOString(),
    frozenAt: null,
    returnedAt: null,
    chainId: loan.chainId,
    rescheduledFromId: loan.id,
    replacedById: null,
    return: null,
    events: [
      event(
        'rescheduled-in',
        actor,
        '改期重排：生成新的借出交接单',
        `承接原单 ${loan.code}；新时段：${input.startDate} 至 ${input.dueDate}；原时段已释放。原因：${reason}。`,
      ),
    ],
  };
  releasedLoan.replacedById = newId;

  return {
    ...state,
    loans: [newLoan, ...provisionalLoans.map((item) => (item.id === loan.id ? releasedLoan : item))],
  };
}

export function inspectReturn(input, state) {
  const loan = state.loans.find((item) => item.id === input.loanId);
  if (!loan) throw new Error('未找到借出记录。');
  if (![STATUS.active, STATUS.frozen].includes(loan.status)) {
    throw new Error('该记录当前状态不能办理归还。');
  }
  if (!input.date) throw new Error('请选择实际归还日期。');
  const inspector = input.inspector?.trim();
  if (!inspector) throw new Error('请填写归还核验人。');

  const condition = input.condition || '完好';
  const archive = input.archive || '完整';
  const packageIn = input.packageIn?.trim();
  if (!packageIn) throw new Error('请选择归还时包装状态。');
  const photos = input.photos || [];
  const note = input.note?.trim() || '';

  const damaged = condition !== '完好';
  const archiveIssue = archive !== '完整';
  const packageMismatch = packageIn !== loan.packageOut;
  const anomaly = damaged || archiveIssue || packageMismatch;

  if (damaged && !photos.length) {
    throw new Error('展品缺损或损毁时必须上传现场照片，否则不能提交归还核验。');
  }
  if (packageMismatch && !note) {
    throw new Error('包装状态与出库不一致时必须说明差异。');
  }
  if (anomaly && !note) {
    throw new Error('发现异常时必须填写异常说明，再提交暂缓入库。');
  }

  const actor = inspector;
  const returnedAt = new Date().toISOString();
  const returnRecord = {
    date: input.date,
    inspector,
    condition,
    archive,
    packageIn,
    packageMismatch,
    note,
    photos,
  };

  let nextLoan = {
    ...loan,
    status: anomaly ? STATUS.held : STATUS.returned,
    returnedAt,
    return: returnRecord,
  };

  const detail = [
    `实际归还日：${input.date}`,
    `展品状况：${condition}`,
    `随箱档案/照片：${archive}`,
    `出库包装：${loan.packageOut}`,
    `归还包装：${packageIn}${packageMismatch ? '（不一致）' : '（一致）'}`,
    note ? `说明：${note}` : '',
  ]
    .filter(Boolean)
    .join('；');

  nextLoan.events = [
    ...nextLoan.events,
    anomaly
      ? event('held', actor, '归还核验异常，暂缓入库', detail)
      : event('returned', actor, '归还核验通过，已入库', detail),
  ];

  let loans = state.loans.map((item) => (item.id === loan.id ? nextLoan : item));
  let tasks = closeTasks(state.tasks, loan.id, 'dunning', actor, anomaly ? '展品已归还，但需异常复核。' : '展品已归还并入库。');

  if (anomaly) {
    const reasons = [
      damaged ? `展品${condition}` : '',
      archiveIssue ? '随箱档案或照片异常' : '',
      packageMismatch ? '包装与出库不一致' : '',
    ].filter(Boolean);
    tasks = [
      ...tasks,
      {
        id: uid('task'),
        kind: 'hold',
        loanId: loan.id,
        exhibitId: loan.exhibitId,
        status: 'open',
        title: `暂缓入库：${reasons.join('、')}`,
        createdAt: returnedAt,
        resolvedAt: null,
        resolution: '',
        notes: [],
      },
    ];
    nextLoan.events = [
      ...nextLoan.events,
      event('task', actor, '已生成暂缓入库复核任务', reasons.join('、')),
    ];
    loans = state.loans.map((item) => (item.id === loan.id ? nextLoan : item));
  }

  return { ...state, loans, tasks };
}

export function completeHold(input, state) {
  const loan = state.loans.find((item) => item.id === input.loanId);
  if (!loan || loan.status !== STATUS.held) throw new Error('该记录不是暂缓入库状态。');
  const actor = input.actor?.trim();
  const disposition = input.disposition?.trim();
  if (!actor) throw new Error('请填写复核人。');
  if (!disposition) throw new Error('请填写缺损、资料或包装差异的处置结论。');

  const photos = input.photos || [];
  const returnedAt = new Date().toISOString();
  const nextLoan = {
    ...loan,
    status: STATUS.returned,
    returnedAt,
    holdCompletedAt: returnedAt,
    return: { ...loan.return, disposition, dispositionPhotos: photos },
    events: [
      ...loan.events,
      event(
        'returned',
        actor,
        '复核完成，批准入库',
        `处置结论：${disposition}${photos.length ? `；附加复核照片 ${photos.length} 张` : ''}。`,
      ),
    ],
  };
  const tasks = closeTasks(state.tasks, loan.id, 'hold', actor, '异常处置完成，展品正式入库。');
  return {
    ...state,
    loans: state.loans.map((item) => (item.id === loan.id ? nextLoan : item)),
    tasks,
  };
}

function closeTasks(tasks, loanId, kind, actor, resolution) {
  return tasks.map((task) => {
    if (task.loanId === loanId && task.kind === kind && task.status === 'open') {
      return {
        ...task,
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: actor,
        resolution,
      };
    }
    return task;
  });
}

export function addTaskNote(input, state) {
  const text = input.text?.trim();
  const actor = input.actor?.trim() || '经办人';
  if (!text) throw new Error('请填写跟进记录。');
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === input.taskId && task.status === 'open'
        ? {
            ...task,
            notes: [
              ...task.notes,
              { id: uid('note'), at: new Date().toISOString(), actor, text },
            ],
          }
        : task,
    ),
  };
}

export function addExhibit(input, state) {
  const title = input.title?.trim();
  if (!title) throw new Error('请填写展品名称。');
  const colors = ['#e6b45d', '#ef8f84', '#83b9b1', '#9ba7dc', '#7fb08c'];
  const exhibit = {
    id: uid('ex'),
    code: input.code?.trim() || `TZ-${String(state.exhibits.length + 1).padStart(3, '0')}`,
    title,
    type: input.type?.trim() || '未分类',
    location: input.location?.trim() || '待分配库位',
    color: colors[state.exhibits.length % colors.length],
  };
  return { ...state, exhibits: [...state.exhibits, exhibit] };
}
