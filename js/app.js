import { auditFiles } from './audit.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const state = { results: [], summary: { total:0, ok:0, risk:0, atRiskValue:0 } };

function formatBRL(n){ try{ return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) }catch(e){ return 'R$ '+n.toFixed(2) } }
function fmtPct(n){ return (typeof n==='number'? n.toFixed(2): n)+'%' }

function renderSummary(){
  $('#kpi-total').textContent = state.summary.total;
  $('#kpi-ok').textContent = state.summary.ok;
  $('#kpi-risk').textContent = state.summary.risk;
  $('#kpi-value').textContent = formatBRL(state.summary.atRiskValue);
}

function renderTable(){
  const tbody = $('#tbody');
  tbody.innerHTML='';
  for(const r of state.results){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.docNumber||'—'}</td>
      <td>${r.type||'—'}</td>
      <td>${r.date||'—'}</td>
      <td>${r.uf||'—'}</td>
      <td>${formatBRL(r.total||0)}</td>
      <td>${r.issue||'<span class="badge ok">OK</span>'}</td>
      <td>${r.declared ?? '—'}</td>
      <td>${r.correct ?? '—'}</td>
      <td>${r.howto || '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function handleUpload(files){
  $('#btn-audit').disabled = true;
  const {summary, details} = await auditFiles(files);
  state.summary = summary;
  state.results = details;
  renderSummary();
  renderTable();
  $('#btn-audit').disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', (event) => {
    const files = event.target.files;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const xmlContent = e.target.result;
        parseXML(xmlContent, file.name);  // chama o parser já existente
      };
      reader.readAsText(file);
    }
  });
});

