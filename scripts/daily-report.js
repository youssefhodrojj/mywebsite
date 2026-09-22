// v7 - includes expenses in summary, PDF and HTML
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REPORT_TO_EMAIL = process.env.REPORT_TO_EMAIL;

if (!SUPABASE_URL||!SUPABASE_SERVICE_KEY||!RESEND_API_KEY||!REPORT_TO_EMAIL){
  console.error('Missing env vars'); process.exit(1);
}

function getYesterday(){
  const d=new Date(); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10);
}
function fmt(n){ return Number(n).toFixed(2); }
function attrs(a){ if(!a||typeof a!=='object') return '--'; return Object.entries(a).map(([k,v])=>k+': '+v).join(', '); }
function pname(r){ return r.variants&&r.variants.products?r.variants.products.name:'--'; }
function pattr(r){ return attrs(r.variants&&r.variants.attributes); }

const H={
  'apikey':SUPABASE_SERVICE_KEY,
  'Authorization':'Bearer '+SUPABASE_SERVICE_KEY,
  'Accept':'application/json',
  'Prefer':'count=none'
};

async function fetch4date(tbl,sel,col,val){
  const url=SUPABASE_URL+'/rest/v1/'+tbl+'?select='+encodeURIComponent(sel)+'&'+col+'=eq.'+val;
  const r=await fetch(url,{headers:H});
  if(!r.ok){console.error('ERR '+tbl+': '+r.status); return [];}
  const d=await r.json();
  console.log('  '+tbl+' where '+col+'='+val+' -> '+d.length+' rows');
  return d;
}

async function getData(date){
  const ss='id,variant_id,quantity,sell_price,sold_at,variants!inner(id,attributes,products!inner(id,name))';
  const ps='id,quantity,cost_price,purchased_at,variants!inner(id,attributes,products!inner(id,name))';
  const rs='id,variant_id,quantity,refund_price,reason,refunded_at,variants!inner(id,attributes,products!inner(id,name))';
  const es='id,amount,note,expense_date,expense_labels(id,name)';
  const[sales,purchases,refunds,expenses]=await Promise.all([
    fetch4date('sale_records',ss,'sold_at',date),
    fetch4date('purchase_batches',ps,'purchased_at',date),
    fetch4date('refunds',rs,'refunded_at',date).catch(()=>[]),
    fetch4date('expenses',es,'expense_date',date).catch(()=>[]),
  ]);
  return{sales,purchases,refunds,expenses};
}

