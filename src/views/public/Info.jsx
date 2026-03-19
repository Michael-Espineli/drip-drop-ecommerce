import React from 'react';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { InformationCircleIcon, StarIcon } from '@heroicons/react/24/outline';

export default function Info() {
    return (
        <div className="bg-gray-50 text-gray-800">
            <header className="fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <div className="pt-24">
                {/* Page Header */}
                <header className="bg-white py-16">
                    <div className="container mx-auto px-4 text-center">
                        <InformationCircleIcon className="h-16 w-16 text-blue-500 mx-auto mb-4" />
                        <h1 className="text-4xl md:text-5xl font-bold">General Information</h1>
                        <p className="mt-4 text-lg text-gray-600">A flexible page for your content.</p>
                    </div>
                </header>

                {/* Content Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4 max-w-4xl">
                        <div className="bg-white p-8 rounded-lg shadow-md">
                            <h2 className="text-2xl font-bold mb-4">Section Title</h2>
                            <p className="text-gray-600 mb-4">
                                This is a reusable info page template. You can populate this section with any content you need, such as FAQs, feature details, or company policies. The design is clean and easy to read, ensuring your message is delivered clearly.
                            </p>
                            <p className="text-gray-600 mb-6">
                                Use lists, bold text, and other formatting to structure your information effectively.
                            </p>

                            <ul className="space-y-4">
                                <li className="flex items-start">
                                    <StarIcon className="h-6 w-6 text-yellow-500 mr-3 mt-1 flex-shrink-0" />
                                    <span><strong>Feature Highlight:</strong> Explain a key feature or benefit in detail here.</span>
                                </li>
                                <li className="flex items-start">
                                    <StarIcon className="h-6 w-6 text-yellow-500 mr-3 mt-1 flex-shrink-0" />
                                    <span><strong>Another Key Point:</strong> Use these list items to break down complex topics into digestible points.</span>
                                </li>
                                <li className="flex items-start">
                                    <StarIcon className="h-6 w-6 text-yellow-500 mr-3 mt-1 flex-shrink-0" />
                                    <span><strong>Flexible Content:</strong> This template can be adapted for a wide variety of informational needs.</span>
                                </li>
                            </ul>
                        </div>

                        <div className="bg-white p-8 rounded-lg shadow-md mt-12">
                            <h2 className="text-2xl font-bold mb-4">Another Section</h2>
                            <p className="text-gray-600">
                                You can add multiple content blocks to organize your information. This modular approach allows for building comprehensive info pages by simply adding more sections as needed.
                            </p>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </div>
    );
}