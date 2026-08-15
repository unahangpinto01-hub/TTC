# Teamagro Trading Corp. — Business Management System (Prototype MVP)

Prototype web app for an agricultural chemical trading company: dealer e-commerce
portal, order-to-cash document flow (SO → DR → SR), inventory with stock cards,
delivery scheduling, finance (AR aging, payments, expenses, reports), lightweight HR,
in-app notifications, and a role-aware dashboard.

## Stack

Next.js 14 (App Router) · TypeScript · Prisma + SQLite · Tailwind CSS · Recharts · SheetJS

## Run locally

```bash
npm install
npx prisma db push   # creates prisma/dev.db
npm run seed         # loads demo data (100 products, 50 dealers, 40 SOs, …)
npm run dev          # http://localhost:3000
```

## Demo accounts (password: `password123`)

| Email | Role |
|---|---|
| superadmin@teamagro.ph | Super Admin (everything + void documents + users) |
| admin@teamagro.ph | Admin (approvals, inventory, finance, HR, reports) |
| clerk@teamagro.ph | Clerk (encode orders, SO/DR, view inventory) |
| dealer@sample.ph | Dealer (e-commerce portal only) |

## Demo script (acceptance flow)

1. Log in as **dealer** → add products to cart → checkout on 60-day terms.
2. Log in as **clerk** → Order Inbox → open the new order → *Convert to SO* →
   the short line is flagged red → adjust qty → *Confirm SO*.
3. Schedule the delivery for tomorrow (board shows n/5 capacity).
4. Generate the DR → print view shows the 3 signature blocks → *Mark as Delivered*
   → the product stock cards show OUT entries.
5. Log in as **admin** → *For Invoicing* queue → *Convert to SR* → due date is
   auto-computed (delivery date + term days).
6. Record a partial payment on the SR → AR Aging updates.
7. Dashboard reflects the sale; Reports → Sales Report → ⬇ Excel / 🖨 Print.

## Notes

- Document numbers are sequential per type per year (`SO-2026-00001`, …).
- Prices are VAT-inclusive; documents show the 12% VAT breakdown.
- Issued documents are **voided** (Super Admin, with reason), never deleted.
- Excel bulk import for products & customers: template download + per-row validation
  (Inventory → Bulk Import / Customers → Bulk Import).