// ---------------------------------------------------------------------------
// Build a minimal valid PDF as a Buffer (no npm required)
// ---------------------------------------------------------------------------
function buildPDF(date,sales,purchases,refunds,expenses){
  const rev  = sales.reduce((s,r)=>s+Number(r.quantity)*Number(r.sell_price),0);
  const cost = purchases.reduce((s,r)=>s+Number(r.quantity)*Number(r.cost_price),0);
  const ref  = refunds.reduce((s,r)=>s+Number(r.quantity)*Number(r.refund_price),0);
  const exp  = expenses.reduce((s,r)=>s+Number(r.amount),0);
  const net  = rev - cost - ref - exp;

  const lines=[];
  const line=(t='')=>lines.push(t);
  line('StockAdmin Daily Report');
  line('Date: '+date);
  line('');
  line('SUMMARY');
  line('  Revenue:   '+fmt(rev));
  line('  Purchases: '+fmt(cost));
  line('  Refunds:   '+fmt(ref));
  line('  Expenses:  '+fmt(exp));
  line('  Net:       '+(net>=0?'+':'')+fmt(net));
  line('');
  line('SALES ('+sales.length+')');
  if(!sales.length){ line('  No records'); }
  else {
    line('  Product                  Variant              Qty  Price    Total');
    line('  '+'-'.repeat(68));
    for(const r of sales){
      const p=(pname(r)+'                        ').slice(0,24);
      const v=(pattr(r)+'                    ').slice(0,20);
      const q=String(r.quantity).padStart(3);
      const pr=fmt(Number(r.sell_price)).padStart(8);
      const tot=fmt(Number(r.quantity)*Number(r.sell_price)).padStart(9);
      line('  '+p+' '+v+' '+q+pr+tot);
    }
  }
  line('');
  line('PURCHASES ('+purchases.length+')');
  if(!purchases.length){ line('  No records'); }
  else {
    line('  Product                  Variant              Qty  Cost     Total');
    line('  '+'-'.repeat(68));
    for(const r of purchases){
      const p=(pname(r)+'                        ').slice(0,24);
      const v=(pattr(r)+'                    ').slice(0,20);
      const q=String(r.quantity).padStart(3);
      const pr=fmt(Number(r.cost_price)).padStart(8);
      const tot=fmt(Number(r.quantity)*Number(r.cost_price)).padStart(9);
      line('  '+p+' '+v+' '+q+pr+tot);
    }
  }
  if(refunds.length){
    line('');
    line('REFUNDS ('+refunds.length+')');
    line('  Product                  Variant              Qty  Price    Reason');
    line('  '+'-'.repeat(68));
    for(const r of refunds){
      const p=(pname(r)+'                        ').slice(0,24);
      const v=(pattr(r)+'                    ').slice(0,20);
      const q=String(r.quantity).padStart(3);
      const pr=fmt(Number(r.refund_price)).padStart(8);
      const reason=(r.reason||'--').slice(0,15);
      line('  '+p+' '+v+' '+q+pr+'  '+reason);
    }
  }
  if(expenses.length){
    line('');
    line('EXPENSES ('+expenses.length+')');
    line('  Label                    Note                 Amount');
    line('  '+'-'.repeat(68));
    for(const r of expenses){
      const lbl=((r.expense_labels&&r.expense_labels.name)||'--')+'                        ';
      const note=(r.note||'--')+'                    ';
      const amt=fmt(Number(r.amount)).padStart(9);
      line('  '+lbl.slice(0,24)+' '+note.slice(0,20)+' '+amt);
    }
    line('  Total expenses: '+fmt(exp));
  }
  line('');
  line('Generated by StockAdmin');

  // PDF objects
  const objs=[];
  let pdf='%PDF-1.4\n';
  const obj=(content)=>{ objs.push({offset:0,content}); };

  obj('<< /Type /Catalog /Pages 2 0 R >>');
  obj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');

  const fontSize=10;
  const lineH=14;
  const startY=780;
  let streamParts=['BT','/F1 '+fontSize+' Tf'];
  for(let i=0;i<lines.length;i++){
    const y=startY-(i*lineH);
    if(y<40) break;
    const safe=lines[i].replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
    streamParts.push('40 '+y+' Td');
    streamParts.push('('+safe+') Tj');
    if(i<lines.length-1) streamParts.push('-40 0 Td');
  }
  streamParts.push('ET');
  const stream=streamParts.join('\n');

  obj('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  obj('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
  obj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  for(let i=0;i<objs.length;i++){
    objs[i].offset=pdf.length;
    pdf+=(i+1)+' 0 obj\n'+objs[i].content+'\nendobj\n';
  }
  const xrefOffset=pdf.length;
  pdf+='xref\n0 '+(objs.length+1)+'\n';
  pdf+='0000000000 65535 f \n';
  for(const o of objs){
    pdf+=String(o.offset).padStart(10,'0')+' 00000 n \n';
  }
  pdf+='trailer\n<< /Size '+(objs.length+1)+' /Root 1 0 R >>\n';
  pdf+='startxref\n'+xrefOffset+'\n%%EOF';

  return Buffer.from(pdf,'latin1').toString('base64');
}

// ---------------------------------------------------------------------------
// HTML email body
// ---------------------------------------------------------------------------
function buildHTML(date,sales,purchases,refunds,expenses){
  const rev  = sales.reduce((s,r)=>s+Number(r.quantity)*Number(r.sell_price),0);
  const cost = purchases.reduce((s,r)=>s+Number(r.quantity)*Number(r.cost_price),0);
  const ref  = refunds.reduce((s,r)=>s+Number(r.quantity)*Number(r.refund_price),0);
  const exp  = expenses.reduce((s,r)=>s+Number(r.amount),0);
  const net  = rev - cost - ref - exp;
  const nc=net>=0?'#16a34a':'#dc2626';
  const ns=net>=0?'+':'';
  const th='padding:6px 10px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;background:#f8fafc;';
  const td='padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;';
  const none='<tr><td colspan="5" style="'+td+'color:#999;font-style:italic;">No records</td></tr>';
  function rows(arr,fn){ if(!arr.length) return none; return arr.map(r=>'<tr>'+fn(r).map(c=>'<td style="'+td+'">'+c+'</td>').join('')+'</tr>').join(''); }
  function tbl(cols,body){ return '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:16px;"><thead><tr>'+cols.map(c=>'<th style="'+th+'">'+c+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>'; }

  const sRows=rows(sales,r=>[pname(r),pattr(r),r.quantity,fmt(Number(r.sell_price)),'<b>'+fmt(Number(r.quantity)*Number(r.sell_price))+'</b>']);
  const pRows=rows(purchases,r=>[pname(r),pattr(r),r.quantity,fmt(Number(r.cost_price)),'<b>'+fmt(Number(r.quantity)*Number(r.cost_price))+'</b>']);
  const rRows=rows(refunds,r=>[pname(r),pattr(r),r.quantity,fmt(Number(r.refund_price)),r.reason||'--']);
  const eRows=expenses.length
    ? expenses.map(r=>'<tr>'
        +'<td style="'+td+'">'+(r.expense_labels&&r.expense_labels.name?r.expense_labels.name:'--')+'</td>'
        +'<td style="'+td+'">'+(r.note||'--')+'</td>'
        +'<td style="'+td+';color:#dc2626;font-weight:600;">'+fmt(Number(r.amount))+'</td>'
        +'</tr>').join('')
        +'<tr><td colspan="2" style="'+td+';text-align:right;font-weight:700;">Total</td>'
        +'<td style="'+td+';color:#dc2626;font-weight:700;">'+fmt(exp)+'</td></tr>'
    : '<tr><td colspan="3" style="'+td+'color:#999;font-style:italic;">No expenses</td></tr>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:sans-serif;">'
    +'<div style="max-width:640px;margin:0 auto;padding:20px;">'
    +'<div style="background:#1e293b;border-radius:8px 8px 0 0;padding:16px 20px;"><h1 style="margin:0;color:#fff;font-size:18px;">StockAdmin Daily Report</h1><p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">'+date+' (PDF attached)</p></div>'
    +'<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:16px 20px;">'
    +'<table width="100%" cellpadding="8" cellspacing="4" style="margin-bottom:20px;"><tr>'
    +'<td style="padding:10px;background:#f0fdf4;border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:#16a34a;">Revenue</div><div style="font-size:20px;font-weight:700;color:#16a34a;">'+fmt(rev)+'</div></td>'
    +'<td style="padding:10px;background:#eff6ff;border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:#2563eb;">Purchases</div><div style="font-size:20px;font-weight:700;color:#2563eb;">'+fmt(cost)+'</div></td>'
    +'<td style="padding:10px;background:#fef2f2;border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:#dc2626;">Refunds</div><div style="font-size:20px;font-weight:700;color:#dc2626;">'+fmt(ref)+'</div></td>'
    +(exp>0?'<td style="padding:10px;background:#fffbeb;border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:#d97706;">Expenses</div><div style="font-size:20px;font-weight:700;color:#d97706;">'+fmt(exp)+'</div></td>':'')
    +'<td style="padding:10px;border:2px solid '+nc+';border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:'+nc+';">Net</div><div style="font-size:20px;font-weight:700;color:'+nc+';">'+ns+fmt(net)+'</div></td>'
    +'</tr></table>'
    +'<h3 style="margin:0 0 6px;font-size:14px;color:#1e293b;">Sales ('+sales.length+')</h3>'+tbl(['Product','Variant','Qty','Price','Total'],sRows)
    +'<h3 style="margin:0 0 6px;font-size:14px;color:#1e293b;">Purchases ('+purchases.length+')</h3>'+tbl(['Product','Variant','Qty','Cost','Total'],pRows)
    +(refunds.length?'<h3 style="margin:0 0 6px;font-size:14px;color:#1e293b;">Refunds ('+refunds.length+')</h3>'+tbl(['Product','Variant','Qty','Price','Reason'],rRows):'')
    +'<h3 style="margin:0 0 6px;font-size:14px;color:#1e293b;">Expenses ('+expenses.length+')</h3>'
    +'<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:16px;"><thead><tr>'
    +'<th style="'+th+'">Label</th><th style="'+th+'">Note</th><th style="'+th+'">Amount</th>'
    +'</tr></thead><tbody>'+eRows+'</tbody></table>'
    +'</div>'
    +'<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:10px 20px;text-align:center;">'
    +'<p style="margin:0;font-size:11px;color:#94a3b8;">Auto-generated by StockAdmin. PDF attached to this email.</p>'
    +'</div></div></body></html>';
}

// ---------------------------------------------------------------------------
// Send via Resend
// ---------------------------------------------------------------------------
async function sendEmail(date,html,pdfBase64,salesCount){
  const subj='StockAdmin '+date+(salesCount?' ('+salesCount+' sale'+(salesCount>1?'s':'')+')':' (no sales)');
  const payload={
    from:'StockAdmin <onboarding@resend.dev>',
    to:[REPORT_TO_EMAIL],
    subject:subj,
    html,
    attachments:[{
      filename:'stockadmin-report-'+date+'.pdf',
      content:pdfBase64,
    }]
  };
  const r=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':'Bearer '+RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const b=await r.json();
  if(!r.ok) throw new Error('Resend: '+JSON.stringify(b));
  return b;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(){
  const date=getYesterday();
  console.log('=== StockAdmin Daily Report for '+date+' ===');
  const{sales,purchases,refunds,expenses}=await getData(date);
  const rev =sales.reduce((s,r)=>s+Number(r.quantity)*Number(r.sell_price),0);
  const cost=purchases.reduce((s,r)=>s+Number(r.quantity)*Number(r.cost_price),0);
  const exp =expenses.reduce((s,r)=>s+Number(r.amount),0);
  console.log('Sales: '+sales.length+' (rev: '+fmt(rev)+')');
  console.log('Purchases: '+purchases.length+' (cost: '+fmt(cost)+')');
  console.log('Refunds: '+refunds.length);
  console.log('Expenses: '+expenses.length+' (total: '+fmt(exp)+')');
  const html=buildHTML(date,sales,purchases,refunds,expenses);
  const pdfB64=buildPDF(date,sales,purchases,refunds,expenses);
  console.log('PDF size: '+Math.round(pdfB64.length*3/4)+' bytes');
  const b=await sendEmail(date,html,pdfB64,sales.length);
  console.log('Sent: '+b.id);
}

main().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
