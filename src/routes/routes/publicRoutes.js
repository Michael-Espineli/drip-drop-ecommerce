import React, { lazy } from "react";

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
const PrivacyPolicy = lazy(()=> import("../../views/public/PrivacyPolicy"))
const Terms = lazy(()=> import("../../views/public/Terms"))
const Info = lazy(()=> import("../../views/public/Info"))
const Contact = lazy(()=> import("../../views/public/Contact"))
const AdminSignIn = lazy(()=> import("../../views/auth/AdminSignIn"))
const SuccessfulSubscription = lazy(()=> import("../../views/SuccessfulSubscription"))

const TermsOfService = lazy(()=> import("../../views/public/TermsOfService"))

const publicRoutes = [
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
      path: "/adminSignIn",
      element: <AdminSignIn />
    }
    ,
    {
      path: "/privacyPolicy",
      element: <PrivacyPolicy />,
    }
    ,
    {
      path: "/termsOfService",
      element: <TermsOfService />,
    }
    ,
    
    {
      path: "/info",
      element: <Info />,
    }
    ,
    {
      path: "/contact",
      element: <Contact />,
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
    }
    ,
    {
      path: "/success/subscription/subscriptionId/:subscriptionId",
      element: <SuccessfulSubscription />,
    }
    ,
    
  ]

export default publicRoutes;