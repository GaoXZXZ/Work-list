import { empty, addTask, changeTask, logProgress, changeNote, merge, view, canMove } from './model.mjs';
import { openStorage, read, update, makePassword, checkPassword, loadCloud, saveCloud, normalizeRepo, connect } from './storage.mjs';
import { day, movedDay, timezone } from './reports.mjs';
import { initReports } from './report-ui.mjs';

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  settings: '<path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 3 3-1 2 3 4-1 1-3 3-1 1-4-3-2 1-3-3-3-3 1-3-2Z"/><circle cx="12" cy="12" r="3"/>',
  widget: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="8" width="6" height="5" rx=".5"/>',
  list: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3.5"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  edit: '<path d="m4 16-1 5 5-1L20 8l-4-4L4 16ZM14 6l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/>',
  branch: '<path d="M6 4v13a2 2 0 0 0 2 2h11M6 8h13"/><path d="m16 5 3 3-3 3m0 5 3 3-3 3"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h14"/>',
  sparkles: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM19 3v4m-2-2h4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const html = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const $ = selector => document.querySelector(selector);
const fullDate = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const stampDate = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const timestamp = time => stampDate.format(new Date(time));
const today = () => day(Date.now());
const demo = new URLSearchParams(location.search).has('demo');
const actor = crypto.randomUUID?.();
const filters = [
  ['all', '全部时间', 'grid'], ['today', '今天', 'calendar'],
  ['week', '近 7 天', 'clock'], ['month', '本月', 'calendar'],
];
const monthLabel = value => value.slice(0, 4) + ' 年 ' + Number(value.slice(5)) + ' 月';
const filterText = value => filters.find(filter => filter[0] === value)?.[1] || monthLabel(value);
const laterFirst = (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id);
const cloudRetry = 45_000;
let db, password, channel, cloud, cloudClient, cloudTimer, syncRunning = false, syncAgain = false;
let state = empty(), tasks = new Map(), activeStatus = 'active', filter = 'all', query = '';
let selected = null, mobileDetail = false, dragId = null, toastTimer;
const localWidget = !demo && location.hostname === '127.0.0.1';
let widgetEnabled = false, lastWidgetPreview, widgetQueue = Promise.resolve();
let lastSync = '', syncMessage = '', cloudEpoch = 0, ready = false;

function action(label, name, iconName, options = {}) {
  const classes = options.classes || 'button';
  const id = options.id ? ` data-id="${html(options.id)}"` : '';
  const note = options.note ? ` data-note="${html(options.note)}"` : '';
  const accessibility = options.iconOnly ? ` aria-label="${html(label)}" title="${html(label)}"` : '';
  return `<button type="button" class="${classes}" data-action="${name}"${id}${note}${accessibility}>${iconName ? icon(iconName) : ''}${options.iconOnly ? '' : html(label)}</button>`;
}

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function showSync(message, status = '') {
  syncMessage = message;
  $('#sync-label').textContent = message;
  $('#sync-button').dataset.state = status;
}

function broadcast(kind) {
  channel?.postMessage(kind);
}

function queueSync(delay = 1600) {
  clearTimeout(cloudTimer);
  if (!cloud || !navigator.onLine) {
    if (cloud) showSync('离线 · 记录已保存到本机');
    return;
  }
  cloudTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  if (!cloud || !navigator.onLine) return;
  if (syncRunning) {
    syncAgain = true;
    return;
  }
  const epoch = cloudEpoch;
  const config = cloud;
  const isCurrent = () => epoch === cloudEpoch;
  syncRunning = true;
  try {
    showSync('正在同步…');
    cloudClient ||= await connect(config);
    const run = () => cloudClient?.sync(async remote => {
      let changed = false;
      const result = await update(db, 'state', previous => {
        const local = previous || empty();
        if (!isCurrent()) return local;
        const joined = merge(local, remote);
        if (JSON.stringify(merge(local, local)) === JSON.stringify(joined)) return local;
        changed = true;
        return joined;
      });
      if (changed) broadcast('remote');
      if (isCurrent()) renderIfChanged(result);
      return result;
    }, isCurrent);
    if (navigator.locks) await navigator.locks.request('work-journal-github-sync', run);
    else await run();
    if (isCurrent()) {
      lastSync = new Date().toISOString();
      showSync('云同步已连接', 'ok');
    }
  } catch (error) {
    if (isCurrent()) showSync(error instanceof TypeError ? '连接失败，已保存在本机' : error.message, 'error');
  } finally {
    if (!isCurrent()) cloudClient = null;
    syncRunning = false;
    queueSync(syncAgain ? 450 : cloudRetry);
    syncAgain = false;
  }
}

