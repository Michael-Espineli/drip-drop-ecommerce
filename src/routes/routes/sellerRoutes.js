import { lazy } from "react";

const Home = lazy(()=> import("../../views/Home"))
const ProfilePage = lazy(()=> import("../../views/company/ProfilePage"))
const Dashboard = lazy(()=> import("../../views/company/Dashboard"))

const Jobs = lazy(()=> import("../../views/company/jobs/Jobs"))
const CreateNewJob = lazy(()=> import("../../views/company/jobs/CreateNewJob"))
const JobDetailView = lazy(()=> import("../../views/company/jobs/JobDetailView"))

const ServiceStops = lazy(()=> import("../../views/company/serviceStops/ServiceStops"))
const CreateNewServiceStop = lazy(()=> import("../../views/company/serviceStops/CreateNewServiceStop"))
const ServiceStopDetails = lazy(()=> import("../../views/company/serviceStops/ServiceStopDetails"))

const PublicPage = lazy(()=> import("../../views/company/PublicPage"))
const Settings = lazy(()=> import("../../views/company/Settings/Settings"))
const Chat = lazy(()=> import("../../views/company/Chat"))
const WorkInProgress = lazy(()=> import("../../views/company/WorkInProgress"))

const Customers = lazy(()=> import("../../views/company/customers/Customers"))
const CustomerDetails = lazy(()=> import("../../views/company/customers/CustomerDetails"))
const CreateNewCustomer = lazy(()=> import("../../views/company/customers/CreateNewCustomer"))

const RouteDashboard = lazy(()=> import("../../views/company/routing/RouteDashboard"))
const RouteManagement = lazy(()=> import("../../views/company/routing/RouteManagement"))
const RouteBuilder = lazy(()=> import("../../views/company/routing/RouteBuilder"))

const Subscriptions = lazy(()=> import("../../views/company/stripe-subscriptions/Subscriptions"))
const CreateNewProduct = lazy(()=> import("../../views/company/stripe-subscriptions/products/CreateNewProduct"))
const Products = lazy(()=> import("../../views/company/stripe-subscriptions/products/Products"))
const EditProduct = lazy(()=> import("../../views/company/stripe-subscriptions/products/EditProduct"))
const Alerts = lazy(()=> import("../../views/company/Alerts"))

const Contracts = lazy(()=> import("../../views/company/contract/Contracts"))
const CreateNew = lazy(()=> import("../../views/company/contract/CreateNew"))
const ContractDetailView = lazy(()=> import("../../views/company/contract/ContractDetailView"))

const ServiceLocations = lazy(()=> import("../../views/company/serviceLocations/ServiceLocations"))
const CreateNewServiceLocation = lazy(()=> import("../../views/company/serviceLocations/CreateNewServiceLocation"))

const BodiesOfWater = lazy(()=> import("../../views/company/bodiesOfWater/BodiesOfWater"))
const CreateNewBodyOfWater = lazy(()=> import("../../views/company/bodiesOfWater/CreateNewBodyOfWater"))

const EquipmentList = lazy(()=> import("../../views/company/equipment/EquipmentList"))

const Roles = lazy(()=> import("../../views/company/roles/Roles"))
const RoleDetails = lazy(()=> import("../../views/company/roles/RoleDetails"))

const WorkLogs = lazy(()=> import("../../views/company/worklogs/WorkLogs"))
const WorkLogDetails = lazy(()=> import("../../views/company/worklogs/WorkLogDetails"))

const CompanyUsers = lazy(()=> import("../../views/company/companyUsers/CompanyUsers"))
const CompanyUserDetails = lazy(()=> import("../../views/company/companyUsers/CompanyUserDetails"))

const LaborContracts = lazy(()=> import("../../views/company/laborContracts/LaborContracts"))
const RecurringLaborContractDetails = lazy(()=> import("../../views/company/laborContracts/RecurringLaborContractDetails"))
const CreateNewLaborContract = lazy(()=> import("../../views/company/laborContracts/CreateNewLaborContract"))

