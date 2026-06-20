
import {
    AiOutlineDashboard,
    AiOutlineShoppingCart,
    AiOutlineFileText,
    AiOutlineTeam,
    AiOutlineApi,
    AiOutlineException,
    AiOutlineSolution,
    AiOutlineFundProjectionScreen

} from "react-icons/ai";

import {
    ArchiveBoxIcon
} from '@heroicons/react/24/outline';
import { BiCategory, BiTachometer } from "react-icons/bi";
import {
    FaUsers,
    FaUserTimes,
    FaCode,
    FaExclamationTriangle,
    FaStore,
    FaRoute,
    FaSwimmingPool,
    FaHouseUser,
    FaUserCog,
    FaRegFileAlt,
    FaCreditCard,
    FaClipboardList
} from "react-icons/fa";
import {
    MdAltRoute,
    MdEmail,
    MdHistory,
    MdManageAccounts,
    MdOutlineDashboard,
    MdOutlinePayments,
    MdOutlineRequestQuote,
    MdPayment,
    MdReceiptLong,
    MdShoppingCart
} from "react-icons/md";
import { IoIosChatbubbles, IoIosPeople } from "react-icons/io";
import { FaClipboardQuestion, FaGear, FaWrench, FaFileContract, FaFileInvoiceDollar, FaRegBuilding, FaRegMap } from "react-icons/fa6";
import { IoDocumentTextOutline } from "react-icons/io5";
import { GiBugNet } from "react-icons/gi";
import { GoTools } from "react-icons/go";


