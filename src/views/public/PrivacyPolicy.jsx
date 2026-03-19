import React from 'react';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';

export default function PrivacyPolicy() {
    return (
        <div className="bg-gray-50 text-gray-800">
            <header className="fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <div className="pt-24">
                {/* Page Header */}
                <header className="bg-white border-b">
                    <div className="container mx-auto px-4 py-16 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold">Privacy Policy</h1>
                        <p className="mt-4 text-gray-600">Last updated: November 12, 2025</p>
                    </div>
                </header>

                {/* Privacy Policy Content */}
                <section className="py-20">
                    <div className="container mx-auto px-4 max-w-4xl">
                        <div className="prose max-w-none">
                            <p>
                                At <strong>Drip Drop</strong>, we value your privacy. This Privacy Policy explains how we collect,
                                use, and protect your personal information when you use our website, <strong>dripdrop-poolapp.com</strong>, and
                                mobile application (collectively, the “Services”) related to our pool cleaning and maintenance offerings.
                            </p>

                            <h2>1. Information We Collect</h2>
                            <p>
                                We collect information to provide and improve our Services. The types of information we collect include:
                            </p>

                            <h3>a. Personal Information</h3>
                            <ul>
                                <li>Name</li>
                                <li>Email address</li>
                                <li>Phone number</li>
                                <li>Service address (e.g., pool location)</li>
                                <li>Payment information (processed securely through third-party providers)</li>
                            </ul>

                            <h3>b. Usage Data</h3>
                            <ul>
                                <li>Device information (type, OS version, browser type)</li>
                                <li>IP address</li>
                                <li>Access times and dates</li>
                                <li>Pages viewed and actions taken within the app or site</li>
                            </ul>

                            <h3>c. Location Data (Optional)</h3>
                            <p>
                                If you allow location access, we may collect your GPS data to help cleaners locate your pool or provide accurate service estimates. You can disable location permissions at any time in your device settings.
                            </p>

                            <h2>2. How We Use Your Information</h2>
                            <ul>
                                <li>To provide, schedule, and manage pool cleaning services.</li>
                                <li>To communicate with you (e.g., confirmations, support, updates).</li>
                                <li>To process secure payments.</li>
                                <li>To improve app and website functionality.</li>
                                <li>To send occasional promotions or service reminders (you may opt out anytime).</li>
                            </ul>

                            <h2>3. How We Share Information</h2>
                            <p>
                                We <strong>do not sell your personal information</strong>. We may share data only in the following cases:
                            </p>
                            <ul>
                                <li>
                                    <strong>With service providers:</strong> For payment processing, hosting, analytics, or communication tools.
                                </li>
                                <li>
                                    <strong>With pool cleaners or technicians:</strong> To complete your requested service.
                                </li>
                                <li>
                                    <strong>For legal reasons:</strong> If required by law, regulation, or to protect our rights and property.
                                </li>
                            </ul>
                            <p>
                                All partners are required to keep your information secure and only use it for the purposes described.
                            </p>

                            <h2>4. Data Retention</h2>
                            <p>
                                We retain your information only as long as necessary to provide our Services, comply with legal obligations, or resolve disputes. You may request deletion of your data anytime by contacting us.
                            </p>

                            <h2>5. Security</h2>
                            <p>
                                We implement appropriate security measures (encryption, secure servers, limited access) to protect your personal data. However, no online transmission or storage is 100% secure, and we cannot guarantee absolute protection.
                            </p>

                            <h2>6. Your Rights</h2>
                            <p>Depending on your location, you may have rights to:</p>
                            <ul>
                                <li>Access, correct, or delete your personal information.</li>
                                <li>Withdraw consent for certain data uses.</li>
                                <li>Request a copy of your data.</li>
                            </ul>
                            <p>
                                To exercise these rights, please contact us at <a href="mailto:info@dripdrop-poolapp.com">info@dripdrop-poolapp.com</a>.
                            </p>

                            <h2>7. Children’s Privacy</h2>
                            <p>
                                Our Services are not directed toward children under 13. We do not knowingly collect personal information from minors. If you believe a child has provided us with personal data, please contact us to remove it.
                            </p>

                            <h2>8. Updates to This Policy</h2>
                            <p>
                                We may update this Privacy Policy from time to time. Any changes will be posted on this page with a new “Last updated” date. Significant updates may also be sent by email or app notification.
                            </p>

                            <h2>9. Contact Us</h2>
                            <p>
                                If you have any questions about this Privacy Policy or your personal information, please contact us at:
                            </p>
                            <address className="not-italic">
                                <strong>Drip Drop Pool App</strong><br />
                                Email: <a href="mailto:info@dripdrop-poolapp.com">info@dripdrop-poolapp.com</a><br />
                                Phone: (619) 324-3222<br />
                                Website: <a href="https://dripdrop-poolapp.com">dripdrop-poolapp.com</a>
                            </address>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </div>
    );
}