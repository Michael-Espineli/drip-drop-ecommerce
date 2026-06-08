import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { endOfMonth, format, startOfMonth } from "date-fns";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  customerHasAnyTag,
  filterCustomersByRoleTagAccess,
  filterRecordsByCustomerTags,
  getCustomerTagOptions,
  getRoleCustomerTagAccess,
} from "../../../utils/customerTags";

const reportCatalog = [
  { value: "readings", label: "Readings", status: "Ready", source: "stopData readings" },
  { value: "chemicals", label: "Chemicals", status: "Ready", source: "stopData dosages" },
  { value: "waste", label: "Waste", status: "Ready", source: "dosages and chemical purchases" },
  { value: "users", label: "Users", status: "Ready", source: "users, stops, jobs, purchases, payroll" },
  { value: "purchases", label: "Purchases", status: "Ready", source: "purchasedItems and database items" },
  { value: "pnl", label: "P.N.L.", status: "Ready", source: "jobs, purchases, payroll" },
  { value: "job", label: "Jobs", status: "Ready", source: "workOrders, purchases, payroll" },
  { value: "vehicle", label: "Vehicle", status: "Ready", source: "vehicals and activeRoutes" },
  { value: "tax", label: "Tax", status: "Ready", source: "purchases and invoiced jobs" },
];

