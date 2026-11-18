export const empty = () => ({ version: 1, clock: 0, tasks: {} });

const taskFields = ['title', 'description', 'due', 'parent', 'status', 'progress', 'deleted'];
const noteFields = ['text', 'deleted'];
const uuid = /^[a-f0-9-]{36}$/i;
const compare = (a, b) => a[0] - b[0] || (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0);
const get = (value, field) => value.fields[field]?.value;
const stamp = (db, actor) => [++db.clock, actor];
const set = (item, fields, at, time) => {
  for (const [name, value] of Object.entries(fields)) item.fields[name] = { value, at, time };
};

export function addTask(db, actor, values, time = new Date().toISOString()) {
  const id = crypto.randomUUID();
  db.tasks[id] = { id, created: time, fields: {}, notes: {} };
  set(db.tasks[id], {
    title: values.title, description: values.description || '', due: values.due || '',
    parent: values.parent || null, status: 'active', progress: 0, deleted: false,
  }, stamp(db, actor), time);
  return id;
}

export function changeTask(db, actor, id, fields, time = new Date().toISOString()) {
  if (!db.tasks[id] || get(db.tasks[id], 'deleted')) throw Error('这项任务已删除');
  set(db.tasks[id], fields, stamp(db, actor), time);
}

export function logProgress(db, actor, id, text, progress, time = new Date().toISOString()) {
  const task = db.tasks[id];
  if (!task || get(task, 'deleted')) throw Error('这项任务已删除');
  if (get(task, 'status') !== 'active') throw Error('请先重新打开已办结任务');
  const previous = get(task, 'progress');
  const at = stamp(db, actor);
  const noteId = crypto.randomUUID();
  const note = { id: noteId, created: time, progress: progress === previous ? null : progress, fields: {} };
  set(note, { text, deleted: false }, at, time);
  task.notes[noteId] = note;
  if (progress !== previous) set(task, { progress }, at, time);
}

export function changeNote(db, actor, id, noteId, fields, time = new Date().toISOString()) {
  const task = db.tasks[id];
  const note = task?.notes[noteId];
  if (!note || get(task, 'deleted') || get(note, 'deleted')) throw Error('这条记录已删除');
  set(note, fields, stamp(db, actor), time);
}

function combine(a, b, names) {
  const fields = {};
  for (const name of names) {
    const left = a[name];
    const right = b[name];
    fields[name] = compare(left.at, right.at) >= 0 ? left : right;
  }
  return fields;
}

export function merge(a, b) {
  const tasks = {};
  for (const id of [...new Set([...Object.keys(a.tasks), ...Object.keys(b.tasks)])].sort()) {
    const left = a.tasks[id], right = b.tasks[id];
    if (!left || !right) {
      tasks[id] = left || right;
      continue;
    }
    const notes = {};
    for (const key of [...new Set([...Object.keys(left.notes), ...Object.keys(right.notes)])].sort()) {
      const x = left.notes[key], y = right.notes[key];
      notes[key] = x && y ? { ...x, fields: combine(x.fields, y.fields, noteFields) } : x || y;
    }
    tasks[id] = { ...left, fields: combine(left.fields, right.fields, taskFields), notes };
  }
  return { version: 1, clock: Math.max(a.clock, b.clock), tasks };
}

export function validate(db) {
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const progress = value => Number.isInteger(value) && value >= 0 && value <= 100;
  const fieldRules = {
    title: value => typeof value === 'string' && value.length > 0 && value.length <= 120,
    description: value => typeof value === 'string' && value.length <= 5000,
    due: value => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value),
    parent: value => value === null || (typeof value === 'string' && uuid.test(value)),
    status: value => ['active', 'done'].includes(value),
    progress,
    deleted: value => typeof value === 'boolean',
    text: value => typeof value === 'string' && value.length <= 3000,
  };
  const validFields = (fields, names) => names.every(name => {
    const field = fields?.[name];
    return field && Array.isArray(field.at) && field.at.length === 2 &&
      Number.isSafeInteger(field.at[0]) && field.at[0] > 0 && field.at[0] <= db.clock &&
      typeof field.at[1] === 'string' && uuid.test(field.at[1]) &&
      date(field.time) && fieldRules[name](field.value);
  });
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  if (db?.version !== 1 || !Number.isSafeInteger(db.clock) || db.clock < 0 || !record(db.tasks)) return false;
  return Object.entries(db.tasks).every(([id, task]) =>
    uuid.test(id) && task?.id === id && date(task.created) && validFields(task.fields, taskFields) &&
    record(task.notes) && Object.entries(task.notes).every(([key, note]) =>
      uuid.test(key) && note?.id === key && date(note.created) &&
      (note.progress === null || progress(note.progress)) && validFields(note.fields, noteFields)));
}

export function view(db) {
  const tasks = new Map();
  for (const task of Object.values(db.tasks)) {
    if (get(task, 'deleted')) continue;
    const values = Object.fromEntries(taskFields.map(name => [name, get(task, name)]));
    const notes = Object.values(task.notes)
      .filter(note => !get(note, 'deleted'))
      .map(note => ({ ...note, text: get(note, 'text'), edited: note.fields.text.time }))
      .sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
    const updated = [...Object.values(task.fields), ...Object.values(task.notes).flatMap(note => Object.values(note.fields))]
      .reduce((max, field) => field.time > max ? field.time : max, task.created);
    tasks.set(task.id, {
      ...values, progress: values.status === 'done' ? 100 : values.progress,
      id: task.id, created: task.created, updated, notes,
      completed: values.status === 'done' ? task.fields.status.time : null,
    });
  }
  for (const task of tasks.values()) if (!tasks.has(task.parent)) task.parent = null;
  const visited = new Set();
  for (const start of tasks.keys()) {
    const chain = new Set();
    let id = start;
    while (id && !visited.has(id) && !chain.has(id)) {
      chain.add(id);
      id = tasks.get(id).parent;
    }
    if (id && chain.has(id)) {
      const cycle = [...chain].slice([...chain].indexOf(id));
      const newest = cycle.reduce((a, b) => {
        const order = compare(db.tasks[a].fields.parent.at, db.tasks[b].fields.parent.at);
        return order > 0 || (order === 0 && a > b) ? a : b;
      });
      tasks.get(newest).parent = null;
    }
    for (const member of chain) visited.add(member);
  }
  return tasks;
}

export function canMove(tasks, id, target) {
  if (!tasks.has(id) || (target && !tasks.has(target))) return false;
  for (let current = target; current; current = tasks.get(current)?.parent) {
    if (current === id) return false;
  }
  return true;
}