async function refreshCloud() {
  cloud = await loadCloud(db);
  cloudEpoch++;
  cloudClient = null;
  lastSync = '';
  showSync(cloud ? '等待云同步' : '本机保存');
  queueSync(0);
}

function renderIfChanged(next) {
  if (JSON.stringify(state) === JSON.stringify(next)) return;
  state = next;
  render();
}

async function mutate(writer, after) {
  let result;
  const apply = previous => {
    const draft = previous || empty();
    result = writer(draft, view(draft));
    return draft;
  };
  state = demo ? apply(state) : await update(db, 'state', apply);
  after?.(result);
  render();
  if (!demo) {
    broadcast('local');
    queueSync();
  }
}

function taskDay(task) {
  return day(task.completed || task.updated);
}

function matchesDate(task) {
  if (filter === 'all') return true;
  const date = taskDay(task);
  const now = today();
  if (filter === 'today') return date === now;
  if (filter === 'week') return date >= movedDay(now, -6) && date <= now;
  if (filter === 'month') return date.startsWith(now.slice(0, 7));
  return date.startsWith(filter);
}

function isLate(task) {
  return task.status === 'active' && task.due && task.due < today();
}

function matchesQuery(task) {
  return !query || [task.title, task.description, ...task.notes.map(note => note.text)]
    .some(text => text.toLocaleLowerCase().includes(query));
}

function navigationItem(value, label, iconName) {
  return `<button class="nav-item" data-action="time" data-value="${value}" aria-current="${filter === value}">${icon(iconName)}${label}</button>`;
}

function renderNavigation() {
  $('#time-nav').innerHTML = filters.map(args => navigationItem(...args)).join('');
  const months = [...new Set([...tasks.values()].map(task => taskDay(task).slice(0, 7)))].sort().reverse();
  if (/^\d{4}-\d{2}$/.test(filter) && !months.includes(filter)) months.push(filter);
  $('#month-nav').innerHTML = months.length
    ? '<h2>按月查看</h2><nav>' + months.map(month => navigationItem(month, monthLabel(month), 'calendar')).join('') + '</nav>'
    : '';
  $('#active-filter').textContent = filterText(filter);
}

function renderRows(items) {
  const visible = new Set(items.map(task => task.id));
  const children = new Map();
  for (const task of items) {
    const parent = visible.has(task.parent) ? task.parent : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(task);
  }
  const overflow = [];
  function branch(parent, depth) {
    return (children.get(parent) || []).map(task => {
      const parentTask = tasks.get(task.parent);
      const subtitle = parentTask && !visible.has(parentTask.id) ? `↳ ${parentTask.title} · ` : '';
      const date = task.completed ? '办结 ' + taskDay(task) : '更新 ' + taskDay(task);
      const inner = depth < 8 ? branch(task.id, depth + 1) : '';
      if (depth === 8 && children.has(task.id)) overflow.push(task.id);
      return `<div class="task-wrap">
        <div class="task-row ${task.id === selected ? 'selected' : ''}" data-drop="${task.id}">
          <button type="button" class="grip" draggable="true" data-drag="${task.id}" data-action="move" data-id="${task.id}" aria-label="移动 ${html(task.title)}" title="拖到另一项任务或点击选择位置">${icon('grip')}</button>
          <button class="row-button" data-action="open" data-id="${task.id}" aria-pressed="${task.id === selected}">
            <span class="task-icon">${icon(task.status === 'done' ? 'check' : 'list')}</span>
            <span class="task-label"><span class="task-title">${html(task.title)}</span>
              <span class="task-summary">${html(subtitle + date)}${isLate(task) ? ' · <span class="late">已逾期</span>' : ''}</span>
            </span><span class="row-progress">${task.progress}%</span>
          </button>
        </div>${inner ? '<div class="task-kids">' + inner + '</div>' : ''}
      </div>`;
    }).join('');
  }
  const displayed = branch(null, 0);
  let deeper = '';
  for (const parent of overflow) deeper += branch(parent, 0);
  return '<div id="drop-root" class="drop-root" data-drop="root" hidden>拖到这里，移为顶级任务</div>' + displayed + deeper;
}

function emptyState(iconName, title, message, extra = '') {
  return `<div class="empty"><span class="empty-icon">${icon(iconName)}</span><h3>${html(title)}</h3><p>${html(message)}</p>${extra}</div>`;
}

