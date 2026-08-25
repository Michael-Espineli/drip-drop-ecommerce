import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { arrayUnion, getDocs, orderBy, query, writeBatch } from "firebase/firestore";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  buildProductFromVendorItem,
  buildVendorItemProductPatch,
  findSuggestedProductForVendorItem,
  getProductDisplayName,
  getProductSellPriceCents,
  getVendorItemCostCents,
  getVendorItemDisplayName,
  productCatalogCollectionRef,
  productCatalogDocRef,
  vendorItemDocRef,
  vendorItemsCollectionRef,
} from "../../../utils/productCatalog";

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const dollarsFromCents = (value) => {
  const cents = Number(value || 0);
  return cents ? (cents / 100).toFixed(2) : "";
};

const centsFromDollarInput = (value) => {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const buildImportRows = (vendorItems, products) =>
  vendorItems.map((vendorItem) => {
    const linkedProduct = findSuggestedProductForVendorItem(vendorItem, products);
    const alreadyLinked = Boolean(vendorItem.productId || vendorItem.genericItemId);

    return {
      id: vendorItem.id,
      selected: !alreadyLinked,
      vendorItem,
      alreadyLinked,
      mode: linkedProduct ? "connect" : "create",
      productId: linkedProduct?.id || "",
      productName: linkedProduct ? getProductDisplayName(linkedProduct) : getVendorItemDisplayName(vendorItem),
      sellPrice: dollarsFromCents(vendorItem.sellPrice ?? vendorItem.billingRate ?? 0),
    };
  });

const ProductCatalogImport = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const productCatalogPath = "/company/product-catalog";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [vendorItems, setVendorItems] = useState([]);
  const [rows, setRows] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showLinked, setShowLinked] = useState(false);
  const [progress, setProgress] = useState({
    open: false,
    total: 0,
    current: 0,
    currentName: "",
    createdProductCount: 0,
    linkedVendorItemCount: 0,
    status: "",
    done: false,
  });

  const loadImportData = useCallback(async () => {
    if (!recentlySelectedCompany) return;

    setLoading(true);
    try {
      const [productSnap, vendorItemSnap] = await Promise.all([
        getDocs(query(productCatalogCollectionRef(db, recentlySelectedCompany), orderBy("commonName"))),
        getDocs(query(vendorItemsCollectionRef(db, recentlySelectedCompany), orderBy("name"))),
      ]);

      const nextProducts = productSnap.docs.map((productDoc) => ({ id: productDoc.id, ...productDoc.data() }));
      const nextVendorItems = vendorItemSnap.docs.map((vendorItemDoc) => ({ id: vendorItemDoc.id, ...vendorItemDoc.data() }));

      setProducts(nextProducts);
      setVendorItems(nextVendorItems);
      setRows(buildImportRows(nextVendorItems, nextProducts));
    } catch (error) {
      console.error("Unable to load product reconciliation:", error);
      toast.error("Could not load vendor items for reconciliation.");
    } finally {
      setLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadImportData();
  }, [loadImportData]);

  const productOptions = useMemo(
    () => products.map((product) => ({ id: product.id, name: getProductDisplayName(product), product })),
    [products]
  );

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      if (!showLinked && row.alreadyLinked) return false;
      if (!normalizedSearch) return true;

      const item = row.vendorItem;
      return [
        getVendorItemDisplayName(item),
        item.sku,
        item.storeName,
        item.category,
        item.subCategory,
        row.productName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [rows, searchTerm, showLinked]);

  const selectedRows = useMemo(() => rows.filter((row) => row.selected), [rows]);
  const unlinkedRows = useMemo(() => rows.filter((row) => !row.alreadyLinked), [rows]);
  const selectedCount = selectedRows.length;
  const selectedCreateCount = selectedRows.filter((row) => row.mode === "create").length;
  const selectedConnectCount = selectedRows.filter((row) => row.mode === "connect").length;
  const visibleSelectedCount = visibleRows.filter((row) => row.selected).length;
  const unlinkedSelectedCount = unlinkedRows.filter((row) => row.selected).length;
  const unlinkedCount = vendorItems.filter((item) => !(item.productId || item.genericItemId)).length;

  const updateRow = (rowId, updates) => {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== rowId) return row;
        const nextRow = { ...row, ...updates };
        if (updates.productId !== undefined) {
          const product = products.find((item) => item.id === updates.productId);
          nextRow.productName = product ? getProductDisplayName(product) : nextRow.productName;
        }
        return nextRow;
      })
    );
  };

  const updateRowsByIds = (rowIds, updater) => {
    const rowIdSet = new Set(rowIds);
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (!rowIdSet.has(row.id)) return row;
        const updates = typeof updater === "function" ? updater(row) : updater;
        return { ...row, ...updates };
      })
    );
  };

  const selectVisibleRows = (selected) => {
    updateRowsByIds(visibleRows.map((row) => row.id), { selected });
  };

  const selectAllUnlinkedRows = () => {
    updateRowsByIds(unlinkedRows.map((row) => row.id), { selected: true });
  };

  const deselectAllRows = () => {
    setRows((currentRows) => currentRows.map((row) => ({ ...row, selected: false })));
  };

  const setSelectedRowsToCreateProducts = () => {
    updateRowsByIds(
      selectedRows.map((row) => row.id),
      (row) => ({
        mode: "create",
        productId: "",
        productName: getVendorItemDisplayName(row.vendorItem),
        selected: true,
      })
    );
  };

  const reconcileRows = async (rowsToReconcile, emptyMessage = "Select at least one vendor item to reconcile.") => {
    if (!recentlySelectedCompany) return;
    if (!rowsToReconcile.length) {
      toast.error(emptyMessage);
      return;
    }

    const invalidConnectRow = rowsToReconcile.find((row) => row.mode === "connect" && !row.productId);
    if (invalidConnectRow) {
      toast.error("Choose a product for every row set to connect.");
      return;
    }

    setSaving(true);
    setProgress({
      open: true,
      total: rowsToReconcile.length,
      current: 0,
      currentName: "",
      createdProductCount: 0,
      linkedVendorItemCount: 0,
      status: "Preparing reconciliation...",
      done: false,
    });
    try {
      let batch = writeBatch(db);
      let operationCount = 0;
      let createdProductCount = 0;
      let linkedVendorItemCount = 0;

      const updateProgressSnapshot = ({
        current = 0,
        currentName = "",
        status = "",
        done = false,
      } = {}) => {
        setProgress({
          open: true,
          total: rowsToReconcile.length,
          current,
          currentName,
          createdProductCount,
          linkedVendorItemCount,
          status,
          done,
        });
      };

      const commitIfNeeded = async () => {
        if (operationCount < 430) return;
        await batch.commit();
        batch = writeBatch(db);
        operationCount = 0;
      };

      for (const [rowIndex, row] of rowsToReconcile.entries()) {
        const now = new Date();
        let product = products.find((item) => item.id === row.productId) || null;
        const rowNumber = rowIndex + 1;
        const vendorItemName = getVendorItemDisplayName(row.vendorItem);
        const status = row.mode === "create" ? "Creating Product..." : "Connecting existing Product...";

        updateProgressSnapshot({
          current: rowNumber,
          currentName: vendorItemName,
          status,
        });

        if (row.mode === "create") {
          const productId = "com_prod_" + uuidv4();
          product = buildProductFromVendorItem({
            productId,
            vendorItem: row.vendorItem,
            overrides: {
              name: row.productName || getVendorItemDisplayName(row.vendorItem),
              sellPrice: centsFromDollarInput(row.sellPrice),
            },
            source: "vendorItemReconciliation",
            now,
          });
          batch.set(productCatalogDocRef(db, recentlySelectedCompany, productId), product);
          operationCount += 1;
          createdProductCount += 1;
          updateProgressSnapshot({
            current: rowNumber,
            currentName: vendorItemName,
            status,
          });
        } else if (product) {
          batch.update(productCatalogDocRef(db, recentlySelectedCompany, product.id), {
            storeItems: arrayUnion(getVendorItemDisplayName(row.vendorItem)),
            storeItemsIds: arrayUnion(row.vendorItem.id),
            vendorItemIds: arrayUnion(row.vendorItem.id),
            dateUpdated: now,
            updatedAt: now,
          });
          operationCount += 1;
        }

        if (product) {
          batch.update(
            vendorItemDocRef(db, recentlySelectedCompany, row.vendorItem.id),
            buildVendorItemProductPatch(product, now)
          );
          operationCount += 1;
          linkedVendorItemCount += 1;
          updateProgressSnapshot({
            current: rowNumber,
            currentName: vendorItemName,
            status,
          });
        }

        await commitIfNeeded();
      }

      if (operationCount > 0) {
        setProgress((current) => ({
          ...current,
          status: "Saving final batch...",
        }));
        await batch.commit();
      }

      toast.success(
        `Reconciled ${linkedVendorItemCount} vendor item${linkedVendorItemCount === 1 ? "" : "s"}${createdProductCount ? ` and created ${createdProductCount} product${createdProductCount === 1 ? "" : "s"}` : ""}.`
      );
      updateProgressSnapshot({
        current: rowsToReconcile.length,
        status: "Reconciliation complete.",
        done: true,
      });
      await loadImportData();
    } catch (error) {
      console.error("Unable to reconcile vendor items to products:", error);
      toast.error("Could not finish the Product Catalog reconciliation.");
      setProgress((current) => ({
        ...current,
        status: "Reconciliation failed. Check the console for details.",
        done: true,
      }));
    } finally {
      setSaving(false);
    }
  };

  const applyImport = async () => {
    await reconcileRows(selectedRows);
  };

  const createProductsFromAllUnlinked = async () => {
    const rowsToCreate = unlinkedRows.map((row) => ({
      ...row,
      selected: true,
      mode: "create",
      productId: "",
      productName: getVendorItemDisplayName(row.vendorItem),
    }));

    await reconcileRows(rowsToCreate, "There are no unlinked vendor items to create Products from.");
  };

  const progressPercent = progress.total > 0
    ? Math.round((Math.min(progress.current, progress.total) / progress.total) * 100)
    : 0;

  if (!recentlySelectedCompany) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Select a company to reconcile Product Catalog items.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Link to={productCatalogPath} className="app-back-link">
                &larr; Back to Product Catalog
              </Link>
              <p className="mt-4 text-xs font-bold uppercase tracking-wide text-blue-700">Product Catalog Reconciliation</p>
              <h1 className="mt-1 text-3xl font-bold text-slate-950">Reconcile Vendor Items</h1>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">
                Create Products from existing vendor items or connect vendor items to Products that already exist.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={createProductsFromAllUnlinked}
                disabled={loading || saving || !unlinkedRows.length}
                className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Working..." : `Create Products From All Unlinked Vendor Items (${unlinkedRows.length})`}
              </button>
              <button
                type="button"
                onClick={applyImport}
                disabled={loading || saving || !selectedCount}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Reconciling..." : `Reconcile Selected (${selectedCount})`}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Vendor Items</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{vendorItems.length}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Unlinked</p>
            <p className="mt-2 text-2xl font-bold text-amber-950">{unlinkedCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Products</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{products.length}</p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-5 md:grid-cols-[minmax(280px,1fr)_auto]">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Search vendor item, SKU, vendor, or product"
            />
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={showLinked}
                onChange={(event) => setShowLinked(event.target.checked)}
              />
              Show already linked
            </label>
          </div>

          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">Reconcile Selected</span> creates Products for selected rows set to Create Product and links rows set to Connect Existing.
              <span className="ml-0 block text-xs text-slate-500 sm:ml-2 sm:inline">
                {selectedCount} selected: {selectedCreateCount} create, {selectedConnectCount} connect.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => selectVisibleRows(true)}
                disabled={loading || saving || !visibleRows.length || visibleSelectedCount === visibleRows.length}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-50"
              >
                Select Visible ({visibleRows.length})
              </button>
              <button
                type="button"
                onClick={() => selectVisibleRows(false)}
                disabled={loading || saving || !visibleSelectedCount}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-50"
              >
                Deselect Visible ({visibleSelectedCount})
              </button>
              <button
                type="button"
                onClick={selectAllUnlinkedRows}
                disabled={loading || saving || !unlinkedRows.length || unlinkedSelectedCount === unlinkedRows.length}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-50"
              >
                Select All Unlinked ({unlinkedRows.length})
              </button>
              <button
                type="button"
                onClick={deselectAllRows}
                disabled={loading || saving || !selectedCount}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-50"
              >
                Deselect All ({selectedCount})
              </button>
              <button
                type="button"
                onClick={setSelectedRowsToCreateProducts}
                disabled={loading || saving || !selectedCount}
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100 disabled:opacity-50"
              >
                Set Selected to Create Products
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 px-4 py-3">Use</th>
                  <th className="border-b border-slate-200 px-4 py-3">Vendor Item</th>
                  <th className="border-b border-slate-200 px-4 py-3">Vendor</th>
                  <th className="border-b border-slate-200 px-4 py-3">Cost</th>
                  <th className="border-b border-slate-200 px-4 py-3">Mode</th>
                  <th className="border-b border-slate-200 px-4 py-3">Product</th>
                  <th className="border-b border-slate-200 px-4 py-3">Sell Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-sm text-slate-500">Loading vendor items...</td>
                  </tr>
                ) : visibleRows.length ? (
                  visibleRows.map((row) => {
                    const item = row.vendorItem;
                    return (
                      <tr key={row.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(event) => updateRow(row.id, { selected: event.target.checked })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-950">{getVendorItemDisplayName(item)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {[item.sku ? `SKU ${item.sku}` : "", item.category, item.UOM].filter(Boolean).join(" | ") || "--"}
                          </p>
                          {row.alreadyLinked ? (
                            <p className="mt-2 text-xs font-bold text-emerald-700">Already linked</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{item.storeName || item.vendorName || "--"}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">{moneyFromCents(getVendorItemCostCents(item))}</td>
                        <td className="px-4 py-3">
                          <select
                            value={row.mode}
                            onChange={(event) => updateRow(row.id, { mode: event.target.value, selected: true })}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="create">Create Product</option>
                            <option value="connect">Connect Existing</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          {row.mode === "connect" ? (
                            <select
                              value={row.productId}
                              onChange={(event) => updateRow(row.id, { productId: event.target.value, selected: true })}
                              className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            >
                              <option value="">Choose product</option>
                              {productOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={row.productName}
                              onChange={(event) => updateRow(row.id, { productName: event.target.value, selected: true })}
                              className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.mode === "connect" ? (
                            <span className="text-sm font-semibold text-slate-700">
                              {moneyFromCents(getProductSellPriceCents(products.find((product) => product.id === row.productId)))}
                            </span>
                          ) : (
                            <input
                              value={row.sellPrice}
                              onChange={(event) => updateRow(row.id, { sellPrice: event.target.value.replace(/[^0-9.]/g, ""), selected: true })}
                              className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                              placeholder="0.00"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                      No vendor items match this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {progress.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Product Catalog Reconciliation</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">
                  {progress.done ? "Reconciliation Finished" : "Reconciling Vendor Items"}
                </h2>
              </div>
              {progress.done && !saving ? (
                <button
                  type="button"
                  onClick={() => setProgress((current) => ({ ...current, open: false }))}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              ) : null}
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
                <span>{progress.current} of {progress.total}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{progress.status}</p>
              {progress.currentName ? (
                <p className="mt-1 break-words text-sm text-slate-600">{progress.currentName}</p>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Products Created</p>
                <p className="mt-1 text-2xl font-bold text-emerald-950">{progress.createdProductCount}</p>
              </div>
              <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Vendor Items Linked</p>
                <p className="mt-1 text-2xl font-bold text-blue-950">{progress.linkedVendorItemCount}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ProductCatalogImport;
