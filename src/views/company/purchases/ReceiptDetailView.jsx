import React, { useState, useEffect, useContext, useMemo, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
    query,
    collection,
    getDocs,
    doc,
    getDoc,
    where,
    updateDoc,
    writeBatch,
    arrayUnion,
    arrayRemove,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";

const ReceiptDetailView = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const { receiptId } = useParams();
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [purchaseList, setPurchaseList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState(false);
    const [edit, setEdit] = useState(false);

    const [receipt, setReceipt] = useState({
        id: "",
        cost: "",
        costAfterTax: "",
        costRaw: 0,
        costAfterTaxRaw: 0,
        tax: "",
        taxRaw: 0,
        date: "",
        dateRaw: null,
        invoiceNum: "",
        numberOfItems: "",
        pdfUrlList: [],
        purchasedItemIds: [],
        storeId: "",
        storeName: "",
        techId: "",
        techName: "",
    });

    const [editForm, setEditForm] = useState({
        invoiceNum: "",
        date: "",
        numberOfItems: "",
        storeName: "",
        techName: "",
        cost: "",
        costAfterTax: "",
    });

    useEffect(() => {
        fetchReceipt();
    }, [recentlySelectedCompany, receiptId]);

    const fetchReceipt = async () => {
        try {
            setIsLoading(true);

            const docRef = doc(db, "companies", recentlySelectedCompany, "receipts", receiptId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();

                const formattedDate = data.date?.toDate
                    ? format(data.date.toDate(), "MM / d / yyyy")
                    : "";
                const dateRaw = data.date?.toDate ? data.date.toDate() : data.date || null;

                const receiptData = {
                    id: data.id || docSnap.id || "",
                    cost: formatCurrency((data.cost || 0) / 100),
                    costAfterTax: formatCurrency((data.costAfterTax || 0) / 100),
                    costRaw: data.cost || 0,
                    costAfterTaxRaw: data.costAfterTax || 0,
                    tax: formatCurrency((data.tax || Math.max((data.costAfterTax || 0) - (data.cost || 0), 0)) / 100),
                    taxRaw: data.tax || Math.max((data.costAfterTax || 0) - (data.cost || 0), 0),
                    date: formattedDate,
                    dateRaw,
                    invoiceNum: data.invoiceNum || "",
                    numberOfItems: data.numberOfItems || 0,
                    pdfUrlList: data.pdfUrlList || [],
                    purchasedItemIds: data.purchasedItemIds || [],
                    storeId: data.storeId || "",
                    storeName: data.storeName || "",
                    techId: data.techId || "",
                    techName: data.techName || data.tech || "",
                };

                setReceipt(receiptData);

                setEditForm({
                    invoiceNum: data.invoiceNum || "",
                    date: dateRaw ? format(dateRaw, "yyyy-MM-dd") : "",
                    numberOfItems: data.numberOfItems || 0,
                    storeName: data.storeName || "",
                    techName: data.techName || data.tech || "",
                    cost: ((data.cost || 0) / 100).toString(),
                    costAfterTax: ((data.costAfterTax || 0) / 100).toString(),
                });

                const q = query(
                    collection(db, "companies", recentlySelectedCompany, "purchasedItems"),
                    where("receiptId", "==", receiptId)
                );

                const querySnapshot = await getDocs(q);

                const purchases = querySnapshot.docs.map((docSnap) => {
                    const purchaseData = docSnap.data();
                    const formattedPurchaseDate = purchaseData.date?.toDate
                        ? format(purchaseData.date.toDate(), "MM / d / yyyy")
                        : "";

                    const price = (purchaseData.price || 0) / 100;
                    const quantity = parseFloat(purchaseData.quantityString || 0);
                    const total = price * quantity;

                    return {
                        id: purchaseData.id || docSnap.id,
                        name: purchaseData.name,
                        invoiceNum: purchaseData.invoiceNum,
                        price,
                        quantityString: purchaseData.quantityString,
                        techName: purchaseData.techName,
                        venderName: purchaseData.venderName,
                        date: formattedPurchaseDate,
                        total,
                    };
                });

                setPurchaseList(purchases);
            } else {
                console.log("No such document!");
            }
        } catch (error) {
            console.log("Error loading receipt detail");
            console.log(error);
        } finally {
            setIsLoading(false);
        }
    };

    function formatCurrency(number, locale = "en-US", currency = "USD") {
        return new Intl.NumberFormat(locale, {
            style: "currency",
            currency,
        }).format(number || 0);
    }

    const itemSummary = useMemo(() => {
        const subtotal = purchaseList.reduce((total, item) => total + Number(item.total || 0), 0);
        const storedSubtotal = Number(receipt.costRaw || 0) / 100;
        const storedTax = Number(receipt.taxRaw || Math.max((receipt.costAfterTaxRaw || 0) - (receipt.costRaw || 0), 0)) / 100;
        const storedTotal = Number(receipt.costAfterTaxRaw || 0) / 100;

        return {
            subtotal,
            storedSubtotal,
            storedTax,
            storedTotal,
            subtotalDifference: storedSubtotal - subtotal,
        };
    }, [purchaseList, receipt.costAfterTaxRaw, receipt.costRaw, receipt.taxRaw]);

    const handleEditFieldChange = (field, value) => {
        setEditForm((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const editJob = () => {
        setEditForm({
            invoiceNum: receipt.invoiceNum || "",
            date: receipt.dateRaw ? format(receipt.dateRaw, "yyyy-MM-dd") : "",
            numberOfItems: receipt.numberOfItems || 0,
            storeName: receipt.storeName || "",
            techName: receipt.techName || "",
            cost: ((receipt.costRaw || 0) / 100).toString(),
            costAfterTax: ((receipt.costAfterTaxRaw || 0) / 100).toString(),
        });
        setEdit(true);
    };

    const cancelEditJob = () => {
        setEdit(false);
        setEditForm({
            invoiceNum: receipt.invoiceNum || "",
            date: receipt.dateRaw ? format(receipt.dateRaw, "yyyy-MM-dd") : "",
            numberOfItems: receipt.numberOfItems || 0,
            storeName: receipt.storeName || "",
            techName: receipt.techName || "",
            cost: ((receipt.costRaw || 0) / 100).toString(),
            costAfterTax: ((receipt.costAfterTaxRaw || 0) / 100).toString(),
        });
    };

    const saveEditChanges = async () => {
        try {
            setUpdating(true);

            const docRef = doc(db, "companies", recentlySelectedCompany, "receipts", receiptId);
            const parsedDate = editForm.date ? new Date(`${editForm.date}T00:00:00`) : null;
            const costCents = Math.round((parseFloat(editForm.cost || 0) || 0) * 100);
            const costAfterTaxCents = Math.round((parseFloat(editForm.costAfterTax || 0) || 0) * 100);

            const updatePayload = {
                invoiceNum: editForm.invoiceNum || "",
                ...(parsedDate ? { date: parsedDate } : {}),
                numberOfItems: parseInt(editForm.numberOfItems || 0, 10),
                storeName: editForm.storeName || "",
                techName: editForm.techName || "",
                tech: editForm.techName || "",
                cost: costCents,
                costAfterTax: costAfterTaxCents,
                tax: Math.max(costAfterTaxCents - costCents, 0),
            };

            const linkedPurchasesQuery = query(
                collection(db, "companies", recentlySelectedCompany, "purchasedItems"),
                where("receiptId", "==", receiptId)
            );
            const linkedPurchasesSnap = await getDocs(linkedPurchasesQuery);
            const batch = writeBatch(db);

            batch.update(docRef, updatePayload);
            linkedPurchasesSnap.docs.forEach((purchaseDoc) => {
                batch.update(purchaseDoc.ref, {
                    invoiceNum: updatePayload.invoiceNum,
                    ...(parsedDate ? { date: parsedDate } : {}),
                    venderName: updatePayload.storeName,
                    vendorName: updatePayload.storeName,
                    techName: updatePayload.techName,
                });
            });

            await batch.commit();

            setReceipt((prev) => ({
                ...prev,
                ...updatePayload,
                costRaw: updatePayload.cost,
                costAfterTaxRaw: updatePayload.costAfterTax,
                taxRaw: updatePayload.tax,
                cost: formatCurrency(updatePayload.cost / 100),
                costAfterTax: formatCurrency(updatePayload.costAfterTax / 100),
                tax: formatCurrency(updatePayload.tax / 100),
                dateRaw: parsedDate || prev.dateRaw,
                date: parsedDate ? format(parsedDate, "MM / d / yyyy") : prev.date,
            }));

            setPurchaseList((prev) =>
                prev.map((item) => ({
                    ...item,
                    invoiceNum: updatePayload.invoiceNum,
                    date: parsedDate ? format(parsedDate, "MM / d / yyyy") : item.date,
                    venderName: updatePayload.storeName,
                    techName: updatePayload.techName,
                }))
            );

            setEdit(false);
        } catch (error) {
            console.log(error);
            console.log("Receipt Detail View Save");
        } finally {
            setUpdating(false);
        }
    };

    const deleteJob = async () => {
        const confirmed = window.confirm("Delete this receipt and all purchased items attached to it?");
        if (!confirmed) return;

        try {
            setUpdating(true);

            const docRef = doc(db, "companies", recentlySelectedCompany, "receipts", receiptId);
            const linkedPurchasesQuery = query(
                collection(db, "companies", recentlySelectedCompany, "purchasedItems"),
                where("receiptId", "==", receiptId)
            );
            const linkedPurchasesSnap = await getDocs(linkedPurchasesQuery);
            const batch = writeBatch(db);

            linkedPurchasesSnap.docs.forEach((purchaseDoc) => {
                batch.delete(purchaseDoc.ref);
            });
            batch.delete(docRef);

            await batch.commit();

            navigate("/company/purchased-items");
        } catch (error) {
            console.log(error);
            console.log("Receipt Detail View Delete");
        } finally {
            setUpdating(false);
        }
    };

    const handleAddFilesClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleAddFiles = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        try {
            setUploadingFiles(true);

            const uploadedUrls = [];

            for (const file of files) {
                const fileRef = ref(
                    storage,
                    `companies/${recentlySelectedCompany}/receipts/${receiptId}/${Date.now()}-${file.name}`
                );

                await uploadBytes(fileRef, file);
                const downloadURL = await getDownloadURL(fileRef);
                uploadedUrls.push(downloadURL);
            }

            const docRef = doc(db, "companies", recentlySelectedCompany, "receipts", receiptId);
            await updateDoc(docRef, {
                pdfUrlList: arrayUnion(...uploadedUrls),
            });

            setReceipt((prev) => ({
                ...prev,
                pdfUrlList: [...(prev.pdfUrlList || []), ...uploadedUrls],
            }));
        } catch (error) {
            console.log(error);
            console.log("Receipt Detail View Upload Files");
        } finally {
            setUploadingFiles(false);
            e.target.value = "";
        }
    };

    const removeUploadedFile = async (url) => {
        const confirmed = window.confirm("Remove this receipt file from the receipt?");
        if (!confirmed) return;

        try {
            setUpdating(true);
            const docRef = doc(db, "companies", recentlySelectedCompany, "receipts", receiptId);
            await updateDoc(docRef, {
                pdfUrlList: arrayRemove(url),
            });

            setReceipt((prev) => ({
                ...prev,
                pdfUrlList: (prev.pdfUrlList || []).filter((existingUrl) => existingUrl !== url),
            }));
        } catch (error) {
            console.log(error);
            console.log("Receipt Detail View Remove File");
        } finally {
            setUpdating(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <Link
                            to="/company/purchased-items"
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back to Purchased Items
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">Receipt Detail View</h2>
                    </div>

                    {!edit ? (
                        <button
                            onClick={editJob}
                            className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                        >
                            Edit
                        </button>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={saveEditChanges}
                                disabled={updating}
                                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                            >
                                Save
                            </button>
                            <button
                                onClick={cancelEditJob}
                                disabled={updating}
                                className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deleteJob}
                                disabled={updating}
                                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Receipt Details</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Receipt Reference</p>
                                    <p>{receipt.invoiceNum || "Receipt"}</p>
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Invoice Number</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.invoiceNum}
                                            onChange={(e) =>
                                                handleEditFieldChange("invoiceNum", e.target.value)
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{receipt.invoiceNum || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Date</p>
                                    {edit ? (
                                        <input
                                            type="date"
                                            value={editForm.date}
                                            onChange={(e) =>
                                                handleEditFieldChange("date", e.target.value)
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{receipt.date || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Store</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.storeName}
                                            onChange={(e) =>
                                                handleEditFieldChange("storeName", e.target.value)
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{receipt.storeName || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Tech</p>
                                    {edit ? (
                                        <input
                                            type="text"
                                            value={editForm.techName}
                                            onChange={(e) =>
                                                handleEditFieldChange("techName", e.target.value)
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{receipt.techName || "—"}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Number of Items</p>
                                    {edit ? (
                                        <input
                                            type="number"
                                            value={editForm.numberOfItems}
                                            onChange={(e) =>
                                                handleEditFieldChange("numberOfItems", e.target.value)
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{receipt.numberOfItems || 0}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Subtotal</p>
                                    {edit ? (
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editForm.cost}
                                            onChange={(e) =>
                                                handleEditFieldChange("cost", e.target.value)
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{receipt.cost || formatCurrency(0)}</p>
                                    )}
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-gray-500 mb-1">Total After Tax</p>
                                    {edit ? (
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editForm.costAfterTax}
                                            onChange={(e) =>
                                                handleEditFieldChange("costAfterTax", e.target.value)
                                            }
                                            className="w-full p-2 border border-gray-300 rounded-lg"
                                        />
                                    ) : (
                                        <p>{receipt.costAfterTax || formatCurrency(0)}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Items</h3>

                            {purchaseList.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left text-gray-700">
                                        <thead className="text-sm text-gray-600 border-b border-gray-200">
                                            <tr>
                                                <th className="py-3 px-4">Name</th>
                                                <th className="py-3 px-4">Price</th>
                                                <th className="py-3 px-4">Quantity</th>
                                                <th className="py-3 px-4">Total</th>
                                                <th className="py-3 px-4"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {purchaseList.map((item) => (
                                                <tr key={item.id} className="border-b border-gray-100">
                                                    <td className="py-3 px-4 font-medium">
                                                        <Link
                                                            to={`/company/purchased-items/detail/${item.id}`}
                                                            className="text-blue-600 hover:text-blue-800"
                                                        >
                                                            {item.name}
                                                        </Link>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        {formatCurrency(item.price)}
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        {item.quantityString}
                                                    </td>
                                                    <td className="py-3 px-4 font-semibold">
                                                        {formatCurrency(item.total)}
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <Link
                                                            to={`/company/purchased-items/detail/${item.id}`}
                                                            className="text-sm font-semibold text-gray-600 hover:text-gray-800"
                                                        >
                                                            View
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-6 text-center">
                                    No purchased items found for this receipt.
                                </div>
                            )}
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <div className="flex items-center justify-between gap-4 mb-4">
                                <h3 className="text-xl font-bold text-gray-800">Uploads</h3>

                                <button
                                    type="button"
                                    onClick={handleAddFilesClick}
                                    disabled={uploadingFiles}
                                    className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition disabled:opacity-50"
                                >
                                    {uploadingFiles ? "Uploading..." : "Add Photo/File"}
                                </button>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    accept="image/*,.pdf"
                                    onChange={handleAddFiles}
                                />
                            </div>

                            {receipt.pdfUrlList && receipt.pdfUrlList.length > 0 ? (
                                <div className="space-y-3">
                                    {receipt.pdfUrlList.map((url, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3"
                                        >
                                            <a
                                                href={url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-blue-600 hover:text-blue-800"
                                            >
                                                Receipt File {index + 1}
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => removeUploadedFile(url)}
                                                className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-6 text-center">
                                    No files uploaded yet.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Summary</h3>
                            <div className="space-y-3 text-gray-700">
                                <div className="flex justify-between">
                                    <span>Store:</span>
                                    <span>{receipt.storeName || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Tech:</span>
                                    <span>{receipt.techName || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Date:</span>
                                    <span>{receipt.date || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Items:</span>
                                    <span>{receipt.numberOfItems || 0}</span>
                                </div>
                                <div className="flex justify-between border-t pt-3">
                                    <span>Receipt Subtotal:</span>
                                    <span>{receipt.cost || formatCurrency(0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Receipt Tax:</span>
                                    <span>{formatCurrency(itemSummary.storedTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Item Subtotal:</span>
                                    <span>{formatCurrency(itemSummary.subtotal)}</span>
                                </div>
                                {Math.abs(itemSummary.subtotalDifference) >= 0.01 && (
                                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                        Receipt subtotal differs from linked item subtotal by{" "}
                                        {formatCurrency(itemSummary.subtotalDifference)}.
                                    </div>
                                )}
                                <div className="flex justify-between font-bold text-lg text-gray-800 border-t pt-3">
                                    <span>Receipt Total:</span>
                                    <span>{formatCurrency(itemSummary.storedTotal)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Quick Actions</h3>
                            <div className="space-y-3">
                                <Link
                                    to="/company/purchased-items"
                                    className="block w-full text-center py-3 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                                >
                                    Back to Purchased Items
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {(isLoading || updating || uploadingFiles) && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        {isLoading
                            ? "Loading receipt..."
                            : uploadingFiles
                                ? "Uploading files..."
                                : "Saving changes..."}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReceiptDetailView;
