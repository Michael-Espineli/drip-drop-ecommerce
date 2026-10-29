export const rateTypeOptions = ["flatPerStop", "flatPerTask", "hourly", "perBodyOfWater", "perServiceLocation", "percentage", "manual"];

export const stackBehaviorOptions = ["stackable", "exclusive", "replacesBase", "modifier"];

export const workCategoryOptions = ["route", "maintenance", "serviceCall", "repair", "installation", "cleaning", "commercial", "startup", "drainAndRefill", "estimate", "extra", "custom"];

export const defaultStopPayCategories = [
  {
    id: "route",
    label: "Routes",
    category: "Route",
    sourceId: "system_recurring_service_stop",
    helper: "Recurring route work and scheduled route visits.",
    defaultWorkCategory: "route",
    defaultRateType: "flatPerStop",
    defaultIconName: "figure.pool.swim",
  },
  {
    id: "job",
    label: "Jobs",
    category: "Job",
    sourceId: "system_job_service_stop",
    helper: "Actual job work performed by a technician.",
    defaultWorkCategory: "serviceCall",
    defaultRateType: "flatPerStop",
    defaultIconName: "briefcase",
  },
  {
    id: "jobEstimate",
    label: "Job Estimates",
    category: "Job Estimate",
    sourceId: "system_job_estimate_service_stop",
    helper: "Fact-finding visits for requested job work before quoting.",
    defaultWorkCategory: "serviceCall",
    defaultRateType: "flatPerStop",
    defaultIconName: "doc.text.magnifyingglass",
  },
  {
    id: "serviceAgreementEstimate",
    label: "Service Agreement Estimates",
    category: "Service Agreement Estimate",
    sourceId: "system_service_agreement_estimate_service_stop",
    helper: "New recurring service surveys, new pools, and agreement inspections.",
    defaultWorkCategory: "startup",
    defaultRateType: "flatPerStop",
    defaultIconName: "list.clipboard",
  },
  {
    id: "customerRelationship",
    label: "Customer Relationship",
    category: "Customer Relationship",
    sourceId: "system_customer_relationship_service_stop",
    helper: "Open-ended customer visits, follow-ups, corrections, and conversations.",
    defaultWorkCategory: "serviceCall",
    defaultRateType: "flatPerStop",
    defaultIconName: "person.wave.2",
  },
];

export const emptyWorkTypeForm = () => ({
  name: "",
  stopPayCategoryId: "job",
  category: "serviceCall",
  iconName: "",
  defaultRateType: "flatPerStop",
  defaultStackBehavior: "stackable",
});

export function resolveStopPayCategories(companyStopPayBuckets = []) {
  const byId = new Map(
    defaultStopPayCategories.map((bucket, index) => [
      bucket.id,
      {
        ...bucket,
        isActive: true,
        isSystemDefault: true,
        sortOrder: index * 10,
      },
    ])
  );

  companyStopPayBuckets.forEach((bucket, index) => {
    if (!bucket?.id) return;
    const base = byId.get(bucket.id) || {};
    const label = String(bucket.label || bucket.name || base.label || "Stop Bucket").trim();
    const category = bucket.category || base.category || "Job";

    byId.set(bucket.id, {
      ...base,
      ...bucket,
      label,
      category,
      helper: bucket.helper || base.helper || "",
      defaultWorkCategory: bucket.defaultWorkCategory || base.defaultWorkCategory || "serviceCall",
      defaultRateType: bucket.defaultRateType || base.defaultRateType || "flatPerStop",
      defaultIconName: bucket.defaultIconName || bucket.iconName || base.defaultIconName || "briefcase",
      sourceId: bucket.sourceId || base.sourceId || bucket.id,
      isActive: bucket.isActive !== false,
      isSystemDefault: Boolean(base.isSystemDefault),
      sortOrder: bucket.sortOrder ?? base.sortOrder ?? (defaultStopPayCategories.length + index) * 10,
    });
  });

  return [...byId.values()]
    .filter((bucket) => bucket.isActive !== false)
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.label || "").localeCompare(String(b.label || "")));
}

export function buildCompanyPayType({ id, companyId, form, bucket, existing = {}, sortOrder, userId, now = new Date() }) {
  return {
    id,
    companyId,
    name: form.name.trim(),
    category: form.category || bucket.defaultWorkCategory,
    iconName: form.iconName.trim() || bucket.defaultIconName,
    isActive: existing.isActive !== false,
    status: existing.status || "Active",
    defaultRateType: form.defaultRateType || bucket.defaultRateType,
    defaultStackBehavior: form.defaultStackBehavior || "stackable",
    sortOrder: existing.sortOrder ?? sortOrder,
    bucketId: bucket.id,
    bucketLabel: bucket.label,
    stopPayBucketId: bucket.id,
    stopPayBucketLabel: bucket.label,
    serviceStopCategory: bucket.category,
    payTypeModelVersion: 1,
    createdAt: existing.createdAt || now,
    createdByUserId: existing.createdByUserId || userId,
    updatedAt: now,
    updatedByUserId: userId,
  };
}
