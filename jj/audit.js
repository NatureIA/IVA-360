// Auditor NF-e / CT-e client-side (robusto p/ namespace + fallback de dados)

async function loadAliquotas(){
  // 1) tenta inline <script id="aliquotas-json" type="application/json">
  const inline = document.getElementById('aliquotas-json');
  if (inline) {
    try { return JSON.parse(inline.textContent); }
    catch(e){ console.warn('[IVA360] aliquotas inline inválidas:', e); }
  }

  // 2) tenta arquivo externo (projeto GitHub Pages)
  const candidates = [
    './data/aliquotas.json',
    `${location.pathname.replace(/\/[^/]*$/, '')}/data/aliquotas.json`,
    '/data/aliquotas.json'
  ];
  for (const url of candidates){
    try {
      const resp = await fetch(url, { cache:'no-store' });
      if (resp.ok) return await resp.json();
      console.warn('[IVA360] fetch falhou', url, resp.status);
    } catch(e){
      console.warn('[IVA360] erro fetch', url, e);
    }
  }
  throw new Error('aliquotas.json não encontrado');
}

function parseXMLText(txt){
  const p = new DOMParser();
  return p.parseFromString(txt, 'application/xml');
}

// Ignora namespace (usa localName / getElementsByTagNameNS)
function getTextNS(root, tag){
  const el = root.getElementsByTagNameNS('*', tag)[0];
  return el ? el.textContent.trim() : null;
}

function parseNFe(doc){
  const root = doc; // buscar no documento inteiro
  const tipo   = 'NF-e';
  const numero = getTextNS(root, 'nNF');
  const data   = (getTextNS(root, 'dhEmi') || getTextNS(root, 'dEmi') || '').slice(0,10);
  const uf     = getTextNS(root, 'UF');
  const vProd  = parseFloat(getTextNS(root, 'vProd') || '0');
  const vNF    = parseFloat(getTextNS(root, 'vNF')   || '0');

  // Totais/declarados (usamos nós de total se existirem)
  const vPIS = parseFloat(getTextNS(root, 'vPIS')    || '0');
  const vCOF = parseFloat(getTextNS(root, 'vCOFINS') || '0');

  return { tipo, numero, data, uf, vProd, vNF, declared: { vPIS, vCOF } };
}

function parseCTe(doc){
  const root   = doc;
  const tipo   = 'CT-e';
  const numero = getTextNS(root, 'nCT');
  const data   = (getTextNS(root, 'dhEmi') || '').slice(0,10);
  const uf     = getTextNS(root, 'UF');
  const vPrest = parseFloat(getTextNS(root, 'vTPrest') || '0');
  return { tipo, numero, data, uf, vProd:vPrest, vNF:vPrest, declared:{} };
}

function validDate(iso){
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime());
}

function within(date, a, b){
  if(!validDate(date)) return false;
  const d = new Date(date);
  const start = new Date(a);
  const end   = b ? new Date(b) : new Date('9999-12-31');
  return d >= start && d <= end;
}

function pickRate(rates, date){
  if(!rates) return null;
  for(const r of rates){
    if(within(date, r.vigencia_inicio, r.vigencia_fim || null)) return r.percentual;
  }
  return null;
}

export async function auditFiles(files){
  const aliq = await loadAliquotas();
  let total=0, ok=0, risk=0, atRiskValue=0;
  const details=[];

  for(const f of files){
    const txt = await f.text();
    const xml = parseXMLText(txt);

    const rootLocal = (xml.documentElement && xml.documentElement.localName || '').toLowerCase();
    let parsed;
    if (rootLocal.includes('cte')) parsed = parseCTe(xml);
    else                           parsed = parseNFe(xml);

    const date = parsed.data || '—';
    const uf   = parsed.uf   || '—';
    const base = parsed.vProd || parsed.vNF || 0;

    // Alíquotas esperadas
    const pisRate  = pickRate(aliq.PIS, date);
    const cofRate  = pickRate(aliq.COFINS, date);
    const cbsRate  = pickRate(aliq.CBS, date);
    const icmsRate = (aliq.ICMS && aliq.ICMS[uf]) ? pickRate(aliq.ICMS[uf], date) : null;
    const ibsRate  = pickRate(aliq.IBS, date);

    // Declarados
    const vPISd = parsed.declared.vPIS || 0;
    const vCOFd = parsed.declared.vCOF || 0;

    // Esperados
    const vPISexp  = pisRate  ? base * (pisRate/100)  : 0;
    const vCOFexp  = cofRate  ? base * (cofRate/100)  : 0;
    const vCBSexp  = cbsRate  ? base * (cbsRate/100)  : 0;
    const vICMSexp = icmsRate ? base * (icmsRate/100) : 0;
    const vIBSexp  = ibsRate  ? base * (ibsRate/100)  : 0;

    let issue=null, declared='—', correct='—', howto='—', exposure=0;

    if(vPISd>0 && pisRate!==null){
      const diff = Math.abs(vPISd - vPISexp);
      if(diff > Math.max(0.5, vPISexp*0.05)){
        issue='PIS divergente';
        declared = vPISd.toFixed(2);
        correct  = vPISexp.toFixed(2);
        howto    = `Aplicar PIS ${pisRate.toFixed(2)}% sobre base ${base.toFixed(2)}`;
        exposure+= Math.abs(vPISexp-vPISd);
      }
    }

    if(vCOFd>0 && cofRate!==null){
      const diff = Math.abs(vCOFd - vCOFexp);
      if(diff > Math.max(0.5, vCOFexp*0.05)){
        issue = issue ? (issue+' + COFINS divergente') : 'COFINS divergente';
        declared = (declared==='—'?'':declared+' | ')+vCOFd.toFixed(2);
        correct  = (correct==='—'?'':correct+' | ')+vCOFexp.toFixed(2);
        howto    = (howto==='—'?'':howto+' | ')+`Aplicar COFINS ${cofRate.toFixed(2)}% sobre base ${base.toFixed(2)}`;
        exposure+= Math.abs(vCOFexp-vCOFd);
      }
    }

    if(!issue && (cbsRate || ibsRate)){
      issue   = 'Revisar transição CBS/IBS';
      declared= '—';
      correct = `CBS~${(vCBSexp||0).toFixed(2)} | IBS~${(vIBSexp||0).toFixed(2)}`;
      howto   = `Verificar regras na data ${date}`;
    }

    details.push({
      docNumber: parsed.numero, type: parsed.tipo, date, uf,
      total: base,
      issue: issue ? `<span class="badge warn">${issue}</span>` : `<span class="badge ok">OK</span>`,
      declared, correct, howto
    });

    total++; if(issue){ risk++; atRiskValue+=exposure; } else { ok++; }
  }

  return { summary: { total, ok, risk, atRiskValue: Math.round(atRiskValue*100)/100 }, details };
}
