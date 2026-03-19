import { lazy } from "react";

const Home = lazy(()=> import("../../views/Home"))

const AdminDashboard = lazy(()=> import("../../views/admin/AdminDashboard"))

const SubscriptionList = lazy(()=> import("../../views/admin/subscriptions/SubscriptionList"))
const AddNewSubscription = lazy(()=> import("../../views/admin/subscriptions/AddNewSubscription"))
const SubscriptionDetailView = lazy(()=> import("../../views/admin/subscriptions/SubscriptionDetailView"))

const CompanyList = lazy(()=> import("../../views/admin/company/CompanyList"))
const CompanyDetailView = lazy(()=> import("../../views/admin/company/CompanyDetailView"))

const UniversalEquipment = lazy(()=> import("../../views/admin/universalEquipment/UniversalEquipment"))

export const adminRoutes = [
    {
        path :'/admin/dashboard',
        element : <AdminDashboard/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/dashboard/orders',
        element : <Home/>,
        role : 'Admin'
    }
    ,
    {
        path :'/admin/dashboard/category',
        element : <Home/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/dashboard/seller',
        element : <Home/>,
        role : 'Admin'
    }
    ,
    {
        path :'/admin/dashboard/payment-request',
        element : <Home/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/dashboard/deactive-sellers',
        element : <Home/>,
        role : 'Admin'
    }
    ,
    {
        path :'/admin/dashboard/sellers-request',
        element : <Home/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/dashboard/chat-seller',
        element : <Home/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/subscriptions',
        element : <SubscriptionList/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/subscriptions/addNew',
        element : <AddNewSubscription/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/subscriptions/detail/:subscriptionId',
        element : <SubscriptionDetailView/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/company',
        element : <CompanyList/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/company/detail/:companyId',
        element : <CompanyDetailView/>,
        role : 'Admin'
    }
    ,  
    {
        path :'/admin/universal-equipment',
        element : <UniversalEquipment/>,
        role : 'Admin'
    }
]