import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { userFacingErrorMessage } from "../../../utils/permissionErrors";
import {
  findLinkedProductForVendorItem, getProductDisplayName, getProductSellPriceCents,
  getVendorItemDisplayName, getVendorItemCostCents, linkedVendorItemsForProduct, isMergedCatalogRecord,
  productCatalogCollectionRef, vendorItemsCollectionRef,
} from "../../../utils/productCatalog";
import { saveVendorProductConnection } from "../../../utils/productVendorConnections";
import { workspaceButtonClass } from "../../../components/workspace/workspaceStyles";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function CatalogConnections({ productId, vendorItemId, catalog, onChange, revision }) {
  const { recentlySelectedCompany: companyId } = useContext(Context);
  const { can } = useCompanyPermissions();
  const [data, setData] = useState({ products: [], vendorItems: [] });
  const [loading, setLoading] = useState(!catalog);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (catalog || !companyId) return;
    setLoading(true);
    setError("");
    try {
      const [products, vendors] = await Promise.all([
        getDocs(productCatalogCollectionRef(db, companyId)), getDocs(vendorItemsCollectionRef(db, companyId)),
      ]);
      const records = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
      if (generation !== loadGeneration.current) return;
      setData({ products: records(products), vendorItems: records(vendors) });
    } catch (failure) {
      if (generation !== loadGeneration.current) return;
      setError(userFacingErrorMessage(failure, "Could not load catalog connections."));
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [catalog, companyId]);
  useEffect(() => { setSelectedId(""); setSearch(""); setData({ products: [], vendorItems: [] }); load(); return () => { loadGeneration.current += 1; }; }, [load, productId, vendorItemId, revision]);
  const { products, vendorItems } = catalog || data;
  const product = products.find((item) => item.id === productId);
  const vendor = vendorItems.find((item) => item.id === vendorItemId);
  const currentProduct = vendor ? findLinkedProductForVendorItem(vendor, products) : null;
  const linked = product ? linkedVendorItemsForProduct(product, vendorItems, products) : [];
  const candidates = (productId ? vendorItems : products).filter(item => !isMergedCatalogRecord(item));
  const displayName = productId ? getVendorItemDisplayName : getProductDisplayName;
  const selectedVendor = productId ? vendorItems.find((item) => item.id === selectedId) : vendor;
  const previousProduct = selectedVendor ? findLinkedProductForVendorItem(selectedVendor, products) : null;
  const canEdit = can("854") && !loading && !error;
  const save = async (itemId, targetId, makePreferred = false) => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const before = vendorItems.find((item) => item.id === itemId);
      await saveVendorProductConnection({ db, companyId, vendorItemId: itemId, productId: targetId, knownProducts: products, makePreferred, expectedProductId: before?.productId || before?.genericItemId || "" });
      await onChange?.();
      await load();
      setSelectedId("");
      toast.success(targetId ? "Product connection saved." : "Product connection removed.");
    } catch (failure) { toast.error(userFacingErrorMessage(failure, "Could not save the product connection.")); }
    finally { setBusy(false); }
  };
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold text-slate-950">{productId ? "Connected Vendor Items" : "Connected Product"}</h2>
    <p className="mt-1 text-sm text-slate-500">{productId ? "Choose suppliers for this product. The preferred vendor supplies its catalog cost." : "Connect this supplier item to the product used for customer pricing and jobs."}</p>
    {loading ? <p className="mt-4">Loading connections...</p> : error ? <div role="alert" className="mt-4"><p>{error}</p><button type="button" onClick={load}>Retry connections</button></div> : <>
      {productId ? <ul className="mt-4 divide-y divide-slate-200">{linked.map((item) => <li key={item.id} className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center">
        <div><Link className="font-semibold text-blue-700 hover:underline" to={`/company/items/detail/${item.id}`}>{getVendorItemDisplayName(item)}</Link><p className="text-sm text-slate-500">{item.storeName || item.vendorName || "Vendor"} · {money(getVendorItemCostCents(item))} per {item.UOM || item.uom || "unit"}{item.id === product.preferredVendorItemId ? " · Preferred" : ""}</p></div>
        {canEdit && <div className="flex flex-wrap gap-2">{item.id !== product.preferredVendorItemId && <button type="button" disabled={busy} onClick={() => save(item.id, productId, true)} className={workspaceButtonClass({ tone: "blue" })}>Make preferred</button>}<button type="button" disabled={busy} onClick={() => save(item.id, "")} className={workspaceButtonClass({ tone: "slate" })}>Disconnect {getVendorItemDisplayName(item)}</button></div>}
      </li>)}</ul> : currentProduct ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><Link className="font-semibold text-blue-700 hover:underline" to={`/company/product-catalog/${currentProduct.id}`}>{getProductDisplayName(currentProduct)}</Link><p className="text-sm text-slate-500">Product sell price: {money(getProductSellPriceCents(currentProduct))}</p></div>{canEdit && <button type="button" disabled={busy} onClick={() => save(vendorItemId, "")} className={workspaceButtonClass({ tone: "slate" })}>Disconnect product</button>}</div> : <p className="mt-4 text-sm text-slate-500">No product connected.</p>}
      {productId && !linked.length && <p className="mt-3 text-sm text-slate-500">No vendor items connected. Enter a manual cost in Edit Product until a supplier is connected.</p>}
      {canEdit && <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
        <label className="block text-sm font-semibold">{productId ? "Find a vendor item" : "Find a product"}<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Search by name, SKU, or vendor" /></label>
        <label className="block text-sm font-semibold">{productId ? "Vendor item to connect" : "Product to connect"}<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={busy} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"><option value="">Choose {productId ? "a vendor item" : "a product"}</option>{candidates.filter((item) => [displayName(item), item.sku, item.storeName].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()) || item.id === selectedId).map((item) => <option key={item.id} value={item.id}>{displayName(item)}{productId ? ` — ${item.storeName || "Vendor"} — ${money(getVendorItemCostCents(item))}` : ""}</option>)}</select></label>
        {previousProduct && previousProduct.id !== (productId || selectedId) && selectedId && <p className="text-sm text-amber-700">This will move the vendor item from {getProductDisplayName(previousProduct)} to the selected product.</p>}
        <button type="button" disabled={busy || !selectedId} onClick={() => save(productId ? selectedId : vendorItemId, productId || selectedId)} className={workspaceButtonClass({ tone: "blue" })}>{busy ? "Saving..." : "Connect"}</button>
      </div>}
    </>}
  </section>;
}
