import { collection, getDocs, query } from "firebase/firestore";

export const VENDOR_SETTINGS_DOC = "vendors";
export const VENDOR_RECORDS_COLLECTION = "vendor";
export const LEGACY_VENDOR_SETTINGS_DOC = "venders";
export const LEGACY_VENDOR_RECORDS_COLLECTION = "vender";

const normalizeVendor = (docSnap, source) => {
  const data = docSnap.data();
  const address = data.address || {};
  const name = data.name || "Unnamed vendor";

  return {
    id: data.id || docSnap.id,
    name,
    email: data.email || "",
    phoneNumber: data.phoneNumber || "",
    streetAddress: address.streetAddress || "",
    city: address.city || "",
    state: address.state || "",
    zip: address.zip || "",
    label: name,
    source,
  };
};

export const vendorCollectionPath = (companyId) => [
  "companies",
  companyId,
  "settings",
  VENDOR_SETTINGS_DOC,
  VENDOR_RECORDS_COLLECTION,
];

const legacyVendorCollectionPath = (companyId) => [
  "companies",
  companyId,
  "settings",
  LEGACY_VENDOR_SETTINGS_DOC,
  LEGACY_VENDOR_RECORDS_COLLECTION,
];

export const fetchCompanyVendors = async (db, companyId, options = {}) => {
  if (!companyId) return [];

  const includeLegacy = options.includeLegacy !== false;
  const paths = [
    { source: "canonical", path: vendorCollectionPath(companyId) },
    ...(includeLegacy ? [{ source: "legacy", path: legacyVendorCollectionPath(companyId) }] : []),
  ];
  const vendorsById = new Map();

  for (const { source, path } of paths) {
    try {
      const snapshot = await getDocs(query(collection(db, ...path)));
      snapshot.docs.forEach((docSnap) => {
        const vendor = normalizeVendor(docSnap, source);
        if (!vendorsById.has(vendor.id)) {
          vendorsById.set(vendor.id, vendor);
        }
      });
    } catch (error) {
      console.warn(`Unable to load ${source} vendor records.`, error);
    }
  }

  return [...vendorsById.values()].sort((a, b) => a.name.localeCompare(b.name));
};