const OneTimeLaborContracts = lazy(()=> import("../../views/company/oneTimeLaborContracts/OneTimeLaborContracts"))
const CreateNewOneTimeLaborContract = lazy(()=> import("../../views/company/oneTimeLaborContracts/CreateNewOneTimeLaborContract"))
const LaborContractDetails = lazy(()=> import("../../views/company/oneTimeLaborContracts/LaborContractDetails"))

const TaskGroups = lazy(()=> import("../../views/company/Settings/TaskGroups/TaskGroups"))
const TaskGroupDetails = lazy(()=> import("../../views/company/Settings/TaskGroups/TaskGroupDetails"))


export const sellerRoutes = [
    
    //Basic Pages
    {
        path:'/company/dashboard',
        element: <Dashboard/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/profile',
        element: <ProfilePage/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/customers',
        element: <Customers/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/serviceLocations',
        element: <ServiceLocations/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/bodiesOfWater',
        element: <BodiesOfWater/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/equipmentList',
        element: <EquipmentList/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    
    {
        path:'/company/jobs',
        element: <Jobs/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/jobs/createNew',
        element: <CreateNewJob/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/jobs/detail/:jobId',
        element: <JobDetailView/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,

    {
        path:'/company/serviceStops',
        element: <ServiceStops/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/serviceStops/createNew/:jobId',
        element: <CreateNewServiceStop/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/serviceStops/detail/:serviceStopId',
        element: <ServiceStopDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    
    {
        path:'/company/repairRequests',
        element: <WorkInProgress/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/seller',
        element: <Home/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/routing',
        element: <RouteDashboard/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/stripe-profile',
        element: <Home/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/contracts',
        element: <Contracts/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/contracts/contract/:contractId',
        element: <ContractDetailView/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    // ,
    // {
    //     path:'/company/contracts/createNew',
    //     element: <CreateNew/>,
    //     ability :['Admin','Seller'],
    //     role:'Company'
    // }
    ,

    {
        path:'/company/subscription-management',
        element: <Subscriptions/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/messages',
        element: <Chat/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/public-profile',
        element: <PublicPage/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/settings',
        element: <Settings/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
        // List Pages
    {
        path:'/company/stripe-subscriptions/products',
        element: <Products/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    // Detail Pages
    {
        path:'/company/customers/details/:customerId',
        element: <CustomerDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    // Create Pages
    {
        path:'/company/stripe-subscriptions/products/addNew',
        element: <CreateNewProduct/>,
        ability :['Admin','Seller'],
        role:'Company'
    },
    {
        path:'/company/stripe-subscriptions/products/edit/:productId',
        element: <EditProduct/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/alerts',
        element: <Alerts/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/routeManagement',
        element: <RouteManagement/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/routeDashboard',
        element: <RouteDashboard/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/routeBuilder',
        element: <RouteBuilder/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/roles',
        element: <Roles/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/roles/:roleId',
        element: <RoleDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/companyUsers',
        element: <CompanyUsers/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/companyUsers/:companyUserId',
        element: <CompanyUserDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/recurringLaborContracts',
        element: <LaborContracts/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/recurringLaborContracts/:laborContractId',
        element: <RecurringLaborContractDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/workLogs',
        element: <WorkLogs/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/workLogs/:workLogId',
        element: <WorkLogDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/contracts/createNew/:customerId',
        element: <CreateNew/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/customers/createNew',
        element: <CreateNewCustomer/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/serviceLocations/createNew/:customerId',
        element: <CreateNewServiceLocation/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/bodiesOfWater/createNew/:customerId/:serviceLocationId',
        element: <CreateNewBodyOfWater/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/recurringLaborContracts/createNew',
        element: <CreateNewLaborContract/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/laborContracts',
        element: <OneTimeLaborContracts/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/laborContracts/createNew/:jobId',
        element: <CreateNewOneTimeLaborContract/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/laborContracts/details/:laborContractId',
        element: <LaborContractDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/taskGroups',
        element: <TaskGroups/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    {
        path:'/company/taskGroups/details/:taskGroupId',
        element: <TaskGroupDetails/>,
        ability :['Admin','Seller'],
        role:'Company'
    }
    ,
    
]

