/**
 * daily-report.js -- Daily email report via Resend
 * Runs in GitHub Actions at midnight.
 * Fetches yesterday's sales/purchases/refunds and sends a summary email.
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;
const REPORT_TO_EMAIL      = process.env.REPORT_TO_EMAIL; // your email address

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY || !REPORT_TO_EMAIL) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, REPORT_TO_EMAIL');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get yesterday's date as YYYY-MM-DD (UTC) */
function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Format a number to 2 decimal places */
function fmt(n) {
  return Number(n).toFixed(2);
}

/** Format attributes object as "key: value, ..." */
function formatAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return '--';
  return Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ');
}

/** Build auth headers for Supabase REST API */
function supabaseHeaders() {
  return {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
  };
}

/** Fetch rows from a Supabase table with optional filter string */
async function fetchRows(tableName, filterQuery = '') {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*${filterQuery ? '&' + filterQuery : ''}`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchRows(${tableName}): ${res.status} ${body}`);
  }
  return res.json();
}

/** Fetch with a joined select for denormalized data */
async function fetchJoined(tableName, select, filterQuery = '') {
  // Build URL -- note: select must NOT be encoded for PostgREST nested joins to work
  // Filter is appended as-is after the select parameter
  const baseUrl = `${SUPABASE_URL}/rest/v1/${tableName}`;
  const params = new URLSearchParams();
  params.set('select', select);
  // Parse filterQuery like "sold_at=eq.2026-09-17" into individual params
  if (filterQuery) {
    for (const part of filterQuery.split('&')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        params.set(part.slice(0, eqIdx), part.slice(eqIdx + 1));
      }
    }
  }
  const url = `${baseUrl}?${params.toString()}`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchJoined(${tableName}): ${res.status} ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getReportData(date) {
  const dateFilter = `date=${date}`;

  // Sales for the date -- join variants and products
  const salesSelect = 'id,quantity,sell_price,sold_at,variants!inner(id,attributes,products!inner(id,name))';
  const sales = await fetchJoined(
    'sale_records',
    salesSelect,
    `sold_at=eq.${date}`
  );

  // Purchases for the date
  const purchasesSelect = 'id,quantity,cost_price,purchased_at,variants!inner(id,attributes,products!inner(id,name))';
  const purchases = await fetchJoined(
    'purchase_batches',
    purchasesSelect,
    `purchased_at=eq.${date}`
  );

  // Refunds for the date
  const refundsSelect = 'id,quantity,refund_price,reason,refunded_at,variants!inner(id,attributes,products!inner(id,name))';
  let refunds = [];
  try {
    refunds = await fetchJoined('refunds', refundsSelect, `refunded_at=eq.${date}`);
  } catch {
    // refunds table may not exist yet
  }

  return { sales, purchases, refunds };
}

// ---------------------------------------------------------------------------
// HTML email builder
// ---------------------------------------------------------------------------

