// v5 - service key bypass, raw URL, report yesterday
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REPORT_TO_EMAIL = process.env.REPORT_TO_EMAIL;

if (!SUPABASE_URL||!SUPABASE_SERVICE_KEY||!RESEND_API_KEY||!REPORT_TO_EMAIL){
  console.error('Missing env vars'); process.exit(1);
}

function getYesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0,10);
}

function fmt(n){ return Number(n).toFixed(2); }
function attrs(a){ if(!a||typeof a!=='object') return '--'; return Object.entries(a).map(([k,v])=>k+': '+v).join(', '); }

// Service key headers -- bypass-rls=true ensures RLS is skipped
const H = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': 'Bearer '+SUPABASE_SERVICE_KEY,
  'Accept': 'application/json',
  'Prefer': 'count=none'
};

async function fetch4date(tbl, sel, col, val) {
  const url = SUPABASE_URL+'/rest/v1/'+tbl+'?select='+sel+'&'+col+'=eq.'+val;
  console.log('  Fetching '+tbl+' where '+col+'='+val);
  const r = await fetch(url, {headers: H});
  const text = await r.text();
  console.log('  HTTP '+r.status+' -> '+text.substring(0,200));
  if(!r.ok){ console.error('  ERROR: '+text); return []; }
  try { const d=JSON.parse(text); console.log('  parsed: '+d.length+' rows'); return d; }
  catch(e){ console.error('  JSON parse error: '+e.message); return []; }
}

// Also test a simple query without joins to isolate the issue
async function testSimpleQuery(date) {
  const url = SUPABASE_URL+'/rest/v1/purchase_batches?select=id,purchased_at&purchased_at=eq.'+date;
  console.log('  SIMPLE TEST: '+url);
  const r = await fetch(url, {headers: H});
  const text = await r.text();
  console.log('  Simple result: HTTP '+r.status+' -> '+text.substring(0,300));
}

async function getData(date) {
  await testSimpleQuery(date);
  const ss='id,quantity,sell_price,sold_at,variants!inner(id,attributes,products!inner(id,name))';
  const ps='id,quantity,cost_price,purchased_at,variants!inner(id,attributes,products!inner(id,name))';
  const rs='id,quantity,refund_price,reason,refunded_at,variants!inner(id,attributes,products!inner(id,name))';
  const [sales,purchases,refunds] = await Promise.all([
    fetch4date('sale_records',ss,'sold_at',date),
    fetch4date('purchase_batches',ps,'purchased_at',date),
    fetch4date('refunds',rs,'refunded_at',date).catch(()=>[]),
  ]);
  return {sales,purchases,refunds};
}

