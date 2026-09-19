/**
 * backup.js -- Automated Supabase backup script
 * Runs in GitHub Actions. Uses the Supabase REST API directly.
 * Saves output to backups/YYYY-MM-DD.json
 */

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.');
  process.exit(1);
}

const fs   = require('fs');
const path = require('path');

/** Fetch all rows from a Supabase table using the REST API. */
async function fetchTable(tableName) {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*`;
  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'count=none',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch ${tableName}: ${res.status} ${body}`);
  }

  return res.json();
}

async function main() {
  console.log('Starting Supabase backup...');
  console.log(`URL: ${SUPABASE_URL}`);

  const tables = [
    'products',
    'variants',
    'purchase_batches',
    'sale_records',
    'stock_corrections',
    'refunds',
    'audit_log',
  ];

  const backup = {
    exported_at: new Date().toISOString(),
    tables: {},
  };

  for (const table of tables) {
    try {
      console.log(`  Fetching ${table}...`);
      backup.tables[table] = await fetchTable(table);
      console.log(`  ${table}: ${backup.tables[table].length} rows`);
    } catch (err) {
      // Non-fatal: log warning and continue (e.g. audit_log may not exist yet)
      console.warn(`  WARNING: Could not fetch ${table}: ${err.message}`);
      backup.tables[table] = [];
    }
  }

  // Save to backups/YYYY-MM-DD.json
  const date     = new Date().toISOString().slice(0, 10);
  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const outputPath = path.join(backupsDir, `${date}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`Backup saved to backups/${date}.json`);

  // Also update backups/latest.json for easy access
  const latestPath = path.join(backupsDir, 'latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log('Updated backups/latest.json');

  // Print summary
  const total = Object.values(backup.tables).reduce((s, rows) => s + rows.length, 0);
  console.log(`\nBackup complete: ${total} total rows across ${tables.length} tables.`);
}

main().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