function buildEmailHTML(date, sales, purchases, refunds) {
  const totalRevenue  = sales.reduce((s, r)     => s + Number(r.quantity) * Number(r.sell_price),    0);
  const totalCost     = purchases.reduce((s, r)  => s + Number(r.quantity) * Number(r.cost_price),   0);
  const totalRefunds  = refunds.reduce((s, r)    => s + Number(r.quantity) * Number(r.refund_price),  0);
  const net           = totalRevenue - totalCost - totalRefunds;
  const netColor      = net >= 0 ? '#16a34a' : '#dc2626';
  const netSign       = net >= 0 ? '+' : '';

  // Helper to build a table section
  function tableRows(rows, cells) {
    if (!rows.length) return '<tr><td colspan="5" style="padding:8px;color:#64748b;font-style:italic;">No records</td></tr>';
    return rows.map(r => `<tr>${cells(r).map(c => `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${c}</td>`).join('')}</tr>`).join('');
  }

  const salesRows = tableRows(sales, r => [
    r.variants?.products?.name ?? '--',
    formatAttrs(r.variants?.attributes),
    r.quantity,
    fmt(Number(r.sell_price)),
    `<strong>${fmt(Number(r.quantity) * Number(r.sell_price))}</strong>`,
  ]);

  const purchaseRows = tableRows(purchases, r => [
    r.variants?.products?.name ?? '--',
    formatAttrs(r.variants?.attributes),
    r.quantity,
    fmt(Number(r.cost_price)),
    `<strong>${fmt(Number(r.quantity) * Number(r.cost_price))}</strong>`,
  ]);

  const refundRows = tableRows(refunds, r => [
    r.variants?.products?.name ?? '--',
    formatAttrs(r.variants?.attributes),
    r.quantity,
    fmt(Number(r.refund_price)),
    r.reason ?? '--',
  ]);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Report ${date}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="background:#1e293b;border-radius:8px 8px 0 0;padding:20px 24px;">
      <h1 style="margin:0;color:#fff;font-size:1.2rem;font-weight:700;">StockAdmin Daily Report</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:0.875rem;">${date}</p>
    </div>

    <!-- Summary cards -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="padding:12px;background:#f0fdf4;border-radius:6px;text-align:center;width:25%;">
            <div style="font-size:0.7rem;text-transform:uppercase;color:#16a34a;letter-spacing:.05em;">Revenue</div>
            <div style="font-size:1.4rem;font-weight:700;color:#16a34a;">${fmt(totalRevenue)}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:12px;background:#eff6ff;border-radius:6px;text-align:center;width:25%;">
            <div style="font-size:0.7rem;text-transform:uppercase;color:#2563eb;letter-spacing:.05em;">Purchases</div>
            <div style="font-size:1.4rem;font-weight:700;color:#2563eb;">${fmt(totalCost)}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:12px;background:#fef2f2;border-radius:6px;text-align:center;width:25%;">
            <div style="font-size:0.7rem;text-transform:uppercase;color:#dc2626;letter-spacing:.05em;">Refunds</div>
            <div style="font-size:1.4rem;font-weight:700;color:#dc2626;">${fmt(totalRefunds)}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:12px;background:#f8fafc;border:2px solid ${netColor};border-radius:6px;text-align:center;width:25%;">
            <div style="font-size:0.7rem;text-transform:uppercase;color:${netColor};letter-spacing:.05em;">Net</div>
            <div style="font-size:1.4rem;font-weight:700;color:${netColor};">${netSign}${fmt(net)}</div>
          </td>
        </tr>
      </table>

      <!-- Sales table -->
      <h3 style="margin:0 0 8px;font-size:0.95rem;color:#1e293b;">Sales (${sales.length})</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:20px;font-size:0.875rem;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Product</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Variant</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Qty</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Price</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Total</th>
          </tr>
        </thead>
        <tbody>${salesRows}</tbody>
      </table>

      <!-- Purchases table -->
      <h3 style="margin:0 0 8px;font-size:0.95rem;color:#1e293b;">Purchases (${purchases.length})</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:20px;font-size:0.875rem;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Product</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Variant</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Qty</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Cost</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Total</th>
          </tr>
        </thead>
        <tbody>${purchaseRows}</tbody>
      </table>

      <!-- Refunds table (only if any) -->
      ${refunds.length > 0 ? `
      <h3 style="margin:0 0 8px;font-size:0.95rem;color:#1e293b;">Refunds (${refunds.length})</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:20px;font-size:0.875rem;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Product</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Variant</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Qty</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Price</th>
            <th style="padding:6px 10px;text-align:left;font-size:0.75rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Reason</th>
          </tr>
        </thead>
        <tbody>${refundRows}</tbody>
      </table>` : ''}

    </div>

    <!-- Footer -->
    <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:12px 24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:0.78rem;color:#94a3b8;">This report was generated automatically by StockAdmin for ${date}.</p>
      <p style="margin:0;font-size:0.78rem;color:#94a3b8;">To download a PDF, open the app and go to Reports, select the date, and click Download PDF.</p>
    </div>

  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Send email via Resend
// ---------------------------------------------------------------------------

async function sendEmail(date, html) {
  const subject = sales_count => `StockAdmin Daily Report -- ${date}${sales_count > 0 ? ` (${sales_count} sales)` : ' (no sales)'}`;

  // Parse sales count from html for subject line
  const salesMatch = html.match(/Sales \((\d+)\)/);
  const salesCount = salesMatch ? parseInt(salesMatch[1]) : 0;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'StockAdmin <onboarding@resend.dev>',
      to:      [REPORT_TO_EMAIL],
      subject: subject(salesCount),
      html:    html,
    }),
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(`Resend API error: ${JSON.stringify(body)}`);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Report on today's date (UTC) -- the workflow runs at midnight so
  // "today" at midnight = the day that just ended
  const date = new Date().toISOString().slice(0, 10);
  console.log(`Generating daily report for ${date}...`);

  const { sales, purchases, refunds } = await getReportData(date);

  console.log(`  Sales: ${sales.length}`);
  console.log(`  Purchases: ${purchases.length}`);
  console.log(`  Refunds: ${refunds.length}`);

  if (sales.length === 0 && purchases.length === 0 && refunds.length === 0) {
    console.log('No activity yesterday. Sending empty report...');
  }

  const html   = buildEmailHTML(date, sales, purchases, refunds);
  const result = await sendEmail(date, html);

  console.log(`Email sent successfully. ID: ${result.id}`);
}

main().catch(err => {
  console.error('Daily report failed:', err.message);
  process.exit(1);
});