function buildHTML(date,sales,purchases,refunds){
  const rev=sales.reduce((s,r)=>s+Number(r.quantity)*Number(r.sell_price),0);
  const cost=purchases.reduce((s,r)=>s+Number(r.quantity)*Number(r.cost_price),0);
  const ref=refunds.reduce((s,r)=>s+Number(r.quantity)*Number(r.refund_price),0);
  const net=rev-cost-ref;
  const nc=net>=0?'#16a34a':'#dc2626';
  const ns=net>=0?'+':'';
  const th='padding:6px 10px;text-align:left;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;background:#f8fafc;';
  const td='padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;';
  const none='<tr><td colspan="5" style="'+td+'color:#999;font-style:italic;">No records</td></tr>';
  function rows(arr,fn){ if(!arr.length) return none; return arr.map(r=>'<tr>'+fn(r).map(c=>'<td style="'+td+'">'+c+'</td>').join('')+'</tr>').join(''); }
  function tbl(cols,body){ return '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:16px;"><thead><tr>'+cols.map(c=>'<th style="'+th+'">'+c+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>'; }
  const sRows=rows(sales,r=>[r.variants&&r.variants.products?r.variants.products.name:'--',attrs(r.variants&&r.variants.attributes),r.quantity,fmt(Number(r.sell_price)),'<b>'+fmt(Number(r.quantity)*Number(r.sell_price))+'</b>']);
  const pRows=rows(purchases,r=>[r.variants&&r.variants.products?r.variants.products.name:'--',attrs(r.variants&&r.variants.attributes),r.quantity,fmt(Number(r.cost_price)),'<b>'+fmt(Number(r.quantity)*Number(r.cost_price))+'</b>']);
  const rRows=rows(refunds,r=>[r.variants&&r.variants.products?r.variants.products.name:'--',attrs(r.variants&&r.variants.attributes),r.quantity,fmt(Number(r.refund_price)),r.reason||'--']);
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:sans-serif;">'
    +'<div style="max-width:640px;margin:0 auto;padding:20px;">'
    +'<div style="background:#1e293b;border-radius:8px 8px 0 0;padding:16px 20px;"><h1 style="margin:0;color:#fff;font-size:18px;">StockAdmin Daily Report</h1><p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">'+date+'</p></div>'
    +'<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:16px 20px;">'
    +'<table width="100%" cellpadding="8" cellspacing="4" style="margin-bottom:20px;"><tr>'
    +'<td style="padding:10px;background:#f0fdf4;border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:#16a34a;">Revenue</div><div style="font-size:20px;font-weight:700;color:#16a34a;">'+fmt(rev)+'</div></td>'
    +'<td style="padding:10px;background:#eff6ff;border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:#2563eb;">Purchases</div><div style="font-size:20px;font-weight:700;color:#2563eb;">'+fmt(cost)+'</div></td>'
    +'<td style="padding:10px;background:#fef2f2;border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:#dc2626;">Refunds</div><div style="font-size:20px;font-weight:700;color:#dc2626;">'+fmt(ref)+'</div></td>'
    +'<td style="padding:10px;border:2px solid '+nc+';border-radius:6px;text-align:center;"><div style="font-size:10px;text-transform:uppercase;color:'+nc+';">Net</div><div style="font-size:20px;font-weight:700;color:'+nc+';">'+ns+fmt(net)+'</div></td>'
    +'</tr></table>'
    +'<h3 style="margin:0 0 6px;font-size:14px;color:#1e293b;">Sales ('+sales.length+')</h3>'
    +tbl(['Product','Variant','Qty','Price','Total'],sRows)
    +'<h3 style="margin:0 0 6px;font-size:14px;color:#1e293b;">Purchases ('+purchases.length+')</h3>'
    +tbl(['Product','Variant','Qty','Cost','Total'],pRows)
    +(refunds.length?'<h3 style="margin:0 0 6px;font-size:14px;color:#1e293b;">Refunds ('+refunds.length+')</h3>'+tbl(['Product','Variant','Qty','Price','Reason'],rRows):'')
    +'</div>'
    +'<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:10px 20px;text-align:center;">'
    +'<p style="margin:0;font-size:11px;color:#94a3b8;">Auto-generated by StockAdmin for '+date+'. For PDF: open app > Reports > select date > Download PDF.</p>'
    +'</div></div></body></html>';
}

async function main(){
  const date = getYesterday();
  console.log('=== StockAdmin Daily Report for '+date+' ===');
  console.log('URL: '+SUPABASE_URL);
  console.log('Key prefix: '+SUPABASE_SERVICE_KEY.substring(0,15)+'...');
  const {sales,purchases,refunds} = await getData(date);
  const rev=sales.reduce((s,r)=>s+Number(r.quantity)*Number(r.sell_price),0);
  const cost=purchases.reduce((s,r)=>s+Number(r.quantity)*Number(r.cost_price),0);
  console.log('Sales: '+sales.length+' (rev: '+fmt(rev)+')');
  console.log('Purchases: '+purchases.length+' (cost: '+fmt(cost)+')');
  console.log('Refunds: '+refunds.length);
  const html = buildHTML(date,sales,purchases,refunds);
  const subj = 'StockAdmin '+date+(sales.length?' ('+sales.length+' sales)':' (no sales)');
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':'Bearer '+RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:'StockAdmin <onboarding@resend.dev>',to:[REPORT_TO_EMAIL],subject:subj,html})
  });
  const b = await r.json();
  if(!r.ok) throw new Error('Resend: '+JSON.stringify(b));
  console.log('Sent: '+b.id);
}

main().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});