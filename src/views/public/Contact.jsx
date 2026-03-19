import React from 'react';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { EnvelopeIcon, ChatBubbleLeftRightIcon, SparklesIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';

export default function Contact() {

    return (
        <div className="bg-gray-50 text-gray-800">
            <header className="fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <div className="pt-24">
                {/* Page Header */}
                <header className="bg-blue-600 text-white py-20">
                    <div className="container mx-auto px-4 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold">Get in Touch</h1>
                        <p className="mt-4 text-lg text-blue-100">We'd love to hear from you. Here's how you can reach us.</p>
                    </div>
                </header>

                {/* Contact Form and Info Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4">
                        <div className="grid md:grid-cols-2 gap-16">
                            {/* Contact Form */}
                            {/* <div className="bg-white p-8 rounded-lg shadow-md">
                                <h2 className="text-2xl font-bold mb-6">Send Us a Message</h2>
                                <form >
                                    <div className="mb-4">
                                        <label htmlFor="name" className="block text-gray-700 font-semibold mb-2">Your Name</label>
                                        <input type="text" id="name" name="name" className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="email" className="block text-gray-700 font-semibold mb-2">Your Email</label>
                                        <input type="email" id="email" name="email" className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="message" className="block text-gray-700 font-semibold mb-2">Message</label>
                                        <textarea id="message" name="message" rows="5" className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
                                    </div>
                                    <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
                                        Submit
                                    </button>
                                </form>
                            </div> */}

                            {/* Contact Info */}
                            <div className="space-y-8">
                                <div className="flex items-start">
                                    <EnvelopeIcon className="h-8 w-8 text-blue-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">General Inquiries</h3>
                                        <p className="text-gray-600">For all general questions, please email us at:</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-blue-600 hover:underline">info@dripdrop-poolapp.com</a>
                                    </div>
                                </div>
                                <div className="flex items-start">
                                    <ChatBubbleLeftRightIcon className="h-8 w-8 text-blue-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">Sales & Demos</h3>
                                        <p className="text-gray-600">Interested in a demo or have pricing questions? Contact our sales team.</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-blue-600 hover:underline">info@dripdrop-poolapp.com</a>
                                    </div>
                                </div>
                                <div className="flex items-start">
                                    <SparklesIcon className="h-8 w-8 text-blue-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">Feedback & Ideas</h3>
                                        <p className="text-gray-600">Have a feature request or feedback? We're all ears.</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-blue-600 hover:underline">info@dripdrop-poolapp.com</a>
                                    </div>
                                </div>
                                <div className="flex items-start">
                                    <WrenchScrewdriverIcon className="h-8 w-8 text-blue-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">Support</h3>
                                        <p className="text-gray-600">Need help with the app? Our support team is here for you.</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-blue-600 hover:underline">info@dripdrop-poolapp.com</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </div>
    );
}