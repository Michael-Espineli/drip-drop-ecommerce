import React, { useState, useEffect, useContext, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { query, doc, setDoc, collection, getDocs, orderBy } from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import DatePicker from "react-datepicker";
import 'react-datepicker/dist/react-datepicker.css';
import Select from 'react-select';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';

const CreateNewPurchase = () => {
    const { recentlySelectedCompany } = useContext(Context);
    const fileInputRef = useRef(null);
    const navigate = useNavigate();

    const [fileRef, setFileRef] = useState('');
    const [showSidebar, setShowSidebar] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const [refrence, setRefrence] = useState('');
    const [quantity, setQuantity] = useState('');
    const [purchaseDate, setPurchaseDate] = useState(new Date());
    const [formattedPurchaseDate, setFormattedPurchaseDate] = useState('');
    const [notes, setNotes] = useState('');

    const [companyUserList, setCompanyUserList] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);

    const [venderList, setVenderList] = useState([]);
    const [selectedVender, setSelectedVender] = useState(null);

    const [genericItemList, setGenericItemList] = useState([]);
    const [selectedGenericItem, setSelectedGenericItem] = useState(null);

    const [purchaseItemlist, setPurchaseItemList] = useState([]);

    const [billable, setBillable] = useState(false);
    const [rate, setRate] = useState('');
    const [rateUSD, setRateUSD] = useState('0');
    const [billingRate, setBillingRate] = useState('');
    const [billingRateUSD, setBillingRateUSD] = useState('0');
    const [sku, setSku] = useState('');
    const [uom, setUom] = useState(null);
    const [category, setCategory] = useState(null);
    const [subcategory, setSubcategory] = useState(null);
    const [color, setColor] = useState('');
    const [description, setDescription] = useState('');
    const [itemName, setItemName] = useState('');
    const [size, setSize] = useState('');
    const [vender, setVender] = useState(null);
    const [venderName, setVenderName] = useState('');
    const [venderId, setVenderId] = useState('');

    const [uomList] = useState([
        { id: 1, label: 'Gallon' },
        { id: 2, label: 'Pounds' },
        { id: 3, label: 'Oz' },
        { id: 4, label: 'Feet' },
        { id: 5, label: 'Square Feet' },
        { id: 6, label: 'Liter' },
        { id: 7, label: 'Inch' },
        { id: 8, label: 'Quart' },
        { id: 9, label: 'Tab' },
        { id: 10, label: 'Unit' },
    ]);

    const [categoryList] = useState([
        { id: 1, label: 'PVC' },
        { id: 2, label: 'Galvanized' },
        { id: 3, label: 'Chemicals' },
        { id: 4, label: 'Useables' },
        { id: 5, label: 'Equipment' },
        { id: 6, label: 'Parts' },
        { id: 7, label: 'Electrical' },
        { id: 8, label: 'Tools' },
        { id: 9, label: 'Misc' }
    ]);

    const [subcategoryList] = useState([
        { id: 1, label: 'Please Update' }
    ]);

    const selectStyles = {
        control: (provided) => ({
            ...provided,
            backgroundColor: 'white',
            border: '1px solid #d1d5db',
            borderRadius: '0.5rem',
            padding: '0.2rem',
            minHeight: '46px',
            boxShadow: 'none',
        }),
        menu: (provided) => ({
            ...provided,
            zIndex: 50,
            borderRadius: '0.75rem',
            overflow: 'hidden',
        }),
        valueContainer: (provided) => ({
            ...provided,
            paddingLeft: '0.5rem',
            paddingRight: '0.5rem',
        }),
    };

    function formatCurrency(number, locale = 'en-US', currency = 'USD') {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency
        }).format(number || 0);
    }

    useEffect(() => {
        (async () => {
            try {
                let q = query(collection(db, 'companies', recentlySelectedCompany, 'companyUsers'));
                const querySnapshot = await getDocs(q);
                setCompanyUserList([]);
                querySnapshot.forEach((docSnap) => {
                    const companyUserData = docSnap.data();
                    const companyUser = {
                        id: companyUserData.id,
                        userId: companyUserData.userId,
                        userName: companyUserData.userName,
                        roleName: companyUserData.roleName,
                        status: companyUserData.status,
                        workerType: companyUserData.workerType,
                        linkedCompanyId: companyUserData.linkedCompanyId,
                        linkedCompanyName: companyUserData.linkedCompanyName,
                        label: companyUserData.userName
                    };
                    setCompanyUserList(prev => [...prev, companyUser]);
                });

                let genericItemQuery = query(
                    collection(db, "companies", recentlySelectedCompany, 'settings', 'dataBase', 'dataBase'),
                    orderBy('name')
                );
                const genericItemQuerySnapshot = await getDocs(genericItemQuery);
                setGenericItemList([]);
                genericItemQuerySnapshot.forEach((docSnap) => {
                    const itemData = docSnap.data();
                    const genericItem = {
                        UOM: itemData.id,
                        billable: itemData.billable,
                        category: itemData.category,
                        color: itemData.color,
                        dateUpdated: itemData.dateUpdated,
                        description: itemData.description,
                        id: itemData.id,
                        name: itemData.name,
                        rate: itemData.rate,
                        size: itemData.size,
                        sku: itemData.sku,
                        storeName: itemData.storeName,
                        subCategory: itemData.subCategory,
                        timesPurchased: itemData.timesPurchased,
                        venderId: itemData.venderId,
                        vendorId: itemData.venderId,
                        label: `${itemData.name} - ${formatCurrency(itemData.rate / 100)} - ${itemData.sku}`
                    };
                    setGenericItemList(prev => [...prev, genericItem]);
                });

                let qv = query(collection(db, 'companies', recentlySelectedCompany, 'settings', 'vendors', 'vendor'));
                const querySnapshotv = await getDocs(qv);
                setVenderList([]);
                querySnapshotv.forEach((docSnap) => {
                    const venderData = docSnap.data();
                    const venderObj = {
                        id: venderData.id,
                        name: venderData.name,
                        email: venderData.email,
                        phoneNumber: venderData.phoneNumber,
                        streetAddress: venderData.address?.streetAddress,
                        city: venderData.address?.city,
                        state: venderData.address?.state,
                        zip: venderData.address?.zip,
                        label: venderData.name
                    };
                    setVenderList(prev => [...prev, venderObj]);
                });
            } catch (error) {
                console.log('Error');
                console.log(error);
            }
        })();
    }, [recentlySelectedCompany]);

    const handlePurchaseDateChange = (dateOption) => {
        setPurchaseDate(dateOption);
        const formattedDate = dateOption.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        setFormattedPurchaseDate(formattedDate);
    };

    const handleVenderChange = (selectedOption) => {
        setVenderName(selectedOption?.label || '');
        setVenderId(selectedOption?.id || '');
        setVender(selectedOption);
    };

    async function revealSideBar(e) {
        e.preventDefault();
        setShowSidebar(true);
    }

    async function closeSideBar(e) {
        e.preventDefault();
        setShowSidebar(false);
    }

    async function addNewItem(e) {
        e.preventDefault();

        toast.dismiss();

        if (quantity !== "" && selectedGenericItem?.id) {
            let rate = parseFloat(selectedGenericItem.rate) / 100;
            let quantityFloat = parseFloat(quantity);
            let totalCost = rate * quantityFloat;
            let id = "comp_pi_" + uuidv4();

            let newItem = {
                id: id,
                sku: selectedGenericItem.sku,
                itemId: selectedGenericItem.id,
                name: selectedGenericItem.name,
                billable: selectedGenericItem.billable,
                rate: rate.toFixed(2),
                quantity: quantityFloat,
                quantityString: quantity,
                description: selectedGenericItem.description,
                totalCost: totalCost.toFixed(2),
                category: selectedGenericItem.category,
            };

            setPurchaseItemList(prev => [...prev, newItem]);
            setQuantity('');
            setSelectedGenericItem(null);
        }
    }

    async function removeItem(e, itemId) {
        e.preventDefault();
        let workingList = purchaseItemlist.filter(item => item.id !== itemId);
        setPurchaseItemList(workingList);
    }

    async function submitReceipt(e) {
        e.preventDefault();
        if (!isLoading) {
            setIsLoading(true);
            let receiptId = 'com_rec_' + uuidv4();

            let cost = 0;
            let purchaseItemIds = [];

            for (let i = 0; i < purchaseItemlist.length; i++) {
                let item = purchaseItemlist[i];

                cost = cost + parseFloat(item.totalCost);
                let price = Math.floor(parseFloat(item.rate * 100));
                let priceBillable = Math.floor(parseFloat(item.billable * 100));

                purchaseItemIds.push(item.id);
                let purchaseItem = {
                    id: item.id,
                    receiptId: receiptId,
                    invoiceNum: refrence,
                    venderId: selectedVender?.id || '',
                    venderName: selectedVender?.name || '',
                    vendorId: selectedVender?.id || '',
                    vendorName: selectedVender?.name || '',
                    techId: selectedUser?.userId || '',
                    techName: selectedUser?.userName || '',
                    itemId: item.itemId,
                    name: item.name,
                    price: price,
                    quantityString: item.quantityString,
                    date: purchaseDate,
                    billable: item.billable,
                    invoiced: false,
                    returned: false,
                    customerId: "",
                    customerName: "",
                    sku: item.sku,
                    notes: notes,
                    jobId: "",
                    billingRate: priceBillable,
                };

                await setDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", item.id), purchaseItem);
            }

            cost = Math.floor(parseFloat(cost * 100));
            let costAfterTax = Math.floor(parseFloat(cost * 1.085));

            let receipt = {
                id: receiptId,
                invoiceNum: refrence,
                date: purchaseDate,
                storeId: selectedVender?.id || '',
                storeName: selectedVender?.name || '',
                tech: selectedUser?.userName || '',
                techId: selectedUser?.userId || '',
                purchasedItemIds: purchaseItemIds,
                numberOfItems: purchaseItemIds.length,
                cost: cost,
                costAfterTax: costAfterTax,
                pdfUrlList: [],
            };

            await setDoc(doc(db, "companies", recentlySelectedCompany, "receipts", receiptId), receipt);
            setIsLoading(false);
            navigate('/company/receipts/detail/' + receiptId);
        }
    }

    async function submitReceiptAndAddAnother(e) {
        e.preventDefault();
        if (!isLoading) {
            setIsLoading(true);
            let receiptId = 'com_rec_' + uuidv4();

            let cost = 0;
            let purchaseItemIds = [];

            for (let i = 0; i < purchaseItemlist.length; i++) {
                let item = purchaseItemlist[i];

                cost = cost + parseFloat(item.totalCost);
                let price = Math.floor(parseFloat(item.rate * 100));
                let priceBillable = Math.floor(parseFloat(item.billable * 100));

                purchaseItemIds.push(item.id);
                let purchaseItem = {
                    id: item.id,
                    receiptId: receiptId,
                    invoiceNum: refrence,
                    venderId: selectedVender?.id || '',
                    venderName: selectedVender?.name || '',
                    techId: selectedUser?.userId || '',
                    techName: selectedUser?.userName || '',
                    itemId: item.itemId,
                    name: item.name,
                    price: price,
                    quantityString: item.quantityString,
                    date: purchaseDate,
                    billable: item.billable,
                    invoiced: false,
                    returned: false,
                    customerId: "",
                    customerName: "",
                    sku: item.sku,
                    notes: notes,
                    jobId: "",
                    billingRate: priceBillable,
                };

                await setDoc(doc(db, "companies", recentlySelectedCompany, "purchasedItems", item.id), purchaseItem);
            }

            cost = Math.floor(parseFloat(cost * 100));
            let costAfterTax = Math.floor(parseFloat(cost * 1.085));

            let receipt = {
                id: receiptId,
                invoiceNum: refrence,
                date: purchaseDate,
                storeId: selectedVender?.id || '',
                storeName: selectedVender?.name || '',
                tech: selectedUser?.userName || '',
                techId: selectedUser?.userId || '',
                purchasedItemIds: purchaseItemIds,
                numberOfItems: purchaseItemIds.length,
                cost: cost,
                costAfterTax: costAfterTax,
                pdfUrlList: [],
            };

            await setDoc(doc(db, "companies", recentlySelectedCompany, "receipts", receiptId), receipt);

            setPurchaseItemList([]);
            setRefrence("");
            setNotes("");
            setIsLoading(false);
        }
    }

    async function rateInput(e) {
        e.preventDefault();
        try {
            let value = e.target.value.replace(/[^\d.]/g, '');
            setRate(value);

            const parts = value.split('.');
            if (parts.length > 1) {
                parts[1] = parts[1].slice(0, 2);
                value = parts.join('.');
            }

            if (!isNaN(value) && value !== '') {
                setRateUSD(value);
            } else {
                setRateUSD('0');
            }
        } catch (error) {
            console.log(error);
        }
    }

    async function billingRateInput(e) {
        e.preventDefault();
        try {
            let value = e.target.value.replace(/[^\d.]/g, '');
            setBillingRate(value);

            const parts = value.split('.');
            if (parts.length > 1) {
                parts[1] = parts[1].slice(0, 2);
                value = parts.join('.');
            }

            if (!isNaN(value) && value !== '') {
                setBillingRateUSD(value);
            } else {
                setBillingRateUSD('0');
            }
        } catch (error) {
            console.log(error);
        }
    }

    async function billableTrue() {
        setBillable(true);
    }

    async function billableFalse() {
        setBillable(false);
    }

    async function createNewDataBaseItem(e) {
        e.preventDefault();
        try {
            let id = 'com_sett_db_' + uuidv4();
            let rateCents = Math.floor(parseFloat(rateUSD * 100));
            let billingRateCents = Math.floor(parseFloat(billingRateUSD * 100));

            let item = {
                UOM: uom?.label || '',
                id: id,
                billable: billable,
                category: category?.label || '',
                color: color,
                dateUpdated: new Date(),
                description: description,
                name: itemName,
                rate: rateCents,
                size: size,
                sku: sku,
                storeName: "",
                subCategory: subcategory?.label || "",
                timesPurchased: 0,
                venderId: venderId || "",
                billingRate: billingRateCents
            };

            await setDoc(doc(db, "companies", recentlySelectedCompany, "settings", 'dataBase', 'dataBase', id), item);

            setItemName('');
            setBillable(false);
            setRate('');
            setRateUSD('0');
            setBillingRate('');
            setBillingRateUSD('0');
            setSku('');
            setUom(null);
            setCategory(null);
            setSubcategory(null);
            setColor('');
            setDescription('');
            setSize('');
            setVender(null);
            setVenderName('');
            setVenderId('');

            let genericItemQuery = query(
                collection(db, "companies", recentlySelectedCompany, 'settings', 'dataBase', 'dataBase'),
                orderBy('name')
            );

            const genericItemQuerySnapshot = await getDocs(genericItemQuery);
            setGenericItemList([]);

            genericItemQuerySnapshot.forEach((docSnap) => {
                const itemData = docSnap.data();
                const genericItem = {
                    id: itemData.id,
                    UOM: itemData.id,
                    billable: itemData.billable,
                    category: itemData.category,
                    color: itemData.color,
                    dateUpdated: itemData.dateUpdated,
                    description: itemData.description,
                    name: itemData.name,
                    rate: itemData.rate,
                    size: itemData.size,
                    sku: itemData.sku,
                    storeName: itemData.storeName,
                    subCategory: itemData.subCategory,
                    timesPurchased: itemData.timesPurchased,
                    venderId: itemData.venderId,
                    label: `${itemData.name} - ${formatCurrency(itemData.rate / 100)} - ${itemData.sku}`
                };
                setGenericItemList(prev => [...prev, genericItem]);
            });

            toast.dismiss();
            setShowSidebar(false);
        } catch (error) {
            console.log('Error From Create New Data Base Item');
            console.log(error);
        }
    }

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            setFileRef(file.name);
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current.click();
    };

    const totalEstimated = purchaseItemlist.reduce((sum, item) => sum + parseFloat(item.totalCost || 0), 0);

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <div>

                        <Link
                            to="/company/purchasedItems"
                            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            &larr; Back to Purchased Items
                        </Link>
                        <h2 className="text-3xl font-bold text-gray-800">Create New Receipt</h2>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={submitReceipt}
                            className="py-2 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                        >
                            Submit
                        </button>
                    </div>
                </div>

                {fileRef && (
                    <div className="mb-6 text-sm text-gray-600">
                        Selected file: <span className="font-medium text-gray-800">{fileRef}</span>
                    </div>
                )}

                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    accept="application/pdf"
                />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Receipt Details</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Purchase Date</label>
                                    <div className="w-full">
                                        <DatePicker
                                            selected={purchaseDate}
                                            onChange={(date) => handlePurchaseDateChange(date)}
                                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Reference</label>
                                    <input
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                        onChange={(e) => setRefrence(e.target.value)}
                                        type="text"
                                        placeholder="Reference"
                                        value={refrence}
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                                    <textarea
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Notes"
                                        value={notes}
                                        rows={3}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Store</label>
                                    <Select
                                        value={selectedVender}
                                        options={venderList}
                                        onChange={setSelectedVender}
                                        isSearchable
                                        placeholder="Select a Vendor"
                                        styles={selectStyles}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Tech</label>
                                    <Select
                                        value={selectedUser}
                                        options={companyUserList}
                                        onChange={setSelectedUser}
                                        isSearchable
                                        placeholder="Select a Tech"
                                        styles={selectStyles}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                                <h3 className="text-xl font-bold text-gray-800">Line Items</h3>

                            </div>

                            {purchaseItemlist.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left text-gray-700">
                                        <thead className="text-sm text-gray-600 border-b border-gray-200">
                                            <tr>
                                                <th className="py-3 px-4">SKU</th>
                                                <th className="py-3 px-4">Name</th>
                                                <th className="py-3 px-4">Description</th>
                                                <th className="py-3 px-4">Cost</th>
                                                <th className="py-3 px-4">Quantity</th>
                                                <th className="py-3 px-4">Total</th>
                                                <th className="py-3 px-4"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {purchaseItemlist.map(item => (
                                                <tr key={item.id} className="border-b border-gray-100">
                                                    <td className="py-3 px-4">{item.sku}</td>
                                                    <td className="py-3 px-4 font-medium">{item.name}</td>
                                                    <td className="py-3 px-4">{item.description}</td>
                                                    <td className="py-3 px-4">${item.rate}</td>
                                                    <td className="py-3 px-4">{item.quantity}</td>
                                                    <td className="py-3 px-4 font-semibold">${item.totalCost}</td>
                                                    <td className="py-3 px-4">
                                                        <button
                                                            onClick={(e) => removeItem(e, item.id)}
                                                            className="text-red-500 hover:text-red-700 font-semibold"
                                                        >
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-6 text-center">
                                    No line items added yet.
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-6 border-t pt-6">
                                <div className="md:col-span-7">
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Generic Item</label>
                                    <Select
                                        value={selectedGenericItem}
                                        options={genericItemList}
                                        onChange={setSelectedGenericItem}
                                        isSearchable
                                        placeholder="Select a Generic Item"
                                        styles={selectStyles}
                                    />
                                </div>

                                <div className="md:col-span-3">
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Quantity</label>
                                    <input
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                        onChange={(e) => setQuantity(e.target.value)}
                                        type="text"
                                        placeholder="Quantity"
                                        value={quantity}
                                    />
                                </div>

                                <div className="md:col-span-2 flex items-end">
                                    <button
                                        onClick={addNewItem}
                                        className="py-2 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                                    >
                                        Add Item
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={revealSideBar}
                                className="py-2 px-4 bg-gray-100 text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition"
                            >
                                Create Item
                            </button>
                        </div>
                        <div className="py-6">

                            <button
                                onClick={handleUploadClick}
                                className="py-2 px-4 bg-green-100 text-green-800 font-semibold rounded-lg hover:bg-green-200 transition"
                            >
                                Add File To Receipt
                            </button>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Receipt Summary</h3>
                            <div className="space-y-3 text-gray-700">
                                <div className="flex justify-between">
                                    <span>Purchase Date:</span>
                                    <span>{formattedPurchaseDate || purchaseDate.toLocaleDateString()}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Store:</span>
                                    <span>{selectedVender?.name || '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Tech:</span>
                                    <span>{selectedUser?.userName || '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Items:</span>
                                    <span>{purchaseItemlist.length}</span>
                                </div>
                                <div className="flex justify-between font-bold text-lg text-gray-800 border-t pt-3">
                                    <span>Total:</span>
                                    <span>{formatCurrency(totalEstimated)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <button
                                onClick={submitReceipt}
                                className="py-2 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                            >
                                Submit Receipt
                            </button>
                            <button
                                onClick={submitReceiptAndAddAnother}
                                className="py-2 px-4 bg-gray-100 text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition"
                            >
                                Submit And Add Another
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {isLoading && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-gray-800 font-semibold">
                        Loading...
                    </div>
                </div>
            )}

            {showSidebar && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-2xl font-bold text-gray-800">Create New Database Item</h3>
                            <button
                                onClick={closeSideBar}
                                className="py-2 px-4 bg-gray-100 text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition"
                            >
                                Close
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Item Name</label>
                                <input
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                    onChange={(e) => setItemName(e.target.value)}
                                    type="text"
                                    placeholder="Item Name"
                                    value={itemName}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Rate</label>
                                <div className="flex items-center border border-gray-300 rounded-lg px-3 bg-white">
                                    <span className="text-gray-500 mr-2">$</span>
                                    <input
                                        className="w-full p-3 outline-none"
                                        onChange={rateInput}
                                        type="text"
                                        placeholder="Rate"
                                        value={rate}
                                    />
                                </div>
                            </div>

                            <div className="flex items-end">
                                {billable ? (
                                    <button
                                        onClick={billableFalse}
                                        className="w-full py-3 px-4 bg-green-100 text-green-800 font-semibold rounded-lg hover:bg-green-200 transition"
                                    >
                                        Billable
                                    </button>
                                ) : (
                                    <button
                                        onClick={billableTrue}
                                        className="w-full py-3 px-4 bg-red-100 text-red-800 font-semibold rounded-lg hover:bg-red-200 transition"
                                    >
                                        Not Billable
                                    </button>
                                )}
                            </div>

                            {billable && (
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Billing Rate</label>
                                    <div className="flex items-center border border-gray-300 rounded-lg px-3 bg-white">
                                        <span className="text-gray-500 mr-2">$</span>
                                        <input
                                            className="w-full p-3 outline-none"
                                            onChange={billingRateInput}
                                            type="text"
                                            placeholder="Billing Rate"
                                            value={billingRate}
                                        />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">SKU</label>
                                <input
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                    onChange={(e) => setSku(e.target.value)}
                                    type="text"
                                    placeholder="SKU"
                                    value={sku}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Vendor</label>
                                <Select
                                    value={vender}
                                    options={venderList}
                                    onChange={handleVenderChange}
                                    isSearchable
                                    placeholder="Select a Vendor"
                                    styles={selectStyles}
                                />


                                <Link
                                    to="/company/vendors/create-new"
                                    className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                                >
                                    Create New Vendor
                                </Link>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">U.O.M.</label>
                                <Select
                                    value={uom}
                                    options={uomList}
                                    onChange={setUom}
                                    isSearchable
                                    placeholder="Select a UOM"
                                    styles={selectStyles}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Size</label>
                                <input
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                    onChange={(e) => setSize(e.target.value)}
                                    type="text"
                                    placeholder="Size"
                                    value={size}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Category</label>
                                <Select
                                    value={category}
                                    options={categoryList}
                                    onChange={setCategory}
                                    isSearchable
                                    placeholder="Select a Category"
                                    styles={selectStyles}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Sub-category</label>
                                <Select
                                    value={subcategory}
                                    options={subcategoryList}
                                    onChange={setSubcategory}
                                    isSearchable
                                    placeholder="Select a Sub-category"
                                    styles={selectStyles}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Color</label>
                                <input
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                    onChange={(e) => setColor(e.target.value)}
                                    type="text"
                                    placeholder="Color"
                                    value={color}
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                                <textarea
                                    className="w-full p-3 border border-gray-300 rounded-lg"
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Description"
                                    value={description}
                                    rows={3}
                                />
                            </div>

                            <div className="md:col-span-2">
                                <button
                                    onClick={createNewDataBaseItem}
                                    className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition"
                                >
                                    Create New Item
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreateNewPurchase;