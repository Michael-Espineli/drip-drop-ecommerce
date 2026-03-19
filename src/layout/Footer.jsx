import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
    return (
        <footer className="bg-gray-800 text-white">
            <div className="container mx-auto px-4 py-16">
                <div className="grid md:grid-cols-4 gap-8">
                    {/* Company Info */}
                    <div className="md:col-span-1">
                        <h2 className="text-2xl font-bold mb-2">Drip Drop</h2>
                        <p className="text-gray-400">The modern solution for pool service professionals.</p>
                    </div>

                    {/* Navigation */}
                    <div>
                        <h3 className="font-semibold mb-4">Navigate</h3>
                        <ul className="space-y-2">
                            <li><Link to="/" className="text-gray-400 hover:text-white">Home</Link></li>
                            <li><Link to="/products" className="text-gray-400 hover:text-white">Products</Link></li>
                            <li><Link to="/about" className="text-gray-400 hover:text-white">About</Link></li>
                            <li><Link to="/contact" className="text-gray-400 hover:text-white">Contact</Link></li>
                        </ul>
                    </div>

                    {/* Audience */}
                    <div>
                        <h3 className="font-semibold mb-4">For You</h3>
                        <ul className="space-y-2">
                            <li><Link to="/company" className="text-gray-400 hover:text-white">Pool Companies</Link></li>
                            <li><Link to="/homeowners" className="text-gray-400 hover:text-white">Homeowners</Link></li>
                            <li><Link to="/signUp" className="text-gray-400 hover:text-white">Sign Up</Link></li>
                        </ul>
                    </div>

                    {/* Legal */}
                    <div>
                        <h3 className="font-semibold mb-4">Legal</h3>
                        <ul className="space-y-2">
                            <li><Link to="/privacyPolicy" className="text-gray-400 hover:text-white">Privacy Policy</Link></li>
                            <li><Link to="/termsOfService" className="text-gray-400 hover:text-white">Terms of Service</Link></li>
                        </ul>
                    </div>
                </div>

                <div className="mt-16 pt-8 border-t border-gray-700 text-center text-gray-400">
                    <p>&copy; {new Date().getFullYear()} Drip Drop. All Rights Reserved.</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;