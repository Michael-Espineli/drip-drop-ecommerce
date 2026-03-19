import React, { useState } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from 'react-router-dom';
import PublicHeader from "../../layout/PublicHeader";
import Footer from "../../layout/Footer";

export default function Terms() {
   return (
    <div className=' w-full bg-cover h-full black-fg'>
        <PublicHeader/>
        <div className="max-w-3xl mx-auto p-6 text-gray-800 pt-[225px]">
            <h1 className="text-3xl font-bold mb-4">Privacy Policy for Drip Drop</h1>
            <p className="text-sm text-gray-500 mb-8">Last updated: 11/12/2025</p>

            <p className="mb-6">
                At <strong>Drip Drop</strong>, we value your privacy. This Privacy Policy explains how we collect,
                use, and protect your personal information when you use our website <strong>[dripdrop-poolapp.com]</strong> and
                mobile application (collectively, the “Services”) related to our pool cleaning and maintenance offerings.
            </p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">1. Information We Collect</h2>
            <p className="mb-4">
                We collect information to provide and improve our Services. The types of information we collect include:
            </p>

            <h3 className="text-xl font-semibold mt-6 mb-2">a. Personal Information</h3>
            <ul className="list-disc ml-6 mb-4">
                <li>Name</li>
                <li>Email address</li>
                <li>Phone number</li>
                <li>Service address (e.g., pool location)</li>
                <li>Payment information (processed securely through third-party providers)</li>
            </ul>

            <h3 className="text-xl font-semibold mt-6 mb-2">b. Usage Data</h3>
            <ul className="list-disc ml-6 mb-4">
                <li>Device information (type, OS version, browser type)</li>
                <li>IP address</li>
                <li>Access times and dates</li>
                <li>Pages viewed and actions taken within the app or site</li>
            </ul>

            <h3 className="text-xl font-semibold mt-6 mb-2">c. Location Data (Optional)</h3>
            <p className="mb-4">
                If you allow location access, we may collect your GPS data to:
            </p>
            <ul className="list-disc ml-6 mb-4">
                <li>Help cleaners locate your pool</li>
                <li>Provide accurate service estimates or route optimization</li>
            </ul>
            <p className="mb-6">You can disable location permissions at any time in your device settings.</p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">2. How We Use Your Information</h2>
            <ul className="list-disc ml-6 mb-4">
                <li>Provide, schedule, and manage pool cleaning services</li>
                <li>Communicate with you (e.g., confirmations, support, updates)</li>
                <li>Process secure payments</li>
                <li>Improve app and website functionality</li>
                <li>Send occasional promotions or service reminders (you may opt out anytime)</li>
            </ul>

            <h2 className="text-2xl font-semibold mt-10 mb-4">3. How We Share Information</h2>
            <p className="mb-4">
                We <strong>do not sell your personal information</strong>. We may share data only in the following cases:
            </p>
            <ul className="list-disc ml-6 mb-4">
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
            <p className="mb-6">
                All partners are required to keep your information secure and only use it for the purposes described.
            </p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">4. Data Retention</h2>
            <p className="mb-6">
                We retain your information only as long as necessary to provide our Services, comply with legal obligations, or
                resolve disputes. You may request deletion of your data anytime by contacting us.
            </p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">5. Security</h2>
            <p className="mb-6">
                We implement appropriate security measures (encryption, secure servers, limited access) to protect your personal
                data. However, no online transmission or storage is 100% secure, and we cannot guarantee absolute protection.
            </p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">6. Your Rights</h2>
            <p className="mb-4">Depending on your location, you may have rights to:</p>
            <ul className="list-disc ml-6 mb-4">
                <li>Access, correct, or delete your personal information</li>
                <li>Withdraw consent for certain data uses</li>
                <li>Request a copy of your data</li>
            </ul>
            <p className="mb-6">
                To exercise these rights, please contact us at <strong>[Your Contact Email]</strong>.
            </p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">7. Children’s Privacy</h2>
            <p className="mb-6">
                Our Services are not directed toward children under 13. We do not knowingly collect personal information from
                minors. If you believe a child has provided us with personal data, please contact us to remove it.
            </p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">8. Updates to This Policy</h2>
            <p className="mb-6">
                We may update this Privacy Policy from time to time. Any changes will be posted on this page with a new “Last
                updated” date. Significant updates may also be sent by email or app notification.
            </p>

            <h2 className="text-2xl font-semibold mt-10 mb-4">9. Contact Us</h2>
            <p className="mb-6">
                If you have any questions about this Privacy Policy or your personal information, please contact us at:
            </p>

            <address className="not-italic mb-10">
                <strong>Drip Drop Pool App</strong>
                <br />
                Email: <a href="mailto:[info@dripdrop-poolapp.com]" className="text-blue-600 underline">[info@dripdrop-poolapp.com]</a>
                <br />
                Phone: (619)324-3222
                <br />
                Website: <a href="https://[dripdrop-poolapp.com]" className="text-blue-600 underline">[dripdrop-poolapp.com]</a>
            </address>
        </div>

        <Footer/>
    </div>
    );
}