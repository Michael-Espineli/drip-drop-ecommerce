export const reportCategories = [
  { value: "operations", label: "Operations" },
  { value: "marketing", label: "Marketing" },
  { value: "performance", label: "Performance" },
  { value: "finance", label: "Finance / Accounting" },
];

export const reportCatalog = [
  { value: "funReadingsDosages", label: "Fun Readings & Dosages", status: "Ready", source: "Daily minimum, maximum and average readings and dosages, with trends for the selected dates.", category: "operations" },
  { value: "readings", label: "Readings & Dosages Summary", status: "Ready", source: "Recorded readings and dosages by company, worker or customer. Summary shows counts and ranges; detail lists visits.", category: "operations" },
  { value: "readingHealth", label: "Reading Health", status: "Ready", source: "Pools with recorded readings that match your selected threshold during the date range.", category: "operations" },
  { value: "readingPerformance", label: "Reading Performance", status: "Ready", source: "Reading standards by worker or customer, including success and failure rates for recorded visits.", category: "performance" },
  { value: "pnlPerPool", label: "PNL Per Service Location", status: "Ready", source: "Estimated recurring-service margin by service location: prorated agreements, separate chemical revenue, labor and chemical costs. Missing costs require review.", category: "performance" },
  { value: "pipeline", label: "Pipeline", status: "Ready", source: "Current pipeline snapshot with checklist progress, lead sources, and lost or fired reasons. Dates do not reconstruct historical stages.", category: "marketing" },
  { value: "chemicals", label: "Chemicals", status: "Ready", source: "Recorded chemical usage by company, worker or customer during the selected dates. Quantities retain their units.", category: "operations" },
  { value: "waste", label: "Waste", status: "Ready", source: "Purchased quantities compared with linked chemical usage in the same dates. Differences can include inventory carried between periods.", category: "performance" },
  { value: "users", label: "Users", status: "Ready", source: "Current company users with service stops, jobs, purchases and payroll activity in the selected dates.", category: "operations" },
  { value: "job", label: "Jobs", status: "Ready", source: "Jobs in the selected dates with issued invoice value or quoted value, plus linked purchases and payroll costs recorded in the period.", category: "operations" },
  { value: "vehicle", label: "Vehicle", status: "Ready", source: "Vehicles and dated route activity, including recorded route distance and odometer mileage where available.", category: "operations" },
  { value: "purchases", label: "Purchases", status: "Ready", source: "Purchases recorded in the selected dates, grouped by category. Returned items are excluded; missing tax uses the legacy 8.5% estimate.", category: "finance" },
  { value: "payroll", label: "Payroll", status: "Ready", source: "Non-voided payroll earned in the selected dates, split into paid, approved and unapproved amounts. Includes review items and adjustments.", category: "finance" },
  { value: "futurePayroll", label: "Future Payroll", status: "Ready", source: "Unpaid payroll earned in the selected dates plus unfinished scheduled work estimates. Estimates use current rates and saved work-offer terms.", category: "finance" },
  { value: "pnl", label: "P.N.L.", status: "Ready", source: "Estimated operating margin: prorated recurring agreements, issued job value, separate chemical revenue, purchases and payroll. This is a planning report, not cash receipts.", category: "finance" },
  { value: "tax", label: "Tax", status: "Ready", source: "Recorded purchase tax and issued Sales invoice tax in the selected dates. Legacy purchases without saved tax use an 8.5% estimate; review before filing.", category: "finance" },
];

export const fixedGroupingReportTypes = new Set(["funReadingsDosages", "readingHealth", "readingPerformance", "pnlPerPool", "pipeline", "users", "vehicle"]);
export const payrollOnlyReportTypes = new Set(["payroll", "futurePayroll"]);

export const readingPerformanceViewOptions = [
  { value: "users", label: "User" },
  { value: "customers", label: "Customer" },
];

export const groupOptions = [
  { value: "company", label: "Company" },
  { value: "user", label: "User" },
  { value: "customer", label: "Customer" },
];


export const reportDescription = (type) => reportCatalog.find((report) => report.value === type)?.source || "";