function renderTasks(items) {
  if (items.length) {
    $('#tasks').innerHTML = renderRows(items);
    return;
  }
  if (query || filter !== 'all') {
    $('#tasks').innerHTML = emptyState('search', '没有匹配的任务', '可以调整搜索词、时间或任务状态。', action('清除筛选', 'clear-filter', '', { classes: 'text-button' }));
    return;
  }
  const done = activeStatus === 'done';
  $('#tasks').innerHTML = emptyState(done ? 'archive' : 'list', done ? '暂无已办结任务' : '暂无进行中的任务',
    done ? '任务办结后会归档到这里。' : '新建任务，即可添加说明、子任务与跟进记录。',
    !tasks.size && !demo && !done ? '<a class="text-button" href="?demo=1">预览示例</a>' : '');
}

function renderDetail(current) {
  const detail = $('#detail');
  detail.classList.toggle('idle', !current);
  $('#work-grid').classList.toggle('has-detail', Boolean(current && mobileDetail));
  if (!current) {
    detail.innerHTML = emptyState('branch', '任务详情', '选中任务后，可在这里查看进度和跟进记录。');
    return;
  }
  const id = current.id;
  const done = current.status === 'done';
  const parent = tasks.get(current.parent);
  const children = [...tasks.values()].filter(task => task.parent === id).sort(laterFirst);
  const button = (label, key, name, classes = 'button') => action(label, key, name, { id, classes, iconOnly: classes === 'icon-button' });
  const notes = current.notes.map(note => `<li>
    <div class="timeline-meta">
      <time datetime="${html(note.created)}">${timestamp(note.created)}</time>
      ${note.progress === null ? '' : `<span class="tag">进度 ${note.progress}%</span>`}
      ${note.edited === note.created ? '' : `<span title="${timestamp(note.edited)}">已编辑</span>`}
      ${action('编辑记录', 'edit-note', 'edit', { id, note: note.id, classes: 'icon-button', iconOnly: true })}
      ${action('删除记录', 'delete-note', 'trash', { id, note: note.id, classes: 'icon-button', iconOnly: true })}
    </div>
    ${note.text ? `<p>${html(note.text)}</p>` : ''}
  </li>`).join('');
  detail.innerHTML = `${action('返回列表', 'back', 'back', { classes: 'button detail-back' })}
    ${parent ? `<div class="crumb">上级任务 ${action(parent.title, 'open', '', { id: parent.id, classes: 'text-button' })}</div>` : ''}
    <div class="detail-top">
      <div><span class="tag">${done ? '已办结' : '进行中'}</span><h2>${html(current.title)}</h2></div>
      <div class="detail-actions">
        ${button('编辑任务', 'edit', 'edit', 'icon-button')}${button('移动任务', 'move', 'branch', 'icon-button')}${button('删除任务', 'delete', 'trash', 'icon-button')}
      </div>
    </div>
    <div class="meta"><span>创建于 ${day(current.created)}</span>
      ${current.due ? `<span class="tag ${isLate(current) ? 'late' : ''}">截止 ${html(current.due)}${isLate(current) ? ' · 已逾期' : ''}</span>` : ''}
      ${done ? `<span>办结于 ${timestamp(current.completed)}</span>` : ''}
    </div>
    <p class="description ${current.description ? '' : 'muted'}">${html(current.description || '暂无工作说明')}</p>
    <div class="progress-label"><span>任务进度</span><strong>${current.progress}%</strong></div>
    <progress aria-label="任务进度" max="100" value="${current.progress}"></progress>
    <div class="task-commands">
      ${done ? button('重新打开', 'reopen', 'back') : button('记进展', 'log', 'plus', 'button primary')}
      ${done ? '' : button('新建子任务', 'add-child', 'branch')}
      ${done ? '' : button('办结归档', 'archive', 'archive')}
    </div>
    ${children.length ? `<div class="detail-section"><h3 class="section-title">子任务 · ${children.length}</h3>
      <div class="sub-list">${children.map(child => `<button class="button" data-action="open" data-id="${child.id}"><span>${html(child.title)}</span><span class="tag">${child.status === 'done' ? '已办结' : child.progress + '%'}</span></button>`).join('')}</div></div>` : ''}
    <div class="detail-section"><h3 class="section-title">跟进记录 · ${current.notes.length}</h3>
      ${notes ? `<ul class="timeline">${notes}</ul>` : '<p class="empty-line">暂无跟进记录</p>'}
    </div>`;
}

