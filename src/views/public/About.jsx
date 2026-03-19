import React from 'react';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { BuildingOffice2Icon, LightBulbIcon, UsersIcon } from '@heroicons/react/24/outline';

export default function About() {
    return (
        <div className="bg-white text-gray-800">
            <header className="fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <div className="pt-24">
                {/* Page Header */}
                <header className="bg-blue-600 text-white py-20">
                    <div className="container mx-auto px-4 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold">About Drip Drop</h1>
                        <p className="mt-4 text-lg text-blue-100">We're on a mission to simplify the pool service industry.</p>
                    </div>
                </header>

                {/* Our Story Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4 grid md:grid-cols-2 gap-12 items-center">
                        <div>
                            <h2 className="text-3xl font-bold mb-4">From the Pool Deck to Your Dashboard</h2>
                            <p className="text-gray-600 mb-4">
                                Drip Drop wasn’t born in a boardroom. It was conceived on the pool deck, by professionals who have spent over a decade servicing pools in the sun. We’ve managed the routes, balanced the chemicals, and handled the late-night calls. We know the daily grind, and we built Drip Drop to be the tool we always wished we had.
                            </p>
                            <p className="text-gray-600">
                                Our San Diego-based team combines hands-on pool industry experience with top-tier software development to create a platform that is both powerful and practical.
                            </p>
                        </div>
                        <div>
                            {/* Placeholder for a team or office image */}
                            <div className="bg-gray-200 h-80 rounded-lg shadow-md"></div>
                        </div>
                    </div>
                </section>

                {/* Mission and Vision Section */}
                <section className="bg-gray-50 py-20">
                    <div className="container mx-auto px-4">
                        <div className="grid md:grid-cols-2 gap-16">
                            <div className="text-center md:text-left">
                                <LightBulbIcon className="h-12 w-12 text-blue-500 mx-auto md:mx-0 mb-4" />
                                <h3 className="text-2xl font-bold mb-2">Our Mission</h3>
                                <p className="text-gray-600">
                                    To empower pool service professionals with intuitive, reliable, and affordable software that streamlines operations, automates administrative tasks, and enhances customer communication, allowing them to focus on what they do best.
                                </p>
                            </div>
                            <div className="text-center md:text-left">
                                <BuildingOffice2Icon className="h-12 w-12 text-blue-500 mx-auto md:mx-0 mb-4" />
                                <h3 className="text-2xl font-bold mb-2">Our Vision</h3>
                                <p className="text-gray-600">
                                    To become the central hub of the pool industry, connecting service companies, technicians, suppliers, and homeowners in a single, seamless ecosystem. We envision a future where technology makes the entire industry more efficient, transparent, and collaborative.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Who We Are Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4 text-center">
                        <UsersIcon className="h-12 w-12 text-blue-500 mx-auto mb-4" />
                        <h2 className="text-3xl font-bold mb-4">Designed for the Modern Pool Professional</h2>
                        <p className="max-w-3xl mx-auto text-gray-600">
                            Whether you're a solo operator or a growing company with 250+ accounts, Drip Drop is built to scale with you. We're obsessively focused on the user experience, guided by a "user-first" development philosophy. Your feedback doesn't just go into a suggestion box—it drives our product roadmap. When you talk, we listen, and we build.
                        </p>
                    </div>
                </section>

                {/* Join Us CTA */}
                <section className="bg-blue-600">
                    <div className="container mx-auto px-4 py-16 text-center">
                        <h2 className="text-3xl font-bold text-white mb-4">Join Us in Shaping the Future of Pool Service</h2>
                        <p className="text-blue-100 max-w-2xl mx-auto mb-8">
                            Have an idea? Need a feature? Let us know. We're building this for you.
                        </p>
                        <a
                            href="mailto:info@dripdrop-poolapp.com"
                            className="bg-white text-blue-600 px-8 py-3 rounded-full font-semibold text-lg hover:bg-gray-100 transition shadow-lg"
                        >
                            Get in Touch
                        </a>
                    </div>
                </section>
            </div>
            <Footer />
        </div>
    );
}