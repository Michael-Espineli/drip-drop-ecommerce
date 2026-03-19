import React, {useContext} from 'react';
import { Link } from 'react-router-dom';
import { 
    BuildingOffice2Icon, 
    UsersIcon, 
    CogIcon, 
    EnvelopeIcon, 
    BeakerIcon, 
    ArchiveBoxIcon, 
    CreditCardIcon, 
    CurrencyDollarIcon,
    DocumentTextIcon
} from '@heroicons/react/24/outline';
import { BiPurchaseTagAlt } from 'react-icons/bi';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Context } from "../../../context/AuthContext";

const functions = getFunctions();

const SettingsLink = ({ to, icon, title, description }) => (
    <Link to={to} className="flex items-start p-4 bg-white rounded-lg shadow-sm hover:bg-gray-50 transition-colors">
        <div className="shrink-0 w-12 h-12 flex items-center justify-center bg-gray-100 rounded-lg text-gray-600">
            {icon}
        </div>
        <div className="ml-4">
            <p className="font-semibold text-gray-800">{title}</p>
            <p className="text-sm text-gray-500">{description}</p>
        </div>
    </Link>
);

const CompanySettings = () => {
      const {recentlySelectedCompany} = useContext(Context);
    
    const settings = {
        general: [
            {
                to: '/company/selector',
                icon: <CogIcon className="w-6 h-6" />,
                title: 'Change Selected Company',
                description: 'Switch between different company profiles.'
            },
            {
                to: '/company/settings/subscriptions',
                icon: <CreditCardIcon className="w-6 h-6" />,
                title: 'Manage Subscriptions',
                description: 'Upgrade, downgrade, or cancel your subscription plans.'
            }
        ],
        company: [
            {
                to: '/Company/CompanyInfo',
                icon: <BuildingOffice2Icon className="w-6 h-6" />,
                title: 'Company Information',
                description: 'Update your company\'s name, address, and other details.'
            },
            {
                to: '/Company/TaskGroups',
                icon: <ArchiveBoxIcon className="w-6 h-6" />,
                title: 'Task Groups',
                description: 'Manage templates for recurring job tasks.'
            },
            {
                to: '/Company/EmailConfiguration',
                icon: <EnvelopeIcon className="w-6 h-6" />,
                title: 'Email Configuration',
                description: 'Configure your company\'s email settings.'
            },
            {
                to: '/Company/ReadingsAndDosages',
                icon: <BeakerIcon className="w-6 h-6" />,
                title: 'Reading and Dosages',
                description: 'Set up measurement units and chemical dosages.'
            },
            {
                to: '/Company/Items',
                icon: <ArchiveBoxIcon className="w-6 h-6" />,
                title: 'Database Items',
                description: 'Manage your company\'s internal database of items.'
            },
            {
                to: '/Company/Roles',
                icon: <UsersIcon className="w-6 h-6" />,
                title: 'User Roles',
                description: 'Define and manage roles and permissions for your team.'
            },
            {
                to: '/company/reports',
                icon: <DocumentTextIcon className="w-6 h-6" />,
                title: 'Reports',
                description: 'Run Reports for all aspects of your company'
            }
        ],
        billing: [
            // Update 3.1
            // {
            //     to: '/Company/StripeProfile',
            //     icon: <CurrencyDollarIcon className="w-6 h-6" />,
            //     title: 'Stripe Profile',
            //     description: 'Manage your company\'s Stripe account and payment details.'
            // },
            {
                to: '/company/settings/terms-templates',
                icon: <DocumentTextIcon className="w-6 h-6" />,
                title: 'Terms Templates',
                description: 'Create and manage templates for your terms and conditions.'
            }
        ],
        stripe: [
            {
                to: '/company/SubscriptionManagement',
                icon: <BiPurchaseTagAlt className="w-6 h-6" />,
                title: 'Stripe Configuration',
                description: 'Manage customer subscriptions through your Stripe Connected Account.'
            }
        ]
    };
    async function runFunction(e) {
        e.preventDefault()
        try{
            //Get Subscription Information From Stripe
            console.log('cancelStripeSubscription')
    
            const functionName = httpsCallable(functions, 'updateCompanyReadingsSettings');
            functionName({ 
                companyId: recentlySelectedCompany,
            })
            .then((result) => {
                console.log("[CompanySettings][runFunction]")
                console.log(result)
                // Handle the result from the function
            })
            .catch((error) => {
                // Handle any errors
                console.log("[CompanySettings][runFunction]")
                console.error(error);
            });
        } catch(error){
            console.log("[CompanySettings][runFunction]")
            console.error(error);
        }
    }

    return (
        <div className='px-4 md:px-8 py-6 bg-gray-50 min-h-screen'>
            <div className="max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

                {/* General Settings */}
                <div className="mb-10">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">General</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {settings.general.map(item => <SettingsLink key={item.to} {...item} />)}
                    </div>
                </div>

                {/* Company Settings */}
                <div className="mb-10">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Company</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {settings.company.map(item => <SettingsLink key={item.to} {...item} />)}
                    </div>
                </div>

                {/* Billing Settings */}
                <div className="mb-10">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Billing</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {settings.billing.map(item => <SettingsLink key={item.to} {...item} />)}
                    </div>
                </div>

                {/* Stripe Connected Account Settings Update 3.1 */}

                {/* <div>
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Stripe Connected Account</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {settings.stripe.map(item => <SettingsLink key={item.to} {...item} />)}
                    </div>
                </div> */}
                

                {/* {process.env.NODE_ENV === 'development' && ( */}
                    <div className="p-4 my-4 bg-yellow-900 border-2 border-yellow-500 rounded-lg">
                    <h3 className="text-xl font-bold text-yellow-400">🚧 Development Only:Upload For Developers To Call Different Cloud Functions 🚧</h3>
                    <p className="text-yellow-300">This feature is for testing and will not be in the final product.</p>
                    {/* You can put any component or button here. For example: */}
                    <button 
                    onClick={(e) => runFunction(e)}
                    className='font-bold text-[#ffffff] px-4 py-1 text-base py-1 px-2 bg-[#9C0D38] cursor-pointer rounded mt-3'>Run updateCompanyReadingsSettings</button>
                    </div>
                {/* )} */}
            </div>
        </div>
    );
};

export default CompanySettings;
