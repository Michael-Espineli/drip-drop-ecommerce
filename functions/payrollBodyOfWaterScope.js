const id = value => String(typeof value === "object" ? value?.id || "" : value || "").trim();

// Resolve operational records, never client-provided earnings. Keep this inside
// the payroll transaction so quantities and the resulting pay commit together.
async function loadPayrollBodyOfWaterScope(transaction, companyRef, records, rates = []) {
  const work = records.filter(Boolean);
  const allRates = [...rates, ...work.flatMap(record => record.payrollAgreement?.rates || [])];
  if (!allRates.some(rate => rate.rateType === "perBodyOfWater")) return {};
  const locations = [...new Set(work.map(record => id(record.serviceLocationId)).filter(Boolean))];
  const snapshots = await Promise.all(locations.map(locationId =>
    transaction.get(companyRef.collection("bodiesOfWater").where("serviceLocationId", "==", locationId))));
  return Object.fromEntries(locations.map((locationId, index) => [locationId,
    snapshots[index].docs.filter(doc => {
      const body = doc.data();
      return body.isActive !== false && body.active !== false && body.archived !== true;
    }).map(doc => doc.id),
  ]));
}

module.exports = { loadPayrollBodyOfWaterScope };
