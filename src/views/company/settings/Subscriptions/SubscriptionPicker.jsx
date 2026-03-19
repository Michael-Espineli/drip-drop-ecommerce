import React, { useState, useEffect, useContext, useCallback } from "react";
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { query, collection, getDocs, where } from "firebase/firestore";
import { db } from "../../../../utils/config";
import { Context } from "../../../../context/AuthContext";
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';

const functions = getFunctions();

// Helper to format currency
const formatCurrency = (amount) => {
    // Ensure amount is a number and not NaN
    const numberAmount = Number(amount);
    if (isNaN(numberAmount)) {
        return '$0.00'; // Return a default or error value
    }
    return (numberAmount / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
    });
};

const SubscriptionPicker = () => {
    const { dataBaseUser, recentlySelectedCompany, stripeId } = useContext(Context);
    const [subscriptionList, setSubscriptionList] = useState([]);
    const [activeSubscription, setActiveSubscription] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const location = useLocation();

    // New state for the preview modal
    const [previewInvoice, setPreviewInvoice] = useState(null);
    const [selectedPlanForPreview, setSelectedPlanForPreview] = useState(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        if (queryParams.get('canceled')) {
            toast.error('The subscription process was canceled.');
            navigate(location.pathname, { replace: true });
        }

        const fetchData = async () => {
            if (!recentlySelectedCompany) {
                setError("No company selected.");
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const plansQuery = query(collection(db, "subscriptions"), where('active', '==', true));
                const plansSnapshot = await getDocs(plansQuery);
                const subs = plansSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setSubscriptionList(subs.sort((a, b) => a.price - b.price));

                const activeSubQuery = query(
                    collection(db, 'companies', recentlySelectedCompany, "subscriptions"),
                    where('status', 'in', ['active', 'trialing'])
                );
                const activeSubSnapshot = await getDocs(activeSubQuery);
                if (!activeSubSnapshot.empty) {
                    const subDoc = activeSubSnapshot.docs[0];
                    setActiveSubscription({ id: subDoc.id, ...subDoc.data() });
                } else {
                    setActiveSubscription(null);
                }
            } catch (err) {
                console.error("Error fetching data: ", err);
                setError("Failed to load subscription data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [recentlySelectedCompany, location.search, navigate, location.pathname]);

    const handleConfirmUpdate = async () => {
        if (!selectedPlanForPreview || !activeSubscription) return;

        setShowPreviewModal(false);
        const toastId = toast.loading('Updating your subscription...');
        const updateStripeSubscription = httpsCallable(functions, 'updateStripeSubscription');

        try {
            await updateStripeSubscription({
                subscriptionId: activeSubscription.stripeSubscriptionId,
                newPriceId: selectedPlanForPreview.stripePriceId,
            });
            
            toast.success('Subscription updated successfully!', { id: toastId });
            // The webhook will handle the DB update, we just need to navigate.
            navigate('/company/settings/subscriptions');
        } catch (err) {
            console.error("Error updating subscription: ", err);
            toast.error(err.message || "Could not update subscription.", { id: toastId });
        } finally {
            setPreviewInvoice(null);
            setSelectedPlanForPreview(null);
        }
    };

    async function handlePlanSelection(selectedPlan) {
        if (activeSubscription && activeSubscription.stripePriceId === selectedPlan.stripePriceId) {
            toast.info("You are already on this plan.");
            return;
        }

        // SCENARIO 1: User has an active subscription and is changing plans.
        if (activeSubscription) {
            setIsPreviewLoading(true);
            const toastId = toast.loading('Generating preview...');

            try {
                const getSubscriptionUpdatePreview = httpsCallable(functions, 'getSubscriptionUpdatePreview');
                const result = await getSubscriptionUpdatePreview({
                    subscriptionId: activeSubscription.stripeSubscriptionId,
                    newPriceId: selectedPlan.stripePriceId,
                });

                if (result.data.invoice) {
                    setPreviewInvoice(result.data.invoice);
                    setSelectedPlanForPreview(selectedPlan);
                    setShowPreviewModal(true);
                    toast.dismiss(toastId);
                } else {
                    throw new Error("Could not fetch subscription preview.");
                }
            } catch (err) {
                console.error("Error getting subscription preview: ", err);
                toast.error(err.message || "Could not generate preview.", { id: toastId });
            } finally {
                setIsPreviewLoading(false);
            }
        } else {
            // SCENARIO 2: User is on a free plan or has no subscription.
            const toastId = toast.loading('Redirecting to checkout...');
            try {
                if (!stripeId || !dataBaseUser?.id || !recentlySelectedCompany) {
                    navigate('/company/settings/subscriptions/picker');
                     throw new Error("User, company, or Stripe customer information is missing.");
                }
                const successUrl = `${window.location.origin}/company/settings/subscriptions?success=true`;
                const cancelUrl = `${window.location.origin}/company/settings/subscriptions/picker?canceled=true`;

                const createCheckoutSession = httpsCallable(functions, 'createSubscriptionCheckoutSession');
                const result = await createCheckoutSession({
                    stripePriceId: selectedPlan.stripePriceId,
                    stripeId: stripeId,
                    userId: dataBaseUser.id,
                    companyId: recentlySelectedCompany,
                    successUrl: successUrl,
                    cancelUrl: cancelUrl,
                });

                if (result.data.url) {
                    toast.dismiss(toastId);
                    window.location.href = result.data.url;
                } else {
                    throw new Error('Could not retrieve checkout URL.');
                }
            } catch (err) {
                console.error("Error selecting subscription: ", err);
                toast.error(err.message || "Could not process subscription.", { id: toastId });
            }
        }
    }

    const PreviewModal = () => {
        if (!showPreviewModal || !previewInvoice || !selectedPlanForPreview) return null;

        const immediateCharge = previewInvoice.amount_due > 0 ? previewInvoice.amount_due : 0;
        const credit = previewInvoice.amount_due < 0 ? -previewInvoice.amount_due : 0;
        const nextPayment = previewInvoice.total - previewInvoice.amount_due;

        return (
            <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                <div className="bg-gray-800 rounded-lg shadow-xl p-8 max-w-lg w-full text-white">
                    <h2 className="text-3xl font-bold mb-6 text-center">Confirm Your Plan Change</h2>
                    
                    <div className="space-y-4 mb-8">
                        <div className="flex justify-between items-center bg-gray-700 p-3 rounded-lg">
                            <span className="font-semibold text-gray-300">Current Plan:</span>
                            <span className="font-bold text-lg">{activeSubscription.name}</span>
                        </div>
                        <div className="flex justify-between items-center bg-gray-700 p-3 rounded-lg">
                             <span className="font-semibold text-gray-300">New Plan:</span>
                            <span className="font-bold text-lg text-yellow-500">{selectedPlanForPreview.name}</span>
                        </div>
                    </div>

                    <div className="bg-gray-900 p-4 rounded-lg mb-8">
                        <h4 className="font-bold text-lg mb-4 text-center">Billing Summary</h4>
                        <div className="space-y-3">
                            {credit > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Credit for unused time:</span>
                                    <span className="text-green-400 font-medium">-{formatCurrency(credit)}</span>
                                </div>
                            )}
                            {immediateCharge > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Prorated charge for new plan:</span>
                                    <span className="font-medium">{formatCurrency(immediateCharge)}</span>
                                </div>
                            )}
                            <div className="border-t border-gray-700 my-2"></div>
                            <div className="flex justify-between text-xl">
                                <span className="font-bold">Immediate Total:</span>
                                <span className="font-extrabold text-yellow-500">{formatCurrency(immediateCharge)}</span>
                            </div>
                             <div className="flex justify-between mt-2">
                                <span className="text-gray-400">Next billing date ({new Date(previewInvoice.next_payment_attempt * 1000).toLocaleDateString()}):</span>
                                <span className="font-medium">{formatCurrency(nextPayment)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end space-x-4">
                        <button 
                            onClick={() => setShowPreviewModal(false)}
                            className="py-2 px-6 bg-gray-600 hover:bg-gray-500 rounded-lg font-bold transition duration-200"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleConfirmUpdate}
                            className="py-2 px-6 bg-yellow-500 hover:bg-yellow-600 text-black rounded-lg font-bold transition duration-200"
                        >
                            Confirm Update
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <PreviewModal />
            <div className='px-4 md:px-8 py-10 bg-gray-800 text-white min-h-screen'>
                 <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-12">
                        <h1 className="text-4xl md:text-5xl font-bold mb-4">Choose Your Plan</h1>
                        <p className="text-lg text-gray-400">Select the perfect plan to fit the needs of your business.</p>
                        <Link to={`/company/settings/subscriptions`} className='text-yellow-500 hover:text-yellow-400 mt-4 inline-block'>&larr; Back to Subscription Management</Link>
                    </div>

                    {loading && <p className="text-center">Loading plans...</p>}
                    {isPreviewLoading && <p className="text-center">Generating preview...</p>}
                    {error && <p className="text-center text-red-500">{error}</p>}

                    {!loading && !error && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {subscriptionList.map(sub => {
                                const isCurrentPlan = activeSubscription && activeSubscription.stripePriceId === sub.stripePriceId;
                                return (
                                    <div key={sub.id} className={`bg-gray-700 rounded-lg shadow-xl p-8 flex flex-col ${isCurrentPlan ? 'border-2 border-yellow-500' : ''}`}>
                                        <h3 className="text-2xl font-bold mb-3">{sub.name}</h3>
                                        <p className="text-4xl font-extrabold mb-4">
                                            ${sub.price ? (sub.price / 100).toFixed(2) : '0'}
                                            {sub.price > 0 && <span className="text-lg font-medium text-gray-400">/ month</span>}
                                        </p>
                                        <p className="text-gray-400 mb-6 min-h-[50px]">{sub.description}</p>
                                        
                                        <ul className="space-y-4 mb-8 flex-grow">
                                            {sub.featureSet?.map((feature, index) => (
                                                <li key={index} className="flex items-start">
                                                    <svg className="w-6 h-6 text-green-400 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                                    <span>{feature}</span>
                                                </li>
                                            ))}
                                        </ul>

                                        <button
                                            onClick={() => handlePlanSelection(sub)}
                                            disabled={isCurrentPlan || isPreviewLoading}
                                            className={`mt-auto w-full font-bold py-3 px-6 rounded-lg text-lg transition duration-300 ${
                                                isCurrentPlan 
                                                ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                                                : isPreviewLoading 
                                                ? 'bg-gray-500 text-gray-300 cursor-wait'
                                                : 'bg-yellow-500 hover:bg-yellow-600 text-black'
                                            }`}
                                        >
                                            {isCurrentPlan ? 'Current Plan' : 'Select Plan'}
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

export default SubscriptionPicker;