function render() {
  tasks = view(state);
  reports.refresh();
  const scoped = [...tasks.values()].filter(matchesDate);
  const active = scoped.filter(task => task.status === 'active');
  $('#hero-date').innerHTML = icon('calendar') + fullDate.format(new Date());
  $('#active-count').textContent = active.length;
  $('#done-count').textContent = scoped.length - active.length;
  $('#late-count').textContent = active.filter(isLate).length;
  renderNavigation();
  for (const button of document.querySelectorAll('[data-action="status"]')) {
    button.setAttribute('aria-pressed', button.dataset.value === activeStatus);
  }
  const visible = scoped.filter(task => task.status === activeStatus && matchesQuery(task)).sort(laterFirst);
  if (selected && !tasks.has(selected)) selected = null;
  const current = tasks.get(selected) || visible[0];
  if (!selected && current && !matchMedia('(max-width: 620px)').matches) selected = current.id;
  renderTasks(visible);
  renderDetail(current);
  if (widgetEnabled) sendWidgetPreview().catch(() => {});
}

const reports = initReports({ getTasks: () => tasks, today, notify });

const dialog = $('#dialog');
const dialogContent = $('#dialog-content');
function frame(title, body) {
  dialog.setAttribute('aria-label', title);
  dialogContent.innerHTML = `<div class="modal-header"><h2>${html(title)}</h2>
    ${action('关闭', 'close', 'x', { classes: 'icon-button', iconOnly: true })}</div>${body}`;
  if (!dialog.open) dialog.showModal();
}

function field(label, name, options = {}) {
  const { type = 'text', initial = '', optional = false, choices } = options;
  const bounds = [options.min != null ? `min="${options.min}"` : '', options.max != null ? `max="${options.max}"` : '',
    options.maxlength != null ? `maxlength="${options.maxlength}"` : '', options.minlength != null ? `minlength="${options.minlength}"` : ''].join(' ');
  const attrs = `name="${name}" ${optional ? '' : 'required'} ${bounds}`;
  let control;
  if (choices) {
    control = '<select ' + attrs + '>' + choices.map(([value, text]) =>
      `<option value="${html(value)}"${value === initial ? ' selected' : ''}>${html(text)}</option>`).join('') + '</select>';
  } else if (type === 'textarea') {
    control = `<textarea ${attrs}>${html(initial)}</textarea>`;
  } else {
    control = `<input type="${type}" ${attrs} value="${html(initial)}" autocomplete="${options.autocomplete || 'off'}" ${type === 'number' ? 'inputmode="numeric"' : ''}>`;
  }
  return `<label class="field"><span>${html(label)}</span>${control}</label>`;
}

async function authorize(values) {
  if (demo) return;
  const current = await read(db, 'password');
  if (current) {
    if (!await checkPassword(values.password, current)) throw Error('操作密码不正确');
    password = current;
    return;
  }
  if (!values.password || values.password.length < 8) throw Error('操作密码至少需要 8 个字符');
  if (values.password !== values.repeat) throw Error('两次输入的操作密码不一致');
  const candidate = await makePassword(values.password);
  password = await update(db, 'password', existing => existing || candidate);
  if (password.salt !== candidate.salt && !await checkPassword(values.password, password)) {
    throw Error('另一个窗口已设置操作密码，请重新核验。');
  }
  broadcast('password');
}

function form({ title, description = '', fields = '', submitLabel = '保存', protect = true, danger = false, submit }) {
  const requiresPassword = protect && !demo;
  const creatingPassword = requiresPassword && !password;
  const passwordField = requiresPassword
    ? field(creatingPassword ? '设置操作密码（至少 8 个字符）' : '核验操作密码', 'password',
      { type: 'password', maxlength: 128, minlength: creatingPassword ? 8 : undefined, autocomplete: creatingPassword ? 'new-password' : 'current-password' })
    : '';
  frame(title, `<p class="modal-description" ${description ? '' : 'hidden'}>${html(description)}</p>
    <form>${fields}${passwordField}
      ${creatingPassword ? field('再次输入操作密码', 'repeat', { type: 'password', maxlength: 128, autocomplete: 'new-password' }) : ''}
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-footer">${action('取消', 'close')}<button class="button ${danger ? 'danger' : 'primary'}" type="submit">${html(submitLabel)}</button></div>
    </form>`);
  const activeForm = dialogContent.querySelector('form');
  const submitButton = activeForm.querySelector('[type="submit"]');
  const errorBox = activeForm.querySelector('.form-error');
  const first = activeForm.querySelector('input, select, textarea');
  first?.focus();
  activeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    errorBox.hidden = true;
    const values = Object.fromEntries(new FormData(activeForm));
    try {
      if (protect) await authorize(values);
      await submit(values);
      dialog.close();
    } catch (error) {
      errorBox.textContent = error.message || '操作失败，请重试。';
      errorBox.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });
}

dialog.addEventListener('cancel', event => {
  if (dialogContent.querySelector('[type="submit"]:disabled')) event.preventDefault();
});
dialog.addEventListener('close', () => { if (!dialog.open) dialogContent.replaceChildren(); });

function showTask(id, mobile = true) {
  const task = tasks.get(id);
  if (!task) return;
  reports.toggle(false);
  if (task.status !== activeStatus || !matchesDate(task) || !matchesQuery(task)) {
    activeStatus = task.status;
    if (!matchesDate(task)) filter = 'all';
    if (!matchesQuery(task)) {
      query = '';
      $('#search').value = '';
    }
  }
  selected = id;
  mobileDetail = mobile;
  render();
  if (mobile && matchMedia('(max-width: 620px)').matches) window.scrollTo(0, 0);
}

function taskEditor(id, parentId = null) {
  const current = tasks.get(id);
  const parent = tasks.get(parentId);
  form({
    title: current ? '编辑任务' : parent ? '新建子任务' : '新建任务',
    description: parent ? '上级任务 · ' + parent.title : '',
    fields: field('任务名称', 'title', { initial: current?.title, maxlength: 120 }) +
      field('工作说明（可选）', 'description', { type: 'textarea', initial: current?.description, maxlength: 5000, optional: true }) +
      field('截止日期（可选）', 'due', { type: 'date', initial: current?.due, optional: true }),
    submit: async values => {
      const { description, due } = values;
      const title = values.title.trim();
      if (!title) throw Error('请输入任务名称');
      let saved;
      await mutate((draft, latest) => {
        if (current) {
          const changes = Object.fromEntries(Object.entries({ title, description, due }).filter(([name, value]) => value !== current[name]));
          if (Object.keys(changes).length) changeTask(draft, actor, id, changes);
          return id;
        }
        if (parentId && latest.get(parentId)?.status !== 'active') throw Error('上级任务已办结或删除');
        return addTask(draft, actor, { title, description, due, parent: parentId });
      }, result => { saved = result; });
      showTask(saved);
      notify(current ? '任务已保存' : '任务已新建');
    },
  });
}

function createTask(parentId = null) {
  taskEditor(null, parentId);
}

function followUp(task) {
  form({
    title: '记录进展', description: task.title,
    fields: field('跟进说明（可选）', 'text', { type: 'textarea', maxlength: 3000, optional: true }) +
      field('进度（%）', 'progress', { type: 'number', initial: task.progress, min: 0, max: 100 }),
    submit: async values => {
      const text = values.text.trim();
      const progress = Number(values.progress);
      if (!text && progress === task.progress) throw Error('请填写跟进说明或更新进度');
      await mutate((draft, latest) => logProgress(draft, actor, task.id, text,
        progress === task.progress ? latest.get(task.id)?.progress : progress));
      showTask(task.id);
      notify('已记录进展');
    },
  });
}

function noteEditor(task, note, remove) {
  if (!note) return;
  form({
    title: remove ? '删除跟进记录' : '编辑跟进记录',
    description: remove ? '将删除这条记录。任务当前的进度会保留。' : '记录时间 · ' + timestamp(note.created),
    fields: remove ? '' : field('跟进说明', 'text', { type: 'textarea', initial: note.text, maxlength: 3000, optional: note.progress !== null }),
    submitLabel: remove ? '删除记录' : '保存',
    danger: remove,
    submit: async values => {
      const text = values.text?.trim();
      if (!remove && !text && note.progress === null) throw Error('请输入跟进说明');
      await mutate(draft => changeNote(draft, actor, task.id, note.id, remove ? { deleted: true } : { text }));
      showTask(task.id);
      notify(remove ? '记录已删除' : '记录已保存');
    },
  });
}

function confirmTask(task, key) {
  const definitions = {
    delete: ['删除任务', '将删除这项任务及其跟进记录。直接子任务会移为顶级任务。', { deleted: true }, '任务已删除'],
    archive: ['办结归档', '任务将移到「已办结」。子任务各自保留当前状态。', { status: 'done' }, '任务已办结'],
    reopen: ['重新打开', '任务将移回「进行中」，可以继续记录进展。', { status: 'active' }, '任务已重新打开'],
  };
  const [title, description, changes, message] = definitions[key];
  form({
    title, description: task.title + '。' + description, submitLabel: title, danger: key === 'delete',
    submit: async () => {
      await mutate(draft => changeTask(draft, actor, task.id, changes));
      if (key !== 'delete') showTask(task.id);
      else {
        selected = null;
        mobileDetail = false;
        render();
      }
      notify(message);
    },
  });
}

function moveTask(task, dropTarget) {
  const id = task.id;
  if (dropTarget !== undefined && (!canMove(tasks, id, dropTarget) || dropTarget === task.parent)) return;
  const options = [['root', '顶级任务'], ...[...tasks.values()]
    .filter(target => canMove(tasks, id, target.id))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    .map(target => [target.id, target.title + (target.status === 'done' ? '（已办结）' : '')])];
  form({
    title: '移动任务',
    description: dropTarget === undefined ? task.title : task.title + ' → ' + (tasks.get(dropTarget)?.title || '顶级任务'),
    fields: dropTarget === undefined ? field('移动到', 'parent', { choices: options, initial: task.parent || 'root' }) : '',
    submitLabel: '确认移动',
    submit: async values => {
      const parent = dropTarget === undefined ? (values.parent === 'root' ? null : values.parent) : dropTarget;
      await mutate((draft, latest) => {
        if (!canMove(latest, id, parent)) throw Error('无法移动到此位置，请选择其他任务');
        if (parent !== latest.get(id).parent) changeTask(draft, actor, id, { parent });
      });
      showTask(id);
      notify('任务位置已保存');
    },
  });
}

function settings() {
  const status = cloud ? `<strong>${html(cloud.repo)}</strong><br>${html(syncMessage)}${lastSync ? ' · ' + timestamp(lastSync) : ''}` : '尚未连接 GitHub。任务会自动保存在当前设备。';
  frame('设置与同步', `<p class="modal-description">${status}</p>
    <div class="sub-list">
      ${action(cloud ? '更新 GitHub 连接' : '连接 GitHub 私有仓库', 'cloud-setup', 'settings')}
      ${cloud ? action('断开当前设备的同步', 'disconnect') : ''}
      ${action(password ? '更换本机操作密码' : '设置本机操作密码', 'password', 'edit')}
    </div>
    <p class="modal-description">配置后，打开应用、保存修改与恢复联网时会自动同步。在另一台设备上连接同一仓库，并使用相同的云同步口令。</p>`);
}

function cloudSetup() {
  if (demo) {
    notify('示例模式使用临时数据');
    return;
  }
  form({
    title: '连接 GitHub 私有仓库',
    description: '使用仅对此仓库拥有 Contents 读写权限的细粒度令牌。云同步口令用于端侧加密，请保存好，并在其他设备使用相同口令。',
    fields: field('GitHub 仓库（用户名/仓库名）', 'repo', { initial: cloud?.repo, maxlength: 195 }) +
      field('GitHub 细粒度访问令牌', 'token', { type: 'password', maxlength: 500 }) +
      field('云同步口令（至少 12 个字符）', 'cloudPassword', { type: 'password', minlength: 12, maxlength: 256 }),
    submitLabel: '验证并启用同步',
    submit: async values => {
      const config = { repo: normalizeRepo(values.repo), token: values.token.trim(), password: values.cloudPassword };
      if (!config.token) throw Error('请输入 GitHub 访问令牌');
      const client = await connect(config);
      await client.sync(remote => remote, undefined, true);
      await saveCloud(db, config);
      await refreshCloud();
      broadcast('cloud');
      notify('已启用自动云同步');
    },
  });
}

function passwordEditor() {
  if (demo) {
    notify('示例模式使用临时数据');
    return;
  }
  if (!password) {
    form({ title: '设置本机操作密码', submit: () => notify('操作密码已设置') });
    return;
  }
  form({
    title: '更换本机操作密码',
    fields: field('新密码（至少 8 个字符）', 'newPassword', { type: 'password', minlength: 8, maxlength: 128, autocomplete: 'new-password' }) +
      field('再次输入新密码', 'newRepeat', { type: 'password', maxlength: 128, autocomplete: 'new-password' }),
    submit: async values => {
      if (values.newPassword !== values.newRepeat) throw Error('两次输入的新密码不一致');
      const previous = password;
      const next = await makePassword(values.newPassword);
      password = await update(db, 'password', stored => {
        if (stored?.salt !== previous.salt) throw Error('操作密码已更换，请重新核验');
        return next;
      });
      broadcast('password');
      notify('操作密码已更换');
    },
  });
}

