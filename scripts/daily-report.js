/**
 * daily-report.js -- Daily email report via Resend
 * Runs at midnight UTC. Reports on YESTERDAY (the day that just ended).
 * Uses raw URL construction for PostgREST -- no URLSearchParams.
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;
const REPORT_TO_EMAIL      = process.env.REPORT_TO_EMAIL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY || !REPORT_TO_EMAIL) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

function getDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function fmt(n) { return Number(n).toFixed(2); }

function formatAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return '--';
  return Object.entries(attrs).map(([k, v]) => k + ': ' + v).join(', ');
}

const HEADERS = {
  'apikey':        SUPABASE_SERVICE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Accept':        'application/json',
};

async function fetchForDate(table, select, dateCol, dateVal) {
  // Build URL manually -- PostgREST requires literal dots in eq.VALUE
  // URLSearchParams would encode the dot breaking the filter
  const url = SUPABASE_URL + '/rest/v1/' + table
    + '?select=' + select
    + '&' + dateCol + '=eq.' + dateVal;
  console.log('  GET ' + table + ' where ' + dateCol + '=' + dateVal);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const txt = await res.text();
    console.error('  HTTP ' + res.status + ': ' + txt);
    return [];
  }
  const data = await res.json();
  console.log('  -> ' + data.length + ' rows');
  return data;
}

async function getReportData(date) {
  const salesSel     = 'id,quantity,sell_price,sold_at,variants!inner(id,attributes,products!inner(id,name))';
  const purchasesSel = 'id,quantity,cost_price,purchased_at,variants!inner(id,attributes,products!inner(id,name))';
  const refundsSel   = 'id,quantity,refund_price,reason,refunded_at,variants!inner(id,attributes,products!inner(id,name))';
  const [sales, purchases, refunds] = await Promise.all([
    fetchForDate('sale_records',     salesSel,     'sold_at',      date),
    fetchForDate('purchase_batches', purchasesSel, 'purchased_at', date),
    fetchForDate('refunds',          refundsSel,   'refunded_at',  date).catch(() => []),
  ]);
  return { sales, purchases, refunds };
}

function buildEmailHTML(date, sales, purchases, refunds) {
  const rev  = sales.reduce((s,r) => s + Number(r.quantity)*Number(r.sell_price), 0);
  const cost = purchases.reduce((s,r) => s + Number(r.quantity)*Number(r.cost_price), 0);
  const ref  = refunds.reduce((s,r) => s + Number(r.quantity)*Number(r.refund_price), 0);
  const net  = rev - cost - ref;
  const nc   = net >= 0 ? '#16a34a' : '#dc2626';
  const ns   = net >= 0 ? '+' : '';

  const th = 'padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;background:#f8fafc;';
  const td = 'padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;';
  const none = '<tr><td colspan="5" style="' + td + 'color:#64748b;font-style:italic;">No records for this date</td></tr>';

  function rows(arr, fn) {
    if (!arr.length) return none;
    return arr.map(r => '<tr>' + fn(r).map(c => '<td style="' + td + '">' + c + '</td>').join('') + '</tr>').join('');
  }
  function tbl(head, body) {
    return '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:20px;font-size:0.875rem;">'
      + '<thead><tr>' + head.map(h => '<th style="' + th + '">' + h + '</th>').join('') + '</tr></thead>'
      + '<tbody>' + body + '</tbody></table>';
  }

  const sRows = rows(sales,     r => [r.variants&&r.variants.products?r.variants.products.name:'--', formatAttrs(r.variants&&r.variants.attributes), r.quantity, fmt(Number(r.sell_price)), fmt(Number(r.quantity)*Number(r.sell_price))]);
  const pRows = rows(purchases, r => [r.variants&&r.variants.products?r.variants.products.name:'--', formatAttrs(r.variants&&r.variants.attributes), r.quantity, fmt(Number(r.cost_price)), fmt(Number(r.quantity)*Number(r.cost_price))]);
  const rRows = rows(refunds,   r => [r.variants&&r.variants.products?r.variants.products.name:'--', formatAttrs(r.variants&&r.variants.attributes), r.quantity, fmt(Number(r.refund_price)), r.reason||'--']);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report ' + date + '</title></head>'
    + '<body style="margin:0;padding:0;background:#f8fafc;font-family:sans-serif;">'
    + '<div style="max-width:680px;margin:0 auto;padding:24px 16px;">'
    + '<div style="background:#1e293b;border-radius:8px 8px 0 0;padding:20px 24px;">'
    + '<h1 style="margin:0;color:#fff;font-size:1.2rem;">StockAdmin Daily Report</h1>'
    + '<p style="margin:4px 0 0;color:#94a3b8;font-size:0.875rem;">' + date + '</p></div>'
    + '<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:20px 24px;">'
    + '<table width="100%" cellpadding="8" cellspacing="4" style="margin-bottom:24px;"><tr>'
    + '<td style="padding:12px;background:#f0fdf4;border-radius:6px;text-align:center;"><div style="font-size:0.7rem;text-transform:uppercase;color:#16a34a;">Revenue</div><div style="font-size:1.3rem;font-weight:700;color:#16a34a;">' + fmt(rev) + '</div></td>'
    + '<td style="padding:12px;background:#eff6ff;border-radius:6px;text-align:center;"><div style="font-size:0.7rem;text-transform:uppercase;color:#2563eb;">Purchases</div><div style="font-size:1.3rem;font-weight:700;color:#2563eb;">' + fmt(cost) + '</div></td>'
    + '<td style="padding:12px;background:#fef2f2;border-radius:6px;text-align:center;"><div style="font-size:0.7rem;text-transform:uppercase;color:#dc2626;">Refunds</div><div style="font-size:1.3rem;font-weight:700;color:#dc2626;">' + fmt(ref) + '</div></td>'
    + '<td style="padding:12px;border:2px solid ' + nc + ';border-radius:6px;text-align:center;"><div style="font-size:0.7rem;text-transform:uppercase;color:' + nc + ';">Net</div><div style="font-size:1.3rem;font-weight:700;color:' + nc + ';">' + ns + fmt(net) + '</div></td>'
    + '</tr></table>'
    + '<h3 style="margin:0 0 8px;font-size:0.95rem;color:#1e293b;">Sales (' + sales.length + ')</h3>'
    + tbl(['Product','Variant','Qty','Price','Total'], sRows)
    + '<h3 style="margin:0 0 8px;font-size:0.95rem;color:#1e293b;">Purchases (' + purchases.length + ')</h3>'
    + tbl(['Product','Variant','Qty','Cost','Total'], pRows)
    + (refunds.length > 0 ? '<h3 style="margin:0 0 8px;font-size:0.95rem;color:#1e293b;">Refunds (' + refunds.length + ')</h3>' + tbl(['Product','Variant','Qty','Price','Reason'], rRows) : '')
    + '</div>'
    + '<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:12px 24px;text-align:center;">'
    + '<p style="margin:0 0 4px;font-size:0.78rem;color:#94a3b8;">Automated daily report -- StockAdmin</p>'
    + '<p style="margin:0;font-size:0.78rem;color:#94a3b8;">For PDF: open the app, go to Reports, select the date, click Download PDF.</p>'
    + '</div></div></body></html>';
}

async function sendEmail(date, html, salesCount) {
  const subject = 'StockAdmin Daily Report -- ' + date + (salesCount > 0 ? ' (' + salesCount + ' sale' + (salesCount > 1 ? 's' : '') + ')' : ' (no sales)');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'StockAdmin <onboarding@resend.dev>', to: [REPORT_TO_EMAIL], subject, html }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error('Resend error: ' + JSON.stringify(body));
  return body;
}

async function main() {
  const date = getDate(-1);
  console.log('=== Daily Report for ' + date + ' ===');
  const { sales, purchases, refunds } = await getReportData(date);
  console.log('Sales: ' + sales.length + '  Purchases: ' + purchases.length + '  Refunds: ' + refunds.length);
  const html   = buildEmailHTML(date, sales, purchases, refunds);
  const result = await sendEmail(date, html, sales.length);
  console.log('Email sent: ' + result.id);
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });