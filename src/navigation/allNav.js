
import {
    AiOutlineDashboard,
    AiOutlineShoppingCart,
    AiOutlineFileText,
    AiOutlineBank,
    AiOutlineTeam,
    AiOutlineApi,
    AiOutlineException,
    AiOutlineGlobal,
    AiOutlineTool,
    AiOutlineSolution

} from "react-icons/ai";

import {
    ArchiveBoxIcon
} from '@heroicons/react/24/outline';
import { BiCategory, BiTachometer, BiPurchaseTagAlt, BiSolidReport } from "react-icons/bi";
import {
    FaUsers,
    FaUserTimes,
    FaCode,
    FaStore,
    FaRoute,
    FaSwimmingPool,
    FaHouseUser,
    FaUserCog,
    FaRegHandshake,
    FaRegFileAlt,
    FaTruck,
    FaCreditCard,
    FaClipboardList
} from "react-icons/fa";
import { MdPayment, MdOutlineLocalOffer, MdEmail, MdShoppingCart } from "react-icons/md";
import { IoIosChatbubbles, IoIosPeople, IoIosPricetags } from "react-icons/io";
import { FaGear, FaWrench, FaFileContract, FaFileInvoiceDollar, FaRegBuilding, FaRegMap } from "react-icons/fa6";
import { IoDocumentTextOutline } from "react-icons/io5";
import { GiBugNet } from "react-icons/gi";
import { GoAlertFill, GoTools } from "react-icons/go";


