/* Seed script: realistic demo data for Teamagro BMS.
   Run with: npm run seed  (drops & recreates all rows) */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Deterministic RNG so the demo dataset is stable
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260815);
const ri = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const round2 = (n: number) => Math.round(n * 100) / 100;

const NOW = new Date();
const YEAR = NOW.getFullYear();
function daysAgo(n: number) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ---- document numbering (local counters, persisted at the end) ----
const counters: Record<string, number> = { SO: 0, DR: 0, SR: 0, PO: 0 };
function docNo(type: "SO" | "DR" | "SR" | "PO") {
  counters[type] += 1;
  return `${type}-${YEAR}-${String(counters[type]).padStart(5, "0")}`;
}

async function main() {
  console.log("Clearing existing data…");
  // delete in FK-safe order
  await prisma.payment.deleteMany();
  await prisma.salesReceipt.deleteMany();
  await prisma.dRLine.deleteMany();
  await prisma.deliveryReceipt.deleteMany();
  await prisma.deliverySchedule.deleteMany();
  await prisma.salesOrderLine.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.incomingOrderLine.deleteMany();
  await prisma.incomingOrder.deleteMany();
  await prisma.pOLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.evaluation.deleteMany();
  await prisma.payrollEntry.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.user.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.documentCounter.deleteMany();

  const passwordHash = bcrypt.hashSync("password123", 10);

  // ---------- Suppliers ----------
  console.log("Suppliers…");
  const supplierData = [
    { name: "AgChem Solutions Inc.", contact: "0917-555-1001", address: "Quezon City, Metro Manila" },
    { name: "CropGuard Philippines Corp.", contact: "0918-555-1002", address: "Calamba, Laguna" },
    { name: "GreenHarvest Import Trading", contact: "0919-555-1003", address: "Cebu City, Cebu" },
    { name: "Mindanao Agri Distributors", contact: "0920-555-1004", address: "Davao City, Davao del Sur" },
    { name: "Pacific Farm Chemicals", contact: "0921-555-1005", address: "San Fernando, Pampanga" },
  ];
  const suppliers = [];
  for (const s of supplierData) suppliers.push(await prisma.supplier.create({ data: s }));

  // ---------- Products (100) ----------
  console.log("Products…");
  type Cat = { category: string; count: number; skuPrefix: string; brands: string[]; ingredients: string[]; forms: string[]; packs: string[]; crops: string[][] };
  const cats: Cat[] = [
    {
      category: "Insecticide", count: 30, skuPrefix: "INS",
      brands: ["AgroShield", "PestBan", "InsectoMax", "Vantage", "StrikeForce", "BugStop", "Sentinel", "RapidKill", "FieldGuard", "Torpedo"],
      ingredients: ["Cypermethrin", "Lambda-cyhalothrin", "Imidacloprid", "Chlorpyrifos", "Fipronil", "Thiamethoxam", "Deltamethrin", "Abamectin"],
      forms: ["5 EC", "10 EC", "25 SC", "20 SL", "50 WP"],
      packs: ["100ml", "250ml", "500ml", "1L"],
      crops: [["Rice"], ["Corn"], ["Vegetables"], ["Rice", "Corn"], ["Mango"], ["Vegetables", "Fruit Trees"]],
    },
    {
      category: "Herbicide", count: 25, skuPrefix: "HRB",
      brands: ["WeedClear", "GrassOut", "CleanField", "Machete Plus", "TerraFree", "WipeWeed", "GroundZero", "ClearCrop"],
      ingredients: ["Glyphosate", "Butachlor", "2,4-D Amine", "Pretilachlor", "Bispyribac-sodium", "Pendimethalin", "Glufosinate-ammonium"],
      forms: ["41 SL", "60 EC", "48 SL", "30 EC", "10 WP"],
      packs: ["250ml", "500ml", "1L", "4L"],
      crops: [["Rice"], ["Corn"], ["Rice", "Corn"], ["Pineapple"], ["Fruit Trees"]],
    },
    {
      category: "Fungicide", count: 15, skuPrefix: "FNG",
      brands: ["FungiStop", "BlightGuard", "CropSafe", "SporeX", "ProtectaMax", "GreenCure"],
      ingredients: ["Mancozeb", "Copper Hydroxide", "Tebuconazole", "Azoxystrobin", "Propineb", "Difenoconazole"],
      forms: ["80 WP", "25 EC", "50 SC", "70 WP"],
      packs: ["250g", "500g", "1kg", "250ml", "500ml"],
      crops: [["Rice"], ["Mango"], ["Vegetables"], ["Mango", "Fruit Trees"], ["Pineapple"]],
    },
    {
      category: "Molluscicide", count: 5, skuPrefix: "MOL",
      brands: ["SnailDown", "KuholBuster", "ShellStop"],
      ingredients: ["Metaldehyde", "Niclosamide"],
      forms: ["6 GB", "250 EC", "70 WP"],
      packs: ["250g", "500g", "1kg", "250ml"],
      crops: [["Rice"]],
    },
    {
      category: "Foliar Fertilizer", count: 15, skuPrefix: "FOL",
      brands: ["GrowMax", "LeafPower", "HarvestBoost", "NutriGreen", "CropVita", "YieldPlus"],
      ingredients: ["NPK 20-20-20", "NPK 10-10-30", "Calcium + Boron", "Amino Acids + Micronutrients", "Potassium Nitrate", "Zinc + Manganese Chelate"],
      forms: ["SL", "WSF", "SC"],
      packs: ["250ml", "500ml", "1L", "500g", "1kg"],
      crops: [["Rice"], ["Corn"], ["Vegetables"], ["Mango"], ["Pineapple"], ["Rice", "Corn", "Vegetables"]],
    },
    {
      category: "Others", count: 10, skuPrefix: "OTH",
      brands: ["StickWell", "AgriWet", "RatOut", "SeedCoat", "PhWell"],
      ingredients: ["Surfactant Blend", "Zinc Phosphide", "Thiram", "Buffering Agent", "Silicone Adjuvant"],
      forms: ["SL", "WP", "B"],
      packs: ["100ml", "250ml", "500ml", "1kg"],
      crops: [["Rice"], ["Corn"], ["Vegetables"], ["Rice", "Corn"]],
    },
  ];

  const products = [] as { id: string; sku: string; name: string; dealerPrice: number; unitCost: number; reorderPoint: number; stock: number }[];
  let skuCounter = 0;
  const usedNames = new Set<string>();
  for (const cat of cats) {
    for (let i = 0; i < cat.count; i++) {
      skuCounter++;
      let name = "";
      do {
        const brand = pick(cat.brands);
        const form = pick(cat.forms);
        name = `${brand} ${form}`;
      } while (usedNames.has(name));
      usedNames.add(name);
      const pack = pick(cat.packs);
      const ingredient = pick(cat.ingredients);
      const unitCost = round2(ri(80, 900) + rand());
      const dealerPrice = round2(unitCost * 1.25);
      const srp = round2(dealerPrice * 1.15);
      const reorderPoint = ri(10, 30);
      const fullName = `${name} ${cat.category} ${pack}`;
      // batch/expiry: most products expire 1.5-2.5 yrs out; every 10th is inside
      // the 6-month warning window and one is already expired (for the red flags)
      const mfgDate = daysAgo(ri(60, 400));
      let expDate = addDays(mfgDate, ri(540, 900));
      if (skuCounter % 10 === 0) expDate = daysAgo(-ri(30, 170));
      if (skuCounter === 13) expDate = daysAgo(ri(5, 40));
      const p = await prisma.product.create({
        data: {
          sku: `${cat.skuPrefix}-${String(skuCounter).padStart(3, "0")}`,
          name: fullName,
          activeIngredient: ingredient,
          category: cat.category,
          cropTags: pick(cat.crops).join(","),
          packSize: pack,
          unitCost,
          dealerPrice,
          srp,
          reorderPoint,
          supplierId: pick(suppliers).id,
          batchNo: `B26-${String(1000 + skuCounter)}`,
          mfgDate,
          expDate,
        },
      });
      products.push({ id: p.id, sku: p.sku, name: p.name, dealerPrice, unitCost, reorderPoint, stock: 0 });
    }
  }

  // ---------- Customers (50 dealers) ----------
  console.log("Customers…");
  const regions: Record<string, string[]> = {
    Luzon: ["Nueva Ecija", "Pangasinan", "Isabela", "Cagayan", "Tarlac", "Bulacan", "Laguna", "Batangas", "Camarines Sur"],
    Visayas: ["Iloilo", "Negros Occidental", "Cebu", "Bohol", "Leyte", "Aklan"],
    Mindanao: ["Davao del Sur", "Bukidnon", "South Cotabato", "North Cotabato", "Zamboanga del Sur", "Agusan del Norte"],
  };
  const surnames = ["Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Flores", "Ramos", "Gonzales", "Villanueva", "Aquino", "Castillo", "Navarro", "Domingo", "Salazar", "Del Rosario", "Aguilar", "Marquez", "Padilla", "Soriano", "Velasco", "Ocampo", "Tolentino", "Cabrera"];
  const suffixes = ["Agri Supply", "Farm Center", "Agrivet", "Agri Trading", "Agri Solutions", "Crop Care Center", "Agro Depot", "Farmers Mart"];
  const firstNames = ["Juan", "Maria", "Jose", "Ana", "Pedro", "Luisa", "Ramon", "Teresa", "Carlos", "Elena", "Danilo", "Rosario"];
  const termOptions = ["COD", "COD,30", "COD,30,60", "COD,30,60,90", "30,60", "COD,60,90"];
  const customers: { id: string; businessName: string; region: string; terms: string[] }[] = [];
  const regionNames = ["Luzon", "Luzon", "Luzon", "Visayas", "Mindanao"]; // weight Luzon heavier
  for (let i = 0; i < 50; i++) {
    const region = regionNames[i % regionNames.length];
    const province = pick(regions[region]);
    const surname = surnames[i % surnames.length];
    const businessName = `${surname} ${pick(suffixes)}${i >= 25 ? " " + province.split(" ")[0] : ""}`;
    // first customer backs the demo dealer login — give it every term for the demo script
    const allowedTerms = i === 0 ? "COD,30,60,90" : pick(termOptions);
    const c = await prisma.customer.create({
      data: {
        businessName,
        contactPerson: `${pick(firstNames)} ${surname}`,
        mobile: `09${ri(15, 99)}-${ri(100, 999)}-${ri(1000, 9999)}`,
        messengerHandle: `fb.com/${surname.toLowerCase().replace(/ /g, "")}agri${i}`,
        address: `${ri(1, 999)} ${pick(["Rizal St.", "Mabini Ave.", "National Hwy", "Poblacion", "Market Rd."])}`,
        region,
        province,
        creditLimit: ri(1, 10) * 50000,
        allowedTerms,
        status: "Active",
      },
    });
    customers.push({ id: c.id, businessName, region, terms: allowedTerms.split(",") });
  }

  // ---------- Users ----------
  console.log("Users…");
  const [superadmin, admin, clerk] = await Promise.all([
    prisma.user.create({ data: { name: "Sam Super", email: "superadmin@teamagro.ph", passwordHash, role: "SUPER_ADMIN" } }),
    prisma.user.create({ data: { name: "Alma Admin", email: "admin@teamagro.ph", passwordHash, role: "ADMIN" } }),
    prisma.user.create({ data: { name: "Carlo Clerk", email: "clerk@teamagro.ph", passwordHash, role: "CLERK" } }),
  ]);
  await prisma.user.create({
    data: { name: customers[0].businessName, email: "dealer@sample.ph", passwordHash, role: "DEALER", customerId: customers[0].id },
  });

  // ---------- Opening stock ----------
  console.log("Opening stock…");
  // Indexes 0-87: healthy stock. 88-95: low (<= reorder point). 96-99: out of stock.
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    let qty: number;
    if (i >= 96) qty = 0;
    else if (i >= 88) qty = Math.max(1, p.reorderPoint - ri(1, 5));
    else qty = ri(120, 450);
    p.stock = qty;
    if (qty > 0) {
      await prisma.stockMovement.create({
        data: { productId: p.id, type: "IN", qty, balanceAfter: qty, refType: "OPENING", refNo: "OPENING", date: daysAgo(220), userId: admin.id },
      });
    }
  }

  // ---------- Purchase orders (a few, mixed statuses) ----------
  console.log("Purchase orders…");
  for (let i = 0; i < 6; i++) {
    const supplier = pick(suppliers);
    const status = ["Received", "Received", "Sent", "Partially Received", "Draft", "Received"][i];
    const poDate = daysAgo(ri(10, 150));
    const po = await prisma.purchaseOrder.create({
      data: { poNumber: docNo("PO"), supplierId: supplier.id, status, date: poDate },
    });
    const lineCount = ri(2, 5);
    for (let j = 0; j < lineCount; j++) {
      const prod = products[ri(0, 87)];
      const qty = ri(50, 200);
      const receivedQty = status === "Received" ? qty : status === "Partially Received" ? Math.floor(qty / 2) : 0;
      await prisma.pOLine.create({
        data: { purchaseOrderId: po.id, productId: prod.id, qty, receivedQty, unitCost: prod.unitCost },
      });
      if (receivedQty > 0) {
        prod.stock += receivedQty;
        await prisma.stockMovement.create({
          data: { productId: prod.id, type: "IN", qty: receivedQty, balanceAfter: prod.stock, refType: "PO", refNo: po.poNumber, date: addDays(poDate, 3), userId: admin.id },
        });
      }
    }
  }

  // ---------- Historical sales orders (40) ----------
  console.log("Sales orders…");
  const trucks = ["Isuzu Elf ABC-1234", "Mitsubishi Canter DEF-5678", "Isuzu Forward GHI-9012"];
  const drivers = ["Mang Ben", "Rico D.", "Jun P.", "Aldo M."];
  // status distribution across the 40
  const soPlan: string[] = [
    ...Array(18).fill("Invoiced"),
    ...Array(6).fill("Delivered"),
    ...Array(4).fill("Scheduled"),
    ...Array(4).fill("Confirmed"),
    ...Array(5).fill("Draft"),
    ...Array(3).fill("Cancelled"),
  ];

  let paidCount = 0;
  for (let i = 0; i < soPlan.length; i++) {
    const status = soPlan[i];
    const cust = pick(customers);
    const term = pick(cust.terms);
    // invoiced ones are older so AR aging has spread
    const age = status === "Invoiced" ? ri(5, 180) : status === "Delivered" ? ri(2, 12) : ri(0, 20);
    const soDate = daysAgo(age);

    const so = await prisma.salesOrder.create({
      data: {
        soNumber: docNo("SO"),
        customerId: cust.id,
        term,
        status,
        orderDate: soDate,
        preparedById: pick([clerk.id, admin.id]),
        createdAt: soDate,
      },
    });

    const lineCount = ri(2, 5);
    const linesForDR: { productId: string; qty: number; unitPrice: number }[] = [];
    let total = 0;
    const usedProducts = new Set<number>();
    for (let j = 0; j < lineCount; j++) {
      let idx = ri(0, 87);
      while (usedProducts.has(idx)) idx = ri(0, 87);
      usedProducts.add(idx);
      const prod = products[idx];
      let qty = ri(5, 40);
      const deducts = status === "Invoiced" || status === "Delivered";
      if (deducts) qty = Math.min(qty, Math.max(1, prod.stock - 10));
      const lineTotal = round2(qty * prod.dealerPrice);
      total += lineTotal;
      await prisma.salesOrderLine.create({
        data: { salesOrderId: so.id, productId: prod.id, qty, unitPrice: prod.dealerPrice, lineTotal },
      });
      linesForDR.push({ productId: prod.id, qty, unitPrice: prod.dealerPrice });
      if (deducts) prod.stock -= qty;
    }
    total = round2(total);

    if (["Scheduled", "Delivered", "Invoiced"].includes(status)) {
      await prisma.deliverySchedule.create({
        data: {
          salesOrderId: so.id,
          date: status === "Scheduled" ? daysAgo(-ri(0, 4)) : addDays(soDate, 2),
          truck: pick(trucks),
          driver: pick(drivers),
          status: status === "Scheduled" ? "Scheduled" : "Delivered",
        },
      });
    }

    if (["Delivered", "Invoiced"].includes(status)) {
      const drDate = addDays(soDate, 2);
      const dr = await prisma.deliveryReceipt.create({
        data: {
          drNumber: docNo("DR"),
          salesOrderId: so.id,
          status: status === "Invoiced" ? "Invoiced" : "Delivered",
          date: drDate,
          deliveredAt: drDate,
          preparedBy: "Carlo Clerk",
          checkedBy: "Alma Admin",
          approvedBy: "Sam Super",
        },
      });
      for (const l of linesForDR) {
        await prisma.dRLine.create({ data: { deliveryReceiptId: dr.id, ...l } });
        const prod = products.find((p) => p.id === l.productId)!;
        await prisma.stockMovement.create({
          data: { productId: prod.id, type: "OUT", qty: l.qty, balanceAfter: prod.stock, refType: "DR", refNo: dr.drNumber, date: drDate, userId: clerk.id },
        });
      }

      if (status === "Invoiced") {
        const termDays = term === "COD" ? 0 : Number(term);
        const dueDate = addDays(drDate, termDays);
        const sr = await prisma.salesReceipt.create({
          data: {
            srNumber: docNo("SR"),
            deliveryReceiptId: dr.id,
            customerId: cust.id,
            amount: total,
            term,
            invoiceDate: drDate,
            dueDate,
            status: "Open",
          },
        });
        // ~8 paid, ~5 partial, rest open (several overdue since dueDate may be past)
        if (paidCount < 8) {
          paidCount++;
          await prisma.payment.create({
            data: { salesReceiptId: sr.id, amount: total, date: addDays(drDate, ri(3, termDays || 5)), method: pick(["Cash", "Check", "Bank Transfer", "GCash"]), refNo: `REF-${ri(10000, 99999)}` },
          });
          await prisma.salesReceipt.update({ where: { id: sr.id }, data: { status: "Paid" } });
        } else if (paidCount < 13) {
          paidCount++;
          const part = round2(total * (ri(30, 70) / 100));
          await prisma.payment.create({
            data: { salesReceiptId: sr.id, amount: part, date: addDays(drDate, ri(5, 30)), method: pick(["Cash", "Check", "Bank Transfer"]), refNo: `REF-${ri(10000, 99999)}` },
          });
          await prisma.salesReceipt.update({ where: { id: sr.id }, data: { status: "Partial" } });
        }
      }
    }

    if (status === "Cancelled") {
      await prisma.salesOrder.update({ where: { id: so.id }, data: { voidReason: "Customer cancelled order" } });
    }
  }

  // update product stockQty
  for (const p of products) {
    await prisma.product.update({ where: { id: p.id }, data: { stockQty: p.stock } });
  }

  // ---------- Pending incoming orders (inbox) ----------
  console.log("Incoming orders…");
  for (let i = 0; i < 4; i++) {
    const cust = pick(customers);
    const io = await prisma.incomingOrder.create({
      data: {
        source: pick(["PORTAL", "MESSENGER", "TEXT"]),
        customerId: cust.id,
        term: pick(cust.terms),
        status: "Pending",
        notes: i === 0 ? "Rush order — planting season" : null,
        createdAt: daysAgo(i === 3 ? 2 : 0), // one older than 24h for escalation demo
      },
    });
    const n = ri(2, 4);
    for (let j = 0; j < n; j++) {
      const prod = products[ri(0, 95)];
      await prisma.incomingOrderLine.create({
        data: { orderId: io.id, productId: prod.id, qty: ri(5, 30), unitPrice: prod.dealerPrice },
      });
    }
    await prisma.notification.create({
      data: { role: "CLERK", type: "NEW_ORDER", message: `New ${io.source.toLowerCase()} order from ${cust.businessName}`, refLink: `/orders/${io.id}`, createdAt: io.createdAt },
    });
  }

  // ---------- Expenses ----------
  console.log("Expenses…");
  const expCats = ["Fuel", "Salaries", "Utilities", "Freight", "Rent", "Supplies", "Others"];
  for (let i = 0; i < 45; i++) {
    const cat = pick(expCats);
    const base: Record<string, [number, number]> = {
      Fuel: [1500, 8000], Salaries: [15000, 90000], Utilities: [2000, 12000],
      Freight: [3000, 15000], Rent: [25000, 25000], Supplies: [500, 5000], Others: [300, 4000],
    };
    const [lo, hi] = base[cat];
    await prisma.expense.create({
      data: { date: daysAgo(ri(0, 210)), category: cat, amount: round2(ri(lo, hi) + rand()), notes: `${cat} expense`, userId: admin.id },
    });
  }

  // ---------- HR ----------
  console.log("HR…");
  const employeeData = [
    { name: "Roberto Dizon", position: "Supervisor", department: "Operations", basicSalary: 28000 },
    { name: "Alma Fernandez", position: "Inventory Controller", department: "Operations", basicSalary: 22000 },
    { name: "Carlo Manalo", position: "Admin Clerk / Encoder", department: "Admin", basicSalary: 16000 },
    { name: "Benjamin Cruz", position: "Driver", department: "Logistics", basicSalary: 15000 },
    { name: "Rico Delos Santos", position: "Driver", department: "Logistics", basicSalary: 15000 },
    { name: "Liza Ramos", position: "Accountant", department: "Finance", basicSalary: 25000 },
    { name: "Marites Uy", position: "Sales Agent", department: "Sales", basicSalary: 18000 },
    { name: "Noel Pascual", position: "Warehouse Staff", department: "Operations", basicSalary: 14000 },
  ];
  for (const e of employeeData) {
    const emp = await prisma.employee.create({
      data: { ...e, hireDate: daysAgo(ri(200, 2000)), status: "Active" },
    });
    for (const cutoff of ["Jul 16-31, 2026", "Aug 1-15, 2026"]) {
      const basicPay = round2(e.basicSalary / 2);
      const allowLiving = ri(0, 2) * 500;
      const allowGas = e.position.includes("Driver") ? ri(3, 8) * 100 : 0;
      const allowMotor = e.position.includes("Driver") ? 300 : 0;
      const allowLoad = ri(0, 1) * 200;
      const allowTravel = e.department === "Sales" ? ri(2, 6) * 100 : 0;
      const allowances = round2(allowLiving + allowGas + allowMotor + allowLoad + allowTravel);
      const dedSss = round2(basicPay * 0.045);
      const dedPhic = round2(basicPay * 0.025);
      const dedHdmf = 100;
      const dedWithholdingTax = round2(Math.max(0, basicPay - 10417) * 0.15);
      const deductions = round2(dedSss + dedPhic + dedHdmf + dedWithholdingTax);
      const grossPay = round2(basicPay + allowances);
      await prisma.payrollEntry.create({
        data: {
          employeeId: emp.id, cutoff, basicPay,
          allowLiving, allowGas, allowMotor, allowLoad, allowTravel,
          dedSss, dedPhic, dedHdmf, dedWithholdingTax,
          allowances, grossPay, deductions, netPay: round2(grossPay - deductions),
        },
      });
    }
    if (rand() > 0.5) {
      await prisma.evaluation.create({
        data: {
          employeeId: emp.id, period: "H1 2026",
          scoresJson: JSON.stringify({ Punctuality: ri(3, 5), Quality: ri(3, 5), Teamwork: ri(3, 5), Initiative: ri(2, 5) }),
          remarks: pick(["Consistent performer.", "Meets expectations.", "Shows initiative, recommend for training."]),
          evaluatorId: admin.id,
        },
      });
    }
  }

  // ---------- Low stock notifications ----------
  const lowProducts = products.filter((p) => p.stock > 0 && p.stock <= p.reorderPoint);
  for (const p of lowProducts.slice(0, 5)) {
    await prisma.notification.create({
      data: { role: "ADMIN", type: "LOW_STOCK", message: `${p.name} is at reorder point (${p.stock} left)`, refLink: `/inventory` },
    });
  }

  // ---------- Persist doc counters ----------
  for (const [docType, lastNumber] of Object.entries(counters)) {
    await prisma.documentCounter.create({ data: { docType, year: YEAR, lastNumber } });
  }

  const lowCount = products.filter((p) => p.stock > 0 && p.stock <= p.reorderPoint).length;
  const outCount = products.filter((p) => p.stock <= 0).length;
  console.log(`Done. Products: ${products.length} (${lowCount} low, ${outCount} out), Customers: ${customers.length}, SOs: ${soPlan.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
