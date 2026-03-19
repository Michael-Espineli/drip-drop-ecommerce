import React, { useState, useContext, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { Context } from "../../context/AuthContext";

export default function Company() {
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
                <main className="py-20">
                    <div className="container mx-auto px-4 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold mb-4">For Pool Service Companies</h1>
                        <p className="max-w-3xl mx-auto text-lg text-gray-600 mb-12">
                            Run your entire business on one platform. From scheduling and routing to billing and customer communication, Drip Drop provides the tools you need to succeed and scale.
                        </p>

                        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto text-left">
                            <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-xl transition">
                                <h2 className="text-2xl font-bold mb-3">Already have an account?</h2>
                                <p className="text-gray-600 mb-6">Sign in to manage your team, routes, and customers.</p>
                                <Link
                                    to="/signIn"
                                    className="flex items-center justify-between bg-blue-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-blue-700 transition"
                                >
                                    <span>Sign In</span>
                                    <ArrowRightIcon className="h-5 w-5" />
                                </Link>
                            </div>
                            <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-xl transition">
                                <h2 className="text-2xl font-bold mb-3">New to Drip Drop?</h2>
                                <p className="text-gray-600 mb-6">Create an account to start your free trial and see how Drip Drop can transform your business.</p>
                                <Link
                                    to="/signUp"
                                    className="flex items-center justify-between bg-green-500 text-white px-6 py-3 rounded-full font-semibold hover:bg-green-600 transition"
                                >
                                    <span>Sign Up for Free</span>
                                    <ArrowRightIcon className="h-5 w-5" />
                                </Link>
                            </div>
                        </div>

                        <div className="mt-16 max-w-4xl mx-auto">
                            <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-xl transition text-left">
                                <h2 className="text-2xl font-bold mb-3">Have an Invite Code?</h2>
                                <p className="text-gray-600 mb-6">
                                    If you've been invited to join a company on Drip Drop, redeem your invite code here to get started.
                                </p>
                                <Link
                                    to="/reedemInviteCode"
                                    className="flex items-center justify-between bg-gray-700 text-white px-6 py-3 rounded-full font-semibold hover:bg-gray-800 transition"
                                >
                                    <span>Redeem Invite</span>
                                    <ArrowRightIcon className="h-5 w-5" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </main>
            </div>

            <Footer />
        </div>
    );
}