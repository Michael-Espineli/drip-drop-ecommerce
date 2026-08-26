
import {
    AiOutlineDashboard,
    AiOutlineShoppingCart,
    AiOutlineFileText,
    AiOutlineApi,
    AiOutlineException,
    AiOutlineSolution

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
    FaBriefcase,
    FaSwimmingPool,
    FaHouseUser,
    FaUserCog,
    FaCreditCard,
    FaClipboardList,
    FaBell,
    FaProjectDiagram
} from "react-icons/fa";
import {
    MdAltRoute,
    MdEmail,
    MdHistory,
    MdManageAccounts,
    MdOutlineCalculate,
    MdOutlineDashboard,
    MdOutlinePayments,
    MdOutlineRequestQuote,
    MdPayment,
    MdReceiptLong,
    MdSecurity,
    MdShoppingCart,
} from "react-icons/md";
import { IoIosChatbubbles, IoIosPeople } from "react-icons/io";
import { FaClipboardQuestion, FaWrench, FaFileContract, FaFileInvoiceDollar, FaRegBuilding, FaRegMap } from "react-icons/fa6";
import { IoDocumentTextOutline } from "react-icons/io5";
import { GiBugNet } from "react-icons/gi";
import { GoTools } from "react-icons/go";
import { OFFERED_WORK_PERMISSION_ID } from "../utils/companyPermissions";


