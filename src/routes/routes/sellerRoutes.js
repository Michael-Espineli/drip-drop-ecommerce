import { lazy } from "react";
import { Navigate } from "react-router-dom";

const CompanyUserDashboard = lazy(() => import("../../views/company/CompanyUserDashboard"))

const Home = lazy(() => import("../../views/Home"))
const ProfilePage = lazy(() => import("../../views/company/ProfilePage"))
const CompanyDashboardWrapper = lazy(() => import("../../views/company/CompanyDashboardWrapper"))
const CompanySelection = lazy(() => import("../../views/company/companySelection/CompanySelection"))
const OperationsDashboard = lazy(() => import("../../views/company/dashboard/OperationsDashboard"));

const Jobs = lazy(() => import("../../views/company/jobs/Jobs"))
const CreateNewJob = lazy(() => import("../../views/company/jobs/CreateNewJob"))
const JobDetailView = lazy(() => import("../../views/company/jobs/JobDetailView"))
const JobHistoryView = lazy(() => import("../../views/company/jobs/JobHistoryView"))

const ServiceStops = lazy(() => import("../../views/company/serviceStops/ServiceStops"))
const CreateNewServiceStop = lazy(() => import("../../views/company/serviceStops/CreateNewServiceStop"))
const ServiceStopDetails = lazy(() => import("../../views/company/serviceStops/ServiceStopDetails"))

const RepairRequests = lazy(() => import("../../views/company/repairRequests/RepairRequests"))
const CreateNewRepairRequest = lazy(() => import("../../views/company/repairRequests/CreateNewRepairRequest"))
const RepairRequestDetailView = lazy(() => import("../../views/company/repairRequests/RepairRequestDetailView"))

const PublicPage = lazy(() => import("../../views/company/PublicPage"))
const Settings = lazy(() => import("../../views/company/settings/Settings"))

const ChatInitiation = lazy(() => import("../../views/company/messages/ChatInitiation"));
const Chat = lazy(() => import("../../views/tech/techChat/Chat"));

const WorkInProgress = lazy(() => import("../../views/company/WorkInProgress"))

const Customers = lazy(() => import("../../views/company/customers/Customers"))
const CustomerDetails = lazy(() => import("../../views/company/customers/CustomerDetails"))
const CreateNewCustomer = lazy(() => import("../../views/company/customers/CreateNewCustomer"))
const BulkCustomerUpload = lazy(() => import("../../views/company/customers/BulkCustomerUpload"))
const CustomerHistory = lazy(() => import("../../views/company/customers/CustomerHistory"))
const ReadingsAndDosagesHistory = lazy(() => import("../../views/company/customers/ReadingsAndDosagesHistory"))


const RouteDashboard = lazy(() => import("../../views/company/routing/RouteOverviewDashboard"))
const DailyRouteBoard = lazy(() => import("../../views/company/routing/RouteDashboard"))
const RouteManagement = lazy(() => import("../../views/company/routing/RouteManagement"))
const RouteBuilder = lazy(() => import("../../views/company/routing/RouteBuilder"))

const RecurringServiceStopList = lazy(() => import("../../views/company/recurringServiceStops/RecurringServiceStopList"))
const RecurringServiceStopDetails = lazy(() => import("../../views/company/recurringServiceStops/RecurringServiceStopDetails"))
const CreateNewRecurringServiceStops = lazy(() => import("../../views/company/recurringServiceStops/CreateNewRecurringServiceStop"))

const StripeSubscriptions = lazy(() => import("../../views/company/stripe-subscriptions/StripeSubscriptions"))
const CreateNewProduct = lazy(() => import("../../views/company/stripe-subscriptions/products/CreateNewProduct"))
const Products = lazy(() => import("../../views/company/stripe-subscriptions/products/Products"))
const EditProduct = lazy(() => import("../../views/company/stripe-subscriptions/products/EditProduct"))
const Alerts = lazy(() => import("../../views/company/Alerts"))
const TodoList = lazy(() => import("../../views/company/todo/TodoList"))

