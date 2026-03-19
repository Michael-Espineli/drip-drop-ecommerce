import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { query, collection, getDocs, where, getCountFromServer, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Context } from '../../../context/AuthContext';
import { Customer } from '../../../utils/models/Customer';
import { ClipLoader } from 'react-spinners';

const UpgradeBanner = ({ remaining, onUpgrade }) => (
    <div className={`p-4 mb-6 rounded-2xl shadow-lg ${remaining <= 0 ? 'bg-red-100 border-red-500' : 'bg-yellow-100 border-yellow-500'} border-l-4`}>
        <div className="flex items-center justify-between">
            <div>
                <p className={`font-bold ${remaining <= 0 ? 'text-red-800' : 'text-yellow-800'}`}>
                    {remaining <= 0 ? 'Upgrade Required' : 'Approaching Limit'}
                </p>
                <p className={`text-sm ${remaining <= 0 ? 'text-red-700' : 'text-yellow-700'}`}>
                    {remaining <= 0 
                        ? 'You have reached your maximum number of customers. Please upgrade your plan to add more.'
                        : `You can only add ${remaining} more customer(s). Please upgrade your plan soon.`}
                </p>
            </div>
            <button onClick={onUpgrade} className={`px-4 py-2 text-sm font-bold text-white rounded-lg shadow-md transition-transform transform hover:scale-105 ${remaining <= 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-500 hover:bg-yellow-600'}`}>
                {remaining <= 0 ? 'Upgrade Now' : 'Upgrade Plan'}
            </button>
        </div>
    </div>
);

export default function Customers() {
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const [allCustomers, setAllCustomers] = useState([]);
    const [filteredCustomers, setFilteredCustomers] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [upgradeState, setUpgradeState] = useState({ isUnlimited: false, remaining: Infinity });

    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchCustomerData = async () => {
            setLoading(true);
            try {
                // Fetch all customers
                const customerQuery = query(collection(db, 'companies', recentlySelectedCompany, 'customers'), orderBy("firstName"));
                const customerSnapshot = await getDocs(customerQuery);
                const customerData = customerSnapshot.docs.map(doc => Customer.fromFirestore(doc));
                setAllCustomers(customerData);
                setFilteredCustomers(customerData);

                // Check subscription status
                // This logic is simplified for clarity, assuming you have a way to get the subscription details.
                // In a real app, you would fetch this from your subscription management service.
                const subQuery = query(collection(db, 'companies', recentlySelectedCompany, 'subscriptions'));
                const subSnap = await getDocs(subQuery);
                
                if (!subSnap.empty) {
                    const subData = subSnap.docs[0].data();
                    //Get universal subscription info
                    const unSubRef = doc(db, 'subscriptions', subData.dripDropSubscriptionId);
                    
                    const docSnap = await getDoc(unSubRef);
                    if (docSnap.exists()) {
                        const activeCount = customerData.filter(c => c.active).length;
                        // This is a placeholder for actual feature limits from your subscription model
                        const subscriptionFeatures = docSnap.data().features.filter(feature => feature.name === 'customerCount');
                        console.log("[][] ",subscriptionFeatures)
                        const customerLimit = subscriptionFeatures.limit
                        console.log("[][] ",customerLimit)

                        if (customerLimit === -1) {
                            setUpgradeState({ isUnlimited: true, remaining: Infinity });
                        } else {
                            setUpgradeState({ isUnlimited: false, remaining: customerLimit - activeCount });
                        }
                    }
                } else {
                    // Default to a free plan limit if no active subscription
                    const activeCount = customerData.filter(c => c.active).length;
                    const freeLimit = 5;
                    setUpgradeState({ isUnlimited: false, remaining: freeLimit - activeCount })
                }

            } catch (error) {
                console.error("Error fetching customer data: ", error);
            } finally {
                setLoading(false);
            }
        };

        fetchCustomerData();
    }, [recentlySelectedCompany]);

    useEffect(() => {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        const filtered = allCustomers.filter(customer =>
            `${customer.firstName} ${customer.lastName}`.toLowerCase().includes(lowerCaseSearchTerm) ||
            customer.email.toLowerCase().includes(lowerCaseSearchTerm) ||
            customer.billingAddress?.streetAddress.toLowerCase().includes(lowerCaseSearchTerm)
        );
        setFilteredCustomers(filtered);
    }, [searchTerm, allCustomers]);

    const handleUpgradeClick = () => navigate('/company/settings/subscriptions/picker');

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
                    <div className="flex space-x-4">
                        <Link to="/company/customers/bulk-upload" className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                            Upload Bulk
                        </Link>
                        <Link to="/company/customers/createNew" 
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700"
                        >
                            + Create New
                        </Link>
                    </div>
                </div>

                {/* Upgrade Banner */}
                {!upgradeState.isUnlimited && upgradeState.remaining < 10 && (
                    <UpgradeBanner remaining={upgradeState.remaining} onUpgrade={handleUpgradeClick} />
                )}

                {/* Main Content */}
                <div className="bg-white p-6 rounded-2xl shadow-lg">
                    <div className="mb-4">
                        <input 
                            type="text"
                            placeholder="Search customers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {loading ? (
                        <div className="flex justify-center items-center py-12">
                            <ClipLoader size={40} color="#4A90E2" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Name</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Contact</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Address</th>
                                        <th className="px-4 py-3 text-sm font-semibold text-gray-600">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCustomers.map(customer => (
                                        <tr 
                                            key={customer.id} 
                                            onClick={() => navigate(`/company/customers/details/${customer.id}`)} 
                                            className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                                        >
                                            <td className="px-4 py-4">
                                                <p className="font-medium text-gray-900">{customer.displayAsCompany ? customer.companyName : `${customer.firstName} ${customer.lastName}`}</p>
                                            </td>
                                            <td className="px-4 py-4">
                                                <p className="text-sm text-gray-800">{customer.email}</p>
                                                <p className="text-sm text-gray-600">{customer.phoneNumber}</p>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-gray-600">
                                                {customer.billingAddress?.streetAddress}
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${customer.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                                    {customer.active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredCustomers.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="text-center py-12 text-gray-500">
                                                No customers found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