export const allNav = [
    // --- Admin Routes ---
    { id: 1, title: 'Dashboard', icon: <AiOutlineDashboard />, role: 'Admin', path: '/admin/dashboard', category: 'NA' },
    { id: 4, title: 'Universal Equipment', icon: <FaUsers />, role: 'Admin', path: '/admin/universal-equipment', category: 'Development' },
    { id: 13, title: 'Universal Readings & Dosages', icon: <FaClipboardList />, role: 'Admin', path: '/admin/universal-readings-dosages', category: 'Development' },
    { id: 16, title: 'Tester Strip Profiles', icon: <FaClipboardList />, role: 'Admin', path: '/admin/tester-strip-profiles', category: 'Development' },
    { id: 5, title: 'Feature Flags', icon: <AiOutlineApi />, role: 'Admin', path: '/admin/feature-flags', category: 'Development' },
    { id: 20, title: 'Permissions', icon: <MdSecurity />, role: 'Admin', path: '/admin/permissions', category: 'Development' },
    { id: 10, title: 'Product Feedback', icon: <GiBugNet />, role: 'Admin', path: '/admin/product-feedback', category: 'Development' },
    { id: 14, title: 'Errors', icon: <FaExclamationTriangle />, role: 'Admin', path: '/admin/errors', category: 'Development' },
    { id: 12, title: 'Documentation', icon: <AiOutlineFileText />, role: 'Admin', path: '/admin/documentation', category: 'Development' },
    { id: 2, title: 'Companies', icon: <AiOutlineShoppingCart />, role: 'Admin', path: '/admin/company', category: 'Management' },
    { id: 18, title: 'Users', icon: <FaUsers />, role: 'Admin', path: '/admin/users', category: 'Management' },
    { id: 19, title: 'Homeowners', icon: <FaHouseUser />, role: 'Admin', path: '/admin/homeowners', category: 'Management' },
    { id: 3, title: 'Subscriptions', icon: <BiCategory />, role: 'Admin', path: '/admin/subscriptions', category: 'Management' },
    { id: 15, title: 'Billing Calculator', icon: <MdOutlineCalculate />, role: 'Admin', path: '/admin/billing-fee-calculator', category: 'Management' },
    { id: 17, title: 'Pool Prospects', icon: <FaSwimmingPool />, role: 'Admin', path: '/admin/pool-prospect-lists', category: 'Management' },
    { id: 6, title: 'Complaints', icon: <AiOutlineException />, role: 'Admin', path: '/admin/dashboard/payment-request', category: 'Management' },
    { id: 7, title: 'Deactivated Sellers', icon: <FaUserTimes />, role: 'Admin', path: '/admin/dashboard/deactive-sellers', category: 'Management' },
    { id: 8, title: 'Seller Requests', icon: <FaCode />, role: 'Admin', path: '/admin/dashboard/sellers-request', category: 'Management' },
    { id: 9, title: 'Live Chat', icon: <IoIosChatbubbles />, role: 'Admin', path: '/admin/dashboard/chat-seller', category: 'Management' },
    { id: 11, title: 'Reach Out Messages', icon: <MdEmail />, role: 'Admin', path: '/admin/reach-out-messages', category: 'Management' },

    // --- Company Routes ---
    // Main Navigation
    { id: 10, title: 'Dashboard', icon: <BiTachometer />, role: 'Company', path: '/company/dashboard', category: 'NA' },
    { id: 118, title: 'Pipeline', icon: <FaProjectDiagram />, role: 'Company', path: '/company/pipeline', category: 'NA', permissionId: '630' },
    { id: 38, title: 'Todo List', icon: <FaClipboardList />, role: 'Company', path: '/company/todo-list', category: 'NA', featureFlagId: 'feature_flag_010' },
    { id: 80, title: 'Messages', icon: <MdEmail />, role: 'Company', path: '/company/messages', category: 'NA', featureFlagId: 'feature_flag_001' },
    { id: 82, title: 'Notifications', icon: <FaBell />, role: 'Company', path: '/company/alerts', category: 'NA', featureFlagId: 'feature_flag_011' },
    { id: 81, title: 'Setup Guide', icon: <FaClipboardQuestion />, role: 'Company', path: '/company/setup-guide', category: 'NA', permissionId: '900' },
    //Marketting 
    { id: 64, title: 'Leads', icon: <IoIosPeople />, role: 'Company', path: '/company/leads', category: 'Marketing', permissionId: '610', featureFlagId: 'feature_flag_007' },
    { id: 65, title: 'Initial Estimates', icon: <MdOutlineRequestQuote />, role: 'Company', path: '/company/initial-estimates', category: 'Marketing', permissionId: '620', featureFlagId: 'feature_flag_007' },
    { id: 90, title: 'Public Page', icon: <FaStore />, role: 'Company', path: '/company/public-profile', category: 'Marketing', featureFlagId: 'feature_flag_007' },

    // Finance
    { id: 62, title: 'Sales Dashboard', icon: <FaFileInvoiceDollar />, role: 'Company', path: '/company/sales', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 124, title: 'PNL Viewer', icon: <MdOutlineCalculate />, role: 'Company', path: '/company/sales/pnl-viewer', category: 'Finance', permissionId: '420', featureFlagId: 'feature_flag_004' },
    { id: 63, title: 'Finished Jobs', icon: <MdOutlineRequestQuote />, role: 'Company', path: '/company/jobs/billing', category: 'Finance', permissionId: '620', featureFlagId: 'feature_flag_007' },
    { id: 66, title: 'Estimates', icon: <MdOutlineRequestQuote />, role: 'Company', path: '/company/estimates', category: 'Finance', permissionId: '620', featureFlagId: 'feature_flag_007' },
    { id: 119, title: 'Product Catalog', icon: <BiCategory />, role: 'Company', path: '/company/product-catalog', category: 'Finance', permissionId: '850' },
    { id: 125, title: 'Service Catalog', icon: <BiCategory />, role: 'Company', path: '/company/sales/catalog-items', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 69, title: 'Service Agreements', icon: <FaFileContract />, role: 'Company', path: '/company/sales/agreements', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 72, title: 'Billing Subscriptions', icon: <FaCreditCard />, role: 'Company', path: '/company/sales/subscriptions', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 70, title: 'Invoices', icon: <MdReceiptLong />, role: 'Company', path: '/company/sales/invoices', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 71, title: 'Payment History', icon: <MdOutlinePayments />, role: 'Company', path: '/company/sales/payments', category: 'Finance', permissionId: '400', featureFlagId: 'feature_flag_004' },
    { id: 117, title: 'Payroll', icon: <MdPayment />, role: 'Company', path: '/company/payroll', category: 'Finance', permissionId: '420', featureFlagId: 'feature_flag_006' },

    // Operations
    { id: 21, title: 'Operations Dashboard', icon: <MdOutlineDashboard />, role: 'Company', path: '/company/operations-dashboard', category: 'Operations', permissionId: '0' },
    { id: 25, title: 'Customers', icon: <FaHouseUser />, role: 'Company', path: '/company/customers', category: 'Operations', permissionId: '10' },
    { id: 31, title: 'Equipment', icon: <FaWrench />, role: 'Company', path: '/company/equipment/needs-maintenance', category: 'Operations', permissionId: '60' },
    { id: 34, title: 'Repair Requests', icon: <GoTools />, role: 'Company', path: '/company/repair-requests', category: 'Operations', permissionId: '30' },
    { id: 30, title: 'Jobs', icon: <AiOutlineSolution />, role: 'Company', path: '/company/jobs/operations', category: 'Operations', permissionId: '20' },
    { id: 37, title: 'Part Approvals', icon: <FaClipboardList />, role: 'Company', path: '/company/part-approvals', category: 'Operations' },
    { id: 35, title: 'Shopping List', icon: <MdShoppingCart />, role: 'Company', path: '/company/shopping-list', category: 'Operations' },
    { id: 36, title: 'Purchased Items', icon: <ArchiveBoxIcon />, role: 'Company', path: '/company/purchased-items', category: 'Operations', permissionId: '400' },
    { id: 103, title: 'Receipts', icon: <IoDocumentTextOutline />, role: 'Company', path: '/company/receipts', category: 'Operations', permissionId: '400' },

    // Management
    { id: 50, title: 'Route Dashboard', icon: <FaRegMap />, role: 'Company', path: '/company/route-dashboard', category: 'Management', permissionId: '210' },
    { id: 51, title: 'Daily Route Board', icon: <FaRoute />, role: 'Company', path: '/company/route-day-management', category: 'Management', permissionId: '210' },
    { id: 52, title: 'Planned Routes', icon: <MdAltRoute />, role: 'Company', path: '/company/route-management', category: 'Management', permissionId: '230' },
    { id: 40, title: 'Offered Work', icon: <FaBriefcase />, role: 'Company', path: '/company/offered-work', category: 'Management', permissionId: OFFERED_WORK_PERMISSION_ID },
    { id: 112, title: 'Users', icon: <FaUsers />, role: 'Company', path: '/company/companyUsers', category: 'Management', permissionId: '260' },
    //Build out with Update 2.1
    // { id: 114, title: 'Recurring Labor Contracts', icon: <FaFileContract />, role: 'Company', path: '/company/recurringLaborContracts', category: 'Users' },
    // { id: 115, title: 'One Time Labor Contracts', icon: <FaRegFileAlt />, role: 'Company', path: '/company/laborContracts', category: 'Users' },

    // --- Client Routes ---
    { id: 1, title: 'Dashboard', icon: <AiOutlineDashboard />, role: 'Client', path: '/dashboard', category: 'NA' },
    { id: 2, title: 'My Pool', icon: <FaSwimmingPool />, role: 'Client', path: '/mypool/NA', category: 'NA' },
    { id: 4, title: 'Equipment', icon: <GiBugNet />, role: 'Client', path: '/equipment', category: 'NA' },
    { id: 5, title: 'Companies', icon: <FaRegBuilding />, role: 'Client', path: '/companies', category: 'NA' },
    { id: 6, title: 'Messages', icon: <IoIosChatbubbles />, role: 'Client', path: '/messages', category: 'NA', featureFlagId: 'feature_flag_001' },
    { id: 11, title: 'Notifications', icon: <FaBell />, role: 'Client', path: '/client/notifications', category: 'NA', featureFlagId: 'feature_flag_011' },
    { id: 7, title: 'Contracts', icon: <IoDocumentTextOutline />, role: 'Client', path: '/contracts', category: 'NA' },
    { id: 8, title: 'Part Approvals', icon: <FaClipboardList />, role: 'Client', path: '/client/part-approvals', category: 'NA' },
    { id: 10, title: 'Settings', icon: <FaUserCog />, role: 'Client', path: '/settings', category: 'NA' },
];
