# Stock Management Admin Panel

A lightweight, single-page admin panel for managing product inventory. Track products and their variants, record purchase batches and sales, apply stock corrections, and visualise monthly trends with bar charts — all without a backend server.

---

## Features

- **Products & Variants** — create products with multiple variants described by arbitrary key-value attributes (e.g. size, colour)
- **Purchase Batches** — record stock-in events with quantity, cost price, and date
- **Sales Recording** — record stock-out events with quantity, sell price, and date; warns before stock goes negative
- **Stock Corrections** — apply positive or negative manual adjustments with an optional reason; warns before stock goes negative
- **Remaining Stock Summary** — filterable table showing live remaining stock per variant; low/zero-stock rows are highlighted
- **Monthly Charts** — side-by-side bar charts for units and monetary value, filterable by date range and product

---

## Tech Stack

- **Frontend**: plain HTML, CSS, JavaScript (ES modules — no build step required)
- **Hosting**: GitHub Pages (free, no server required)
- **Backend**: [Supabase](https://supabase.com) — PostgreSQL database, Supabase Auth, and Row Level Security

---

## Setup Guide

### 1. Create a Supabase project

1. Go to [https://supabase.com](https://supabase.com) and sign up for free.
2. Click **New project** and fill in the project name, database password, and region.
3. Wait about 2 minutes for the project to provision.

### 2. Set up the database

1. In the Supabase dashboard, open the **SQL Editor** (left sidebar).
2. Click **New query**.
3. Copy the entire contents of `supabase/schema.sql` from this repository and paste it into the editor.
4. Click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`).

This creates all five tables (`products`, `variants`, `purchase_batches`, `stock_corrections`, `sale_records`), enables Row Level Security on each, adds the required RLS policies, and creates the `monthly_purchase_summary` and `monthly_sales_summary` views used by the charts.

### 3. Create your admin user

1. In the Supabase dashboard, go to **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Enter your email address and a strong password.
4. Click **Create user**.

> You can add more users the same way if multiple people need access.

### 4. Configure the app

1. In the Supabase dashboard, go to **Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.  
   ⚠️ Do **not** copy the `service_role` key — that key bypasses RLS and must never go in frontend code.
3. Open `js/config.js` in this project and replace the placeholder values:

```js
export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

### 5. Deploy to GitHub Pages

1. Push this repository to GitHub (or fork it first).
2. Go to your repository's **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Select the `main` (or `master`) branch and the `/ (root)` folder.
5. Click **Save**.

GitHub will build and publish the site. After a minute or two it will be live at:

```
https://YOUR_USERNAME.github.io/REPO_NAME/
```

### 6. Log in

1. Open your GitHub Pages URL.
2. You will be redirected to the login screen automatically.
3. Enter the email and password you created in Step 3.

---

## Security Notes

- The Supabase anon key stored in `js/config.js` is safe to expose in public source code — it is the **public** key, equivalent to a read-only API token.
- Real security is enforced by **PostgreSQL Row Level Security** policies inside Supabase. Every query is scoped to the authenticated user's own data via `auth.uid()`.
- The login screen is a UX convenience; even if someone bypassed it in the browser, they would still be unable to read or write another user's data.
- Never put the `service_role` key anywhere in frontend code.

---

## Project Structure

```
├── index.html                  # App shell: navigation, all view containers, module entry point
├── css/
│   └── style.css               # All styles — layout, forms, tables, modals, toasts, low-stock row highlight
├── js/
│   ├── config.js               # Supabase project URL and anon key (fill these in — see Setup step 4)
│   ├── supabase.js             # Initialises and exports the Supabase client
│   ├── auth.js                 # login(), logout(), getSession(), onAuthStateChange()
│   ├── router.js               # Hash-based router, view switching, session guard
│   ├── db.js                   # All database access functions (products, variants, purchases, corrections, sales, charts)
│   ├── stock.js                # computeRemainingStock(purchases, sales, corrections) — pure function
│   ├── validation.js           # Input validation functions — pure, no side effects
│   ├── charts.js               # Chart.js bar chart rendering helpers
│   └── views/
│       ├── login.js            # Login form logic
│       ├── dashboard.js        # Dashboard / home view logic
│       ├── products.js         # Products & Variants view (list, add, edit, delete)
│       ├── purchases.js        # Purchase Batches view (form + history table)
│       ├── corrections.js      # Stock Corrections view (form + history table)
│       ├── sales.js            # Sales Recording view (form + history table)
│       └── stock-view.js       # Remaining Stock summary view (filterable table)
├── libs/
│   ├── supabase.min.js         # Bundled supabase-js (pinned CDN copy)
│   └── chart.min.js            # Chart.js (pinned CDN copy)
└── supabase/
    └── schema.sql              # All DDL, RLS policies, and views — run this in the Supabase SQL Editor
```
