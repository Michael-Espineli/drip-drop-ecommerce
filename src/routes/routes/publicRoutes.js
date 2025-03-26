import React, { lazy } from "react";
import PublicLayout from '../../layout/PublicHeader';

const SignUp = lazy(()=> import("../../views/auth/SignUp"))
const SignIn = lazy(()=> import("../../views/auth/SignIn"))
const ReedemInviteCode = lazy(()=> import("../../views/auth/ReedemInviteCode"))
const HomeOwnerSignUp = lazy(()=> import("../../views/auth/HomeOwnerSignUp"))
const HomeOwnerSignIn = lazy(()=> import("../../views/auth/HomeOwnerSignIn"))
const Home = lazy(()=> import("../../views/Home"))
const Refresh = lazy(()=> import("../../views/Refresh"))
const Return = lazy(()=> import("../../views/Return"))
const Success = lazy(()=> import("../../views/Success"))
const Cancel = lazy(()=> import("../../views/Cancel"))
const About = lazy(()=> import("../../views/public/About"))
const Products = lazy(()=> import("../../views/public/Products"))
const Homeowners = lazy(()=> import("../../views/public/Homeowners"))
const Company = lazy(()=> import("../../views/public/Company"))

const publicRoutes = [
    // {
    //   path: "/",
    //   element: <PublicLayout />,
    //   children: <Home />
    // }
    // ,
    // {
    //   path: "/about",
    //   element: <PublicLayout />,
    //   children: <About />
    // }
    // ,
    {
      path: "/",
      element: <Home />,
    }
    ,
    {
      path: "/about",
      element: <About />,
    }
    ,
    {
      path: "/homeowners",
      element: <Homeowners />,
    }
    ,
    {
      path: "/company",
      element: <Company />,
    }
    ,
    {
      path: "/products",
      element: <Products />,
    }
    ,
    {
      path: "/signUp",
      element: <SignUp/>,
    }
    ,
    {
      path: "/signIn",
      element: <SignIn />,
    }
    ,
    {
      path: "/reedemInviteCode",
      element: <ReedemInviteCode />,
    }
    ,
    {
      path: "/homeOwnerSignUp",
      element: <HomeOwnerSignUp/>,
    }
    ,
    {
      path: "/homeOwnerSignIn",
      element: <HomeOwnerSignIn />,
    }
    ,
    {
      path: "/refresh/:connectedAccountId",
      element: <Refresh />,
    }
    ,
    {
      path: "/return/:connectedAccountId",
      element: <Return />,
    }
    ,
    {
      path: "/canceled",
      element: <Cancel />,
    }
    ,
    {
      path: "/success/sessionId/:sessionId",
      element: <Success />,
    },
  ]

export default publicRoutes;