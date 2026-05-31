import React, { useState, useContext, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { query, collection, getDocs, doc, updateDoc, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { Link, useNavigate } from 'react-router-dom';
import { Context } from '../../../context/AuthContext';
import { ServiceLocation } from '../../../utils/models/ServiceLocation';

const functions = getFunctions();

const SectionCard = ({ title, children, rightContent }) => (
    <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
            {rightContent}
        </div>
        {children}
    </div>
);

const EmptyState = ({ text }) => (
    <div className="py-8 text-center text-gray-500 text-sm">
        {text}
    </div>
);

const ContractTable = ({ contracts, navigate }) => {
    if (!contracts?.length) {
        return <EmptyState text="No contracts found in this section." />;
    }

    return (
        <div className="relative overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Receiver Name</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Amount</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {contracts.map((contract) => (
                        <tr
                            key={contract.id}
                            className="hover:bg-gray-50 transition-colors cursor-pointer"
                            onClick={() => navigate(`/company/contracts/contract/${contract.id}`)}
                        >
                            <td className="p-4 whitespace-nowrap text-sm text-gray-800 font-medium">
                                {contract.customerName || contract.receiverName || 'N/A'}
                            </td>
                            <td className="p-4 whitespace-nowrap text-sm text-gray-700">
                                ${Number((contract.rate || 0) / 100).toLocaleString()}
                            </td>
                            <td className="p-4 whitespace-nowrap text-sm text-gray-700">
                                {contract.status || 'N/A'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const SubscriptionTable = ({ subscriptions }) => {
    if (!subscriptions?.length) {
        return <EmptyState text="No Stripe subscriptions found." />;
    }

    return (
        <div className="relative overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Subscription ID</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Name</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Interval</th>
                        <th className="px-4 py-3 border-b text-left text-sm font-semibold text-gray-700">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {subscriptions.map((subscription) => (
                        <tr key={subscription.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 border-b text-sm text-gray-800">{subscription.id}</td>
                            <td className="px-4 py-3 border-b text-sm text-gray-800">
                                {subscription?.plan?.nickname || subscription?.plan?.nickName || 'N/A'}
                            </td>
                            <td className="px-4 py-3 border-b text-sm text-gray-800">
                                {subscription?.plan?.interval || 'N/A'}
                            </td>
                            <td className="px-4 py-3 border-b text-sm text-gray-800">
                                ${((subscription?.plan?.amount || 0) / 100).toLocaleString()}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

function Contracts() {
    const { stripeConnectedAccountId, user, recentlySelectedCompany } = useContext(Context);

    const [contractList, setContractList] = useState([]);
    const [contractsDraft, setContractsDraft] = useState([]);
    const [contractsAccepted, setContractsAccepted] = useState([]);
    const [contractsRejected, setContractsRejected] = useState([]);
    const [contractsPast, setContractsPast] = useState([]);
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);

                const draftQuery = query(
                    collection(db, 'contracts'),
                    where('status', '==', 'Draft'),
                    where('senderId', '==', recentlySelectedCompany)
                );
                const draftSnapshot = await getDocs(draftQuery);
                const draftContracts = draftSnapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        companyName: data.companyName,
                        receiverName: data.receiverName,
                        rate: data.rate,
                        status: data.status,
                        ...data,
                    };
                });
                setContractsDraft(draftContracts);

                const acceptedQuery = query(
                    collection(db, 'contracts'),
                    where('status', '==', 'Accepted'),
                    where('senderId', '==', recentlySelectedCompany)
                );
                const acceptedSnapshot = await getDocs(acceptedQuery);
                const acceptedContracts = acceptedSnapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        companyName: data.companyName,
                        receiverName: data.receiverName,
                        rate: data.rate,
                        status: data.status,
                        ...data,
                    };
                });
                setContractsAccepted(acceptedContracts);

                const rejectedQuery = query(
                    collection(db, 'contracts'),
                    where('status', '==', 'Rejected'),
                    where('senderId', '==', recentlySelectedCompany)
                );
                const rejectedSnapshot = await getDocs(rejectedQuery);
                const rejectedContracts = rejectedSnapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        companyName: data.companyName,
                        receiverName: data.receiverName,
                        rate: data.rate,
                        status: data.status,
                        ...data,
                    };
                });
                setContractsRejected(rejectedContracts);

                const pastQuery = query(
                    collection(db, 'contracts'),
                    where('status', '==', 'Past'),
                    where('senderId', '==', recentlySelectedCompany)
                );
                const pastSnapshot = await getDocs(pastQuery);
                const pastContracts = pastSnapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        companyName: data.companyName,
                        receiverName: data.receiverName,
                        rate: data.rate,
                        status: data.status,
                        ...data,
                    };
                });
                setContractsPast(pastContracts);
            } catch (error) {
                console.error('Error loading contracts:', error);
            }

            try {
                const getSubcriptionList = httpsCallable(functions, 'getSubcriptionList');
                const result = await getSubcriptionList({
                    customerId: 'cus_RBsy3ZCArWYVkW',
                    connectedAccount: stripeConnectedAccountId || 'acct_1QIep2PPLD20PPKn',
                    method: 'POST',
                });

                setContractList(result?.data?.subscriptions?.data || []);
            } catch (error) {
                console.error('Error loading Stripe subscriptions:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [stripeConnectedAccountId, user, recentlySelectedCompany]);

    async function acceptContract(e) {
        e.preventDefault();

        try {
            const callable = httpsCallable(functions, 'acceptContract');
            const result = await callable({
                name: 'name',
                description: 'description',
                customerId: 'cus_RBsy3ZCArWYVkW',
                priceId: 'price_1QJN3JPPLD20PPKnO8w5XHVa',
                connectedAccount: stripeConnectedAccountId || 'acct_1QIep2PPLD20PPKn',
                method: 'POST',
            });

            console.log(result?.data?.subscription);
        } catch (error) {
            console.error(error);
        }
    }

    async function acceptContract2(e) {
        e.preventDefault();

        try {
            const callable = httpsCallable(functions, 'acceptContract2');
            const result = await callable({
                name: 'name',
                description: 'description',
                customerId: 'cus_RBsy3ZCArWYVkW',
                priceId: 'price_1QJN3JPPLD20PPKnO8w5XHVa',
                connectedAccount: stripeConnectedAccountId || 'acct_1QIep2PPLD20PPKn',
                method: 'POST',
            });

            const session = result?.data?.session;
            if (session?.url) {
                window.location.href = session.url;
            }
        } catch (error) {
            console.error(error);
        }
    }

    async function setUpCustomer(e) {
        e.preventDefault();

        try {
            const callable = httpsCallable(functions, 'setUpCustomer');
            const result = await callable({
                name: 'name',
                description: 'description',
                connectedAccount: stripeConnectedAccountId || 'acct_1QIep2PPLD20PPKn',
                method: 'POST',
            });

            console.log(result?.data?.customer);
        } catch (error) {
            console.error(error);
        }
    }

    async function fixBodiesOfWater(e) {
        e.preventDefault();

        try {
            let q = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'));
            const querySnapshot = await getDocs(q);
            const locationData = querySnapshot.docs.map((docSnap) => ServiceLocation.fromFirestore(docSnap));

            for (let i = 0; i < locationData.length; i++) {
                const location = locationData[i];
                console.log('Updating Service Location : ' + location.id);

                await updateDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', location.id), {
                    isActive: true,
                });
            }

            let q2 = query(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'));
            const querySnapshot2 = await getDocs(q2);
            const bodiesOfWaterData = querySnapshot2.docs.map((docSnap) => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    ...data,
                };
            });

            for (let j = 0; j < bodiesOfWaterData.length; j++) {
                const bodyOfWater = bodiesOfWaterData[j];
                const bodyOfWaterRef = doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', bodyOfWater.id);
                await updateDoc(bodyOfWaterRef, {
                    isActive: true,
                });
                console.log('Updating Body Of Water : ' + bodyOfWater.id);
            }
        } catch (error) {
            console.error('fixBodiesOfWater Error!: ' + error);
        }
    }

    if (loading) {
        return (
            <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-7xl">
                    <div className="bg-white shadow-lg rounded-2xl p-6">
                        <p className="text-gray-600">Loading contracts...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-50 min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="mx-auto">
                <div className="bg-white shadow-lg rounded-2xl p-6 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <Link
                                to="/company/contracts"
                                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                &larr; Back to Contracts
                            </Link>
                            <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
                            <p className="text-gray-500 mt-1">
                                Manage draft, accepted, rejected, and past contract activity.
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <Link
                                to="/company/contracts/createNew/NA"
                                className="px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-xl shadow-sm hover:bg-yellow-100 transition"
                            >
                                Send New Contract
                            </Link>

                            <Link
                                to="/company/contracts/past"
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl shadow-sm hover:bg-gray-100 transition"
                            >
                                View Past
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-white shadow-lg rounded-2xl p-5">
                        <p className="text-sm text-gray-500">Draft</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{contractsDraft.length}</p>
                    </div>
                    <div className="bg-white shadow-lg rounded-2xl p-5">
                        <p className="text-sm text-gray-500">Accepted</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{contractsAccepted.length}</p>
                    </div>
                    <div className="bg-white shadow-lg rounded-2xl p-5">
                        <p className="text-sm text-gray-500">Rejected</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{contractsRejected.length}</p>
                    </div>
                    <div className="bg-white shadow-lg rounded-2xl p-5">
                        <p className="text-sm text-gray-500">Past</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{contractsPast.length}</p>
                    </div>
                </div>

                <SectionCard title="Accepted Contracts">
                    <ContractTable contracts={contractsAccepted} navigate={navigate} />
                </SectionCard>

                <SectionCard title="Draft Contracts">
                    <ContractTable contracts={contractsDraft} navigate={navigate} />
                </SectionCard>

                <SectionCard title="Rejected Contracts">
                    <ContractTable contracts={contractsRejected} navigate={navigate} />
                </SectionCard>

                <SectionCard title="Past Contracts">
                    <ContractTable contracts={contractsPast} navigate={navigate} />
                </SectionCard>

                <SectionCard title="Stripe Subscriptions">
                    <SubscriptionTable subscriptions={contractList} />
                </SectionCard>

                <SectionCard title="Developer Tools">
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={acceptContract}
                            className="px-4 py-2 text-sm font-medium text-black-700 bg-black-50 border black-yellow-200 rounded-xl shadow-sm hover:bg-black-100 transition"
                        >
                            Test Accept Contract
                        </button>

                        <button
                            onClick={acceptContract2}
                            className="px-4 py-2 text-sm font-medium text-black-700 bg-black-50 border black-yellow-200 rounded-xl shadow-sm hover:bg-black-100 transition"
                        >
                            Test Accept Contract 2
                        </button>

                        <button
                            onClick={setUpCustomer}
                            className="px-4 py-2 text-sm font-medium text-black-700 bg-black-50 border black-yellow-200 rounded-xl shadow-sm hover:bg-black-100 transition"
                        >
                            Test Set Up Customer
                        </button>

                        <button
                            onClick={fixBodiesOfWater}
                            className="px-4 py-2 text-sm font-medium text-black-700 bg-black-50 border black-yellow-200 rounded-xl shadow-sm hover:bg-black-100 transition"
                        >
                            Fix Bodies Of Water
                        </button>
                    </div>
                </SectionCard>
            </div>
        </div>
    );
}

export default Contracts;