function disconnect() {
  form({
    title: '断开当前设备的同步', description: '本机与 GitHub 仓库中的现有记录都会保留。',
    submitLabel: '断开同步',
    submit: async () => {
      await saveCloud(db, null);
      await refreshCloud();
      broadcast('cloud');
      notify('已断开云同步');
    },
  });
}

async function checkDesktopWidget() {
  if (!localWidget) return;
  try {
    const response = await fetch('./api/desktop-widget', { cache: 'no-store' });
    if (!response.ok) return;
    const status = await response.json();
    $('#widget-button').hidden = !status.available;
    if (status.enabled) {
      widgetEnabled = true;
      await sendWidgetPreview();
    }
  } catch {
    // A stopped local launcher leaves the last preview available on the desktop.
  }
}

function sendWidgetPreview(open = false) {
  const send = async () => {
    const active = [...tasks.values()].filter(task => task.status === 'active').sort(laterFirst);
    const preview = {
      total: active.length,
      tasks: active.slice(0, 5).map(({ id, title, progress }) => ({ id, title, progress })),
    };
    const snapshot = JSON.stringify(preview);
    if (!open && snapshot === lastWidgetPreview) return;
    const response = await fetch('./api/desktop-widget', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open, ...preview }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '桌面组件未能更新。');
    lastWidgetPreview = snapshot;
    widgetEnabled = true;
  };
  widgetQueue = widgetQueue.catch(() => {}).then(send);
  return widgetQueue;
}

async function openWidget() {
  const button = $('#widget-button');
  button.disabled = true;
  try {
    await sendWidgetPreview(true);
    notify('桌面组件已开启，切回桌面即可查看');
  } catch (error) {
    notify(error.message || '无法打开桌面组件，请检查本机启动器。');
  } finally {
    button.disabled = false;
  }
}

function closeNav() {
  document.body.classList.remove('nav-open');
  $('#nav-backdrop').hidden = true;
  $('.menu-button').setAttribute('aria-expanded', 'false');
}

function handleAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action: key, id, value, note } = button.dataset;
  if (key === 'close') {
    if (!dialogContent.querySelector('[type="submit"]:disabled')) dialog.close();
    return;
  }
  if (key === 'nav-open') {
    if (matchMedia('(max-width: 850px)').matches) {
      document.body.classList.add('nav-open');
      $('#nav-backdrop').hidden = false;
      $('.menu-button').setAttribute('aria-expanded', 'true');
      $('#time-nav [aria-current="true"]')?.focus();
    } else $('#sidebar [aria-current="true"]')?.focus();
    return;
  }
  if (key === 'nav-close') return closeNav();
  if (!ready) return;
  if (key === 'reports') {
    closeNav();
    return reports.toggle();
  }
  if (key === 'report-back') return reports.toggle(false);
  if (key === 'status' || key === 'time' || key === 'clear-filter' || key === 'back') {
    if (key === 'time') filter = value;
    if (key === 'time') reports.toggle(false);
    if (key === 'status') activeStatus = value;
    if (key === 'clear-filter') {
      filter = 'all';
      query = '';
      $('#search').value = '';
    }
    selected = null;
    mobileDetail = false;
    closeNav();
    return render();
  }
  if (key === 'add') {
    reports.toggle(false);
    return createTask();
  }
  if (key === 'widget') return openWidget();
  if (key === 'settings') {
    closeNav();
    return settings();
  }
  if (key === 'cloud-setup') return cloudSetup();
  if (key === 'password') return passwordEditor();
  if (key === 'disconnect') return disconnect();
  const task = tasks.get(id);
  if (!task) return;
  if (key === 'open') return showTask(id);
  if (key === 'edit') return taskEditor(id);
  if (key === 'add-child') return createTask(id);
  if (key === 'log') return followUp(task);
  if (key === 'edit-note' || key === 'delete-note') return noteEditor(task, task.notes.find(item => item.id === note), key === 'delete-note');
  if (key === 'move') return moveTask(task);
  if (['archive', 'reopen', 'delete'].includes(key)) confirmTask(task, key);
}

function clearDrag() {
  dragId = null;
  document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
  if ($('#drop-root')) $('#drop-root').hidden = true;
}

function droppedTarget(event) {
  const target = event.target.closest('[data-drop]')?.dataset.drop;
  if (!target) return undefined;
  return target === 'root' ? null : target;
}

