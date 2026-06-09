import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
    return (
        <footer className="bg-slate-950 text-white">
            <div className="container mx-auto px-4 py-16">
                <div className="grid md:grid-cols-5 gap-8">
                    {/* Company Info */}
                    <div className="md:col-span-1">
                        <h2 className="text-2xl font-bold mb-2">Drip Drop</h2>
                        <p className="text-slate-400">The modern solution for pool service professionals.</p>
                    </div>

                    {/* Navigation */}
                    <div>
                        <h3 className="font-semibold mb-4">Navigate</h3>
                        <ul className="space-y-2">
                            <li><Link to="/" className="text-slate-400 hover:text-cyan-100">Home</Link></li>
                            <li><Link to="/products" className="text-slate-400 hover:text-cyan-100">Products</Link></li>
                            <li><Link to="/about" className="text-slate-400 hover:text-cyan-100">About</Link></li>
                            <li><Link to="/companies" className="text-slate-400 hover:text-cyan-100">Companies</Link></li>
                            <li><Link to="/contact" className="text-slate-400 hover:text-cyan-100">Contact</Link></li>
                        </ul>
                    </div>

                    {/* Audience */}
                    <div>
                        <h3 className="font-semibold mb-4">For You</h3>
                        <ul className="space-y-2">
                            <li><Link to="/company" className="text-slate-400 hover:text-cyan-100">Pool Companies</Link></li>
                            <li><Link to="/homeowners" className="text-slate-400 hover:text-cyan-100">Homeowners</Link></li>
                            <li><Link to="/companies" className="text-slate-400 hover:text-cyan-100">Find a Company</Link></li>
                            <li><Link to="/signUp" className="text-slate-400 hover:text-cyan-100">Sign Up</Link></li>
                        </ul>
                    </div>

                    {/* Legal */}
                    <div>
                        <h3 className="font-semibold mb-4">Legal</h3>
                        <ul className="space-y-2">
                            <li><Link to="/privacyPolicy" className="text-slate-400 hover:text-cyan-100">Privacy Policy</Link></li>
                            <li><Link to="/termsOfService" className="text-slate-400 hover:text-cyan-100">Terms of Service</Link></li>
                        </ul>
                    </div>

                    {/* Support */}
                    <div>
                        <h3 className="font-semibold mb-4">Support</h3>
                        <ul className="space-y-2">
                            <li><Link to="/feedback?type=bug" className="text-slate-400 hover:text-cyan-100">Bug Report</Link></li>
                            <li><Link to="/feedback?type=feature" className="text-slate-400 hover:text-cyan-100">Feature Request</Link></li>
                        </ul>
                    </div>
                </div>

                <div className="mt-16 pt-8 border-t border-slate-800 text-center text-slate-400">
                    <p>&copy; {new Date().getFullYear()} Drip Drop. All Rights Reserved.</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
