export const reportNames = { week: '周报', month: '月报', year: '年报' };
export const reportUnits = { week: '周', month: '月', year: '年' };
export const reportMaterialLimit = 100_000;
export const deepseekModels = {
  'deepseek-flash': 'DeepSeek Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
};
export const defaultDeepseekModel = 'deepseek-flash';
export const timezone = 'Asia/Shanghai';

const calendarDay = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const calendarTime = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const msPerDay = 86_400_000;
export const day = time => calendarDay.format(new Date(time));
const clock = time => calendarTime.format(new Date(time));
const midnight = date => new Date(date + 'T00:00:00Z');
const isoDate = date => date.toISOString().slice(0, 10);
export const movedDay = (date, delta) => isoDate(new Date(midnight(date).getTime() + delta * msPerDay));

export function reportPeriod(kind, anchor) {
  const date = midnight(anchor);
  if (!Object.hasOwn(reportNames, kind) || !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
      Number.isNaN(date.getTime()) || isoDate(date) !== anchor) throw Error('请选择有效的报表日期');
  if (kind === 'week') {
    const start = movedDay(anchor, -(date.getUTCDay() + 6) % 7);
    return { kind, start, end: movedDay(start, 6), label: reportNames[kind] };
  }
  const year = anchor.slice(0, 4);
  if (kind === 'year') return { kind, start: year + '-01-01', end: year + '-12-31', label: reportNames[kind] };
  const start = anchor.slice(0, 7) + '-01';
  const nextMonth = midnight(start);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return { kind, start, end: movedDay(isoDate(nextMonth), -1), label: reportNames[kind] };
}

export function collectReport(tasks, period, today) {
  const through = today < period.end ? today : period.end;
  const includes = date => date >= period.start && date <= through;
  const isCurrentPeriod = includes(today);
  const entries = [];
  const pending = [];
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, created: 0, completed: 0, notes: 0 }));
  const count = { created: 0, completed: 0, notes: 0, pending: 0 };

  for (const task of tasks.values()) {
    const created = day(task.created);
    const completed = task.completed ? day(task.completed) : '';
    const added = includes(created);
    const closed = includes(completed);
    const notes = task.notes.map(note => ({ date: day(note.created), when: clock(note.created), progress: note.progress, text: note.text }))
      .filter(note => includes(note.date)).reverse();
    const title = tasks.has(task.parent) ? tasks.get(task.parent).title + ' › ' + task.title : task.title;
    const related = added || closed || notes.length > 0;
    const late = Boolean(task.due && task.due < today);
    if (related) {
      entries.push({ title, description: task.description, added: added ? created : '', closed: closed ? completed : '', notes });
    }
    if (task.status === 'active' && (related || includes(task.due) || (isCurrentPeriod && late))) {
      pending.push({ title, due: task.due, progress: task.progress, late });
    }
    if (added) {
      count.created++;
      months[Number(created.slice(5, 7)) - 1].created++;
    }
    if (closed) {
      count.completed++;
      months[Number(completed.slice(5, 7)) - 1].completed++;
    }
    for (const note of notes) {
      count.notes++;
      months[Number(note.date.slice(5, 7)) - 1].notes++;
    }
  }
  count.pending = pending.length;
  entries.sort((a, b) => b.closed.localeCompare(a.closed) || a.title.localeCompare(b.title, 'zh-CN'));
  pending.sort((a, b) => Number(b.late) - Number(a.late) || (a.due || '9999').localeCompare(b.due || '9999') ||
    a.title.localeCompare(b.title, 'zh-CN'));
  return { period, through, today, count, months, entries, pending };
}

export function reportDraft(report) {
  const { period, through, today, count, months, entries, pending } = report;
  const lines = [
    '工作' + period.label, period.start + ' 至 ' + period.end + '（北京时间）',
    ...(through < period.end ? ['活动统计截至 ' + through] : []), '',
    '一、工作概况',
    '本期新增 ' + count.created + ' 项，办结 ' + count.completed + ' 项，记录跟进 ' + count.notes + ' 条。',
  ];
  if (period.kind === 'year') {
    lines.push('', '按月统计（仅列有记录的月份）');
    const populated = months.filter(month => month.created || month.completed || month.notes);
    for (const { month, created, completed, notes } of populated) {
      lines.push(month + ' 月　新增 ' + created + ' 项，办结 ' + completed + ' 项，跟进 ' + notes + ' 条');
    }
    if (!populated.length) lines.push('暂无记录。');
  }
  const sections = [
    ['二、本期办结', entries.filter(item => item.closed)],
    ['三、本期新增与推进', entries.filter(item => !item.closed)],
  ];
  for (const [heading, items] of sections) {
    lines.push('', heading);
    for (const item of items) {
      const milestones = [item.added && '新增 ' + item.added, item.closed && '办结 ' + item.closed].filter(Boolean);
      lines.push('• ' + item.title + (milestones.length ? '（' + milestones.join('，') + '）' : ''));
      if (item.description) lines.push('  工作说明：' + item.description.replace(/\n/g, '\n  '));
      for (const note of item.notes) {
        const progress = note.progress === null ? '' : ' · 进度 ' + note.progress + '%';
        const text = note.text ? '　' + note.text.replace(/\n/g, '\n  ') : '';
        lines.push('  - ' + note.when + progress + text);
      }
    }
    if (!items.length) lines.push('暂无记录。');
  }
  lines.push('', '四、待推进事项（生成时状态 · ' + today + '）');
  for (const item of pending) {
    lines.push('• ' + item.title + ' · 进度 ' + item.progress + '%' +
      (item.due ? ' · 截止 ' + item.due : '') + (item.late ? ' · 已逾期' : ''));
  }
  if (!pending.length) lines.push('暂无相关待推进事项。');
  return lines.join('\n');
}
