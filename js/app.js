import { auditFiles } from './audit.js';

const $ = s => document.querySelector(s);

const state = { results: [], summary: { total:0, ok:0, risk:0, atRiskValue:0 } };

function formatBRL(n){
  try { return Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) }
  catch { return 'R$ ' + (Number(n||0)).toFixed(2) }
}

function renderSummary(){
  $('#kpi-total').textContent = state.summary.total;
  $('#kpi-ok').textContent    = state.summary.ok;
  $('#kpi-risk').textContent  = state.summary.risk;
  $('#kpi-value').textContent = formatBRL(state.summary.atRiskValue);
}

function renderTable(){
  const tbody = $('#tbody');
  tbody.innerHTML = '';
  for (const r of state.results){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.docNumber || '—'}</td>
      <td>${r.type      || '—'}</td>
      <td>${r.date      || '—'}</td>
      <td>${r.uf        || '—'}</td>
      <td>${formatBRL(r.total || 0)}</td>
      <td>${r.issue || '<span class="badge ok">OK</span>'}</td>
      <td>${r.declared ?? '—'}</td>
      <td>${r.correct  ?? '—'}</td>
      <td>${r.howto    || '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function handleUpload(fileList){
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const btn = $('#btn-audit');
  if (btn) btn.disabled = true;

  try {
    console.log('[IVA360] Arquivos recebidos:', files.map(f=>f.name));
    const { summary, details } = await auditFiles(files);
    console.log('[IVA360] Resultado auditoria:', summary, details);
    state.summary = summary || { total:0, ok:0, risk:0, atRiskValue:0 };
    state.results = details || [];
    renderSummary();
    renderTable();
  } catch (err){
    console.error('[IVA360] Erro na auditoria:', err);
    alert('Falha ao processar os XMLs (veja o Console com F12).');
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const input  = document.getElementById('file');       // bate com seu index.html
  const btn    = document.getElementById('btn-audit');
  const label  = document.getElementById('label-file');

  if (btn)   btn.addEventListener('click', () => input && input.click());
  if (label) label.addEventListener('click', () => input && input.click());
  if (input) input.addEventListener('change', e => handleUpload(e.target.files));

  // drag & drop opcional
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) handleUpload(e.dataTransfer.files);
  });
});
