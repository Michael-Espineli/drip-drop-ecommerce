import { lazy } from "react";

const Home = lazy(()=> import("../../views/Home"))

export const adminRoutes = [
    {
        path :'admin/dashboard',
        element : <Home/>,
        role : 'Admin'
    },  
    {
        path :'admin/dashboard/orders',
        element : <Home/>,
        role : 'Admin'
    },
    {
        path :'admin/dashboard/category',
        element : <Home/>,
        role : 'Admin'
    },  
    {
        path :'admin/dashboard/seller',
        element : <Home/>,
        role : 'Admin'
    },
    {
        path :'admin/dashboard/payment-request',
        element : <Home/>,
        role : 'Admin'
    },  
    {
        path :'admin/dashboard/deactive-sellers',
        element : <Home/>,
        role : 'Admin'
    },
    {
        path :'admin/dashboard/sellers-request',
        element : <Home/>,
        role : 'Admin'
    },  
    {
        path :'admin/dashboard/chat-seller',
        element : <Home/>,
        role : 'Admin'
    }
]