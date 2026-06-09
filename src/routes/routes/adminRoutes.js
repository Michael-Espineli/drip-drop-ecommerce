import { lazy } from "react";

const Home = lazy(() => import("../../views/Home"))

const AdminDashboard = lazy(() => import("../../views/admin/AdminDashboard"))

const SubscriptionList = lazy(() => import("../../views/admin/subscriptions/SubscriptionList"))
const AddNewSubscription = lazy(() => import("../../views/admin/subscriptions/AddNewSubscription"))
const SubscriptionDetailView = lazy(() => import("../../views/admin/subscriptions/SubscriptionDetailView"))

const CompanyList = lazy(() => import("../../views/admin/company/CompanyList"))
const CompanyDetailView = lazy(() => import("../../views/admin/company/CompanyDetailView"))

const UniversalEquipment = lazy(() => import("../../views/admin/universalEquipment/UniversalEquipment"))
const UniversalReadingsDosages = lazy(() => import("../../views/admin/universalTemplates/UniversalReadingsDosages"))
const DripDropWorkflowArchitectureDocsPage = lazy(() => import("../../views/admin/documentation/DripDropWorkflowArchitectureDocsPage"))
const FeatureFlags = lazy(() => import("../../views/admin/featureFlags/FeatureFlags"))
const Complaints = lazy(() => import("../../views/admin/complaints/Complaints"))
const ProductFeedback = lazy(() => import("../../views/admin/feedback/ProductFeedback"))
const ReachOutMessages = lazy(() => import("../../views/admin/messages/ReachOutMessages"))
const DeactivatedSellers = lazy(() => import("../../views/admin/sellers/DeactivatedSellers"))
const SellerRequests = lazy(() => import("../../views/admin/sellers/SellerRequests"))
const LiveChat = lazy(() => import("../../views/admin/liveChat/LiveChat"))
export const adminRoutes = [
    {
        path: '/admin/dashboard',
        element: <AdminDashboard />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/dashboard/orders',
        element: <Home />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/dashboard/category',
        element: <Home />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/dashboard/seller',
        element: <Home />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/dashboard/payment-request',
        element: <Complaints />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/dashboard/deactive-sellers',
        element: <DeactivatedSellers />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/dashboard/sellers-request',
        element: <SellerRequests />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/dashboard/chat-seller',
        element: <LiveChat />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/subscriptions',
        element: <SubscriptionList />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/subscriptions/addNew',
        element: <AddNewSubscription />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/subscriptions/detail/:subscriptionId',
        element: <SubscriptionDetailView />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/company',
        element: <CompanyList />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/company/detail/:companyId',
        element: <CompanyDetailView />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/universal-equipment',
        element: <UniversalEquipment />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/universal-readings-dosages',
        element: <UniversalReadingsDosages />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/feature-flags',
        element: <FeatureFlags />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/product-feedback',
        element: <ProductFeedback />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/reach-out-messages',
        element: <ReachOutMessages />,
        role: 'Admin'
    }
    ,
    {
        path: '/admin/documentation',
        element: <DripDropWorkflowArchitectureDocsPage />,
        role: 'Admin'
    }
]
