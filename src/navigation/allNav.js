
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
    FaRegFileAlt 
} from "react-icons/fa";
import { MdPayment, MdOutlineLocalOffer, MdEmail } from "react-icons/md";
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
    { id: 5, title: 'Complaints IP', icon: <MdPayment />, role: 'Admin', path: '/admin/dashboard/payment-request' },
    { id: 6, title: 'Deactive Sellers IP', icon: <FaUserTimes />, role: 'Admin', path: '/admin/dashboard/deactive-sellers' },
    { id: 7, title: 'Seller Request IP', icon: <FaCode />, role: 'Admin', path: '/admin/dashboard/sellers-request' },
    { id: 8, title: 'Live Chat IP', icon: <IoIosChatbubbles />, role: 'Admin', path: '/admin/dashboard/chat-seller' },

    // --- Company Routes ---
    // Main Navigation
    { id: 10, title: 'Dashboard', icon: <BiTachometer />, role: 'Company', path: '/company/dashboard', category: 'NA' },
    { id: 80, title: 'Messages', icon: <MdEmail />, role: 'Company', path: '/company/messages', category: 'NA' },

    // Marketing
    { id: 62, title: 'Sales Dashboard', icon: <FaFileInvoiceDollar />, role: 'Company', path: '/company/sales', category: 'Marketing' },
    { id: 64, title: 'Leads', icon: <IoIosPeople />, role: 'Company', path: '/company/leads', category: 'Marketing' },
    { id: 66, title: 'Estimates', icon: <IoIosPricetags />, role: 'Company', path: '/company/estimates', category: 'Marketing' },
    { id: 90, title: 'Public Page', icon: <FaStore />, role: 'Company', path: '/company/public-profile', category: 'Marketing' },

    // Operations
    { id: 21, title: 'Operations Dashboard', icon: <AiOutlineDashboard />, role: 'Company', path: '/company/operations-dashboard', category: 'Operations' },
    { id: 25, title: 'Customers', icon: <FaHouseUser />, role: 'Company', path: '/company/customers', category: 'Operations' },
    { id: 30, title: 'Jobs', icon: <AiOutlineSolution />, role: 'Company', path: '/company/jobs', category: 'Operations' },
    { id: 31, title: 'Equipment', icon: <FaWrench />, role: 'Company', path: '/company/equipment', category: 'Operations' },
    { id: 32, title: 'Service Stops', icon: <AiOutlineTool />, role: 'Company', path: '/company/serviceStops', category: 'Operations' },
    { id: 34, title: 'Repair Requests', icon: <GoTools />, role: 'Company', path: '/company/repair-requests', category: 'Operations' },

    // Routing
    { id: 50, title: 'Route Dashboard', icon: <FaRegMap />, role: 'Company', path: '/company/route-dashboard', category: 'Routing' },
    { id: 52, title: 'Route Management', icon: <FaRoute />, role: 'Company', path: '/company/route-management', category: 'Routing' },
    { id: 54, title: 'Recurring Service Stops', icon: <AiOutlineFileText />, role: 'Company', path: '/company/recurringServiceStop', category: 'Routing' },
    { id: 56, title: 'Route Builder', icon: <AiOutlineGlobal />, role: 'Company', path: '/company/route-builder', category: 'Routing' },

    // Users
    { id: 111, title: 'User Dashboard', icon: <AiOutlineDashboard />, role: 'Company', path: '/company/user-dashboard', category: 'Users' },
    { id: 112, title: 'Company Users', icon: <AiOutlineTeam />, role: 'Company', path: '/company/companyUsers', category: 'Users' },
    { id: 113, title: 'Associated Business', icon: <FaRegHandshake />, role: 'Company', path: '/company/associatedBusiness', category: 'Users' },
    //Build out with Update 2.1
    // { id: 114, title: 'Recurring Labor Contracts', icon: <FaFileContract />, role: 'Company', path: '/company/recurringLaborContracts', category: 'Users' },
    // { id: 115, title: 'One Time Labor Contracts', icon: <FaRegFileAlt />, role: 'Company', path: '/company/laborContracts', category: 'Users' },
    { id: 116, title: 'Work Logs', icon: <AiOutlineException />, role: 'Company', path: '/company/workLogs', category: 'Users' },

    // Settings
    // { id: 102, title: 'Reports', icon: <BiSolidReport />, role: 'Company', path: '/company/reports', category: 'Settings' },
    { id: 100, title: 'Settings', icon: <FaGear />, role: 'Company', path: '/company/Settings', category: 'Settings' },
    
    // --- Client Routes ---
    { id: 1, title: 'Dashboard', icon: <AiOutlineDashboard />, role: 'Client', path: '/dashboard', category: 'NA' },
    { id: 2, title: 'My Pool', icon: <FaSwimmingPool />, role: 'Client', path: '/mypool/NA', category: 'NA' },
    { id: 4, title: 'Equipment', icon: <GiBugNet />, role: 'Client', path: '/equipment', category: 'NA' },
    { id: 5, title: 'Companies', icon: <FaRegBuilding />, role: 'Client', path: '/companies', category: 'NA' },
    { id: 6, title: 'Messages', icon: <IoIosChatbubbles />, role: 'Client', path: '/messages', category: 'NA' },
    { id: 7, title: 'Contracts', icon: <IoDocumentTextOutline />, role: 'Client', path: '/contracts', category: 'NA' },
    { id: 10, title: 'Settings', icon: <FaUserCog />, role: 'Client', path: '/settings', category: 'NA' },
];
