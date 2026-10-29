import { useEffect, useState } from "react";
import { db } from "../utils/config";
import { loadJobProductCatalog } from "../utils/productCatalog";

export default function useJobProductCatalog(companyId, enabled = true) {
  const [data, setData] = useState({ products: [], databaseItems: [], loading: false, error: "" });
  useEffect(() => {
    let cancelled = false;
    setData({ products: [], databaseItems: [], loading: Boolean(companyId && enabled), error: "" });
    if (companyId && enabled) loadJobProductCatalog(db, companyId).then((catalog) => {
      if (!cancelled) setData({ products: catalog.products, databaseItems: catalog.vendorItems, loading: false, error: "" });
    }).catch(() => {
      if (!cancelled) setData({ products: [], databaseItems: [], loading: false, error: "Products could not be loaded. Check product access and try again." });
    });
    return () => { cancelled = true; };
  }, [companyId, enabled]);
  return data;
}
