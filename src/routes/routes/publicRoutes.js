import React, { lazy } from "react";

const SignUp = lazy(()=> import("../../views/auth/SignUp"))
const SignIn = lazy(()=> import("../../views/auth/SignIn"))
const Home = lazy(()=> import("../../views/Home"))
const Refresh = lazy(()=> import("../../views/Refresh"))
const Return = lazy(()=> import("../../views/Return"))
const Success = lazy(()=> import("../../views/Success"))
const Cancel = lazy(()=> import("../../views/Cancel"))

const publicRoutes = [
    {
      path: "/",
      element: <Home />,
    },
    {
      path: "/signUp",
      element: <SignUp/>,
    },
    {
      path: "/signIn",
      element: <SignIn />,
    },
    {
      path: "/refresh/:connectedAccountId",
      element: <Refresh />,
    },
    {
      path: "/return/:connectedAccountId",
      element: <Return />,
    },
    {
      path: "/canceled",
      element: <Cancel />,
    },
    {
      path: "/success/sessionId/:sessionId",
      element: <Success />,
    },
  ]

export default publicRoutes;