const groupOptions = [
  { value: "company", label: "Company" },
  { value: "user", label: "User" },
  { value: "customer", label: "Customer" },
];

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const dateFromValue = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shortDate = (value) => {
  const date = dateFromValue(value);
  return date ? format(date, "MM/dd/yyyy") : "-";
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cents = (value) => Math.round(toNumber(value));

const templateMap = (templates, alternateIdField) => {
  const map = new Map();
  templates.forEach((template) => {
    map.set(template.id, template);
    if (template[alternateIdField]) map.set(template[alternateIdField], template);
  });
  return map;
};

const templateName = (item, templatesById, fallback) =>
  item.name || templatesById.get(item.templateId)?.name || templatesById.get(item.universalTemplateId)?.name || fallback;

const valueWithUnit = (item) => [item.amount ?? "", item.UOM || item.uom || ""].filter(Boolean).join(" ").trim() || "-";

const itemDate = (item, fields) => {
  for (const field of fields) {
    const date = dateFromValue(item[field]);
    if (date) return date;
  }
  return null;
};

const inRange = (item, startDate, endDate, fields) => {
  const date = itemDate(item, fields);
  if (!date) return true;
  return date >= startDate && date <= endDate;
};

const groupKey = (item, groupBy, fallbackName = "Company") => {
  if (groupBy === "user") {
    return {
      id: item.userId || item.techId || item.adminId || item.workerId || "unassigned",
      name: item.userName || item.techName || item.tech || item.adminName || item.workerName || "Unassigned",
    };
  }

  if (groupBy === "customer") {
    return {
      id: item.customerId || "no-customer",
      name: item.customerName || "No Customer",
    };
  }

  return { id: "company", name: fallbackName };
};

const ensureGroup = (groups, group) => {
  if (!groups.has(group.id)) {
    groups.set(group.id, {
      id: group.id,
      name: group.name,
      metrics: {},
      rows: [],
    });
  }

  return groups.get(group.id);
};

const addMetric = (group, key, amount) => {
  group.metrics[key] = (group.metrics[key] || 0) + amount;
};

const moneyMetric = (label, centsValue) => ({ label, value: moneyFromCents(centsValue) });
const numberMetric = (label, value, suffix = "") => ({ label, value: `${Number(value || 0).toLocaleString()}${suffix}` });

const purchaseTotalCents = (item) => {
  const quantity = toNumber(item.quantity ?? item.quantityString ?? 1) || 1;
  const priceCents = cents(item.priceCents ?? item.price ?? item.unitCostCents);
  const explicitTotal = cents(item.totalAfterTaxCents ?? item.totalCents ?? item.costAfterTax);
  if (explicitTotal > 0) return explicitTotal;
  return Math.round(priceCents * quantity * 1.085);
};

const purchasePreTaxCents = (item) => {
  const quantity = toNumber(item.quantity ?? item.quantityString ?? 1) || 1;
  const explicit = cents(item.totalCents ?? item.cost);
  if (explicit > 0) return explicit;
  return Math.round(cents(item.priceCents ?? item.price ?? item.unitCostCents) * quantity);
};

const normalizePurchaseCategory = (value) => String(value || "").trim() || "Uncategorized";

const purchaseCategory = (item, databaseItemById) => {
  const databaseItem =
    databaseItemById.get(item.itemId) ||
    databaseItemById.get(item.dataBaseItemId) ||
    databaseItemById.get(item.databaseItemId) ||
    databaseItemById.get(item.templateId) ||
    null;

  return normalizePurchaseCategory(
    item.category ||
      item.itemCategory ||
      item.materialCategory ||
      databaseItem?.category
  );
};

const jobRevenueCents = (job) => cents(job.revenueCents ?? job.invoiceTotalCents ?? job.totalCents ?? job.rate ?? job.amount ?? 0);
const jobLaborCostCents = (job) => cents(job.laborCostCents ?? job.laborCost ?? 0);
const payrollLineCents = (line) => cents(line.totalAmountCents ?? line.amountCents ?? line.payCents ?? 0);

const normalizeDocs = (snapshot) => snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

const getCollection = async (companyId, collectionName) => {
  const snap = await getDocs(collection(db, "companies", companyId, collectionName));
  return normalizeDocs(snap);
};

const getDatabaseItems = async (companyId) => {
  const snap = await getDocs(collection(db, "companies", companyId, "settings", "dataBase", "dataBase"));
  return normalizeDocs(snap);
};

const buildReadingReport = ({ stopData, readingTemplates, mode, groupBy }) => {
  const readingTemplatesById = templateMap(readingTemplates, "readingsTemplateId");
  const groups = new Map();
  const overall = { visits: 0, readings: 0 };

  stopData.forEach((stop) => {
    const readings = Array.isArray(stop.readings) ? stop.readings : [];
    if (!readings.length && mode === "summary") return;

    const group = ensureGroup(groups, groupKey(stop, groupBy));
    addMetric(group, "visits", 1);
    addMetric(group, "readings", readings.length);
    overall.visits += 1;
    overall.readings += readings.length;

    if (mode === "summary") {
      readings.forEach((reading) => {
        const name = templateName(reading, readingTemplatesById, "Reading");
        const value = toNumber(reading.amount);
        const row = group.rows.find((item) => item.name === name);
        if (row) {
          row.count += 1;
          row.total += value;
          row.min = Math.min(row.min, value);
          row.max = Math.max(row.max, value);
        } else {
          group.rows.push({ name, count: 1, total: value, min: value, max: value });
        }
      });
    } else {
      group.rows.push({
        date: shortDate(stop.date),
        customer: stop.customerName || "-",
        worker: stop.userName || stop.techName || stop.tech || "-",
        values: readings.map((reading) => `${templateName(reading, readingTemplatesById, "Reading")}: ${valueWithUnit(reading)}`).join(", ") || "-",
      });
    }
  });

  return {
    title: "Readings Report",
    stats: [
      numberMetric("Service Visits", overall.visits),
      numberMetric("Readings", overall.readings),
      numberMetric("Templates", readingTemplates.length),
    ],
    columns: mode === "summary"
      ? [
          { key: "name", label: "Reading" },
          { key: "count", label: "Count", align: "right" },
          { key: "average", label: "Average", align: "right", render: (row) => (row.count ? (row.total / row.count).toFixed(2) : "0") },
          { key: "min", label: "Low", align: "right", render: (row) => row.min.toFixed(2) },
          { key: "max", label: "High", align: "right", render: (row) => row.max.toFixed(2) },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "customer", label: "Customer" },
          { key: "worker", label: "Worker" },
          { key: "values", label: "Readings" },
        ],
    groups: [...groups.values()],
  };
};

const buildChemicalReport = ({ stopData, dosageTemplates, mode, groupBy }) => {
  const dosageTemplatesById = templateMap(dosageTemplates, "dosageTemplateId");
  const groups = new Map();
  const overall = { visits: 0, dosages: 0, amount: 0 };

  stopData.forEach((stop) => {
    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    if (!dosages.length && mode === "summary") return;

    const group = ensureGroup(groups, groupKey(stop, groupBy));
    addMetric(group, "visits", 1);
    addMetric(group, "dosages", dosages.length);
    overall.visits += 1;
    overall.dosages += dosages.length;

    if (mode === "summary") {
      dosages.forEach((dosage) => {
        const name = templateName(dosage, dosageTemplatesById, "Dosage");
        const amount = toNumber(dosage.amount);
        overall.amount += amount;
        const row = group.rows.find((item) => item.name === name);
        if (row) {
          row.count += 1;
          row.amount += amount;
        } else {
          group.rows.push({ name, count: 1, amount });
        }
      });
    } else {
      group.rows.push({
        date: shortDate(stop.date),
        customer: stop.customerName || "-",
        worker: stop.userName || stop.techName || stop.tech || "-",
        values: dosages.map((dosage) => `${templateName(dosage, dosageTemplatesById, "Dosage")}: ${valueWithUnit(dosage)}`).join(", ") || "-",
      });
    }
  });

  return {
    title: "Chemicals Report",
    stats: [
      numberMetric("Service Visits", overall.visits),
      numberMetric("Dosages", overall.dosages),
      numberMetric("Total Amount", overall.amount.toFixed(2)),
    ],
    columns: mode === "summary"
      ? [
          { key: "name", label: "Dosage" },
          { key: "count", label: "Uses", align: "right" },
          { key: "amount", label: "Total Amount", align: "right", render: (row) => row.amount.toLocaleString() },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "customer", label: "Customer" },
          { key: "worker", label: "Worker" },
          { key: "values", label: "Dosages" },
        ],
    groups: [...groups.values()],
  };
};