const Contracts = lazy(() => import("../../views/company/contract/Contracts"))
const CreateNew = lazy(() => import("../../views/company/contract/CreateNew"))
const ContractDetailView = lazy(() => import("../../views/company/contract/ContractDetailView"))

const RecurringContracts = lazy(() => import("../../views/company/contractRecurring/RecurringContracts"))
const CreateNewRecurringContract = lazy(() => import("../../views/company/contractRecurring/CreateNewRecurringContract"))
const RecurringContractDetailView = lazy(() => import("../../views/company/contractRecurring/RecurringContractDetailView"))

const PurchaseListView = lazy(() => import("../../views/company/purchases/PurchaseListView"))
const CreateNewPurchase = lazy(() => import("../../views/company/purchases/CreateNewPurchase"))
const PurchaseDetailView = lazy(() => import("../../views/company/purchases/PurchaseDetailView"))
const AlphaWaterReceiptImport = lazy(() => import("../../views/company/purchases/AlphaWaterReceiptImport"))

const ShoppingListView = lazy(() => import("../../views/company/shoppingList/ShoppingListListView"))
const CreateNewShoppingList = lazy(() => import("../../views/company/shoppingList/ShoppingListCreateView"))
const ShoppingListDetailView = lazy(() => import("../../views/company/shoppingList/ShoppingListDetailView"))
const PartApprovals = lazy(() => import("../../views/company/partApprovals/PartApprovals"))

const DataBaseItemDetailView = lazy(() => import("../../views/company/databaseItems/DataBaseItemDetailView"))
const CreateNewDataBaseItem = lazy(() => import("../../views/company/databaseItems/CreateNewDataBaseItem"))
const DataBaseItems = lazy(() => import("../../views/company/databaseItems/DataBaseItems"))
const DataBaseItemBulkUpload = lazy(() => import("../../views/company/databaseItems/DataBaseItemBulkUpload"))

const ReceiptListView = lazy(() => import("../../views/company/purchases/ReceiptListView"))
const ReceiptDetailView = lazy(() => import("../../views/company/purchases/ReceiptDetailView"))

const ServiceLocations = lazy(() => import("../../views/company/serviceLocations/ServiceLocations"))
const CreateNewServiceLocation = lazy(() => import("../../views/company/serviceLocations/CreateNewServiceLocation"))
const ServiceLocationDetails = lazy(() => import("../../views/company/serviceLocations/ServiceLocationDetails"))

const BodiesOfWater = lazy(() => import("../../views/company/bodiesOfWater/BodiesOfWater"))
const CreateBodyOfWater = lazy(() => import("../../views/company/bodiesOfWater/CreateBodyOfWater"));
const BodiesOfWaterDetails = lazy(() => import("../../views/company/bodiesOfWater/BodiesOfWaterDetails"))

const EquipmentList = lazy(() => import("../../views/company/equipment/EquipmentList"))
const EquipmentDetail = lazy(() => import("../../views/company/equipment/EquipmentDetail"))
const EquipmentMaintenanceHistory = lazy(() => import("../../views/company/equipment/EquipmentMaintenanceHistory"))
const EquipmentRepairHistory = lazy(() => import("../../views/company/equipment/EquipmentRepairHistory"))
const EquipmentServiceHistory = lazy(() => import("../../views/company/equipment/EquipmentServiceHistory"))
const CreateNewEquipment = lazy(() => import("../../views/company/equipment/CreateNewEquipment"))
const FleetList = lazy(() => import("../../views/company/fleet/FleetList"))

const Roles = lazy(() => import("../../views/company/roles/Roles"))
const RoleDetails = lazy(() => import("../../views/company/roles/RoleDetails"))

const WorkLogs = lazy(() => import("../../views/company/worklogs/WorkLogs"))
const WorkLogDetails = lazy(() => import("../../views/company/worklogs/WorkLogDetails"))

const CompanyUsers = lazy(() => import("../../views/company/companyUsers/CompanyUsers"))
const CompanyUserDetails = lazy(() => import("../../views/company/companyUsers/CompanyUserDetails"))
const CreateNewCompanyUser = lazy(() => import("../../views/company/companyUsers/CreateNewCompanyUser"))

const TaskGroups = lazy(() => import("../../views/company/settings/TaskGroups/TaskGroups"))
const CreateNewTaskGroup = lazy(() => import("../../views/company/settings/TaskGroups/CreateNewTaskGroup"))
const TaskGroupDetails = lazy(() => import("../../views/company/settings/TaskGroups/TaskGroupDetails"))

const Vendors = lazy(() => import("../../views/company/venders/Venders"))
const CreateNewVendor = lazy(() => import("../../views/company/venders/CreateNewVenders"))

const Reports = lazy(() => import("../../views/company/reports/Reports"))
const MigrationDashboard = lazy(() => import("../../views/company/migration/MigrationDashboard"))
const CustomerExportImport = lazy(() => import("../../views/company/migration/CustomerExportImport"))
const EquipmentImport = lazy(() => import("../../views/company/migration/EquipmentImport"))
const SkimmerPreviousDosagesUpload = lazy(() => import("../../views/company/migration/SkimmerPreviousDosagesUpload"))

const ChemicalHistory = lazy(() => import("../../views/company/history/ChemicalHistory"))
const ServiceHistory = lazy(() => import("../../views/company/history/ServiceHistory"))
const CompanySettings = lazy(() => import("../../views/company/settings/CompanySettings"))
const CompanySetupGuide = lazy(() => import("../../views/company/setup/CompanySetupGuide"))

const EmailConfiguration = lazy(() => import("../../views/company/settings/EmailConfiguration/EmailConfiguration"))
const ReadingsAndDosages = lazy(() => import("../../views/company/settings/ReadingsAndDosages/ReadingsAndDosages"))
const CompanyInfo = lazy(() => import("../../views/company/companyInfo/CompanyInfo"))

const Subscriptions = lazy(() => import("../../views/company/settings/Subscriptions/Subscriptions"))
const SubscriptionDetailView = lazy(() => import("../../views/company/settings/Subscriptions/SubscriptionDetailView"))
const SubscriptionCancellationDetails = lazy(() => import("../../views/company/settings/Subscriptions/SubscriptionCancellationDetails"))
const UpdateSubscription = lazy(() => import("../../views/company/settings/Subscriptions/UpdateSubscription"))
const SubscriptionPicker = lazy(() => import("../../views/company/settings/Subscriptions/SubscriptionPicker"))

const AssociatedBusinessList = lazy(() => import("../../views/company/AssociatedBusiness/AssociatedBusinessList"))
const SearchForAssociatedBusiness = lazy(() => import("../../views/company/AssociatedBusiness/SearchForAssociatedBusiness"))
const AssociatedBusinessPage = lazy(() => import("../../views/company/AssociatedBusiness/AssociatedBusinessPage"))

const Success = lazy(() => import("../../views/Success"))
const Cancel = lazy(() => import("../../views/Cancel"))

const Leads = lazy(() => import('../../views/company/marketing/Leads'));
const LeadDetail = lazy(() => import('../../views/company/marketing/LeadDetail'));
const AddLead = lazy(() => import('../../views/company/marketing/AddLead'));
const CreateCustomerFromLead = lazy(() => import('../../views/company/customers/CreateCustomerFromLead'));

const CreateEstimate = lazy(() => import('../../views/company/marketing/CreateEstimate'));
const Estimates = lazy(() => import('../../views/company/marketing/Estimates'));
const ScheduleEstimate = lazy(() => import('../../views/company/marketing/ScheduleEstimate'));

const Sales = lazy(() => import('../../views/company/sales/Sales'));
const CompanyAccountingWorkspace = lazy(() => import('../../views/company/accounting/CompanyAccountingWorkspace'));
const SalesCatalogItems = lazy(() => import('../../views/company/sales/SalesCatalogItems'));
const SalesAgreements = lazy(() => import('../../views/company/sales/SalesAgreements'));
const CreateSalesAgreement = lazy(() => import('../../views/company/sales/CreateSalesAgreement'));
const SalesAgreementDetail = lazy(() => import('../../views/company/sales/SalesAgreementDetail'));
const SalesFinanceBoard = lazy(() => import('../../views/company/sales/SalesFinanceBoard'));
const SalesBillingSubscriptionDetail = lazy(() => import('../../views/company/sales/SalesBillingSubscriptionDetail'));
const CreateSalesInvoice = lazy(() => import('../../views/company/sales/CreateSalesInvoice'));
const SalesInvoiceDetail = lazy(() => import('../../views/company/sales/SalesInvoiceDetail'));
const Payroll = lazy(() => import("../../views/company/payroll/Payroll"));

const Reviews = lazy(() => import('../../views/company/reviews/Reviews'));

const TermsTemplates = lazy(() => import("../../views/company/settings/TermsTemplates"));
const TermsTemplateDetail = lazy(() => import("../../views/company/settings/TermsTemplateDetail"));
const JobTemplates = lazy(() => import("../../views/company/settings/JobTemplates"));

const PendingInvites = lazy(() => import("../../views/company/invites/CompanyPendingInvites"));
const AcceptedInvites = lazy(() => import("../../views/company/invites/CompanyAcceptedInvites"));
const RejectedInvites = lazy(() => import("../../views/company/invites/CompanyRejectedInvites"));

export const sellerRoutes = [

    {
        path: '/company/settings',
        element: <CompanySettings />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/settings/payroll-setup',
        element: <Payroll mode="setup" />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        permissionId: '400',
        featureFlagId: 'feature_flag_006',
    }, {
        path: '/company/setup-guide',
        element: <CompanySetupGuide />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, { //Basic Pages 
        path: '/company/selector',
        element: <CompanySelection />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/operations-dashboard',
        element: <OperationsDashboard />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/dashboard',
        element: <CompanyDashboardWrapper />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/profile',
        element: <ProfilePage />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/customers',
        element: <Customers />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/customers/history/:customerId',
        element: <CustomerHistory />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/customers/history/readings-dosages/:customerId',
        element: <ReadingsAndDosagesHistory />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    },
    {
        path: '/company/serviceLocations',
        element: <ServiceLocations />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    },
    {
        path: '/company/bodiesOfWater',
        element: <BodiesOfWater />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/equipment',
        element: <EquipmentList />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/equipment/detail/:equipmentId',
        element: <EquipmentDetail />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/equipment/detail/:equipmentId/service-history',
        element: <EquipmentServiceHistory />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/equipment/createNew/',
        element: <CreateNewEquipment />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/equipment/createNew/:customerId',
        element: <CreateNewEquipment />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/equipment/createNew/:customerId/:locationId',
        element: <CreateNewEquipment />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/equipment/createNew/:customerId/:locationId/:bodyOfWaterId',
        element: <CreateNewEquipment />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/fleet',
        element: <FleetList />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/jobs',
        element: <Jobs />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/jobs/createNew',
        element: <CreateNewJob />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/jobs/createNew/:customerId',
        element: <CreateNewJob />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/jobs/createNew/:customerId/:locationId',
        element: <CreateNewJob />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/jobs/detail/:jobId',
        element: <JobDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/jobs/history/:jobId',
        element: <JobHistoryView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/serviceStops',
        element: <ServiceStops />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/serviceStops/createNew',
        element: <CreateNewServiceStop />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/serviceStops/createNew/:jobId',
        element: <CreateNewServiceStop />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/serviceLocations/detail/:serviceLocationId',
        element: <ServiceLocationDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/bodiesOfWater/detail/:bodyOfWaterId',
        element: <BodiesOfWaterDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }

    ,
    {
        path: '/company/serviceStops/detail/:serviceStopId',
        element: <ServiceStopDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/repair-requests',
        element: <RepairRequests />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/repair-requests/detail/:repairRequestId',
        element: <RepairRequestDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/repair-requests/create',
        element: <CreateNewRepairRequest />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/repair-requests/create/:customerId',
        element: <CreateNewRepairRequest />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/seller',
        element: <Home />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {//DataBase Items
        path: '/company/items',
        element: <DataBaseItems />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/items/bulk-upload',
        element: <DataBaseItemBulkUpload />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/items/createNew',
        element: <CreateNewDataBaseItem />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/items/detail/:id',
        element: <DataBaseItemDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    //Purchased Items
    ,
    {
        path: '/company/purchased-items',
        element: <PurchaseListView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/purchased-items/createNew',
        element: <CreateNewPurchase />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/purchased-items/alpha-water-import',
        element: <AlphaWaterReceiptImport />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/purchased-items/detail/:purchaseId',
        element: <PurchaseDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/purchasedItems',
        element: <PurchaseListView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/purchasedItems/createNew',
        element: <CreateNewPurchase />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/purchasedItems/alpha-water-import',
        element: <AlphaWaterReceiptImport />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/purchasedItems/detail/:purchaseId',
        element: <PurchaseDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/receipts',
        element: <ReceiptListView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/receipts/detail/:receiptId',
        element: <ReceiptDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,


    {
        path: '/company/shopping-list',
        element: <ShoppingListView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/shopping-list/create',
        element: <CreateNewShoppingList />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/shopping-list/create/:customerId',
        element: <CreateNewShoppingList />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/shopping-list/create/:customerId/:dbItemId',
        element: <CreateNewShoppingList />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/shopping-list/detail/:shoppingItemId',
        element: <ShoppingListDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/part-approvals',
        element: <PartApprovals />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/vendors',
        element: <Vendors />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/vendors/create-new',
        element: <CreateNewVendor />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/vendors/detail/:vendorId',
        element: <CreateNewVendor />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/routing',
        element: <RouteDashboard />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/StripeProfile',
        element: <Home />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/EmailConfiguration',
        element: <EmailConfiguration />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/CompanyInfo',
        element: <CompanyInfo />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/readingsAndDosages',
        element: <ReadingsAndDosages />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    // ,
    // {
    //     path:'/company/readings/:templateId',
    //     element: <ReadingsAndDosages/>,
    //     ability :['Admin','Seller'],
    //     role:'Company'
    // }
    // ,
    // {
    //     path:'/company/dosages/:templateId',
    //     element: <ReadingsAndDosages/>,
    //     ability :['Admin','Seller'],
    //     role:'Company'
    // }
    ,
    {
        path: '/company/contracts',
        element: <Contracts />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/contract/detail/:contractId',
        element: <ContractDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/contract/createNew/:customerId',
        element: <CreateNew />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    //Recurring Contracts
    {
        path: '/company/recurring-contracts',
        element: <RecurringContracts />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/recurring-contracts/detail/:contractId',
        element: <RecurringContractDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/recurring-contracts/createNew/:customerId',
        element: <CreateNewRecurringContract />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/SubscriptionManagement',
        element: <StripeSubscriptions />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/settings/subscriptions',
        element: <Subscriptions />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/settings/terms-templates',
        element: <TermsTemplates />,
        role: 'company',
        name: 'Terms Templates'
    },
    {
        path: '/company/settings/terms-templates/:templateId',
        element: <TermsTemplateDetail />,
        role: 'company',
        name: 'Terms Templates'
    },
    {
        path: '/company/settings/job-templates',
        element: <JobTemplates />,
        role: 'company',
        name: 'Job Templates'
    },

    {
        path: '/success',
        element: <Success />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/cancel',
        element: <Cancel />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/ManageSubscriptions/Detail/:subscriptionId',
        element: <SubscriptionDetailView />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/ManageSubscriptions/Update/:subscriptionId',
        element: <UpdateSubscription />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/ManageSubscriptions/Picker',
        element: <SubscriptionPicker />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/settings/subscriptions/picker',
        element: <SubscriptionPicker />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,

    {
        path: '/Company/ManageSubscriptions/Cancel/:subscriptionId',
        element: <SubscriptionCancellationDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/messages',
        element: <Chat />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        featureFlagId: 'feature_flag_001',
    }, {
        path: '/company/messages/:clientId',
        element: <ChatInitiation />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        featureFlagId: 'feature_flag_001',
    }, {
        path: '/company/public-profile',
        element: <PublicPage />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        // List Pages
        path: '/company/stripe-subscriptions/products',
        element: <Products />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        // Detail Pages
        path: '/company/customers/details/:customerId',
        element: <CustomerDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/customers/details/:customerId/:tab',
        element: <CustomerDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/stripe-subscriptions/products/addNew',
        element: <CreateNewProduct />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/stripe-subscriptions/products/edit/:productId',
        element: <EditProduct />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/alerts',
        element: <Alerts />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        featureFlagId: 'feature_flag_011',
    }
    ,
    {
        path: '/company/todo-list',
        element: <TodoList />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        featureFlagId: 'feature_flag_010',
    }
    ,
    {
        path: '/company/todos',
        element: <Navigate to="/company/todo-list" replace />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        featureFlagId: 'feature_flag_010',
    }
    ,
    {
        path: '/company/route-management',
        element: <RouteManagement />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/route-dashboard',
        element: <RouteDashboard />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/route-day-management',
        element: <DailyRouteBoard />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/route-builder',
        element: <RouteBuilder />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/recurringServiceStop',
        element: <RecurringServiceStopList />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/recurring-service-stops/create',
        element: <CreateNewRecurringServiceStops />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/recurring-service-stops/create/:customerId',
        element: <CreateNewRecurringServiceStops />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/recurringServiceStop/details/:recurringServiceStopId',
        element: <RecurringServiceStopDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/Roles',
        element: <Roles />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/Company/Roles/:roleId',
        element: <RoleDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/companyUsers',
        element: <CompanyUsers />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/companyUsers/:companyUserId',
        element: <CompanyUserDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/companyUsers/detail/:companyUserId',
        element: <CompanyUserDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/companyUsers/createNew',
        element: <CreateNewCompanyUser />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/workLogs',
        element: <WorkLogs />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/workLogs/:workLogId',
        element: <WorkLogDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/migration',
        element: <MigrationDashboard />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        permissionId: '800',
        featureFlagId: 'feature_flag_008',
    }
    ,
    {
        path: '/company/migration/customer-export-import',
        element: <CustomerExportImport />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        permissionId: '800',
        featureFlagId: 'feature_flag_008',
    }
    ,
    {
        path: '/company/migration/equipment-import',
        element: <EquipmentImport />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        permissionId: '800',
        featureFlagId: 'feature_flag_008',
    }
    ,
    {
        path: '/company/migration/skimmer-previous-dosages-upload',
        element: <SkimmerPreviousDosagesUpload />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        permissionId: '800',
        featureFlagIds: ['feature_flag_008', 'feature_flag_009'],
    }
    ,
    {
        path: '/company/payroll',
        element: <Payroll />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        featureFlagId: 'feature_flag_006',
    }
    ,
    {
        path: '/company/payroll/setup',
        element: <Navigate to="/company/settings/payroll-setup" replace />,
        ability: ['Admin', 'Seller'],
        role: 'Company',
        featureFlagId: 'feature_flag_006',
    }
    ,
    {
        path: '/company/customers/createNew',
        element: <CreateNewCustomer />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/customers/bulk-upload',
        element: <BulkCustomerUpload />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/serviceLocations/createNew',
        element: <CreateNewServiceLocation />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/serviceLocations/createNew/:customerId',
        element: <CreateNewServiceLocation />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/bodiesOfWater/createNew',
        element: <CreateBodyOfWater />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/bodiesOfWater/createNew/:customerId',
        element: <CreateBodyOfWater />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/bodiesOfWater/createNew/:customerId/:serviceLocationId',
        element: <CreateBodyOfWater />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/taskGroups',
        element: <TaskGroups />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/taskGroups/createNew',
        element: <CreateNewTaskGroup />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/taskGroups/details/:taskGroupId',
        element: <TaskGroupDetails />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/reports',
        element: <Reports />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/chemicalHistory/:customerId/:serviceLocationId/:bodyOfWaterId',
        element: <ChemicalHistory />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,

    {
        path: '/company/serviceHistory/:customerId/:serviceLocationId/:bodyOfWaterId',
        element: <ServiceHistory />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/associatedBusiness',
        element: <AssociatedBusinessList />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }
    ,
    {
        path: '/company/associatedBusiness/search',
        element: <SearchForAssociatedBusiness />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/associatedBusiness/detail/:companyId',
        element: <AssociatedBusinessPage />,
        ability: ['Admin', 'Seller'],
        role: 'Company'
    }, {
        path: '/company/leads',
        element: <Leads />,
        role: 'Company',
    }, {
        path: '/company/leads/new',
        element: <AddLead />,
        role: 'Company',
    }, {
        path: '/company/leads/:leadId',
        element: <LeadDetail />,
        role: 'Company',
    }, {
        path: '/company/leads/:leadId/edit',
        element: <AddLead />,
        role: 'Company',
    }, {
        path: '/company/customers/create-from-lead/:leadId',
        element: <CreateCustomerFromLead />,
        role: 'Company',
    }, {
        path: '/company/estimates',
        element: <Estimates />,
        role: 'Company',
    }, {
        path: '/company/estimates/create/:leadId',
        element: <CreateEstimate />,
        role: 'Company',
    }, {
        path: '/company/estimates/schedule/:leadId',
        element: <ScheduleEstimate />,
        role: 'Company',
    }, {
        path: '/company/sales',
        element: <Sales />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/accounting',
        element: <CompanyAccountingWorkspace />,
        role: 'Company',
        permissionId: '400',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/catalog-items',
        element: <SalesCatalogItems />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/invoices',
        element: <SalesFinanceBoard defaultView="invoices" />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/invoices/new',
        element: <CreateSalesInvoice />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/invoices/:invoiceId',
        element: <SalesInvoiceDetail />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/payments',
        element: <SalesFinanceBoard defaultView="payments" />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/subscriptions',
        element: <SalesFinanceBoard defaultView="subscriptions" />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/subscriptions/:billingSubscriptionId',
        element: <SalesBillingSubscriptionDetail />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/agreements',
        element: <SalesAgreements />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/agreements/needs-routing',
        element: <SalesAgreements routingQueueOnly />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/agreements/new',
        element: <CreateSalesAgreement />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/sales/agreements/:agreementId',
        element: <SalesAgreementDetail />,
        role: 'Company',
        featureFlagId: 'feature_flag_004',
    }, {
        path: '/company/reviews/:companyId',
        element: <Reviews />,
        role: 'Company',
    }, {
        path: '/company/reviews/detail/:reviewId',
        element: <Sales />,
        role: 'Company',
    },
    {
        path: '/company/user-dashboard',
        element: <CompanyUserDashboard />,
        role: 'Company',
    },
    {
        path: '/company/invites/pending',
        element: <PendingInvites />,
        role: 'company',
        name: 'Pending Invites'
    },
    {
        path: '/company/invites/rejected',
        element: <RejectedInvites />,
        role: 'company',
        name: 'Rejected Invites'
    },
    {
        path: '/company/invites/accepted',
        element: <AcceptedInvites />,
        role: 'company',
        name: 'Accepted Invites'
    },
]
