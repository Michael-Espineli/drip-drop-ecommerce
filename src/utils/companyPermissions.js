export const COMPANY_WIDE_MESSAGES_PERMISSION_ID = "300";
export const TODO_ALL_BOARDS_PERMISSION_ID = "310";
export const OFFERED_WORK_PERMISSION_ID = "320";
export const CREATE_OFFERED_WORK_PERMISSION_ID = "322";
export const UPDATE_OFFERED_WORK_PERMISSION_ID = "324";
export const SPLIT_OFFERED_WORK_PERMISSION_ID = "326";
export const INCENTIVIZE_OFFERED_WORK_PERMISSION_ID = "328";
export const APPROVE_OFFERED_WORK_PERMISSION_ID = "330";
export const VIEW_ALL_OFFERED_WORK_PERMISSION_ID = "332";
export const ACCEPT_OFFERED_WORK_PERMISSION_ID = "334";
export const JOBS_PERMISSION_ID = "20";
export const CREATE_JOBS_PERMISSION_ID = "22";
export const SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID = "23";
export const UPDATE_JOBS_PERMISSION_ID = "24";
export const EDIT_TEMPLATE_WORK_ORDERS_PERMISSION_ID = "28";
export const CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID = "29";
export const CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID = "27";
export const CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID = "31";
export const FIELD_JOB_ESTIMATE_PLAN_PERMISSION_ID = "72";
export const FIELD_JOB_ESTIMATE_SEND_PERMISSION_ID = "74";
export const SERVICE_AGREEMENTS_PERMISSION_ID = "430";
export const CREATE_SERVICE_AGREEMENTS_PERMISSION_ID = "432";
export const UPDATE_SERVICE_AGREEMENTS_PERMISSION_ID = "434";
export const DELETE_SERVICE_AGREEMENTS_PERMISSION_ID = "436";
export const SEND_SERVICE_AGREEMENTS_PERMISSION_ID = "438";
export const FIELD_INITIAL_SURVEY_PRICE_PERMISSION_ID = "627";
export const FIELD_SERVICE_AGREEMENT_WORKFLOW_PERMISSION_ID = "628";
export const BASIC_WORK_ORDER_PERMISSION_IDS = [
  SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID,
  CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID,
  CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID,
  CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID,
];

const webImplementedPermissionIds = new Set([
  "0", "10", "12", "14", "16", JOBS_PERMISSION_ID, CREATE_JOBS_PERMISSION_ID, SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID, UPDATE_JOBS_PERMISSION_ID, "26", CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID, EDIT_TEMPLATE_WORK_ORDERS_PERMISSION_ID, CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID, "30", CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID, "32", "34", "36",
  "40", "42", "44", "50", "52", "54", "60", "62", "64", "66", FIELD_JOB_ESTIMATE_PLAN_PERMISSION_ID, FIELD_JOB_ESTIMATE_SEND_PERMISSION_ID,
  "210", "230", "232", "240", "242", "244", "246", "260", "262", "264", "280", "290", "292", "294", "296", COMPANY_WIDE_MESSAGES_PERMISSION_ID, TODO_ALL_BOARDS_PERMISSION_ID, OFFERED_WORK_PERMISSION_ID, CREATE_OFFERED_WORK_PERMISSION_ID, UPDATE_OFFERED_WORK_PERMISSION_ID, SPLIT_OFFERED_WORK_PERMISSION_ID, INCENTIVIZE_OFFERED_WORK_PERMISSION_ID, APPROVE_OFFERED_WORK_PERMISSION_ID, VIEW_ALL_OFFERED_WORK_PERMISSION_ID, ACCEPT_OFFERED_WORK_PERMISSION_ID, "400", "420",
  SERVICE_AGREEMENTS_PERMISSION_ID, CREATE_SERVICE_AGREEMENTS_PERMISSION_ID, UPDATE_SERVICE_AGREEMENTS_PERMISSION_ID, DELETE_SERVICE_AGREEMENTS_PERMISSION_ID, SEND_SERVICE_AGREEMENTS_PERMISSION_ID,
  "600", "610", "612", "614", "620", "622", FIELD_INITIAL_SURVEY_PRICE_PERMISSION_ID, FIELD_SERVICE_AGREEMENT_WORKFLOW_PERMISSION_ID, "630", "632", "634", "800", "810", "820", "822", "824", "826", "830",
  "840", "850", "852", "854", "856", "860", "864", "870", "880", "882", "884", "886", "890", "900", "910"
]);

const permissionCatalog = [
  { id: "0", name: "Operations", description: "Can See the Operations Tabs", category: "Operations", ios: true, web: false },
  { id: "10", name: "Customer", description: "", category: "Operations", ios: true, web: false },
  { id: "12", name: "Create Customer", description: "", category: "Operations", ios: false, web: false },
  { id: "14", name: "Update Customer", description: "", category: "Operations", ios: false, web: false },
  { id: "16", name: "Delete Customer", description: "", category: "Operations", ios: false, web: false },
  { id: JOBS_PERMISSION_ID, name: "Jobs", description: "", category: "Operations", ios: true, web: false },
  { id: CREATE_JOBS_PERMISSION_ID, name: "Create Jobs", description: "Can use the full job creation workflow, including billing, labor, materials, and admin assignment fields.", category: "Operations", ios: false, web: false },
  { id: SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID, name: "Schedule Template Jobs", description: "Can create and schedule technician-enabled job templates for themselves from the basic job form.", category: "Operations", ios: true, web: false },
  { id: UPDATE_JOBS_PERMISSION_ID, name: "Update Jobs", description: "", category: "Operations", ios: false, web: false },
  { id: "26", name: "Delete Jobs", description: "", category: "Operations", ios: false, web: false },
  { id: CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID, name: "Create Basic Jobs For Self", description: "Can create a basic custom job assigned to themselves.", category: "Operations", ios: true, web: false },
  { id: EDIT_TEMPLATE_WORK_ORDERS_PERMISSION_ID, name: "Edit Template Jobs", description: "Can make basic scope and schedule edits to jobs that were created from templates.", category: "Operations", ios: false, web: false },
  { id: CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID, name: "Create Template Jobs For Others", description: "Can create and schedule technician-enabled job templates for another company user.", category: "Operations", ios: false, web: false },
  { id: "30", name: "Repair Requests", description: "", category: "Operations", ios: true, web: false },
  { id: CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID, name: "Create Basic Jobs For Others", description: "Can create a basic custom job assigned to another company user.", category: "Operations", ios: false, web: false },
  { id: "32", name: "Create Repair Requests", description: "", category: "Operations", ios: false, web: false },
  { id: "34", name: "Update Repair Requests", description: "", category: "Operations", ios: false, web: false },
  { id: "36", name: "Delete Repair Requests", description: "", category: "Operations", ios: false, web: false },
  { id: "40", name: "Service Location", description: "", category: "Operations", ios: false, web: false },
  { id: "42", name: "Create Service Location", description: "", category: "Operations", ios: false, web: false },
  { id: "44", name: "Update Service Location", description: "", category: "Operations", ios: false, web: false },
  { id: "46", name: "Delete Service Location", description: "", category: "Operations", ios: false, web: false },
  { id: "50", name: "Bodies of Water", description: "", category: "Operations", ios: false, web: false },
  { id: "52", name: "Create Bodies of Water", description: "", category: "Operations", ios: false, web: false },
  { id: "54", name: "Update Bodies of Water", description: "", category: "Operations", ios: false, web: false },
  { id: "56", name: "Delete Bodies of Water", description: "", category: "Operations", ios: false, web: false },
  { id: "60", name: "Equipment", description: "", category: "Operations", ios: true, web: false },
  { id: "62", name: "Create Equipment", description: "", category: "Operations", ios: true, web: false },
  { id: "64", name: "Update Equipment", description: "", category: "Operations", ios: true, web: false },
  { id: "66", name: "Delete Equipment", description: "", category: "Operations", ios: true, web: false },
  { id: FIELD_JOB_ESTIMATE_PLAN_PERMISSION_ID, name: "Build Field Job Estimate Plans", description: "Can save technician-built job estimate plans from a job estimate service stop without full job update access.", category: "Operations", ios: true, web: true },
  { id: FIELD_JOB_ESTIMATE_SEND_PERMISSION_ID, name: "Send Field Job Estimates", description: "Can send a job estimate from field workflows after the plan is ready.", category: "Operations", ios: true, web: true },
  { id: "200", name: "Management", description: "", category: "Operations", ios: false, web: false },
  { id: "210", name: "Route Over View", description: "", category: "Management", ios: true, web: false },
  { id: "220", name: "Live Route Access", description: "", category: "Management", ios: true, web: false },
  { id: "230", name: "Routes", description: "", category: "Management", ios: false, web: false },
  { id: "232", name: "Create Routes", description: "", category: "Management", ios: false, web: false },
  { id: "234", name: "Update Routes", description: "", category: "Management", ios: false, web: false },
  { id: "236", name: "Delete Routes", description: "", category: "Management", ios: false, web: false },
  { id: "240", name: "ServiceStops", description: "", category: "Management", ios: true, web: false },
  { id: "242", name: "Create ServiceStops", description: "", category: "Management", ios: false, web: false },
  { id: "244", name: "Update ServiceStops", description: "", category: "Management", ios: false, web: false },
  { id: "246", name: "Delete ServiceStops", description: "", category: "Management", ios: false, web: false },
  { id: "250", name: "ServiceStops For Others", description: "", category: "Management", ios: false, web: false },
  { id: "252", name: "Create ServiceStops For Others", description: "", category: "Management", ios: false, web: false },
  { id: "254", name: "Update ServiceStops For Others", description: "", category: "Management", ios: false, web: false },
  { id: "256", name: "Delete ServiceStops For Others", description: "", category: "Management", ios: false, web: false },
  { id: "260", name: "CompanyUsers", description: "", category: "Management", ios: true, web: false },
  { id: "262", name: "Create CompanyUsers", description: "", category: "Management", ios: false, web: false },
  { id: "264", name: "Update CompanyUsers", description: "", category: "Management", ios: false, web: false },
  { id: "266", name: "Delete CompanyUsers", description: "", category: "Management", ios: false, web: false },
  { id: "280", name: "WorkLogs", description: "", category: "Management", ios: false, web: false },
  { id: "282", name: "Create WorkLogs", description: "", category: "Management", ios: false, web: false },
  { id: "284", name: "Update WorkLogs", description: "", category: "Management", ios: false, web: false },
  { id: "286", name: "Delete WorkLogs", description: "", category: "Management", ios: false, web: false },
  { id: "290", name: "Fleet", description: "", category: "Management", ios: true, web: false },
  { id: "292", name: "Create Fleet", description: "", category: "Management", ios: false, web: false },
  { id: "294", name: "Update Fleet", description: "", category: "Management", ios: false, web: false },
  { id: "296", name: "Delete Fleet", description: "", category: "Management", ios: false, web: false },
  { id: COMPANY_WIDE_MESSAGES_PERMISSION_ID, name: "View Other Messages", description: "Can view company and customer conversations they are not directly included in.", category: "Management", ios: true, web: false },
  { id: TODO_ALL_BOARDS_PERMISSION_ID, name: "View All Todo Boards", description: "Can view every todo board and todo task, even when not assigned or listed as a board member.", category: "Management", ios: false, web: false },
  { id: OFFERED_WORK_PERMISSION_ID, name: "Offered Work", description: "Can open the offered work board.", category: "Management", ios: false, web: false },
  { id: CREATE_OFFERED_WORK_PERMISSION_ID, name: "Create Offered Work", description: "Can offer their own routes, route stops, or one-off work to a board or direct technician.", category: "Management", ios: false, web: false },
  { id: UPDATE_OFFERED_WORK_PERMISSION_ID, name: "Update Offered Work", description: "Can post work on behalf of another technician and manage work offer details.", category: "Management", ios: false, web: false },
  { id: SPLIT_OFFERED_WORK_PERMISSION_ID, name: "Split Offered Work", description: "Can break route coverage into partial route or individual-stop offers.", category: "Management", ios: false, web: false },
  { id: INCENTIVIZE_OFFERED_WORK_PERMISSION_ID, name: "Incentivize Offered Work", description: "Can add flat-rate or percentage incentives to work offers.", category: "Management", ios: false, web: false },
  { id: APPROVE_OFFERED_WORK_PERMISSION_ID, name: "Approve Offered Work", description: "Can approve work offers or accepted coverage when company settings require approval.", category: "Management", ios: false, web: false },
  { id: VIEW_ALL_OFFERED_WORK_PERMISSION_ID, name: "View All Offered Work", description: "Can view every direct offer, board post, route coverage offer, and incentive.", category: "Management", ios: false, web: false },
  { id: ACCEPT_OFFERED_WORK_PERMISSION_ID, name: "Accept Offered Work", description: "Can claim eligible board posts and direct work offers.", category: "Management", ios: false, web: false },
  { id: "400", name: "Finance", description: "", category: "Finance", ios: true, web: false },
  { id: "410", name: "Finished Jobs", description: "", category: "Finance", ios: true, web: false },
  { id: "412", name: "Create Finished Jobs", description: "", category: "Finance", ios: false, web: false },
  { id: "414", name: "Update Finished Jobs", description: "", category: "Finance", ios: false, web: false },
  { id: "416", name: "Delete Finished Jobs", description: "", category: "Finance", ios: false, web: false },
  { id: "420", name: "Payroll Information", description: "Can view payroll setup, pay statements, and technician pay line items.", category: "Finance", ios: true, web: false },
  { id: SERVICE_AGREEMENTS_PERMISSION_ID, name: "Service Agreements", description: "Can view service agreements.", category: "Finance", ios: true, web: false },
  { id: CREATE_SERVICE_AGREEMENTS_PERMISSION_ID, name: "Create Service Agreements", description: "Can create service agreements.", category: "Finance", ios: false, web: false },
  { id: UPDATE_SERVICE_AGREEMENTS_PERMISSION_ID, name: "Update Service Agreements", description: "Can edit service agreements.", category: "Finance", ios: false, web: false },
  { id: DELETE_SERVICE_AGREEMENTS_PERMISSION_ID, name: "Delete Service Agreements", description: "Can delete service agreements.", category: "Finance", ios: false, web: false },
  { id: SEND_SERVICE_AGREEMENTS_PERMISSION_ID, name: "Send Service Agreements", description: "Can send service agreements to customers.", category: "Finance", ios: false, web: false },
  { id: "600", name: "Marketing", description: "", category: "Marketing", ios: false, web: false },
  { id: "610", name: "Leads", description: "", category: "Marketing", ios: false, web: false },
  { id: "612", name: "Respond Leads", description: "", category: "Marketing", ios: false, web: false },
  { id: "614", name: "Update Leads", description: "", category: "Marketing", ios: false, web: false },
  { id: "616", name: "Delete Leads", description: "", category: "Marketing", ios: false, web: false },
  { id: "620", name: "Estimates", description: "", category: "Marketing", ios: false, web: false },
  { id: "622", name: "Respond Estimates", description: "", category: "Marketing", ios: false, web: false },
  { id: "624", name: "Update Estimates", description: "", category: "Marketing", ios: false, web: false },
  { id: "626", name: "Delete Estimates", description: "", category: "Marketing", ios: false, web: false },
  { id: FIELD_INITIAL_SURVEY_PRICE_PERMISSION_ID, name: "Recommend Initial Survey Price", description: "Can save a technician's recommended service agreement price from an initial survey service stop.", category: "Marketing", ios: false, web: false },
  { id: FIELD_SERVICE_AGREEMENT_WORKFLOW_PERMISSION_ID, name: "Send Service Agreements From Field", description: "Can create and send a service agreement from an initial survey in the field.", category: "Finance", ios: true, web: false },
  { id: "630", name: "Pipeline", description: "Can view the customer onboarding pipeline.", category: "Marketing", ios: false, web: false },
  { id: "632", name: "Create Pipeline", description: "Can sync leads and customers into the pipeline and add manual pipeline rows.", category: "Marketing", ios: false, web: false },
  { id: "634", name: "Update Pipeline", description: "Can update pipeline notes, manual signoffs, statuses, lead sources, and pipeline settings.", category: "Marketing", ios: false, web: false },
  { id: "800", name: "Settings", description: "", category: "Settings", ios: true, web: false },
  { id: "810", name: "Company Information", description: "", category: "Settings", ios: true, web: false },
  { id: "812", name: "Create Company Information", description: "", category: "Settings", ios: false, web: false },
  { id: "814", name: "Update Company Information", description: "", category: "Settings", ios: false, web: false },
  { id: "816", name: "Delete Company Information", description: "", category: "Settings", ios: false, web: false },
  { id: "820", name: "Task Groups", description: "", category: "Settings", ios: true, web: false },
  { id: "822", name: "Create Task Groups", description: "", category: "Settings", ios: false, web: false },
  { id: "824", name: "Update Task Groups", description: "", category: "Settings", ios: false, web: false },
  { id: "826", name: "Delete Task Groups", description: "", category: "Settings", ios: false, web: false },
  { id: "830", name: "Email Configuration", description: "", category: "Settings", ios: true, web: false },
  { id: "832", name: "Create Email Configuration", description: "", category: "Settings", ios: false, web: false },
  { id: "834", name: "Update Email Configuration", description: "", category: "Settings", ios: false, web: false },
  { id: "836", name: "Delete Email Configuration", description: "", category: "Settings", ios: false, web: false },
  { id: "840", name: "Readings and Dosages", description: "", category: "Settings", ios: true, web: false },
  { id: "842", name: "Create Readings and Dosages", description: "", category: "Settings", ios: false, web: false },
  { id: "844", name: "Update Readings and Dosages", description: "", category: "Settings", ios: false, web: false },
  { id: "846", name: "Delete Readings and Dosages", description: "", category: "Settings", ios: false, web: false },
  { id: "850", name: "Product Catalog and Vendor Items", description: "", category: "Settings", ios: true, web: false },
  { id: "852", name: "Create Vendor Items", description: "", category: "Settings", ios: false, web: false },
  { id: "854", name: "Update Vendor Items", description: "", category: "Settings", ios: false, web: false },
  { id: "856", name: "Delete Vendor Items", description: "", category: "Settings", ios: false, web: false },
  { id: "860", name: "User Roles", description: "", category: "Settings", ios: true, web: false },
  { id: "862", name: "Create User Roles", description: "", category: "Settings", ios: false, web: false },
  { id: "864", name: "Update User Roles", description: "", category: "Settings", ios: false, web: false },
  { id: "866", name: "Delete User Roles", description: "", category: "Settings", ios: false, web: false },
  { id: "870", name: "Reports", description: "", category: "Settings", ios: true, web: false },
  { id: "872", name: "Create Reports", description: "", category: "Settings", ios: false, web: false },
  { id: "874", name: "Update Reports", description: "", category: "Settings", ios: false, web: false },
  { id: "876", name: "Delete Reports", description: "", category: "Settings", ios: false, web: false },
  { id: "880", name: "Terms Templates", description: "", category: "Settings", ios: true, web: false },
  { id: "882", name: "Create Terms Templates", description: "", category: "Settings", ios: false, web: false },
  { id: "884", name: "Update Terms Templates", description: "", category: "Settings", ios: false, web: false },
  { id: "886", name: "Delete Terms Templates", description: "", category: "Settings", ios: false, web: false },
  { id: "890", name: "Manage Subscriptions", description: "", category: "Settings", ios: true, web: false },
  { id: "892", name: "Create Manage Subscriptions", description: "", category: "Settings", ios: false, web: false },
  { id: "894", name: "Update Manage Subscriptions", description: "", category: "Settings", ios: false, web: false },
  { id: "896", name: "Delete Manage Subscriptions", description: "", category: "Settings", ios: false, web: false },
  { id: "900", name: "General Company Configuration", description: "Can manage general company setup and configuration tools.", category: "Settings", ios: false, web: false },
  { id: "910", name: "Data Uploads", description: "Can access company data import and upload tools.", category: "Settings", ios: false, web: false }
];

export const companyPermissions = permissionCatalog.map(permission => ({
  ...permission,
  web: webImplementedPermissionIds.has(permission.id)
}));

export const companyPermissionIds = companyPermissions.map(permission => permission.id);

export const companyPermissionsByCategory = companyPermissions.reduce((acc, permission) => {
  if (!acc[permission.category]) acc[permission.category] = [];
  acc[permission.category].push(permission);
  return acc;
}, {});

const childPermissionPrefixes = ["Create", "Update", "Delete", "Respond", "Split", "Incentivize", "Approve", "View All", "Accept", "Schedule", "Edit", "Build", "Send", "Recommend"];

const normalizePermissionName = (value = "") =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const stripChildPermissionPrefix = (name = "") => {
  const prefix = childPermissionPrefixes.find((candidate) =>
    name.toLowerCase().startsWith(`${candidate.toLowerCase()} `)
  );

  return prefix ? name.slice(prefix.length).trim() : "";
};

const permissionById = companyPermissions.reduce((acc, permission) => {
  acc[permission.id] = permission;
  return acc;
}, {});

const explicitPermissionParentIds = {
  [FIELD_SERVICE_AGREEMENT_WORKFLOW_PERMISSION_ID]: SERVICE_AGREEMENTS_PERMISSION_ID,
};

const permissionByNormalizedName = companyPermissions.reduce((acc, permission) => {
  acc[normalizePermissionName(permission.name)] = permission;
  return acc;
}, {});

export const getPermissionParent = (permission) => {
  if (!permission) return null;

  const explicitParentId = explicitPermissionParentIds[permission.id];
  if (explicitParentId) return permissionById[explicitParentId] || null;

  const parentName = stripChildPermissionPrefix(permission.name);
  if (!parentName) return null;

  return permissionByNormalizedName[normalizePermissionName(parentName)] || null;
};

export const getPermissionChildren = (permission) => {
  if (!permission) return [];

  return companyPermissions.filter((candidate) => {
    const parent = getPermissionParent(candidate);
    return parent?.id === permission.id;
  });
};

export const getPermissionGroupIds = (permission) => {
  if (!permission) return [];

  const children = getPermissionChildren(permission);
  if (children.length > 0) {
    return [permission.id, ...children.map((child) => child.id)];
  }

  return [permission.id];
};

const orderPermissionIds = (ids) => {
  const selected = new Set(ids);
  const orderedIds = companyPermissions
    .filter((permission) => selected.has(permission.id))
    .map((permission) => permission.id);
  const unknownIds = [...selected].filter((id) => !permissionById[id]).sort();

  return [...orderedIds, ...unknownIds];
};

export const normalizePermissionSelection = (ids = []) => {
  return orderPermissionIds(new Set(ids));
};

export const getPermissionSelectionState = (permission, selectedIds = []) => {
  const selected = new Set(selectedIds);
  const children = getPermissionChildren(permission);

  if (selected.has(permission.id)) return "selected";
  if (children.length === 0) return "empty";

  const childIds = children.map((child) => child.id);
  const selectedChildren = childIds.filter((id) => selected.has(id));

  if (selectedChildren.length > 0) return "partial";
  return "empty";
};

export const togglePermissionSelection = (permissionId, selectedIds = []) => {
  const permission = permissionById[permissionId];
  if (!permission) return selectedIds;

  const selected = new Set(selectedIds);
  if (selected.has(permission.id)) selected.delete(permission.id);
  else selected.add(permission.id);

  return orderPermissionIds(selected);
};

export const companyPermissionCategoryGroups = Object.keys(companyPermissionsByCategory).map((category) => {
  const categoryPermissions = companyPermissionsByCategory[category];
  const childIds = new Set();

  categoryPermissions.forEach((permission) => {
    const parent = getPermissionParent(permission);
    if (parent && parent.category === category) {
      childIds.add(permission.id);
    }
  });

  const groups = categoryPermissions
    .filter((permission) => !childIds.has(permission.id))
    .map((permission) => ({
      parent: permission,
      children: getPermissionChildren(permission).filter((child) => child.category === category),
    }));

  return {
    category,
    permissions: categoryPermissions,
    groups,
  };
});

export const getCategorySelectionState = (categoryGroup, selectedIds = []) => {
  const selected = new Set(selectedIds);
  const categoryIds = categoryGroup.permissions.map((permission) => permission.id);
  const selectedCount = categoryIds.filter((id) => selected.has(id)).length;

  if (selectedCount === 0) return "empty";
  if (selectedCount === categoryIds.length) return "selected";
  return "partial";
};

export const togglePermissionCategorySelection = (category, selectedIds = []) => {
  const categoryGroup = companyPermissionCategoryGroups.find((group) => group.category === category);
  if (!categoryGroup) return selectedIds;

  const selected = new Set(selectedIds);
  const shouldSelectCategory = getCategorySelectionState(categoryGroup, selectedIds) !== "selected";

  categoryGroup.permissions.forEach((permission) => {
    if (shouldSelectCategory) selected.add(permission.id);
    else selected.delete(permission.id);
  });

  return normalizePermissionSelection(orderPermissionIds(selected));
};
