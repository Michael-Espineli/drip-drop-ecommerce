import React from 'react';
import { Link } from 'react-router-dom';
import PublicHeader from '../layout/PublicHeader';
import Footer from '../layout/Footer';
import { BuildingOffice2Icon, CheckCircleIcon, MagnifyingGlassIcon, SparklesIcon } from '@heroicons/react/24/solid';

export default function Home() {
    return (
        <div className="bg-slate-50 text-slate-900">
            {/* Header is now fixed to the top with a solid background */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-cyan-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            {/* Main content area starts below the fixed header */}
            <div className="pt-24">
                {/* Hero Section */}
                <main className="relative pt-10 pb-20 md:pt-20 md:pb-32 text-center text-white bg-gradient-to-b from-cyan-600 to-blue-700">
                    <div className="container mx-auto px-4">
                        <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-4">
                            Modernize Your Pool Service Business
                        </h1>
                        <p className="text-lg md:text-xl text-cyan-50 max-w-3xl mx-auto mb-8">
                            Drip Drop is the all-in-one platform to manage your routes, billing, and customer communication, designed by pool professionals for pool professionals.
                        </p>
                        <div className="flex flex-col justify-center gap-3 sm:flex-row">
                            <Link
                                to="/signUp"
                                className="bg-white text-cyan-700 px-8 py-3 rounded-md font-semibold text-lg hover:bg-cyan-50 transition shadow-lg"
                            >
                                Start Your Free Account
                            </Link>
                            <Link
                                to="/companies"
                                className="border-2 border-white text-white px-8 py-3 rounded-md font-semibold text-lg hover:bg-white hover:text-cyan-700 transition"
                            >
                                Find Companies
                            </Link>
                        </div>
                    </div>
                </main>

                <section className="border-b border-cyan-100 bg-white py-14">
                    <div className="container mx-auto px-4">
                        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
                            <div>
                                <p className="text-sm font-bold uppercase tracking-wide text-cyan-700">Public company profiles</p>
                                <h2 className="mt-3 text-3xl font-bold text-slate-950 md:text-4xl">Homeowners can find Drip Drop companies before they create an account.</h2>
                                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                                    The public directory gives each company a profile link and a request-service link that can be shared on websites, emails, texts, and social pages.
                                </p>
                            </div>
                            <div className="grid gap-3">
                                <Link to="/companies" className="inline-flex items-center justify-between gap-3 rounded-md bg-cyan-600 px-5 py-4 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700">
                                    <span className="inline-flex items-center gap-2">
                                        <MagnifyingGlassIcon className="h-5 w-5" />
                                        Browse Companies
                                    </span>
                                    <span>View directory</span>
                                </Link>
                                <Link to="/company" className="inline-flex items-center justify-between gap-3 rounded-md border border-cyan-200 bg-cyan-50 px-5 py-4 text-sm font-semibold text-cyan-900 hover:bg-cyan-100">
                                    <span className="inline-flex items-center gap-2">
                                        <BuildingOffice2Icon className="h-5 w-5" />
                                        Add Your Company
                                    </span>
                                    <span>Company signup</span>
                                </Link>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Features Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl md:text-4xl font-bold">Why Drip Drop?</h2>
                            <p className="text-slate-600 mt-2">Everything you need to run a successful pool service business.</p>
                        </div>
                        <div className="grid md:grid-cols-3 gap-8 text-center">
                            <div className="bg-white p-8 rounded-md border border-slate-200 shadow-sm">
                                <CheckCircleIcon className="h-12 w-12 text-cyan-500 mx-auto mb-4" />
                                <h3 className="text-xl font-semibold mb-2">Streamline Operations</h3>
                                <p className="text-slate-600">Manage routes, schedules, and work orders with ease, saving you time and reducing headaches.</p>
                            </div>
                            {/* Update 3 */}
                            {/* <div className="bg-white p-8 rounded-xl shadow-md">
                                <CheckCircleIcon className="h-12 w-12 text-blue-500 mx-auto mb-4" />
                                <h3 className="text-xl font-semibold mb-2">Automate Billing</h3>
                                <p className="text-gray-600">Integrate with Stripe to automate invoicing and payments, ensuring you get paid on time, every time.</p>
                            </div> */}
                            <div className="bg-white p-8 rounded-md border border-slate-200 shadow-sm">
                                <SparklesIcon className="h-12 w-12 text-cyan-500 mx-auto mb-4" />
                                <h3 className="text-xl font-semibold mb-2">Enhance Communication</h3>
                                <p className="text-slate-600">Keep customers in the loop with a dedicated client portal and automated service notifications.</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* About Section */}
                <section className="bg-white py-20">
                    <div className="container mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built for the Trade, by the Trade</h2>
                            <p className="text-slate-600 mb-4">
                                Based in San Diego, Drip Drop was founded by pool industry veterans who understand the challenges you face. We built this software to be the solution we wish we had — powerful, intuitive, and affordable.
                            </p>
                            <Link
                                to="/about"
                                className="text-cyan-700 font-semibold hover:underline"
                            >
                                Learn More About Our Story &rarr;
                            </Link>
                        </div>
                        <div>
                            {/* Placeholder for an image or illustration */}
                            <div className="flex h-80 items-center justify-center rounded-md border border-cyan-100 bg-cyan-50 shadow-sm">
                                <SparklesIcon className="h-16 w-16 text-cyan-500" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="py-20 bg-cyan-600 text-white">
                    <div className="container mx-auto px-4 text-center">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Dive In?</h2>
                        <p className="text-cyan-50 max-w-2xl mx-auto mb-8">
                            Join hundreds of other pool professionals who have transformed their business with Drip Drop. Get started today with our free plan.
                        </p>
                        <Link
                            to="/signUp"
                            className="bg-white text-cyan-700 px-10 py-4 rounded-md font-bold text-lg hover:bg-cyan-50 transition shadow-lg"
                        >
                            Sign Up for Free
                        </Link>
                    </div>
                </section>
            </div>
            <Footer />
        </div>
    );
}
