import React, { useState, useContext, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { HomeIcon, CalendarDaysIcon, ChatBubbleBottomCenterTextIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { Context } from "../../context/AuthContext";

export default function Homeowners() {
    const navigate = useNavigate();

    const { user } = useContext(Context);
    useEffect(() => {
        if (!user) return;
        if (user.accountType === 'Company') {
            navigate('/company/dashboard');
        } else if (user.accountType === 'Client') {
            navigate('/client/dashboard');
        }

    }, [user]);

    return (
        <div className="bg-gray-50 text-gray-800">
            <header className="fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <div className="pt-24">
                {/* Hero Section */}
                <main className="bg-blue-600 text-white py-20">
                    <div className="container mx-auto px-4 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold">A Clear View of Your Pool Care</h1>
                        <p className="mt-4 text-lg max-w-3xl mx-auto text-blue-100">
                            As a customer of a Drip Drop-powered pool company, you get a transparent, convenient, and reliable way to manage your pool service.
                        </p>
                    </div>
                </main>


                {/* Login/Signup Section */}
                <section className="bg-white py-20">
                    <div className="container mx-auto px-4">
                        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                            <div className="bg-gray-100 p-8 rounded-lg text-center md:text-left">
                                <h2 className="text-2xl font-bold mb-3">Access Your Portal</h2>
                                <p className="text-gray-600 mb-6">Sign in to view your service history, pay invoices, and communicate with your pool professional.</p>
                                <Link
                                    to="/homeOwnerSignIn"
                                    className="inline-flex items-center bg-blue-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-blue-700 transition"
                                >
                                    <span>Homeowner Sign In</span>
                                    <ArrowRightIcon className="h-5 w-5 ml-2" />
                                </Link>
                            </div>
                            <div className="bg-gray-100 p-8 rounded-lg text-center md:text-left">
                                <h2 className="text-2xl font-bold mb-3">New User?</h2>
                                <p className="text-gray-600 mb-6">If your pool company has invited you to Drip Drop, sign up to create your account and access your portal.</p>
                                <Link
                                    to="/homeOwnerSignUp"
                                    className="inline-flex items-center bg-green-500 text-white px-6 py-3 rounded-full font-semibold hover:bg-green-600 transition"
                                >
                                    <span>Create Your Account</span>
                                    <ArrowRightIcon className="h-5 w-5 ml-2" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </section>
                {/* Features Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4">
                        <div className="text-center mb-16">
                            <h2 className="text-3xl font-bold">Your Personal Pool Dashboard</h2>
                            <p className="mt-2 text-gray-600">The Drip Drop client portal gives you everything you need at your fingertips.</p>
                        </div>
                        <div className="grid md:grid-cols-3 gap-12 text-center">
                            <div className="flex flex-col items-center">
                                <CalendarDaysIcon className="h-12 w-12 text-blue-500 mb-4" />
                                <h3 className="text-xl font-semibold mb-2">Service History</h3>
                                <p className="text-gray-600">View detailed records of every service visit, including chemical readings, tasks performed, and notes from your technician.</p>
                            </div>
                            <div className="flex flex-col items-center">
                                <ChatBubbleBottomCenterTextIcon className="h-12 w-12 text-blue-500 mb-4" />
                                <h3 className="text-xl font-semibold mb-2">Easy Communication</h3>
                                <p className="text-gray-600">Communicate directly with your pool service company, report issues, and ask questions all through the portal.</p>
                            </div>
                            <div className="flex flex-col items-center">
                                <HomeIcon className="h-12 w-12 text-blue-500 mb-4" />
                                <h3 className="text-xl font-semibold mb-2">All Your Properties in One Place</h3>
                                <p className="text-gray-600">If you have multiple properties, you can manage and view the service history for all of them under a single account.</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </div>
    );
}