export const allNav = [
    // --- Admin Routes ---
    { id: 1, title: 'Dashboard', icon: <AiOutlineDashboard />, role: 'Admin', path: '/admin/dashboard', category: 'NA' },
    { id: 4, title: 'Universal Equipment', icon: <FaUsers />, role: 'Admin', path: '/admin/universal-equipment', category: 'Development' },
    { id: 13, title: 'Universal Readings & Dosages', icon: <FaClipboardList />, role: 'Admin', path: '/admin/universal-readings-dosages', category: 'Development' },
    { id: 5, title: 'Feature Flags', icon: <AiOutlineApi />, role: 'Admin', path: '/admin/feature-flags', category: 'Development' },
    { id: 10, title: 'Product Feedback', icon: <GiBugNet />, role: 'Admin', path: '/admin/product-feedback', category: 'Development' },
    { id: 14, title: 'Errors', icon: <FaExclamationTriangle />, role: 'Admin', path: '/admin/errors', category: 'Development' },
    { id: 12, title: 'Documentation', icon: <AiOutlineFileText />, role: 'Admin', path: '/admin/documentation', category: 'Development' },
    { id: 2, title: 'Companies', icon: <AiOutlineShoppingCart />, role: 'Admin', path: '/admin/company', category: 'Management' },
    { id: 3, title: 'Subscriptions', icon: <BiCategory />, role: 'Admin', path: '/admin/subscriptions', category: 'Management' },
    { id: 6, title: 'Complaints', icon: <AiOutlineException />, role: 'Admin', path: '/admin/dashboard/payment-request', category: 'Management' },
    { id: 7, title: 'Deactivated Sellers', icon: <FaUserTimes />, role: 'Admin', path: '/admin/dashboard/deactive-sellers', category: 'Management' },
    { id: 8, title: 'Seller Requests', icon: <FaCode />, role: 'Admin', path: '/admin/dashboard/sellers-request', category: 'Management' },
    { id: 9, title: 'Live Chat', icon: <IoIosChatbubbles />, role: 'Admin', path: '/admin/dashboard/chat-seller', category: 'Management' },
    { id: 11, title: 'Reach Out Messages', icon: <MdEmail />, role: 'Admin', path: '/admin/reach-out-messages', category: 'Management' },

    // --- Company Routes ---
    // Main Navigation
    { id: 10, title: 'Dashboard', icon: <BiTachometer />, role: 'Company', path: '/company/dashboard', category: 'NA' },
    { id: 38, title: 'Todo List', icon: <FaClipboardList />, role: 'Company', path: '/company/todo-list', category: 'NA', featureFlagId: 'feature_flag_010' },
    { id: 80, title: 'Messages', icon: <MdEmail />, role: 'Company', path: '/company/messages', category: 'NA', featureFlagId: 'feature_flag_001' },
    { id: 81, title: 'Setup Guide', icon: <FaClipboardQuestion />, role: 'Company', path: '/company/setup-guide', category: 'NA', permissionId: '800' },

    // Finance
    { id: 62, title: 'Sales Dashboard', icon: <FaFileInvoiceDollar />, role: 'Company', path: '/company/sales', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 66, title: 'Estimates', icon: <MdOutlineRequestQuote />, role: 'Company', path: '/company/estimates', category: 'Finance', permissionId: '620', featureFlagId: 'feature_flag_007' },
    { id: 69, title: 'Service Agreements', icon: <FaFileContract />, role: 'Company', path: '/company/sales/agreements', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 70, title: 'Invoices', icon: <MdReceiptLong />, role: 'Company', path: '/company/sales/invoices', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 71, title: 'Payment History', icon: <MdOutlinePayments />, role: 'Company', path: '/company/sales/payments', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 72, title: 'Billing Subscriptions', icon: <FaCreditCard />, role: 'Company', path: '/company/sales/subscriptions', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 117, title: 'Payroll', icon: <MdPayment />, role: 'Company', path: '/company/payroll', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_006' },
    { id: 64, title: 'Leads', icon: <IoIosPeople />, role: 'Company', path: '/company/leads', category: 'Marketing', permissionId: '610', featureFlagId: 'feature_flag_007' },
    { id: 90, title: 'Public Page', icon: <FaStore />, role: 'Company', path: '/company/public-profile', category: 'Marketing', featureFlagId: 'feature_flag_007' },

    // Operations
    { id: 21, title: 'Operations Dashboard', icon: <MdOutlineDashboard />, role: 'Company', path: '/company/operations-dashboard', category: 'Operations', permissionId: '0' },
    { id: 25, title: 'Customers', icon: <FaHouseUser />, role: 'Company', path: '/company/customers', category: 'Operations', permissionId: '10' },
    { id: 30, title: 'Jobs', icon: <AiOutlineSolution />, role: 'Company', path: '/company/jobs', category: 'Operations', permissionId: '20' },
    { id: 34, title: 'Repair Requests', icon: <GoTools />, role: 'Company', path: '/company/repair-requests', category: 'Operations', permissionId: '30' },
    { id: 31, title: 'Equipment', icon: <FaWrench />, role: 'Company', path: '/company/equipment/needs-maintenance', category: 'Operations', permissionId: '60' },
    { id: 37, title: 'Part Approvals', icon: <FaClipboardList />, role: 'Company', path: '/company/part-approvals', category: 'Operations' },
    { id: 35, title: 'Shopping List', icon: <MdShoppingCart />, role: 'Company', path: '/company/shopping-list', category: 'Operations' },
    { id: 36, title: 'Purchased Items', icon: <ArchiveBoxIcon />, role: 'Company', path: '/company/purchased-items', category: 'Operations', permissionId: '400' },
    { id: 103, title: 'Receipts', icon: <IoDocumentTextOutline />, role: 'Company', path: '/company/receipts', category: 'Operations', permissionId: '400' },

    // Management
    { id: 51, title: 'Daily Route Board', icon: <FaRoute />, role: 'Company', path: '/company/route-day-management', category: 'Management', permissionId: '210' },
    { id: 50, title: 'Route Dashboard', icon: <FaRegMap />, role: 'Company', path: '/company/route-dashboard', category: 'Management', permissionId: '210' },
    { id: 52, title: 'Planned Routes', icon: <MdAltRoute />, role: 'Company', path: '/company/route-management', category: 'Management', permissionId: '230' },
    { id: 111, title: 'User Dashboard', icon: <MdManageAccounts />, role: 'Company', path: '/company/user-dashboard', category: 'Management', permissionId: '260' },
    { id: 112, title: 'Company Users', icon: <AiOutlineTeam />, role: 'Company', path: '/company/companyUsers', category: 'Management', permissionId: '260' },
    { id: 116, title: 'Work Logs', icon: <MdHistory />, role: 'Company', path: '/company/workLogs', category: 'Management', permissionId: '280' },
    { id: 113, title: 'Vendors', icon: <FaStore />, role: 'Company', path: '/company/vendors', category: 'Management' },
    { id: 114, title: 'Fleet', icon: <FaRoute />, role: 'Company', path: '/company/fleet', category: 'Management', permissionId: '290' },
    //Build out with Update 2.1
    // { id: 114, title: 'Recurring Labor Contracts', icon: <FaFileContract />, role: 'Company', path: '/company/recurringLaborContracts', category: 'Users' },
    // { id: 115, title: 'One Time Labor Contracts', icon: <FaRegFileAlt />, role: 'Company', path: '/company/laborContracts', category: 'Users' },

    // Migration
    { id: 118, title: 'Migration Dashboard', icon: <AiOutlineFundProjectionScreen />, role: 'Company', path: '/company/migration', category: 'Migration', permissionId: '800', featureFlagId: 'feature_flag_008' },
    { id: 119, title: 'Customer Export Upload', icon: <AiOutlineFileText />, role: 'Company', path: '/company/migration/customer-export-import', category: 'Migration', permissionId: '800', featureFlagId: 'feature_flag_008' },
    { id: 120, title: 'Equipment Upload', icon: <FaWrench />, role: 'Company', path: '/company/migration/equipment-import', category: 'Migration', permissionId: '800', featureFlagId: 'feature_flag_008' },
    { id: 121, title: 'Service History Upload', icon: <FaRegFileAlt />, role: 'Company', path: '/company/migration/skimmer-previous-dosages-upload', category: 'Migration', permissionId: '800', featureFlagIds: ['feature_flag_008', 'feature_flag_009'] },
    { id: 122, title: 'Performance History Upload (Murdock Only)', icon: <FaRegFileAlt />, role: 'Company', path: '/company/migration/performance-history-import', category: 'Migration', permissionId: '800', featureFlagId: 'feature_flag_008' },

    // Settings
    { id: 100, title: 'Settings', icon: <FaGear />, role: 'Company', path: '/company/Settings', category: 'Settings', permissionId: '800' },

    // --- Client Routes ---
    { id: 1, title: 'Dashboard', icon: <AiOutlineDashboard />, role: 'Client', path: '/dashboard', category: 'NA' },
    { id: 2, title: 'My Pool', icon: <FaSwimmingPool />, role: 'Client', path: '/mypool/NA', category: 'NA' },
    { id: 4, title: 'Equipment', icon: <GiBugNet />, role: 'Client', path: '/equipment', category: 'NA' },
    { id: 5, title: 'Companies', icon: <FaRegBuilding />, role: 'Client', path: '/companies', category: 'NA' },
    { id: 6, title: 'Messages', icon: <IoIosChatbubbles />, role: 'Client', path: '/messages', category: 'NA', featureFlagId: 'feature_flag_001' },
    { id: 7, title: 'Contracts', icon: <IoDocumentTextOutline />, role: 'Client', path: '/contracts', category: 'NA' },
    { id: 8, title: 'Part Approvals', icon: <FaClipboardList />, role: 'Client', path: '/client/part-approvals', category: 'NA' },
    { id: 10, title: 'Settings', icon: <FaUserCog />, role: 'Client', path: '/settings', category: 'NA' },
];