const buildPurchaseReport = ({ purchases, databaseItemById, mode, groupBy }) => {
  const groups = new Map();
  let totalCents = 0;

  purchases.forEach((item) => {
    const group = ensureGroup(groups, groupKey(item, groupBy));
    const category = purchaseCategory(item, databaseItemById);
    const amount = purchaseTotalCents(item);
    const quantity = toNumber(item.quantity ?? item.quantityString ?? 1) || 1;
    totalCents += amount;
    addMetric(group, "items", 1);
    addMetric(group, "spend", amount);

    if (mode === "summary") {
      const row = group.rows.find((entry) => entry.name === category);
      if (row) {
        row.count += 1;
        row.totalCents += amount;
      } else {
        group.rows.push({ name: category, count: 1, totalCents: amount });
      }
    } else {
      group.rows.push({
        date: shortDate(item.date),
        name: item.name || "Unnamed Item",
        category,
        quantity,
        totalCents: amount,
      });
    }
  });

  const resultGroups = [...groups.values()].map((group) => ({
    ...group,
    footerRow:
      mode === "summary"
        ? {
            name: "Total",
            count: group.metrics.items || 0,
            totalCents: group.metrics.spend || 0,
          }
        : {
            date: "Total",
            name: "",
            category: "",
            quantity: "",
            totalCents: group.metrics.spend || 0,
          },
  }));

  return {
    title: "Purchases Report",
    stats: [
      moneyMetric("Total Spend", totalCents),
      numberMetric("Purchase Lines", purchases.length),
      numberMetric("Groups", groups.size),
    ],
    columns: mode === "summary"
      ? [
          { key: "name", label: "Category" },
          { key: "count", label: "Lines", align: "right" },
          { key: "totalCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.totalCents) },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "name", label: "Item" },
          { key: "category", label: "Category" },
          { key: "quantity", label: "Qty", align: "right" },
          { key: "totalCents", label: "Total", align: "right", render: (row) => moneyFromCents(row.totalCents) },
        ],
    total: {
      label: "Purchases Total",
      value: moneyFromCents(totalCents),
      subtitle: `${purchases.length.toLocaleString()} purchase line(s)`,
    },
    groups: resultGroups,
  };
};

const buildWasteReport = ({ stopData, purchases, databaseItemById, groupBy }) => {
  const groups = new Map();
  const chemicalPurchases = purchases.filter((item) => {
    const category = purchaseCategory(item, databaseItemById).toLowerCase();
    return category.includes("chemical") || String(item.name || "").toLowerCase().includes("chlorine") || String(item.name || "").toLowerCase().includes("acid");
  });
  let usedAmount = 0;
  let chemicalSpend = 0;

  stopData.forEach((stop) => {
    const dosages = Array.isArray(stop.dosages) ? stop.dosages : [];
    const group = ensureGroup(groups, groupKey(stop, groupBy));
    dosages.forEach((dosage) => {
      const amount = toNumber(dosage.amount);
      usedAmount += amount;
      addMetric(group, "usedAmount", amount);
      const name = dosage.name || "Chemical";
      const row = group.rows.find((item) => item.name === name);
      if (row) {
        row.usedAmount += amount;
        row.uses += 1;
      } else {
        group.rows.push({ name, usedAmount: amount, uses: 1, chemicalSpendCents: 0 });
      }
    });
  });

  chemicalPurchases.forEach((purchase) => {
    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    const amount = purchaseTotalCents(purchase);
    chemicalSpend += amount;
    addMetric(group, "chemicalSpendCents", amount);
    const name = purchase.name || "Chemical Purchase";
    const row = group.rows.find((item) => item.name === name);
    if (row) {
      row.chemicalSpendCents += amount;
    } else {
      group.rows.push({ name, usedAmount: 0, uses: 0, chemicalSpendCents: amount });
    }
  });

  return {
    title: "Waste Report",
    stats: [
      numberMetric("Used Amount", usedAmount.toFixed(2)),
      moneyMetric("Chemical Spend", chemicalSpend),
      numberMetric("Chemical Purchase Lines", chemicalPurchases.length),
    ],
    columns: [
      { key: "name", label: "Chemical" },
      { key: "uses", label: "Uses", align: "right" },
      { key: "usedAmount", label: "Used Amount", align: "right", render: (row) => row.usedAmount.toLocaleString() },
      { key: "chemicalSpendCents", label: "Purchase Spend", align: "right", render: (row) => moneyFromCents(row.chemicalSpendCents) },
    ],
    groups: [...groups.values()],
  };
};

const buildUsersReport = ({ users, serviceStops, jobs, purchases, payrollLines }) => {
  const groups = new Map();
  users.forEach((user) => {
    ensureGroup(groups, { id: user.userId || user.id, name: user.userName || user.name || user.id }).rows.push({
      role: user.roleName || "-",
      workerType: user.workerType || "-",
      status: user.status || "-",
      stops: 0,
      jobs: 0,
      purchasesCents: 0,
      payrollCents: 0,
    });
  });

  const userRow = (id, name) => {
    const group = ensureGroup(groups, { id: id || "unassigned", name: name || "Unassigned" });
    if (!group.rows.length) {
      group.rows.push({ role: "-", workerType: "-", status: "-", stops: 0, jobs: 0, purchasesCents: 0, payrollCents: 0 });
    }
    return group.rows[0];
  };

  serviceStops.forEach((stop) => {
    userRow(stop.techId || stop.userId, stop.tech || stop.userName).stops += 1;
  });
  jobs.forEach((job) => {
    userRow(job.adminId || job.techId || job.userId, job.adminName || job.techName || job.userName).jobs += 1;
  });
  purchases.forEach((purchase) => {
    userRow(purchase.techId, purchase.techName).purchasesCents += purchaseTotalCents(purchase);
  });
  payrollLines.forEach((line) => {
    userRow(line.technicianId || line.userId || line.techId, line.technicianName || line.userName || line.techName).payrollCents += payrollLineCents(line);
  });

  return {
    title: "Users Report",
    stats: [
      numberMetric("Users", groups.size),
      numberMetric("Service Stops", serviceStops.length),
      moneyMetric("Payroll", payrollLines.reduce((total, line) => total + payrollLineCents(line), 0)),
    ],
    columns: [
      { key: "role", label: "Role" },
      { key: "workerType", label: "Worker Type" },
      { key: "status", label: "Status" },
      { key: "stops", label: "Stops", align: "right" },
      { key: "jobs", label: "Jobs", align: "right" },
      { key: "purchasesCents", label: "Purchases", align: "right", render: (row) => moneyFromCents(row.purchasesCents) },
      { key: "payrollCents", label: "Payroll", align: "right", render: (row) => moneyFromCents(row.payrollCents) },
    ],
    groups: [...groups.values()],
  };
};

const buildPnlReport = ({ jobs, purchases, payrollLines, groupBy }) => {
  const groups = new Map();
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    addMetric(group, "revenueCents", jobRevenueCents(job));
    addMetric(group, "jobLaborCents", jobLaborCostCents(job));
  });
  purchases.forEach((purchase) => {
    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    addMetric(group, "purchaseCents", purchaseTotalCents(purchase));
  });
  payrollLines.forEach((line) => {
    const group = ensureGroup(groups, groupKey(line, groupBy));
    addMetric(group, "payrollCents", payrollLineCents(line));
  });

  const resultGroups = [...groups.values()].map((group) => {
    const revenueCents = group.metrics.revenueCents || 0;
    const costCents = (group.metrics.purchaseCents || 0) + (group.metrics.payrollCents || 0) + (group.metrics.jobLaborCents || 0);
    group.rows = [{ revenueCents, costCents, netCents: revenueCents - costCents }];
    return group;
  });

  return {
    title: "P.N.L. Report",
    stats: [
      moneyMetric("Revenue", resultGroups.reduce((total, group) => total + group.rows[0].revenueCents, 0)),
      moneyMetric("Costs", resultGroups.reduce((total, group) => total + group.rows[0].costCents, 0)),
      moneyMetric("Net", resultGroups.reduce((total, group) => total + group.rows[0].netCents, 0)),
    ],
    columns: [
      { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
      { key: "costCents", label: "Costs", align: "right", render: (row) => moneyFromCents(row.costCents) },
      { key: "netCents", label: "Net", align: "right", render: (row) => moneyFromCents(row.netCents) },
    ],
    groups: resultGroups,
  };
};

