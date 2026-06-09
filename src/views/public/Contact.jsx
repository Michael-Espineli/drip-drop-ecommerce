import React, { useContext, useState } from 'react';
import toast from 'react-hot-toast';
import PublicHeader from '../../layout/PublicHeader';
import Footer from '../../layout/Footer';
import { EnvelopeIcon, ChatBubbleLeftRightIcon, SparklesIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { Context } from '../../context/AuthContext';
import { createContactMessage, FEEDBACK_AUDIENCES } from '../../utils/adminInbox';

export default function Contact() {
    const context = useContext(Context);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: context.user?.email || '',
        companyName: context.recentlySelectedCompanyName || '',
        audience: context.accountType || FEEDBACK_AUDIENCES.prospect,
        subject: '',
        message: '',
    });

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((current) => ({ ...current, [name]: value }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!formData.name.trim() || !formData.email.trim() || !formData.message.trim()) {
            toast.error('Please add your name, email, and message.');
            return;
        }

        setIsSubmitting(true);
        const toastId = toast.loading('Sending message...');

        try {
            await createContactMessage(formData, context);
            setFormData((current) => ({
                name: '',
                email: current.email,
                companyName: current.companyName,
                audience: current.audience,
                subject: '',
                message: '',
            }));
            toast.success('Message sent. We will reach out soon.', { id: toastId });
        } catch (error) {
            console.error('Error sending contact message:', error);
            toast.error('Could not send your message. Please try again.', { id: toastId });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-gray-50 text-gray-800">
            <header className="fixed top-0 left-0 right-0 z-50 bg-cyan-600 shadow-md">
                <div className="container mx-auto px-4">
                    <PublicHeader />
                </div>
            </header>

            <div className="pt-24">
                {/* Page Header */}
                <header className="bg-cyan-600 text-white py-20">
                    <div className="container mx-auto px-4 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold">Get in Touch</h1>
                        <p className="mt-4 text-lg text-cyan-50">We'd love to hear from you. Here's how you can reach us.</p>
                    </div>
                </header>

                {/* Contact Form and Info Section */}
                <section className="py-20">
                    <div className="container mx-auto px-4">
                        <div className="grid md:grid-cols-2 gap-16">
                            {/* Contact Form */}
                            <div className="bg-white p-8 rounded-lg shadow-md">
                                <h2 className="text-2xl font-bold mb-6">Send Us a Message</h2>
                                <form onSubmit={handleSubmit}>
                                    <div className="mb-4">
                                        <label htmlFor="name" className="block text-gray-700 font-semibold mb-2">Your Name</label>
                                        <input
                                            type="text"
                                            id="name"
                                            name="name"
                                            required
                                            value={formData.name}
                                            onChange={handleChange}
                                            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="email" className="block text-gray-700 font-semibold mb-2">Your Email</label>
                                        <input
                                            type="email"
                                            id="email"
                                            name="email"
                                            required
                                            value={formData.email}
                                            onChange={handleChange}
                                            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="companyName" className="block text-gray-700 font-semibold mb-2">Company</label>
                                        <input
                                            type="text"
                                            id="companyName"
                                            name="companyName"
                                            value={formData.companyName}
                                            onChange={handleChange}
                                            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="subject" className="block text-gray-700 font-semibold mb-2">Subject</label>
                                        <input
                                            type="text"
                                            id="subject"
                                            name="subject"
                                            value={formData.subject}
                                            onChange={handleChange}
                                            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="message" className="block text-gray-700 font-semibold mb-2">Message</label>
                                        <textarea
                                            id="message"
                                            name="message"
                                            rows="5"
                                            required
                                            value={formData.message}
                                            onChange={handleChange}
                                            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                        ></textarea>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full bg-cyan-600 text-white py-3 rounded-lg font-semibold hover:bg-cyan-700 transition disabled:cursor-not-allowed disabled:bg-cyan-300"
                                    >
                                        {isSubmitting ? 'Submitting...' : 'Submit'}
                                    </button>
                                </form>
                            </div>

                            {/* Contact Info */}
                            <div className="space-y-8">
                                <div className="flex items-start">
                                    <EnvelopeIcon className="h-8 w-8 text-cyan-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">General Inquiries</h3>
                                        <p className="text-gray-600">For all general questions, please email us at:</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-cyan-700 hover:underline">info@dripdrop-poolapp.com</a>
                                    </div>
                                </div>
                                <div className="flex items-start">
                                    <ChatBubbleLeftRightIcon className="h-8 w-8 text-cyan-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">Sales & Demos</h3>
                                        <p className="text-gray-600">Interested in a demo or have pricing questions? Contact our sales team.</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-cyan-700 hover:underline">info@dripdrop-poolapp.com</a>
                                    </div>
                                </div>
                                <div className="flex items-start">
                                    <SparklesIcon className="h-8 w-8 text-cyan-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">Feedback & Ideas</h3>
                                        <p className="text-gray-600">Have a feature request or feedback? We're all ears.</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-cyan-700 hover:underline">info@dripdrop-poolapp.com</a>
                                    </div>
                                </div>
                                <div className="flex items-start">
                                    <WrenchScrewdriverIcon className="h-8 w-8 text-cyan-500 mr-4 mt-1" />
                                    <div>
                                        <h3 className="text-xl font-semibold">Support</h3>
                                        <p className="text-gray-600">Need help with the app? Our support team is here for you.</p>
                                        <a href="mailto:info@dripdrop-poolapp.com" className="text-cyan-700 hover:underline">info@dripdrop-poolapp.com</a>
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
