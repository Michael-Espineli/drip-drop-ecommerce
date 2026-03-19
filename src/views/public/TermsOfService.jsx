import React from 'react';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';

export default function TermsOfService() {
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
                        <h1 className="text-4xl md:text-5xl font-bold">Terms of Service</h1>
                        <p className="mt-4 text-gray-600">Last updated: November 12, 2025</p>
                    </div>
                </header>

                {/* Terms of Service Content */}
                <section className="py-20">
                    <div className="container mx-auto px-4 max-w-4xl">
                        <div className="prose max-w-none">
                            <p>
                                Welcome to <strong>Drip Drop</strong>. These Terms of Service (“Terms”) govern your use of our website, <strong>dripdrop-poolapp.com</strong>, and our mobile application (collectively, the “Services”). By using our Services, you agree to these Terms.
                            </p>

                            <h2>1. Use of Our Services</h2>
                            <p>
                                You must be at least 18 years old to use our Services. You agree to use our Services in compliance with all applicable laws and regulations. You are responsible for maintaining the confidentiality of your account and password.
                            </p>

                            <h2>2. User Accounts</h2>
                            <p>
                                When you create an account with us, you must provide information that is accurate, complete, and current at all times. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service.
                            </p>

                            <h2>3. Service Plans and Payments</h2>
                            <p>
                                Our Services are billed on a subscription basis. You will be billed in advance on a recurring, periodic basis (such as monthly or annually), depending on the subscription plan you select. Your subscription will automatically renew at the end of each billing cycle unless you cancel it.
                            </p>

                            <h2>4. Intellectual Property</h2>
                            <p>
                                The Service and its original content, features, and functionality are and will remain the exclusive property of Drip Drop and its licensors. Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of Drip Drop.
                            </p>

                            <h2>5. Termination</h2>
                            <p>
                                We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your right to use the Service will immediately cease.
                            </p>

                            <h2>6. Limitation of Liability</h2>
                            <p>
                                In no event shall Drip Drop, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the Service.
                            </p>

                            <h2>7. Governing Law</h2>
                            <p>
                                These Terms shall be governed and construed in accordance with the laws of the State of California, United States, without regard to its conflict of law provisions.
                            </p>

                            <h2>8. Changes to These Terms</h2>
                            <p>
                                We reserve the right, at our sole discretion, to modify or replace these Terms at any time. We will provide at least 30 days' notice prior to any new terms taking effect. By continuing to access or use our Service after those revisions become effective, you agree to be bound by the revised terms.
                            </p>

                            <h2>9. Contact Us</h2>
                            <p>
                                If you have any questions about these Terms, please contact us at <a href="mailto:info@dripdrop-poolapp.com">info@dripdrop-poolapp.com</a>.
                            </p>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </div>
    );
}