const buildJobReport = ({ jobs, purchases, payrollLines, groupBy }) => {
  const purchaseByJob = new Map();
  purchases.forEach((purchase) => {
    if (purchase.jobId) purchaseByJob.set(purchase.jobId, (purchaseByJob.get(purchase.jobId) || 0) + purchaseTotalCents(purchase));
  });
  const payrollByJob = new Map();
  payrollLines.forEach((line) => {
    if (line.jobId) payrollByJob.set(line.jobId, (payrollByJob.get(line.jobId) || 0) + payrollLineCents(line));
  });

  const groups = new Map();
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    const revenueCents = jobRevenueCents(job);
    const costCents = purchaseByJob.get(job.id) || 0;
    const payrollCents = payrollByJob.get(job.id) || 0;
    group.rows.push({
      internalId: job.internalId || "Job",
      date: shortDate(itemDate(job, ["invoiceDate", "dateCreated", "createdAt"])),
      customer: job.customerName || "-",
      operationStatus: job.operationStatus || "-",
      billingStatus: job.billingStatus || "-",
      revenueCents,
      costCents,
      payrollCents,
    });
  });

  return {
    title: "Jobs Report",
    stats: [
      numberMetric("Jobs", jobs.length),
      moneyMetric("Revenue", jobs.reduce((total, job) => total + jobRevenueCents(job), 0)),
      moneyMetric("Known Costs", purchases.reduce((total, purchase) => total + purchaseTotalCents(purchase), 0) + payrollLines.reduce((total, line) => total + payrollLineCents(line), 0)),
    ],
    columns: [
      { key: "internalId", label: "Job" },
      { key: "date", label: "Date" },
      { key: "customer", label: "Customer" },
      { key: "operationStatus", label: "Ops" },
      { key: "billingStatus", label: "Billing" },
      { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
      { key: "costCents", label: "Purchases", align: "right", render: (row) => moneyFromCents(row.costCents) },
      { key: "payrollCents", label: "Payroll", align: "right", render: (row) => moneyFromCents(row.payrollCents) },
    ],
    groups: [...groups.values()],
  };
};

