import React from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/solid';

const plans = [
    {
        name: 'Free',
        price: '$0',
        frequency: '/ month',
        description: 'For solo technicians or small teams just getting started.',
        features: [
            { name: 'Up to 50 Pools', included: true },
            { name: 'Unlimited Users', included: true },
            { name: 'Chemical Tracking', included: true },
            { name: 'Customer Service Reports', included: true },
            { name: 'Routing & Jobs', included: true },
            // Fix on update 3
            // { name: 'Recurring Invoicing', included: false },
            // { name: 'Stripe Integration', included: false },
            // { name: 'Customer Portal', included: false },
        ],
        cta: 'Start for Free',
        to: '/signUp',
        primary: false,
    },
    {
        name: 'Starter',
        price: '$50',
        frequency: '/ month',
        description: 'For growing businesses that need automated billing and client management.',
        features: [
            { name: '50–200 Pools', included: true },
            { name: 'Unlimited Users', included: true },
            { name: 'Chemical Tracking', included: true },
            { name: 'Customer Service Reports', included: true },
            { name: 'Routing & Jobs', included: true },
            // Fix on update 3
            // { name: 'Recurring Invoicing', included: true },
            // { name: 'Stripe Integration', included: true },
            // { name: 'Customer Portal', included: true },
        ],
        cta: 'Choose Starter',
        to: '/signUp',
        primary: true,
    },
    {
        name: 'Commercial',
        price: '$200',
        frequency: '/ month',
        description: 'For large operations managing multiple routes and extensive client lists.',
        features: [
            { name: '200+ Pools', included: true },
            { name: 'Unlimited Users', included: true },
            { name: 'Chemical Tracking', included: true },
            { name: 'Customer Service Reports', included: true },
            { name: 'Routing & Jobs', included: true },
            // Fix on update 3
            // { name: 'Recurring Invoicing', included: true },
            // { name: 'Stripe Integration', included: true },
            // { name: 'Customer Portal', included: true },
        ],
        cta: 'Choose Commercial',
        to: '/signUp',
        primary: false,
    },
];

export default function Products() {
    return (
        <div className="bg-white text-gray-800">
            <header className="fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <div className="pt-24">
                {/* Page Header */}
                <header className="bg-gray-50 py-20">
                    <div className="container mx-auto px-4 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold">Find the Right Plan for Your Business</h1>
                        <p className="mt-4 text-lg max-w-2xl mx-auto text-gray-600">
                            Simple, transparent pricing that scales with you. No hidden fees, ever.
                        </p>
                    </div>
                </header>

                {/* Pricing Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4">
                        <div className="grid lg:grid-cols-3 gap-8 items-stretch">
                            {plans.map((plan) => (
                                <div
                                    key={plan.name}
                                    className={`flex flex-col rounded-2xl shadow-lg border ${plan.primary ? 'border-blue-500' : 'border-gray-200'}`}
                                >
                                    <div className="p-8 text-center bg-white rounded-t-2xl">
                                        <h3 className="text-2xl font-semibold">{plan.name}</h3>
                                        <p className="mt-2 text-gray-500">{plan.description}</p>
                                        <div className="mt-6">
                                            <span className="text-5xl font-extrabold">{plan.price}</span>
                                            <span className="text-lg font-medium text-gray-500">{plan.frequency}</span>
                                        </div>
                                    </div>
                                    <div className="p-8 bg-gray-50 flex-grow">
                                        <ul className="space-y-4">
                                            {plan.features.map((feature) => (
                                                <li key={feature.name} className="flex items-center">
                                                    {feature.included ? (
                                                        <CheckIcon className="h-6 w-6 text-green-500 mr-3" />
                                                    ) : (
                                                        <XMarkIcon className="h-6 w-6 text-gray-400 mr-3" />
                                                    )}
                                                    <span className={feature.included ? 'text-gray-800' : 'text-gray-500'}>
                                                        {feature.name}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div className="p-8 bg-white rounded-b-2xl">
                                        <Link
                                            to={plan.to}
                                            className={`block w-full text-center rounded-lg py-3 font-semibold text-lg transition ${plan.primary
                                                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                                                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                                                }`}
                                        >
                                            {plan.cta}
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* FAQ Section */}
                <section className="bg-gray-50 py-20">
                    <div className="container mx-auto px-4 max-w-4xl">
                        <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
                        <div className="space-y-8">
                            <div>
                                <h3 className="text-xl font-semibold mb-2">Can I change my plan later?</h3>
                                <p className="text-gray-600">
                                    Yes, you can upgrade or downgrade your plan at any time directly from your account dashboard. Prorated charges or credits will be applied automatically.
                                </p>
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold mb-2">Is there a contract or commitment?</h3>
                                <p className="text-gray-600">
                                    No. All our plans are month-to-month. You can cancel anytime without any penalty.
                                </p>
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold mb-2">What happens if I go over my plan's pool limit?</h3>
                                <p className="text-gray-600">
                                    We'll notify you when you're approaching your limit. If you exceed it, we'll automatically upgrade you to the next plan tier to ensure uninterrupted service.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </div>
    );
}