function wire() {
  document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
  document.addEventListener('click', handleAction);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      closeNav();
      $('.menu-button').focus();
    }
  });
  $('#search').addEventListener('input', event => {
    query = event.target.value.trim().toLocaleLowerCase();
    selected = null;
    mobileDetail = false;
    render();
  });
  $('#tasks').addEventListener('dragstart', event => {
    const grip = event.target.closest('[data-drag]');
    if (!grip || !event.dataTransfer) return;
    dragId = grip.dataset.drag;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
    $('#drop-root').hidden = false;
  });
  $('#tasks').addEventListener('dragover', event => {
    const target = droppedTarget(event);
    document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
    if (!dragId || target === undefined || !canMove(tasks, dragId, target) || tasks.get(dragId).parent === target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.target.closest('[data-drop]').classList.add('drag-over');
  });
  $('#tasks').addEventListener('drop', event => {
    const task = tasks.get(dragId);
    const target = droppedTarget(event);
    clearDrag();
    if (task && target !== undefined) {
      event.preventDefault();
      moveTask(task, target);
    }
  });
  document.addEventListener('dragend', clearDrag);
  window.addEventListener('online', () => queueSync(0));
  window.addEventListener('offline', () => queueSync());
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && db) {
      renderIfChanged(await read(db, 'state') || empty());
      queueSync(0);
      if (!widgetEnabled) checkDesktopWidget();
    }
  });
}

function demoData() {
  const date = (offset, hour) => new Date(Date.parse(movedDay(today(), offset) + 'T00:00:00+08:00') + hour * 3_600_000).toISOString();
  const main = addTask(state, actor, { title: '整理项目阶段汇报', description: '汇总本阶段的关键成果、验证记录及下一步计划，供周会讨论。', due: movedDay(today(), 3) }, date(-5, 10));
  const child = addTask(state, actor, { title: '核对工程应用数据', parent: main }, date(-4, 10));
  addTask(state, actor, { title: '补充材料与图表', parent: main }, date(-4, 11));
  const second = addTask(state, actor, { title: '跟进合作单位反馈', description: '整理对方反馈并更新待确认问题。', due: movedDay(today(), -1) }, date(-3, 11));
  const done = addTask(state, actor, { title: '归档上周会议纪要' }, date(-8, 10));
  logProgress(state, actor, child, '已核对两项工程数据，等待补充应用记录。', 80, date(-2, 14));
  logProgress(state, actor, second, '已发送初稿，待确认反馈时间。', 35, date(-2, 15));
  logProgress(state, actor, main, '完成汇报框架，已汇总验证材料。下一步核对图表和工程应用数据。', 65, date(0, 9));
  logProgress(state, actor, main, '对齐汇报提纲，确认本阶段的主要成果。', 30, date(-3, 14));
  changeTask(state, actor, main, { progress: 65 }, date(0, 9));
  changeTask(state, actor, done, { status: 'done' }, date(-2, 16));
  for (const panel of document.querySelectorAll('#task-content, #report-content')) {
    panel.insertAdjacentHTML('afterbegin', '<div class="demo-banner"><span>示例模式 · 修改仅在本页有效</span><a class="text-button" href="./">返回我的工作记录</a></div>');
  }
}

async function start() {
  wire();
  if (!isSecureContext || !actor) {
    $('#tasks').innerHTML = emptyState('list', '请使用安全地址打开', '在 Windows 使用本机启动器，或在 iPhone 打开 HTTPS 部署地址。');
    return;
  }
  if (demo) demoData();
  else {
    db = await openStorage();
    state = await read(db, 'state') || empty();
    password = await read(db, 'password');
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('work-journal-v1');
      channel.onmessage = async ({ data }) => {
        if (data === 'cloud') await refreshCloud();
        if (data === 'password') password = await read(db, 'password');
        if (data === 'local' || data === 'remote') renderIfChanged(await read(db, 'state') || empty());
      };
    }
    try {
      await refreshCloud();
    } catch {
      showSync('请重新配置云同步', 'error');
    }
  }
  ready = true;
  render();
  checkDesktopWidget();
  setInterval(() => {
    render();
    if (!widgetEnabled) checkDesktopWidget();
  }, 60_000);
  const link = new URL(location.href);
  const taskId = link.searchParams.get('task');
  if (taskId || link.searchParams.has('new')) {
    if (link.searchParams.get('new') === '1') createTask();
    else if (tasks.has(taskId)) showTask(taskId);
    else notify('这项任务暂无本机记录。');
    link.searchParams.delete('task');
    link.searchParams.delete('new');
    history.replaceState(null, '', link);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

start().catch(error => {
  $('#tasks').innerHTML = emptyState('list', '无法打开工作记录', error.message || '请检查浏览器存储设置后重新打开。');
});