const buildVehicleReport = ({ vehicles, activeRoutes, mode }) => {
  const routesByVehicle = new Map();
  activeRoutes.forEach((route) => {
    const vehicleId = route.vehicalId || route.vehicleId || "unassigned";
    if (!routesByVehicle.has(vehicleId)) routesByVehicle.set(vehicleId, []);
    routesByVehicle.get(vehicleId).push(route);
  });

  const groups = vehicles.map((vehicle) => {
    const routes = routesByVehicle.get(vehicle.id) || [];
    const distance = routes.reduce((total, route) => total + toNumber(route.distanceMiles || route.distance || 0), 0);
    return {
      id: vehicle.id,
      name: vehicle.nickName || `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim() || "Vehicle",
      metrics: {},
      rows: mode === "summary"
        ? [{ type: vehicle.vehicalType || "-", status: vehicle.status || "-", miles: toNumber(vehicle.miles), routes: routes.length, distance }]
        : routes.map((route) => ({
            date: shortDate(itemDate(route, ["date", "routeDate", "startTime", "createdAt"])),
            worker: route.techName || route.companyUserName || "-",
            status: route.status || "-",
            distance: toNumber(route.distanceMiles || route.distance || 0),
          })),
    };
  });

  return {
    title: "Vehicle Report",
    stats: [
      numberMetric("Vehicles", vehicles.length),
      numberMetric("Routes", activeRoutes.length),
      numberMetric("Route Miles", activeRoutes.reduce((total, route) => total + toNumber(route.distanceMiles || route.distance || 0), 0).toFixed(1)),
    ],
    columns: mode === "summary"
      ? [
          { key: "type", label: "Type" },
          { key: "status", label: "Status" },
          { key: "miles", label: "Odometer", align: "right", render: (row) => row.miles.toLocaleString() },
          { key: "routes", label: "Routes", align: "right" },
          { key: "distance", label: "Route Miles", align: "right", render: (row) => row.distance.toLocaleString() },
        ]
      : [
          { key: "date", label: "Date" },
          { key: "worker", label: "Worker" },
          { key: "status", label: "Status" },
          { key: "distance", label: "Miles", align: "right", render: (row) => row.distance.toLocaleString() },
        ],
    groups,
  };
};

const buildTaxReport = ({ purchases, jobs, groupBy }) => {
  const groups = new Map();
  purchases.forEach((purchase) => {
    const group = ensureGroup(groups, groupKey(purchase, groupBy));
    const preTaxCents = purchasePreTaxCents(purchase);
    const afterTaxCents = purchaseTotalCents(purchase);
    const taxCents = Math.max(0, afterTaxCents - preTaxCents);
    addMetric(group, "purchaseTaxCents", taxCents);
    addMetric(group, "purchasePreTaxCents", preTaxCents);
  });
  jobs.forEach((job) => {
    const group = ensureGroup(groups, groupKey(job, groupBy));
    addMetric(group, "revenueCents", jobRevenueCents(job));
    addMetric(group, "revenueTaxCents", cents(job.taxCents ?? job.invoiceTaxCents ?? 0));
  });

  const resultGroups = [...groups.values()].map((group) => {
    group.rows = [{
      purchasePreTaxCents: group.metrics.purchasePreTaxCents || 0,
      purchaseTaxCents: group.metrics.purchaseTaxCents || 0,
      revenueCents: group.metrics.revenueCents || 0,
      revenueTaxCents: group.metrics.revenueTaxCents || 0,
    }];
    return group;
  });

  return {
    title: "Tax Report",
    stats: [
      moneyMetric("Purchase Tax", resultGroups.reduce((total, group) => total + group.rows[0].purchaseTaxCents, 0)),
      moneyMetric("Revenue Tax", resultGroups.reduce((total, group) => total + group.rows[0].revenueTaxCents, 0)),
      moneyMetric("Taxable Purchases", resultGroups.reduce((total, group) => total + group.rows[0].purchasePreTaxCents, 0)),
    ],
    columns: [
      { key: "purchasePreTaxCents", label: "Purchase Pretax", align: "right", render: (row) => moneyFromCents(row.purchasePreTaxCents) },
      { key: "purchaseTaxCents", label: "Purchase Tax", align: "right", render: (row) => moneyFromCents(row.purchaseTaxCents) },
      { key: "revenueCents", label: "Revenue", align: "right", render: (row) => moneyFromCents(row.revenueCents) },
      { key: "revenueTaxCents", label: "Revenue Tax", align: "right", render: (row) => moneyFromCents(row.revenueTaxCents) },
    ],
    groups: resultGroups,
  };
};

const StatCard = ({ title, value, subtitle }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
  </div>
);

const ReportCatalogCard = ({ report, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(report.value)}
    className={`rounded-lg border p-4 text-left shadow-sm transition ${
      selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:border-slate-400"
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-bold">{report.label}</p>
        <p className={`mt-1 text-xs ${selected ? "text-slate-200" : "text-slate-500"}`}>{report.source}</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${selected ? "bg-white text-slate-900" : "bg-slate-100 text-slate-600"}`}>
        {report.status}
      </span>
    </div>
  </button>
);

const ReportTable = ({ columns, rows, footerRow }) => (
  <div className="mt-4 overflow-x-auto">
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          {columns.map((column) => (
            <th key={column.key} className={`py-2 pr-4 ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length ? rows.map((row, index) => (
          <tr key={row.id || `${row.name || "row"}-${index}`} className="border-b border-slate-100 align-top last:border-0">
            {columns.map((column) => (
              <td key={column.key} className={`py-2 pr-4 ${column.align === "right" ? "text-right font-semibold text-slate-900" : "text-slate-700"}`}>
                {column.render ? column.render(row) : row[column.key] ?? "-"}
              </td>
            ))}
          </tr>
        )) : (
          <tr>
            <td className="py-4 text-slate-500" colSpan={columns.length}>No rows in this group.</td>
          </tr>
        )}
      </tbody>
      {footerRow ? (
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
            {columns.map((column) => (
              <td key={column.key} className={`py-3 pr-4 ${column.align === "right" ? "text-right" : ""}`}>
                {column.render ? column.render(footerRow) : footerRow[column.key] || (column.key === columns[0].key ? "Total" : "")}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  </div>
);

const GeneratedReportView = ({ data }) => {
  if (!data) {
    return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">Generate a report to see results.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {data.stats.map((stat) => (
          <StatCard key={stat.label} title={stat.label} value={stat.value} subtitle={stat.subtitle} />
        ))}
      </div>

      {data.total ? (
        <div className="rounded-lg border border-slate-300 bg-slate-900 p-5 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{data.total.label}</p>
          <p className="mt-1 text-3xl font-bold">{data.total.value}</p>
          {data.total.subtitle ? <p className="mt-1 text-sm text-slate-300">{data.total.subtitle}</p> : null}
        </div>
      ) : null}

      {data.groups.length ? (
        <div className="grid gap-4">
          {data.groups.map((group) => (
            <div key={group.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{group.name}</h3>
                {Object.keys(group.metrics || {}).length ? (
                  <p className="mt-1 text-sm text-slate-500">
                    {Object.entries(group.metrics).map(([key, value]) => `${key}: ${typeof value === "number" ? value.toLocaleString() : value}`).join(" | ")}
                  </p>
                ) : null}
              </div>
              <ReportTable columns={data.columns} rows={group.rows} footerRow={group.footerRow} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No data found for this date range.</div>
      )}
    </div>
  );
};

const Reports = () => {
  const { recentlySelectedCompany, companyRole } = useContext(Context);
  const [reportType, setReportType] = useState("readings");
  const [mode, setMode] = useState("summary");
  const [groupBy, setGroupBy] = useState("company");
  const [availableCustomerTags, setAvailableCustomerTags] = useState([]);
  const [selectedCustomerTags, setSelectedCustomerTags] = useState([]);
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  });
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const selectedReport = useMemo(
    () => reportCatalog.find((report) => report.value === reportType) || reportCatalog[0],
    [reportType]
  );

  const roleTagAccess = useMemo(() => getRoleCustomerTagAccess(companyRole), [companyRole]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setAvailableCustomerTags([]);
      setSelectedCustomerTags([]);
      return;
    }

    const fetchCustomerTags = async () => {
      try {
        const customers = await getCollection(recentlySelectedCompany, "customers");
        const visibleCustomers = filterCustomersByRoleTagAccess(customers, companyRole);
        setAvailableCustomerTags(getCustomerTagOptions(visibleCustomers));
        setSelectedCustomerTags((currentTags) =>
          currentTags.filter((tag) => getCustomerTagOptions(visibleCustomers).includes(tag))
        );
      } catch (error) {
        console.error("Failed to load customer tags for reports:", error);
      }
    };

    fetchCustomerTags();
  }, [recentlySelectedCompany, companyRole]);

  const handleReportSelect = (value) => {
    setReportType(value);
    setReportData(null);
  };

  const toggleCustomerTagFilter = (tag) => {
    setReportData(null);
    setSelectedCustomerTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag]
    );
  };

  const handleGenerateReport = async () => {
    if (!recentlySelectedCompany) {
      toast.error("Please select a company.");
      return;
    }

    setIsLoading(true);
    const toastId = toast.loading(`Generating ${selectedReport.label.toLowerCase()} report...`);

    try {
      const startDate = new Date(`${dateRange.start}T00:00:00`);
      const endDate = new Date(`${dateRange.end}T23:59:59`);
      const [stopDataSnap, readingsSnap, dosagesSnap, customersRaw] = await Promise.all([
        getDocs(query(collection(db, "companies", recentlySelectedCompany, "stopData"), where("date", ">=", startDate), where("date", "<=", endDate))),
        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "readings", "readings")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "settings", "dosages", "dosages")),
        getCollection(recentlySelectedCompany, "customers"),
      ]);
      const visibleCustomers = filterCustomersByRoleTagAccess(customersRaw, companyRole);
      const reportCustomers = selectedCustomerTags.length
        ? visibleCustomers.filter((customer) => customerHasAnyTag(customer, selectedCustomerTags))
        : visibleCustomers;
      const customersById = new Map(reportCustomers.map((customer) => [customer.id, customer]));
      const tagFilterContext = { customersById, role: companyRole, selectedTags: selectedCustomerTags };

      const stopData = filterRecordsByCustomerTags({
        records: normalizeDocs(stopDataSnap),
        ...tagFilterContext,
      });
      const readingTemplates = normalizeDocs(readingsSnap);
      const dosageTemplates = normalizeDocs(dosagesSnap);

      const needsPurchases = ["purchases", "waste", "pnl", "job", "tax", "users"].includes(reportType);
      const needsJobs = ["pnl", "job", "tax", "users"].includes(reportType);
      const needsPayroll = ["pnl", "job", "users"].includes(reportType);
      const needsUsers = reportType === "users";
      const needsFleet = reportType === "vehicle";

      const [
        purchasesRaw,
        databaseItemsRaw,
        jobsRaw,
        payrollLinesRaw,
        serviceStopsRaw,
        usersRaw,
        vehiclesRaw,
        activeRoutesRaw,
      ] = await Promise.all([
        needsPurchases ? getCollection(recentlySelectedCompany, "purchasedItems") : Promise.resolve([]),
        needsPurchases ? getDatabaseItems(recentlySelectedCompany) : Promise.resolve([]),
        needsJobs ? getCollection(recentlySelectedCompany, "workOrders") : Promise.resolve([]),
        needsPayroll ? getCollection(recentlySelectedCompany, "technicianPayLineItems") : Promise.resolve([]),
        needsUsers ? getCollection(recentlySelectedCompany, "serviceStops") : Promise.resolve([]),
        needsUsers ? getCollection(recentlySelectedCompany, "companyUsers") : Promise.resolve([]),
        needsFleet ? getCollection(recentlySelectedCompany, "vehicals") : Promise.resolve([]),
        needsFleet ? getCollection(recentlySelectedCompany, "activeRoutes") : Promise.resolve([]),
      ]);

      const purchases = filterRecordsByCustomerTags({
        records: purchasesRaw.filter((item) => inRange(item, startDate, endDate, ["date", "createdAt", "dateCreated"])),
        ...tagFilterContext,
      });
      const jobs = filterRecordsByCustomerTags({
        records: jobsRaw.filter((item) => inRange(item, startDate, endDate, ["invoiceDate", "dateCreated", "createdAt", "completedAt"])),
        ...tagFilterContext,
      });
      const payrollLines = filterRecordsByCustomerTags({
        records: payrollLinesRaw.filter((item) => inRange(item, startDate, endDate, ["completedDate", "createdAt", "paidAt"])),
        ...tagFilterContext,
      });
      const serviceStops = filterRecordsByCustomerTags({
        records: serviceStopsRaw.filter((item) => inRange(item, startDate, endDate, ["serviceDate", "date", "createdAt"])),
        ...tagFilterContext,
      });
      const activeRoutes = activeRoutesRaw.filter((item) => inRange(item, startDate, endDate, ["date", "routeDate", "startTime", "createdAt"]));
      const databaseItemById = new Map(databaseItemsRaw.map((item) => [item.id, item]));

      const context = {
        stopData,
        readingTemplates,
        dosageTemplates,
        purchases,
        databaseItemById,
        jobs,
        payrollLines,
        serviceStops,
        users: usersRaw,
        vehicles: vehiclesRaw,
        activeRoutes,
        mode,
        groupBy,
      };

      const builders = {
        readings: buildReadingReport,
        chemicals: buildChemicalReport,
        purchases: buildPurchaseReport,
        waste: buildWasteReport,
        users: buildUsersReport,
        pnl: buildPnlReport,
        job: buildJobReport,
        vehicle: buildVehicleReport,
        tax: buildTaxReport,
      };

      const nextReport = builders[reportType](context);
      setReportData({
        ...nextReport,
        stats: [
          ...(nextReport.stats || []),
          { label: "Date Range", value: `${dateRange.start} - ${dateRange.end}` },
          { label: "Customer Tags", value: selectedCustomerTags.length ? selectedCustomerTags.join(", ") : roleTagAccess.length ? roleTagAccess.join(", ") : "All" },
        ],
      });
      toast.success(`${selectedReport.label} report generated.`, { id: toastId });
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error(`Report generation failed: ${error.message}`, { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-slate-600">iOS report families with live web reporting.</p>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reportCatalog.map((report) => (
            <ReportCatalogCard key={report.value} report={report} selected={report.value === reportType} onSelect={handleReportSelect} />
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Report Controls</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">Report Type</label>
                <select value={reportType} onChange={(event) => handleReportSelect(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm">
                  {reportCatalog.map((report) => (
                    <option key={report.value} value={report.value}>{report.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Output</label>
                <select value={mode} onChange={(event) => setMode(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm">
                  <option value="summary">Summary</option>
                  <option value="detail">Detail</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Group By</label>
                <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm">
                  {groupOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-sm font-semibold text-slate-700">Customer Tags</label>
                  {selectedCustomerTags.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomerTags([]);
                        setReportData(null);
                      }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                {roleTagAccess.length > 0 ? (
                  <p className="mt-1 text-xs text-blue-700">
                    Role limited to {roleTagAccess.join(", ")}.
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableCustomerTags.length > 0 ? (
                    availableCustomerTags.map((tag) => {
                      const selected = selectedCustomerTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleCustomerTagFilter(tag)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            selected
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-slate-500">No customer tags found.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Date Range</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <input type="date" value={dateRange.start} onChange={(event) => setDateRange((prev) => ({ ...prev, start: event.target.value }))} className="rounded-md border border-slate-300 p-2 text-sm" />
                  <input type="date" value={dateRange.end} onChange={(event) => setDateRange((prev) => ({ ...prev, end: event.target.value }))} className="rounded-md border border-slate-300 p-2 text-sm" />
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={isLoading}
                className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>

          <GeneratedReportView data={reportData} />
        </div>
      </div>
    </div>
  );
};

export default Reports;
