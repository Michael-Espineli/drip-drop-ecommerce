import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';

const PublicHeader = () => {
    const [isOpen, setIsOpen] = useState(false);

    const activeLink = "text-white bg-blue-700 rounded-md px-3 py-2 text-sm font-medium";
    const inactiveLink = "text-blue-100 hover:text-white hover:bg-blue-500 rounded-md px-3 py-2 text-sm font-medium";

    return (
        <nav className="bg-blue-600">
            <div className="container mx-auto px-4">
                <div className="relative flex items-center justify-between h-16">
                    {/* Logo */}
                    <div className="flex-shrink-0">
                        <Link to="/" className="text-white text-2xl font-bold">
                            Drip Drop
                        </Link>
                    </div>

                    {/* Desktop Menu */}
                    <div className="hidden sm:flex sm:items-center sm:space-x-4">
                        <NavLink to="/products" className={({ isActive }) => (isActive ? activeLink : inactiveLink)}>Products</NavLink>
                        <NavLink to="/about" className={({ isActive }) => (isActive ? activeLink : inactiveLink)}>About</NavLink>
                        <NavLink to="/contact" className={({ isActive }) => (isActive ? activeLink : inactiveLink)}>Contact</NavLink>
                        <div className="h-6 border-l border-blue-400"></div>
                        <NavLink to="/company" className={({ isActive }) => (isActive ? activeLink : inactiveLink)}>For Companies</NavLink>
                        <NavLink to="/homeowners" className={({ isActive }) => (isActive ? activeLink : inactiveLink)}>For Homeowners</NavLink>
                    </div>

                    {/* Mobile Menu Button */}
                    <div className="absolute inset-y-0 right-0 flex items-center sm:hidden">
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            className="inline-flex items-center justify-center p-2 rounded-md text-blue-200 hover:text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
                        >
                            <span className="sr-only">Open main menu</span>
                            {isOpen ? (
                                <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
                            ) : (
                                <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile Menu */}
            {isOpen && (
                <div className="sm:hidden">
                    <div className="px-2 pt-2 pb-3 space-y-1">
                        <NavLink to="/products" className={({ isActive }) => `block ${isActive ? activeLink : inactiveLink}` }>Products</NavLink>
                        <NavLink to="/about" className={({ isActive }) => `block ${isActive ? activeLink : inactiveLink}` }>About</NavLink>
                        <NavLink to="/contact" className={({ isActive }) => `block ${isActive ? activeLink : inactiveLink}` }>Contact</NavLink>
                        <div className="pt-2">
                            <NavLink to="/company" className={({ isActive }) => `block ${isActive ? activeLink : inactiveLink}` }>
                                For Pool Companies
                            </NavLink>
                            <NavLink to="/homeowners" className={({ isActive }) => `block ${isActive ? activeLink : inactiveLink}` }>
                                For Homeowners
                            </NavLink>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
};

export default PublicHeader;