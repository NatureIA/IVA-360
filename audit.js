// Simple XML NF-e/CT-e auditor (client-side).
// This is a functional demo: it parses XMLs, extracts fields, compares declared taxes vs historical rates.

async function loadAliquotas(){
  const resp = await fetch('./data/aliquotas.json');
  return resp.json();
}

function parseXMLText(txt){
  const p = new DOMParser();
  return p.parseFromString(txt, 'application/xml');
}

function getText(x, path){
  const el = x.querySelector(path);
  return el ? el.textContent.trim() : null;
}

function parseNFe(x){
  const tipo = 'NF-e';
  const numero = getText(x, 'ide > nNF') || getText(x,'infNFe > ide > nNF');
  const data = (getText(x, 'ide > dhEmi') || getText(x, 'ide > dEmi') || '').slice(0,10);
  const uf = getText(x, 'emit > enderEmit > UF');
  const vProd = parseFloat(getText(x, 'total > ICMSTot > vProd') || '0');
  const vNF = parseFloat(getText(x, 'total > ICMSTot > vNF') || '0');

  // Declared PIS/COFINS if present
  const vPIS = parseFloat(getText(x, 'imposto > PIS > PISAliq > vPIS') || getText(x,'total > ICMSTot > vPIS') || '0');
  const vCOF = parseFloat(getText(x, 'imposto > COFINS > COFINSAliq > vCOFINS') || getText(x,'total > ICMSTot > vCOFINS') || '0');

  return { tipo, numero, data, uf, vProd, vNF, declared: { vPIS, vCOF } };
}

function parseCTe(x){
  const tipo = 'CT-e';
  const numero = getText(x, 'ide > nCT');
  const data = (getText(x, 'ide > dhEmi') || '').slice(0,10);
  const uf = getText(x, 'emit > enderEmit > UF');
  const vPrest = parseFloat(getText(x, 'vPrest > vTPrest') || '0');
  return { tipo, numero, data, uf, vProd: vPrest, vNF: vPrest, declared: {} };
}

function within(date, a, b){
  const d = new Date(date);
  return d >= new Date(a) && (b === null || d <= new Date(b));
}

function pickRate(rates, date){
  // rates: [ {percentual, vigencia_inicio, vigencia_fim} ]
  if(!rates) return null;
  for(const r of rates){
    if(within(date, r.vigencia_inicio, r.vigencia_fim === null ? null : r.vigencia_fim)) return r.percentual;
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

    // Detect NF-e vs CT-e by root
    const rootName = xml.documentElement.nodeName;
    let parsed;
    if(/cteProc|CTe|infCte/.test(rootName)) parsed = parseCTe(xml);
    else parsed = parseNFe(xml);

    const date = parsed.data || '—';
    const uf = parsed.uf || '—';
    const base = parsed.vProd || parsed.vNF || 0;

    // Expected rates
    const pisRate = pickRate(aliq.PIS, date);
    const cofRate = pickRate(aliq.COFINS, date);
    const cbsRate = pickRate(aliq.CBS, date);
    const icmsRate = (aliq.ICMS[uf] ? pickRate(aliq.ICMS[uf], date) : null);
    const ibsRate = pickRate(aliq.IBS, date);

    // Declared
    const vPISd = parsed.declared.vPIS || 0;
    const vCOFd = parsed.declared.vCOF || 0;

    // Compute expected where applicable
    const vPISexp = pisRate ? base * (pisRate/100) : 0;
    const vCOFexp = cofRate ? base * (cofRate/100) : 0;
    const vCBSexp = cbsRate ? base * (cbsRate/100) : 0;
    const vICMSexp = icmsRate ? base * (icmsRate/100) : 0;
    const vIBSexp = ibsRate ? base * (ibsRate/100) : 0;

    // Simple rule: if vPIS declared exists, compare to expected; same for COFINS.
    let issue=null, declared='—', correct='—', howto='—', exposure=0;

    if(vPISd>0 && pisRate!==null){
      const diff = Math.abs(vPISd - vPISexp);
      if(diff > Math.max(0.5, vPISexp*0.05)){ // tolerance
        issue = 'PIS divergente';
        declared = vPISd.toFixed(2);
        correct = vPISexp.toFixed(2);
        howto = `Aplicar PIS ${pisRate.toFixed(2)}% sobre base aprox. ${base.toFixed(2)}`;
        exposure += Math.abs(vPISexp - vPISd);
      }
    }

    if(vCOFd>0 && cofRate!==null){
      const diff = Math.abs(vCOFd - vCOFexp);
      if(diff > Math.max(0.5, vCOFexp*0.05)){
        issue = issue ? (issue + ' + COFINS divergente') : 'COFINS divergente';
        declared = (declared==='—'?'':declared+' | ') + vCOFd.toFixed(2);
        correct = (correct==='—'?'':correct+' | ') + vCOFexp.toFixed(2);
        howto = (howto==='—'?'':howto+' | ') + `Aplicar COFINS ${cofRate.toFixed(2)}% sobre base aprox. ${base.toFixed(2)}`;
        exposure += Math.abs(vCOFexp - vCOFd);
      }
    }

    // If date >= 2026, we expect CBS/IBS values to appear in documento novo (quando aplicável). Demo: apenas sinaliza esperado.
    if(!issue && (cbsRate || ibsRate)){
      issue = 'Revisar transição CBS/IBS';
      declared = '—';
      correct = `CBS~${(vCBSexp||0).toFixed(2)} | IBS~${(vIBSexp||0).toFixed(2)}`;
      howto = `Verificar regras de transição na data ${date}`;
    }

    const row = {
      docNumber: parsed.numero,
      type: parsed.tipo,
      date, uf,
      total: base,
      issue: issue ? `<span class="badge warn">${issue}</span>` : `<span class="badge ok">OK</span>`,
      declared,
      correct,
      howto
    };

    total++;
    if(issue){ risk++; atRiskValue += exposure; } else { ok++; }
    details.push(row);
  }

  return {
    summary: { total, ok, risk, atRiskValue: Math.round(atRiskValue*100)/100 },
    details
  };
}