export const allNav = [
    // --- Admin Routes ---
    { id: 1, title: 'Dashboard', icon: <AiOutlineDashboard />, role: 'Admin', path: '/admin/dashboard' },
    { id: 2, title: 'Companies', icon: <AiOutlineShoppingCart />, role: 'Admin', path: '/admin/company' },
    { id: 3, title: 'Subscriptions', icon: <BiCategory />, role: 'Admin', path: '/admin/subscriptions' },
    { id: 4, title: 'Universal Equipment', icon: <FaUsers />, role: 'Admin', path: '/admin/universal-equipment' },
    { id: 5, title: 'Feature Flags', icon: <AiOutlineApi />, role: 'Admin', path: '/admin/feature-flags' },
    { id: 6, title: 'Complaints', icon: <AiOutlineException />, role: 'Admin', path: '/admin/dashboard/payment-request' },
    { id: 7, title: 'Deactivated Sellers', icon: <FaUserTimes />, role: 'Admin', path: '/admin/dashboard/deactive-sellers' },
    { id: 8, title: 'Seller Requests', icon: <FaCode />, role: 'Admin', path: '/admin/dashboard/sellers-request' },
    { id: 9, title: 'Live Chat', icon: <IoIosChatbubbles />, role: 'Admin', path: '/admin/dashboard/chat-seller' },
    { id: 10, title: 'Documentation', icon: <AiOutlineFileText />, role: 'Admin', path: '/admin/documentation' },

    // --- Company Routes ---
    // Main Navigation
    { id: 10, title: 'Dashboard', icon: <BiTachometer />, role: 'Company', path: '/company/dashboard', category: 'NA' },
    { id: 80, title: 'Messages', icon: <MdEmail />, role: 'Company', path: '/company/messages', category: 'NA' },
    { id: 81, title: 'Setup Guide', icon: <FaClipboardList />, role: 'Company', path: '/company/setup-guide', category: 'NA', permissionId: '800' },

    // Marketing
    { id: 62, title: 'Sales Dashboard', icon: <FaFileInvoiceDollar />, role: 'Company', path: '/company/sales', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 63, title: 'Sales Catalog Items', icon: <IoIosPricetags />, role: 'Company', path: '/company/sales/catalog-items', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 69, title: 'Service Agreements', icon: <FaFileContract />, role: 'Company', path: '/company/sales/agreements', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 70, title: 'Invoices', icon: <FaFileInvoiceDollar />, role: 'Company', path: '/company/sales/invoices', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 71, title: 'Payment History', icon: <MdPayment />, role: 'Company', path: '/company/sales/payments', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 72, title: 'Billing Subscriptions', icon: <FaCreditCard />, role: 'Company', path: '/company/sales/subscriptions', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 64, title: 'Leads', icon: <IoIosPeople />, role: 'Company', path: '/company/leads', category: 'Marketing', permissionId: '610', featureFlagId: 'feature_flag_007' },
    { id: 66, title: 'Estimates', icon: <IoIosPricetags />, role: 'Company', path: '/company/estimates', category: 'Marketing', permissionId: '620', featureFlagId: 'feature_flag_007' },
    { id: 90, title: 'Public Page', icon: <FaStore />, role: 'Company', path: '/company/public-profile', category: 'Marketing', featureFlagId: 'feature_flag_007' },

    // Operations
    { id: 21, title: 'Operations Dashboard', icon: <AiOutlineDashboard />, role: 'Company', path: '/company/operations-dashboard', category: 'Operations', permissionId: '0' },
    { id: 25, title: 'Customers', icon: <FaHouseUser />, role: 'Company', path: '/company/customers', category: 'Operations', permissionId: '10' },
    { id: 30, title: 'Jobs', icon: <AiOutlineSolution />, role: 'Company', path: '/company/jobs', category: 'Operations', permissionId: '20' },
    { id: 31, title: 'Equipment', icon: <FaWrench />, role: 'Company', path: '/company/equipment', category: 'Operations', permissionId: '60' },
    { id: 32, title: 'Fleet', icon: <FaTruck />, role: 'Company', path: '/company/fleet', category: 'Operations', permissionId: '290' },
    { id: 34, title: 'Repair Requests', icon: <GoTools />, role: 'Company', path: '/company/repair-requests', category: 'Operations', permissionId: '30' },
    { id: 35, title: 'Shopping List', icon: <MdShoppingCart />, role: 'Company', path: '/company/shopping-list', category: 'Operations' },
    { id: 36, title: 'Purchased Items', icon: <ArchiveBoxIcon />, role: 'Company', path: '/company/purchased-items', category: 'Auditing', permissionId: '400' },

    // Routing
    { id: 50, title: 'Route Dashboard', icon: <FaRegMap />, role: 'Company', path: '/company/route-dashboard', category: 'Routing', permissionId: '210' },
    { id: 51, title: 'Daily Route Board', icon: <FaRoute />, role: 'Company', path: '/company/route-day-management', category: 'Routing', permissionId: '210' },
    { id: 52, title: 'Planned Routes', icon: <FaRoute />, role: 'Company', path: '/company/route-management', category: 'Routing', permissionId: '230' },
    { id: 58, title: 'New Route', icon: <AiOutlineGlobal />, role: 'Company', path: '/company/route-builder', category: 'Routing', permissionId: '232' },
    { id: 54, title: 'Recurring Service Stops', icon: <AiOutlineFileText />, role: 'Company', path: '/company/recurringServiceStop', category: 'Routing', permissionId: '240' },
    { id: 56, title: 'Service Stops', icon: <AiOutlineTool />, role: 'Company', path: '/company/serviceStops', category: 'Routing', permissionId: '240' },

    // Users
    { id: 111, title: 'User Dashboard', icon: <AiOutlineDashboard />, role: 'Company', path: '/company/user-dashboard', category: 'Users', permissionId: '260' },
    { id: 112, title: 'Company Users', icon: <AiOutlineTeam />, role: 'Company', path: '/company/companyUsers', category: 'Users', permissionId: '260' },
    { id: 113, title: 'Businesses', icon: <FaRegHandshake />, role: 'Company', path: '/company/associatedBusiness', category: 'Users', permissionId: '260' },
    { id: 65, title: 'Vendors', icon: <FaStore />, role: 'Company', path: '/company/vendors', category: 'Users', permissionId: '600', featureFlagId: 'feature_flag_007' },
    //Build out with Update 2.1
    // { id: 114, title: 'Recurring Labor Contracts', icon: <FaFileContract />, role: 'Company', path: '/company/recurringLaborContracts', category: 'Users' },
    // { id: 115, title: 'One Time Labor Contracts', icon: <FaRegFileAlt />, role: 'Company', path: '/company/laborContracts', category: 'Users' },

    // Auditing
    { id: 102, title: 'Reports', icon: <BiSolidReport />, role: 'Company', path: '/company/reports', category: 'Auditing', permissionId: '870' },
    { id: 103, title: 'Receipts', icon: <IoDocumentTextOutline />, role: 'Company', path: '/company/receipts', category: 'Auditing', permissionId: '400' },
    { id: 116, title: 'Work Logs', icon: <AiOutlineException />, role: 'Company', path: '/company/workLogs', category: 'Auditing', permissionId: '280' },
    { id: 117, title: 'Payroll', icon: <MdPayment />, role: 'Company', path: '/company/payroll', category: 'Auditing', permissionId: '400', featureFlagId: 'feature_flag_006' },
    { id: 118, title: 'Payroll Setup', icon: <MdOutlineLocalOffer />, role: 'Company', path: '/company/payroll/setup', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_006' },

    // Settings
    { id: 100, title: 'Settings', icon: <FaGear />, role: 'Company', path: '/company/Settings', category: 'Settings', permissionId: '800' },

    // --- Client Routes ---
    { id: 1, title: 'Dashboard', icon: <AiOutlineDashboard />, role: 'Client', path: '/dashboard', category: 'NA' },
    { id: 2, title: 'My Pool', icon: <FaSwimmingPool />, role: 'Client', path: '/mypool/NA', category: 'NA' },
    { id: 4, title: 'Equipment', icon: <GiBugNet />, role: 'Client', path: '/equipment', category: 'NA' },
    { id: 5, title: 'Companies', icon: <FaRegBuilding />, role: 'Client', path: '/companies', category: 'NA' },
    { id: 6, title: 'Messages', icon: <IoIosChatbubbles />, role: 'Client', path: '/messages', category: 'NA' },
    { id: 7, title: 'Contracts', icon: <IoDocumentTextOutline />, role: 'Client', path: '/contracts', category: 'NA' },
    { id: 10, title: 'Settings', icon: <FaUserCog />, role: 'Client', path: '/settings', category: 'NA' },
];
