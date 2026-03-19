import React, { useState, useEffect, useContext } from "react";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { query, collection, getDocs, orderBy } from "firebase/firestore";
import { Link } from "react-router-dom";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";

const DatabaseItems = () => {
  const { name, recentlySelectedCompany } = useContext(Context);

  const [genericItemList, setGenericItemList] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        //Get Generic Data Base Items
        let genericItemQuery = query(
          collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"),
          orderBy("name")
        );
        const genericItemQuerySnapshot = await getDocs(genericItemQuery);
        setGenericItemList([]);
        genericItemQuerySnapshot.forEach((doc) => {
          const itemData = doc.data();
          const dateUpdated = itemData.dateUpdated.toDate();
          const formattedDate1 = format(dateUpdated, "MM / d / yyyy");

          let rateDouble = itemData.rate / 100;
          let formattedRateUSD = formatCurrency(rateDouble);

          let billingRateDouble = itemData.billingRate / 100;
          let formattedBillingRateUSD = formatCurrency(billingRateDouble);

          const genericItem = {
            UOM: itemData.id,
            billable: itemData.billable,
            category: itemData.category,
            color: itemData.color,
            dateUpdated: formattedDate1,
            description: itemData.description,
            id: itemData.id,
            name: itemData.name,
            rate: formattedRateUSD,
            size: itemData.size,
            sku: itemData.sku,
            storeName: itemData.storeName,
            subCategory: itemData.subCategory,
            timesPurchased: itemData.timesPurchased,
            venderId: itemData.venderId,
            label: itemData.name + " " + itemData.rate + " " + itemData.sku,
            billingRate: formattedBillingRateUSD,
          };
          setGenericItemList((genericItemList) => [...genericItemList, genericItem]);
        });
      } catch (error) {
        console.log("Error");
        console.log(error);
      }
    })();
  }, []);

  function formatCurrency(number, locale = "en-US", currency = "USD") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
    }).format(number);
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Database Items</h2>
            <p className="text-sm text-slate-500 mt-1">Browse and manage your company catalog.</p>
          </div>
          <div className="flex space-x-4">
            <Link to="/company/items/bulk-upload" className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                Upload Bulk
            </Link>
            <Link
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700"
              to={`/company/items/createNew`}
            >
              Create New
            </Link>
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-md">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
                  </svg>
                </span>

                {/* Search Bar (no functionality change) */}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  type="text"
                  name="search"
                  placeholder="Search items"
                />
              </div>
            </div>

            <div className="text-xs text-slate-500">
              {genericItemList.length} item{genericItemList.length === 1 ? "" : "s"}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 border-b border-slate-200">Name</th>
                  <th className="px-5 py-3 border-b border-slate-200">Description</th>
                  <th className="px-5 py-3 border-b border-slate-200">Rate</th>
                  <th className="px-5 py-3 border-b border-slate-200">SKU</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 bg-white">
                {genericItemList?.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full hover:text-blue-700"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.name}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-600">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.description}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.rate}
                      </Link>
                    </td>

                    <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                      <Link
                        to={`/company/items/detail/${item.id}`}
                        className="block w-full h-full"
                        style={{ display: "block", width: "100%", height: "100%" }}
                      >
                        {item.sku}
                      </Link>
                    </td>
                  </tr>
                ))}

                {genericItemList.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <div className="mx-auto max-w-sm">
                        <div className="text-sm font-semibold text-slate-800">No database items found</div>
                        <div className="text-sm text-slate-500 mt-1">
                          Create a new item to start building your catalog.
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatabaseItems;
