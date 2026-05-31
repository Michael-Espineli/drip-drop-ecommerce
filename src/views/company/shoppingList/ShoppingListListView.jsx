import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";

const ShoppingListListView = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const navigate = useNavigate();
    const [shoppingList, setShoppingList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("All");
    const [statusFilter, setStatusFilter] = useState("All");

    useEffect(() => {
        fetchShoppingItems();
    }, [recentlySelectedCompany]);

    const fetchShoppingItems = async () => {
        try {
            setIsLoading(true);

            const q = query(
                collection(db, "companies", recentlySelectedCompany, "shoppingList"),
                orderBy("name")
            );

            const querySnapshot = await getDocs(q);

            const list = querySnapshot.docs.map((docSnap) => {
                const data = docSnap.data();

                return {
                    id: docSnap.id,
                    category: data.category || "",
                    subCategory: data.subCategory || "",
                    status: data.status || "",
                    purchaserId: data.purchaserId || "",
                    purchaserName: data.purchaserName || "",
                    genericItemId: data.genericItemId || "",
                    name: data.name || "",
                    description: data.description || "",
                    datePurchased: data.datePurchased?.toDate
                        ? format(data.datePurchased.toDate(), "MM / d / yyyy")
                        : "",
                    quantity: data.quantity || "",
                    jobId: data.jobId || "",
                    customerId: data.customerId || "",
                    customerName: data.customerName || "",
                    userId: data.userId || "",
                    userName: data.userName || "",
                    dbItemId: data.dbItemId || "",
                };
            });

            setShoppingList(list);
        } catch (error) {
            console.log("Error loading shopping list");
            console.log(error);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredList = useMemo(() => {
        return shoppingList.filter((item) => {
            const matchesSearch =
                search.trim() === "" ||
                item.name.toLowerCase().includes(search.toLowerCase()) ||
                item.description.toLowerCase().includes(search.toLowerCase()) ||
                item.purchaserName.toLowerCase().includes(search.toLowerCase()) ||
                item.customerName.toLowerCase().includes(search.toLowerCase());

            const matchesCategory =
                categoryFilter === "All" || item.category === categoryFilter;

            const matchesStatus =
                statusFilter === "All" || item.status === statusFilter;

            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [shoppingList, search, categoryFilter, statusFilter]);

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-800">Shopping List</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Manage shopping items by category and status
                        </p>
                    </div>

                    <Link
                        to="/company/shopping-list/create"
                        className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                    >
                        New Item
                    </Link>
                </div>

                <div className="bg-white p-4 rounded-xl shadow-lg mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search items..."
                            className="w-full p-3 border border-gray-300 rounded-lg"
                        />

                        <select
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                        >
                            <option value="All">All Categories</option>
                            <option value="Personal">Personal</option>
                            <option value="Customer">Customer</option>
                            <option value="Job">Job</option>
                        </select>

                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                        >
                            <option value="All">All Statuses</option>
                            <option value="Need to Purchase">Need to Purchase</option>
                            <option value="Purchased">Purchased</option>
                            <option value="Installed">Installed</option>
                        </select>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    {filteredList.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left text-gray-700">
                                <thead className="text-sm text-gray-600 border-b border-gray-200 bg-gray-50">
                                    <tr>
                                        <th className="py-3 px-4">Name</th>
                                        <th className="py-3 px-4">Category</th>
                                        <th className="py-3 px-4">Sub Category</th>
                                        <th className="py-3 px-4">Status</th>
                                        <th className="py-3 px-4">Purchaser</th>
                                        <th className="py-3 px-4">Quantity</th>
                                        <th className="py-3 px-4">Date Purchased</th>
                                        <th className="py-3 px-4"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredList.map((item) => (
                                        <tr key={item.id} className="border-b border-gray-100"
                                            onClick={() => navigate(`/company/shopping-list/detail/${item.id}`)}
                                        >
                                            <td className="py-3 px-4 font-medium">{item.name}</td>
                                            <td className="py-3 px-4">{item.category || "—"}</td>
                                            <td className="py-3 px-4">{item.subCategory || "—"}</td>
                                            <td className="py-3 px-4">{item.status || "—"}</td>
                                            <td className="py-3 px-4">{item.purchaserName || "—"}</td>
                                            <td className="py-3 px-4">{item.quantity || "—"}</td>
                                            <td className="py-3 px-4">{item.datePurchased || "—"}</td>

                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg m-6 p-6 text-center">
                            No shopping list items found.
                        </div>
                    )}
                </div>
            </div>

            {isLoading && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        Loading shopping list...
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShoppingListListView;