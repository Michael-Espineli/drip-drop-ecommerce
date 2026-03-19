import { lazy } from "react";

const CompanyDashboardWrapper = lazy(() => import("../../views/company/CompanyDashboardWrapper"));
const BrowseCompanies = lazy(() => import("../../views/tech/browse/BrowseCompanies"));
const NoCompanyChat = lazy(() => import("../../views/tech/NoCompanyChat"));
const CompanyDetail = lazy(() => import("../../views/tech/CompanyDetail"));
const JobPostings = lazy(() => import("../../views/tech/JobPostings"));
const JobPostingDetail = lazy(() => import("../../views/tech/JobPostingDetail"));
const CompanyChat = lazy(() => import("../../views/tech/techChat/Chat"));
const CompanyConversation = lazy(() => import("../../views/tech/techChat/CompanyConversation"));
const ChatInitiation = lazy(() => import("../../views/tech/techChat/ChatInitiation"));
const SavedCompanies = lazy(() => import("../../views/tech/browse/SavedCompanies"));

const CompanyCreationInfo = lazy(() => import("../../views/company/companySelection/CompanyCreationInfo"));
const CompanySelection = lazy(() => import("../../views/company/companySelection/CompanySelection"));
const CreateNewCompany = lazy(() => import("../../views/company/companySelection/CreateNewCompany"));

const PendingInvites = lazy(() => import("../../views/company/invites/PendingInvites"));
const AcceptedInvites = lazy(() => import("../../views/company/invites/AcceptedInvites"));
const RejectedInvites = lazy(() => import("../../views/company/invites/RejectedInvites"));


export const businessRoutes = [
    {
        path: '/company/dashboard',
        element: <CompanyDashboardWrapper />,
        role: 'company',
        name: 'Company Dashboard'
    },
    {
        path: '/company/selection',
        element: <CompanySelection />,
        role: 'company',
        name: 'Company Selection'
    },
    {
        path: '/company/create-new',
        element: <CreateNewCompany />,
        role: 'company',
        name: 'Create New Company'
    },
    {
        path: '/company/create-info',
        element: <CompanyCreationInfo />,
        role: 'company',
        name: 'Create New Company Info'
    },
    {
        path: '/invites/pending',
        element: <PendingInvites />,
        role: 'company',
        name: 'Pending Invites'
    },
    {
        path: '/invites/rejected',
        element: <RejectedInvites />,
        role: 'company',
        name: 'Rejected Invites'
    },
    {
        path: '/invites/accepted',
        element: <AcceptedInvites />,
        role: 'company',
        name: 'Accepted Invites'
    },
    {
        path: '/browse-companies',
        element: <BrowseCompanies />,
        role: 'company',
        name: 'Browse Companies'
    },
    {
        path: '/saved-companies',
        element: <SavedCompanies />,
        role: 'company',
        name: 'Saved Companies'
    },
    {
        path: 'companies-chat',
        element: <CompanyChat />,
        role: 'company',
        name: 'Company Chat'
    },
    {
        path: '/companies-chat/detail/:chatId',
        element: <CompanyConversation />,
        role: 'company',
        name: 'Company Conversation'
    },
    {
        path: '/company/chat/initiate/:participantId',
        element: <ChatInitiation />,
        role: 'company',
        name: 'Company Conversation'
    },
    {
        path: '/companies-detail/:id',
        element: <CompanyDetail />,
        role: 'company',
        name: 'Company Detail'
    },
    {
        path: '/job-postings',
        element: <JobPostings />,
        role: 'company',
        name: 'Company Detail'
    },
    {
        path: '/job-postings/details/:id',
        element: <JobPostingDetail />,
        role: 'company',
        name: 'Company Detail'
    }
    
]