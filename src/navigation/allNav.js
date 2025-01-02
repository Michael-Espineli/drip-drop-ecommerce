import { AiOutlineDashboard, AiOutlineShoppingCart } from "react-icons/ai"
import { BiCategory } from "react-icons/bi"
import { FaUsers, FaUserTimes, FaCode } from "react-icons/fa"
import { MdPayment } from "react-icons/md"
import { IoIosChatbubbles } from "react-icons/io"
import { FaStore } from "react-icons/fa";
import { FaGear } from "react-icons/fa6";
import { FaRoute } from "react-icons/fa";
import { IoDocumentTextOutline } from "react-icons/io5";
import { FaSwimmingPool } from "react-icons/fa";
import { GiBugNet } from "react-icons/gi";
import { GoAlertFill } from "react-icons/go";
import { FaHouse } from "react-icons/fa6";


export const allNav = [
    // ------------------- Admin Routes -----------------------
    {
        id : 1,
        title : 'Dashboard',
        icon : <AiOutlineDashboard/>,
        role : 'Admin',
        path : '/admin/dashboard'
    },
    {
        id : 2,
        title : 'Orders',
        icon : <AiOutlineShoppingCart/>,
        role : 'Admin',
        path : '/admin/dashboard/orders'
    },
    {
        id : 3,
        title : 'Category',
        icon : <BiCategory/>,
        role : 'Admin',
        path : '/admin/dashboard/category'
    },
    {
        id : 4,
        title : 'Sellers',
        icon : <FaUsers/>,
        role : 'Admin',
        path : '/admin/dashboard/seller'
    },
    {
        id : 5,
        title : 'Payment Request',
        icon : <MdPayment/>,
        role : 'Admin',
        path : '/admin/dashboard/payment-request'
    },
    {
        id : 6,
        title : 'Deactive Sellers',
        icon : <FaUserTimes/>,
        role : 'Admin',
        path : '/admin/dashboard/deactive-sellers'
    },
    {
        id : 7,
        title : 'Seller Request',
        icon : <FaCode />,
        role : 'Admin',
        path : '/admin/dashboard/sellers-request'
    },
    {
        id : 8,
        title : 'Live Chat',
        icon : <IoIosChatbubbles />,
        role : 'Admin',
        path : '/admin/dashboard/chat-seller'
    }
    ,
    // ------------------- Company Routes -----------------------
    {
        id : 10,
        title : 'Dashboard',
        icon : <AiOutlineDashboard />,
        role : 'Company',
        path : '/company/dashboard',
        category:'NA'
    },
    {
        id : 20,
        title : 'Customers',
        icon : <FaUsers/>,
        role : 'Company',
        path : '/company/customers',
        category:'Physical Locations'

    },
    {
        id : 22,
        title : 'Service Locations',
        icon : <FaHouse />        ,
        role : 'Company',
        path : '/company/serviceLocations',
        category:'Physical Locations'

    },
    {
        id : 24,
        title : 'Bodies Of Water',
        icon : <FaSwimmingPool/>,
        role : 'Company',
        path : '/company/bodiesOfWater',
        category:'Physical Locations'

    },
    {
        id : 24,
        title : 'Equipment',
        icon : <FaSwimmingPool/>,
        role : 'Company',
        path : '/company/equipmentList',
        category:'Physical Locations'

    },
    {
        id : 30,
        title : 'Jobs',
        icon : <BiCategory/>,
        role : 'Company',
        path : '/company/jobs',
        category:'Operations'
    }
    ,
    {
        id : 32,
        title : 'Service Stops',
        icon : <BiCategory/>,
        role : 'Company',
        path : '/company/serviceStops',
        category:'Operations'
    }
    ,
    
    {
        id : 34,
        title : 'Repair Requests',
        icon : <BiCategory/>,
        role : 'Company',
        path : '/company/repairRequests',
        category:'Operations'
    }
    ,
    {
        id : 36,
        title : 'Task Groups',
        icon : <BiCategory/>,
        role : 'Company',
        path : '/company/taskGroups',
        category:'Operations'
    }
    ,
    {
        id : 48,
        title : 'Items',
        icon : <AiOutlineShoppingCart/>,
        role : 'Company',
        path : '/company/seller',
        category:'Operations'
    },
    {
        id : 50,
        title : 'Route Managment',
        icon : <FaRoute/>,
        role : 'Company',
        path : '/company/routeManagement',
        category:'Routing'
    },
    {
        id : 52,
        title : 'Route Dashboard',
        icon : <FaRoute/>,
        role : 'Company',
        path : '/company/routeDashboard',
        category:'Routing'
    },
    {
        id : 54,
        title : 'Route Builder',
        icon : <FaRoute/>,
        role : 'Company',
        path : '/company/routeBuilder',
        category:'Routing'
    },


    {
        id : 60,
        title : 'Stripe Profile',
        icon : <MdPayment/>,
        role : 'Company',
        path : '/company/stripe-profile',
        category:'Stripe'
    },
    {
        id : 65,
        title : 'Contracts',
        icon : <IoDocumentTextOutline />,
        role : 'Company',
        path : '/company/contracts',
        category:'Monies'
    },
    {
        id : 70,
        title : 'Subscription Management',
        icon : <FaCode />,
        role : 'Company',
        path : '/company/subscription-management',
        category:'Stripe'
    },
    {
        id : 80,
        title : 'Messages',
        icon : <IoIosChatbubbles />,
        role : 'Company',
        path : '/company/messages',
        category:'NA'
    },
    {
        id : 90,
        title : 'Public Page',
        icon : <FaStore  />,
        role : 'Company',
        path : '/company/public-profile',
        category:'NA'
    },
    {
        id : 95,
        title : 'Alerts',
        icon : <GoAlertFill />,
        role : 'Company',
        path : '/company/alerts',
        category:'NA'
    },
    {
        id : 100,
        title : 'Settings',
        icon : <FaGear  />,
        role : 'Company',
        path : '/company/settings',
        category:'NA'
    }
    ,
    {
        id : 110,
        title : 'Roles',
        icon : <FaGear  />,
        role : 'Company',
        path : '/company/roles',
        category:'Users'
    }
    ,
    {
        id : 112,
        title : 'Company Users',
        icon : <FaGear  />,
        role : 'Company',
        path : '/company/companyUsers',
        category:'Users'
    }
    ,
    {
        id : 114,
        title : 'Recurring Labor Contracts',
        icon : <FaGear  />,
        role : 'Company',
        path : '/company/recurringLaborContracts',
        category:'Users'
    }
    ,
    {
        id : 114,
        title : 'One Time Labor Contracts',
        icon : <FaGear  />,
        role : 'Company',
        path : '/company/laborContracts',
        category:'Users'
    }
    ,
    {
        id : 116,
        title : 'Work Logs',
        icon : <FaGear  />,
        role : 'Company',
        path : '/company/workLogs',
        category:'Users'
    }
    // ------------------- Client Routes -----------------------
    ,
    {
        id : 1,
        title : 'Dashboard',
        icon : <AiOutlineDashboard  />,
        role : 'Client',
        path : '/dashboard'
    }
    ,
    {
        id : 2,
        title : 'My Pool',
        icon : <FaSwimmingPool  />,
        role : 'Client',
        path : '/mypool'
    }
    ,  
    {
        id : 4,
        title : 'Equipment',
        icon : <GiBugNet />,
        role : 'Client',
        path : '/equipment'
    }
    , 
    {
        id : 5,
        title : 'Companies',
        icon : <FaStore  />,
        role : 'Client',
        path : '/companies'
    }
    , 
    {
        id : 6,
        title : 'Messages',
        icon : <IoIosChatbubbles  />,
        role : 'Client',
        path : '/messages'
    }
    ,
    {
        id : 7,
        title : 'Contracts',
        icon : <IoDocumentTextOutline  />,
        role : 'Client',
        path : '/contracts'
    }
    ,
    {
        id : 10,
        title : 'Settings',
        icon : <FaGear  />,
        role : 'Client',
        path : '/settings'
    }
]