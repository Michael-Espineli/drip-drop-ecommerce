import React, { lazy } from "react";

const SignUp = lazy(() => import("../../views/auth/SignUp"))
const SignIn = lazy(() => import("../../views/auth/SignIn"))
const ReedemInviteCode = lazy(() => import("../../views/auth/ReedemInviteCode"))
const HomeOwnerSignUp = lazy(() => import("../../views/auth/HomeOwnerSignUp"))
const HomeOwnerSignIn = lazy(() => import("../../views/auth/HomeOwnerSignIn"))
const Home = lazy(() => import("../../views/Home"))
const Refresh = lazy(() => import("../../views/Refresh"))
const Return = lazy(() => import("../../views/Return"))
const Success = lazy(() => import("../../views/Success"))
const Cancel = lazy(() => import("../../views/Cancel"))
const About = lazy(() => import("../../views/public/About"))
const Products = lazy(() => import("../../views/public/Products"))
const Homeowners = lazy(() => import("../../views/public/Homeowners"))
const Company = lazy(() => import("../../views/public/Company"))
const Companies = lazy(() => import("../../views/public/Companies"))
const CompanyPublicProfile = lazy(() => import("../../views/public/CompanyPublicProfile"))
const PrivacyPolicy = lazy(() => import("../../views/public/PrivacyPolicy"))
const Info = lazy(() => import("../../views/public/Info"))
const Contact = lazy(() => import("../../views/public/Contact"))
const Feedback = lazy(() => import("../../views/public/Feedback"))
const AdminSignIn = lazy(() => import("../../views/auth/AdminSignIn"))
const SuccessfulSubscription = lazy(() => import("../../views/SuccessfulSubscription"))
const ClientAccountInviteLanding = lazy(() => import("../../views/client/ClientAccountInviteLanding"))
const PublicServiceRequest = lazy(() => import("../../views/public/PublicServiceRequest"))
const PublicServiceRequestVerification = lazy(() => import("../../views/public/PublicServiceRequestVerification"))
const PublicServiceAgreementLanding = lazy(() => import("../../views/public/PublicServiceAgreementLanding"))
const PublicServiceAgreementInspectionReport = lazy(() => import("../../views/public/PublicServiceAgreementInspectionReport"))
const ClientInvoiceDetail = lazy(() => import("../../views/client/billing/ClientInvoiceDetail"))

const TermsOfService = lazy(() => import("../../views/public/TermsOfService"))

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
    path: "/companies",
    element: <Companies />,
  }
  ,
  {
    path: "/companies/profile/:companyId",
    element: <CompanyPublicProfile />,
  }
  ,
  {
    path: "/products",
    element: <Products />,
  }
  ,
  {
    path: "/signUp",
    element: <SignUp />,
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
    path: "/company/invite/:inviteId",
    element: <ReedemInviteCode />,
  }
  ,
  {
    path: "/homeownerSignUp",
    element: <HomeOwnerSignUp />,
  }
  ,
  {
    path: "/homeownerSignIn",
    element: <HomeOwnerSignIn />,
  }
  ,
  {
    path: "/client/customer-account-invite/:inviteId",
    element: <ClientAccountInviteLanding />,
  }
  ,
  {
    path: "/client/claim-account/:inviteId",
    element: <ClientAccountInviteLanding />,
  }
  ,
  {
    path: "/request-service/:companyId",
    element: <PublicServiceRequest />,
  }
  ,
  {
    path: "/public/service-request/:companyId",
    element: <PublicServiceRequest />,
  }
  ,
  {
    path: "/public-service-request/verify/:verificationId",
    element: <PublicServiceRequestVerification />,
  }
  ,
  {
    path: "/service-request/verify/:verificationId",
    element: <PublicServiceRequestVerification />,
  }
  ,
  {
    path: "/customer/service-agreements/:agreementId/inspection-report",
    element: <PublicServiceAgreementInspectionReport />,
  }
  ,
  {
    path: "/customer/service-agreements/:agreementId",
    element: <PublicServiceAgreementLanding />,
  }
  ,
  {
    path: "/customer/invoices/:invoiceId",
    element: <ClientInvoiceDetail />,
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
    path: "/feedback",
    element: <Feedback />,
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
