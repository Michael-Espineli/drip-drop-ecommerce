import { lazy } from "react";

const ProfilePage = lazy(()=> import("../../views/client/ProfilePage"))
const Dashboard = lazy(()=> import("../../views/client/Dashboard"))
const MyPool = lazy(()=> import("../../views/client/MyPool"))

const Contracts = lazy(()=> import("../../views/client/contract/Contracts"))
const Messages = lazy(()=> import("../../views/client/Messages/Messages"))
const ContractDetailView = lazy(()=> import("../../views/client/contract/ContractDetailView"))
const Companies = lazy(()=> import("../../views/client/companies/Companies"))
const CompanyProfilePage = lazy(()=> import("../../views/client/companies/CompanyProfilePage"))
const EquipmentDetailView = lazy(()=> import("../../views/client/equipment/EquipmentDetailView"))
const EquipmentList = lazy(()=> import("../../views/client/equipment/EquipmentList"))
const Settings = lazy(()=> import("../../views/client/Settings"))



export const clientRoutes = [
    {
        path:'/dashboard', 
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
        path:'/messages',
        element: <Messages/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/contracts',
        element: <Contracts/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/settings',
        element: <Settings/>,
        ability :['Admin','Client'],
        role:'Client'
    },  
    {
        path:'/profile',
        element: <ProfilePage/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/mypool',
        element: <MyPool/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    {
        path:'/equipment',
        element: <EquipmentList/>,
        ability :['Admin','Client'],
        role:'Client'
    },
    // Detail Views
    {
        path:'/contracts/contract/:contractId',
        element: <ContractDetailView/>,
        ability :['Admin','Seller'],
        role:'Client'
    }
    ,
    {
        path:'/companies/profile/:companyId',
        element: <CompanyProfilePage/>,
        ability :['Admin','Seller'],
        role:'Client'
    }
    ,
    {
        path:'/equipment/:equipmentId',
        element: <EquipmentDetailView/>,
        ability :['Admin','Seller'],
        role:'Client'
    }
]