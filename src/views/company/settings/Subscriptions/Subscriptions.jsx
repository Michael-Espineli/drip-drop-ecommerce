import React, { useState, useEffect, useContext, useCallback } from "react";
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { query, collection, getDocs, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../../../utils/config";
import { format } from 'date-fns';
import { Context } from "../../../../context/AuthContext";
import toast from 'react-hot-toast';

const functions = getFunctions();

const formatCurrency = (amount, currency = 'usd') => {
    if (amount === null || amount === undefined) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
    }).format(amount / 100);
};

export default function Subscriptions() {
    const { recentlySelectedCompany, dataBaseUser, stripeId } = useContext(Context);
    const [activeSubscription, setActiveSubscription] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const location = useLocation();

    const [paymentHistory, setPaymentHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [isPortalLoading, setIsPortalLoading] = useState(false);
    const [upcomingInvoice, setUpcomingInvoice] = useState(null);

    const fetchActiveSubscription = useCallback(async () => {
        if (!recentlySelectedCompany) {
            setError("No company selected.");
            setLoading(false);
            return null; // Return null to indicate failure
        }
        setLoading(true);
        setError('');
        try {
            const q = query(
                collection(db, 'companies', recentlySelectedCompany, "subscriptions"),
                where('status', 'in', ['active', 'trialing', 'pending_cancellation'])
            );
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const subDoc = querySnapshot.docs[0];
                const subData = subDoc.data();
                const subscription = {
                    id: subDoc.id,
                    ...subData,
                    started: subData.started?.toDate ? format(subData.started.toDate(), 'MMMM d, yyyy') : 'N/A',
                };
                setActiveSubscription(subscription);
                return subscription; // Return the subscription object
            } else {
                setActiveSubscription(null);
                return null; // Return null if no active sub
            }
        } catch (err) {
            console.error("Error fetching active subscription:", err);
            setError("Failed to fetch subscription details.");
            toast.error("Could not fetch subscription details.");
            return null; // Return null on error
        } finally {
            setLoading(false);
        }
    }, [recentlySelectedCompany]);

    const fetchPaymentHistory = useCallback(async () => {
        if (!stripeId) return;

        setLoadingHistory(true);
        try {
            const getStripePaymentHistory = httpsCallable(functions, 'getStripePaymentHistory');
            const result = await getStripePaymentHistory({ stripeCustomerId: stripeId });
            if (result.data.invoices) {
                setPaymentHistory(result.data.invoices);
            }
        } catch (error) {
            console.error("Error fetching payment history:", error);
            toast.error('Could not load payment history.');
        } finally {
            setLoadingHistory(false);
        }
    }, [stripeId]);
    
    const fetchUpcomingInvoice = useCallback(async (subscriptionId) => {
        if (!subscriptionId) return;
        try {
            const getUpcomingInvoice = httpsCallable(functions, 'getUpcomingInvoice');
            const result = await getUpcomingInvoice({ subscriptionId });
            if (result.data.upcomingInvoice) {
                setUpcomingInvoice(result.data.upcomingInvoice);
            }
        } catch (error) {
            // It's common for there to be no upcoming invoice (e.g., canceled plan), so we don't need a toast here.
            console.log("Info: Could not fetch upcoming invoice.", error.message);
        }
    }, []);

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        if (queryParams.get('success')) {
            toast.success('Subscription activated successfully!');
            navigate(location.pathname, { replace: true });
        }
        if (queryParams.get('canceled')) {
            toast.error('Subscription process was canceled.');
            navigate(location.pathname, { replace: true });
        }
        
        fetchActiveSubscription().then(subscription => {
            if (subscription) {
                fetchPaymentHistory();
                if (subscription.status !== 'pending_cancellation') {
                    fetchUpcomingInvoice(subscription.stripeSubscriptionId);
                }
            }
        });
    }, [fetchActiveSubscription, fetchPaymentHistory, fetchUpcomingInvoice, location.search, navigate, location.pathname]);

    const handleCancelSubscription = async () => {
        if (!activeSubscription || !activeSubscription.stripeSubscriptionId) {
            toast.error("No active subscription to cancel.");
            return;
        }

        if (window.confirm("Are you sure you want to cancel your subscription? This action will take effect at the end of your current billing period.")) {
            const cancelStripeSubscription = httpsCallable(functions, 'cancelStripeSubscription');
            const toastId = toast.loading('Canceling subscription...');

            try {
                await cancelStripeSubscription({ subscriptionId: activeSubscription.stripeSubscriptionId });
                toast.success('Subscription canceled. Your plan remains active until the end of the billing period.', { id: toastId, duration: 6000 });
                // Refetch data to show the updated status
                fetchActiveSubscription().then(subscription => {
                    if(subscription) {
                        // Clear upcoming invoice as there won't be one for a canceled plan.
                        setUpcomingInvoice(null);
                    }
                });
            } catch (error) {
                console.error("Cancellation Error:", error);
                toast.error(`Failed to cancel subscription: ${error.message}`, { id: toastId });
            }
        }
    };

    const handleRedirectToPortal = async () => {
        if (!stripeId) {
            toast.error('Stripe customer information not found.');
            return;
        }
        setIsPortalLoading(true);
        const toastId = toast.loading('Redirecting to secure portal...');
        try {
            const createStripePortalSession = httpsCallable(functions, 'createStripePortalSession');
            const result = await createStripePortalSession({
                stripeCustomerId: stripeId,
                returnUrl: window.location.href,
            });
            if (result.data.url) {
                toast.dismiss(toastId);
                window.location.href = result.data.url;
            } else {
                throw new Error('Could not create portal session.');
            }
        } catch (error) {
            console.error('Error creating Stripe portal session:', error);
            toast.error(error.message || 'Could not redirect to portal.', { id: toastId });
            setIsPortalLoading(false);
        }
    };
    
    return (
        <div className='px-4 md:px-8 py-10 bg-gray-900 text-white min-h-screen'>
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-bold mb-8 text-center">Manage Subscription</h1>

                {loading && <p className="text-center">Loading subscription...</p>}
                {error && <p className="text-center text-red-500">{error}</p>}

                {!loading && !error && (
                    <>
                        <div className="bg-gray-800 p-8 rounded-xl shadow-2xl mb-10">
                            {activeSubscription ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-400">Current Plan</h2>
                                        <p className="text-3xl font-bold text-white mt-1">{activeSubscription.name}</p>
                                        <p className="text-lg font-semibold capitalize mt-1 text-yellow-400">{activeSubscription.status.replace('_', ' ')}</p>
                                        {activeSubscription.status === 'pending_cancellation' && activeSubscription.cancel_at && (
                                            <p className="text-yellow-400 text-sm mt-1">
                                                Cancels on {format(activeSubscription.cancel_at.toDate(), 'MMMM d, yyyy')}
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-gray-400">Started on: <span className="font-semibold text-white">{activeSubscription.started}</span></p>
                                        <p className="text-gray-400">Price: <span className="font-semibold text-white">{formatCurrency(activeSubscription.price)}/month</span></p>
                                        {upcomingInvoice && (
                                            <>
                                                <p className="text-gray-400 mt-2">Next billing date: <span className="font-semibold text-white">{format(new Date(upcomingInvoice.next_payment_attempt * 1000), 'MMMM d, yyyy')}</span></p>
                                                <p className="text-gray-400">Next charge: <span className="font-semibold text-white">{formatCurrency(upcomingInvoice.amount_due, upcomingInvoice.currency)}</span></p>
                                            </>
                                        )}
                                    </div>
                                    <div className="md:col-span-2 mt-6 pt-6 border-t border-gray-700 space-y-4">
                                        <button 
                                            onClick={handleRedirectToPortal}
                                            disabled={isPortalLoading}
                                            className="w-full text-center py-3 px-4 bg-yellow-500 text-black font-bold rounded-lg hover:bg-yellow-600 transition duration-300 disabled:bg-gray-500 disabled:cursor-wait"
                                        >
                                            {isPortalLoading ? 'Redirecting...' : 'Manage Billing & Invoices'}
                                        </button>
                                         <div className="flex items-center space-x-4">
                                            <button onClick={() => navigate('/company/settings/subscriptions/picker')} className='w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-5 rounded-lg transition duration-300'>
                                                Change Plan
                                            </button>
                                            {activeSubscription.status !== 'pending_cancellation' && (
                                                 <button onClick={handleCancelSubscription} className='w-full bg-gray-600 hover:bg-red-700 text-white font-bold py-2 px-5 rounded-lg transition duration-300'>
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center">
                                    <h2 className="text-2xl font-bold mb-4">No Active Subscription</h2>
                                    <p className="text-gray-400 mb-6">You are currently on the Free plan.</p>
                                    <Link to="/company/settings/subscriptions/picker" className='bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg text-lg'>
                                        View Plans & Upgrade
                                    </Link>
                                </div>
                            )}
                        </div>

                        {activeSubscription && (
                            <div>
                                <h3 className="text-3xl font-bold mb-6 text-center">Recent Payments</h3>
                                {loadingHistory ? (
                                    <p className="text-center">Loading payment history...</p>
                                ) : paymentHistory.length > 0 ? (
                                    <div className="bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
                                        <ul className="divide-y divide-gray-700">
                                            {paymentHistory.map(invoice => (
                                                <li key={invoice.id} className="p-5 flex justify-between items-center hover:bg-gray-700/50 transition duration-200">
                                                    <div>
                                                        <p className="font-bold text-white">{format(new Date(invoice.created * 1000), 'MMMM d, yyyy')}</p>
                                                        <p className={`text-sm font-semibold ${invoice.paid ? 'text-green-400' : 'text-red-400'}`}>
                                                            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                                                        </p>
                                                    </div>
                                                    <div className='text-right'>
                                                        <p className="font-bold text-lg text-white">{formatCurrency(invoice.amount_paid, invoice.currency)}</p>
                                                        {invoice.hosted_invoice_url &&
                                                            <a href={invoice.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-sm text-yellow-500 hover:text-yellow-400 transition duration-200">
                                                                View Invoice
                                                            </a>
                                                        }
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : (
                                    <div className="text-center bg-gray-800 p-8 rounded-xl shadow-inner">
                                        <p>No payment history found.</p>
                                     </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
