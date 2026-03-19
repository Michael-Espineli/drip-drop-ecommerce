import { lazy } from "react";

const ProfilePage = lazy(()=> import("../../views/client/ProfilePage"))
const Dashboard = lazy(()=> import("../../views/client/Dashboard"))
const MyPool = lazy(()=> import("../../views/client/MyPool"))
const NewPool = lazy(()=> import("../../views/client/NewPool"))
const ConnectToCompany = lazy(()=> import("../../views/client/ConnectToCompany"))


const Contracts = lazy(()=> import("../../views/client/contract/Contracts"))
const Messages = lazy(()=> import("../../views/client/Messages/Messages"))
const NewCompanyChat = lazy(()=> import("../../views/client/Messages/NewCompanyChat"))
const CompanyConversation = lazy(()=> import("../../views/client/Messages/CompanyConversation"))
const ContractDetailView = lazy(()=> import("../../views/client/contract/ContractDetailView"))

const Companies = lazy(()=> import("../../views/client/companies/Companies"))
const SavedCompanies = lazy(()=> import("../../views/client/companies/SavedCompanies"))

const CompanyProfilePage = lazy(()=> import("../../views/client/companies/CompanyProfilePage"))
const EquipmentDetailView = lazy(()=> import("../../views/client/equipment/EquipmentDetailView"))
const EquipmentList = lazy(()=> import("../../views/client/equipment/EquipmentList"))
const NewEquipment = lazy(() => import("../../views/client/equipment/NewEquipment"));
const Settings = lazy(()=> import("../../views/client/Settings"))
const CreateServiceLocation = lazy(()=> import("../../views/client/serviceLocations/CreateServiceLocation"))
const ConnectServiceLocation = lazy(()=> import("../../views/client/serviceLocations/ConnectServiceLocation"))
const ServiceHistoryDetail = lazy(()=> import("../../views/client/serviceHistory/ServiceHistoryDetail"))

const RepairRequests = lazy(() => import("../../views/client/repairRequests/RepairRequests"));
const NewRepairRequest = lazy(()=> import("../../views/client/repairRequests/NewRepairRequest"))
const RepairRequestDetail = lazy(() => import("../../views/client/repairRequests/RepairRequestDetail"));
const NewRequest = lazy(() => import("../../views/client/serviceRequests/NewRequest"));
const ServiceRequests = lazy(() => import("../../views/client/serviceRequests/ServiceRequests"));
const ServiceRequestDetail = lazy(() => import("../../views/client/serviceRequests/ServiceRequestDetail"));
const EditServiceRequest = lazy(() => import("../../views/client/serviceRequests/EditServiceRequest"));

const NewBodyOfWater = lazy(() => import("../../views/client/pools/NewBodyOfWater"));
const BodyOfWaterDetailView = lazy(() => import("../../views/client/pools/BodyOfWaterDetailView"));

const ClientProfile = lazy(() => import('../../views/client/account/ClientProfile'));
const ClientSettings = lazy(() => import('../../views/client/account/ClientSettings'));
export const clientRoutes = [
    
    {
        path:'/client/connect-to-company', 
        element: <ConnectToCompany/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/dashboard', 
        element: <Dashboard/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/companies',
        element: <Companies/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/client/settings',
        element: <ClientSettings/>,
        ability :['Admin','Client'],
        role:'Client'
    },  
    {
        path:'/client/profile',
        element: <ClientProfile/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/serviceLocation/connect/:linkedInviteId',
        element: <ConnectServiceLocation/>,
        ability :['Admin','Client'],
        role:'Client'
    }
    ,
    {
        path:'/serviceLocation/create',
        element: <CreateServiceLocation/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/client/equipment',
        element: <EquipmentList/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/client/equipment/:equipmentId',
        element: <EquipmentDetailView/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path: '/client/equipment/new',
        element: <NewEquipment />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    },
    {
        path:'/client/pools-spas/new', 
        element: <NewBodyOfWater/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/pools-spas/:bodyOfWaterId', 
        element: <BodyOfWaterDetailView/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    // Detail Views
    {
        path:'/contracts/contract/:contractId',
        element: <ContractDetailView/>,
        ability :['Admin','Client'],
        role:'Client'
    }
    ,
    {
        path:'/serviceStop/detail/:serviceStopId',
        element: <ServiceHistoryDetail/>,
        ability :['Admin','Client'],
        role:'Client'
    }
    ,
    {
        path:'/companies/profile/:companyId',
        element: <CompanyProfilePage/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/messages/newCompany/:companyId',
        element: <NewCompanyChat/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/client/chat', 
        element: <Messages/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/chat/details/:chatId',
        element: <CompanyConversation/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/client/companies', 
        element: <Companies/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/saved-companies', 
        element: <SavedCompanies/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/contracts', 
        element: <Contracts/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/recurring-contracts', 
        element: <Dashboard/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/my-pool', 
        element: <MyPool/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path:'/client/my-pool/new', 
        element: <NewPool/>,
        ability :['Admin','Client'], 
        role:'Client'
    },
    {
        path: '/client/repair-requests',
        element: <RepairRequests />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    },
    {
        path: '/client/repair-requests/new',
        element: <NewRepairRequest />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    },
    {
        path: '/client/repair-requests/:repairRequestId',
        element: <RepairRequestDetail />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    },
    {
        path: '/client/service-requests/new/:companyId',
        element: <NewRequest />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    },
    {
        path: '/client/service-requests',
        element: <ServiceRequests />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    },
    {
        path: '/client/service-requests/:requestId',
        element: <ServiceRequestDetail />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    },
    {
        path: '/client/service-requests/edit/:requestId',
        element: <EditServiceRequest />,
        ability: ['Admin', 'Client'],
        role: 'Client'
    }
]