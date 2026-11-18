import { collectReport, movedDay, reportDraft, reportMaterialLimit, reportPeriod, reportUnits } from './reports.mjs';

const earliest = '1900-01-01';
const reportEndpoint = './api/report-ai';

export function initReports({ getTasks, today, notify }) {
  const $ = selector => document.querySelector(selector);
  const panel = $('#report-content');
  const anchorInput = $('#report-anchor');
  const draft = $('#report-draft');
  const reset = $('#report-reset');
  const aiDialog = $('#report-ai-dialog');
  const aiForm = $('#report-ai-form');
  const material = $('#report-ai-material');
  const code = $('#report-ai-code');
  const generate = $('#report-ai-generate');
  const aiStatus = $('#report-ai-status');
  const aiPreview = $('#report-ai-preview');
  const result = $('#report-ai-result');
  const edits = new Map();
  let kind = 'week', anchor = '', current, editedKey, aiTarget, accessCode = '', request;
  anchorInput.min = earliest;

  function refresh() {
    if (panel.hidden) return;
    const now = today();
    const date = anchor || now;
    const period = reportPeriod(kind, date);
    anchorInput.max = now;
    anchorInput.value = date;
    current = collectReport(getTasks(), period, now);
    editedKey = kind + '/' + period.start;
    for (const button of $('#report-kinds').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', button.dataset.kind === kind);
    }
    const unit = reportUnits[kind];
    const previous = $('#report-previous');
    previous.disabled = period.start <= earliest;
    previous.setAttribute('aria-label', '上一' + unit);
    const next = $('#report-next');
    next.disabled = period.end >= now;
    next.setAttribute('aria-label', '下一' + unit);
    $('#report-title').textContent = '工作' + period.label;
    $('#report-range').textContent = period.start + ' 至 ' + period.end +
      (current.through < period.end ? ' · 统计截至 ' + current.through : ' · 北京时间');
    for (const [metric, number] of Object.entries(current.count)) $('#report-' + metric).textContent = number;
    $('#report-yearly').hidden = kind !== 'year';
    if (kind === 'year') {
      const months = current.months.filter(item => item.created || item.completed || item.notes);
      const rows = months.map(({ month, created, completed, notes }) =>
        `<tr><th scope="row">${month} 月</th><td>${created}</td><td>${completed}</td><td>${notes}</td></tr>`);
      $('#report-months').innerHTML = rows.join('') || '<tr><td colspan="4">暂无月度记录</td></tr>';
    }
    const text = edits.get(editedKey) ?? reportDraft(current);
    if (draft.value !== text) draft.value = text;
    reset.hidden = !edits.has(editedKey);
  }

  function toggle(open = panel.hidden) {
    if (open === !panel.hidden) return;
    panel.hidden = !open;
    $('#task-content').hidden = open;
    $('#task-top-actions').hidden = open;
    $('#report-back').hidden = !open;
    $('#reports-nav').setAttribute('aria-current', open);
    $('#page-heading').textContent = open ? '工作报表' : '工作台';
    refresh();
    window.scrollTo(0, 0);
  }

  function saveEdit(text) {
    edits.set(editedKey, text);
    reset.hidden = false;
  }

  draft.addEventListener('input', () => saveEdit(draft.value));
  reset.addEventListener('click', () => {
    if (!window.confirm('恢复自动草稿会覆盖本期的编辑内容。确定恢复吗？')) return;
    edits.delete(editedKey);
    refresh();
  });
  $('#report-kinds').addEventListener('click', event => {
    const button = event.target.closest('button[data-kind]');
    if (!button) return;
    kind = button.dataset.kind;
    refresh();
  });
  anchorInput.addEventListener('change', () => {
    if (!anchorInput.value) return refresh();
    if (!anchorInput.reportValidity()) return;
    anchor = anchorInput.value;
    refresh();
  });
  $('#report-previous').addEventListener('click', () => {
    anchor = movedDay(current.period.start, -1);
    refresh();
  });
  $('#report-next').addEventListener('click', () => {
    anchor = movedDay(current.period.end, 1);
    refresh();
  });
  $('#report-today').addEventListener('click', () => {
    anchor = '';
    refresh();
  });
  $('#report-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(draft.value);
      notify('已复制报表草稿');
    } catch {
      draft.focus();
      draft.select();
      notify('已选中草稿，请使用系统复制命令');
    }
  });
  $('#report-download').addEventListener('click', () => {
    const { label, start, end } = current.period;
    const url = URL.createObjectURL(new Blob(['\ufeff', draft.value], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `工作${label}_${start}_${end}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  function status(message, busy = false) {
    aiStatus.textContent = message;
    aiStatus.hidden = !message;
    aiStatus.classList.toggle('muted', busy);
  }

  $('#report-ai-open').addEventListener('click', async () => {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    aiTarget = { key: editedKey, period: current.period };
    material.value = reportDraft(current);
    code.value = accessCode;
    result.value = '';
    aiForm.hidden = false;
    aiPreview.hidden = true;
    generate.disabled = true;
    material.readOnly = false;
    code.readOnly = false;
    status('正在检查撰写服务…', true);
    aiDialog.showModal();
    try {
      const response = await fetch(reportEndpoint, { cache: 'no-store', redirect: 'error', signal: controller.signal });
      const configured = response.ok && response.headers.get('Content-Type')?.includes('application/json') &&
        (await response.json()).enabled === true;
      if (controller.signal.aborted) return;
      generate.disabled = !configured;
      status(configured ? '' : '此站点尚未启用 DeepSeek 服务，请参阅部署说明。');
    } catch {
      if (!controller.signal.aborted) status('无法连接撰写服务。联网后可重新打开此窗口。');
    } finally {
      if (request === controller) request = undefined;
    }
  });
  $('#report-ai-close').addEventListener('click', () => aiDialog.close());
  aiDialog.addEventListener('close', () => {
    if (aiDialog.open) return;
    request?.abort();
    request = undefined;
    material.value = '';
    result.value = '';
    code.value = '';
  });

  aiForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (generate.disabled) return;
    const source = material.value.trim();
    if (!source) return status('请填写用于撰写的素材。');
    if (source.length > reportMaterialLimit) return status('素材超过 10 万字符，请删减后重试。');
    const token = code.value.trim();
    if (!token) return status('请输入部署时设置的 AI 访问口令。');
    const { period } = aiTarget;
    const controller = new AbortController();
    request = controller;
    generate.disabled = true;
    material.readOnly = true;
    code.readOnly = true;
    status('正在撰写，生成后可以先预览。', true);
    try {
      const response = await fetch(reportEndpoint, {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ kind: period.kind, start: period.start, end: period.end, source }),
      });
      if (!response.headers.get('Content-Type')?.includes('application/json')) throw Error('此站点尚未启用 DeepSeek 服务，请参阅部署说明。');
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '未能生成草稿，请稍后重试。');
      if (typeof data.draft !== 'string' || !data.draft.trim()) throw Error('DeepSeek 返回了空白草稿，请重试。');
      if (controller.signal.aborted) return;
      accessCode = token;
      result.value = data.draft;
      aiForm.hidden = true;
      aiPreview.hidden = false;
      result.focus();
    } catch (error) {
      if (!controller.signal.aborted) status(error instanceof TypeError ? '无法连接撰写服务，请检查网络后重试。' : error.message);
    } finally {
      if (request === controller) {
        request = undefined;
        generate.disabled = false;
        material.readOnly = false;
        code.readOnly = false;
      }
    }
  });
  $('#report-ai-review').addEventListener('click', () => {
    aiForm.hidden = false;
    aiPreview.hidden = true;
    status('');
    material.focus();
  });
  $('#report-ai-apply').addEventListener('click', () => {
    if (!result.value.trim()) return;
    edits.set(aiTarget.key, result.value);
    refresh();
    aiDialog.close();
    notify('已将 DeepSeek 文稿应用到报表');
  });

  return { refresh, toggle };
}
