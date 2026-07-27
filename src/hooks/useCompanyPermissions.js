import { useContext, useCallback } from "react";
import { Context } from "../context/AuthContext";
import { appAlert } from "../utils/appDialog";

export default function useCompanyPermissions() {
  const {
    hasCompanyPermission,
    companyRoleLoading,
    companyRoleLoaded,
  } = useContext(Context);

  const can = useCallback((permissionId) => {
    if (!permissionId) return true;
    if (companyRoleLoading || !companyRoleLoaded) return false;
    return hasCompanyPermission(permissionId);
  }, [companyRoleLoaded, companyRoleLoading, hasCompanyPermission]);

  const requirePermission = useCallback((permissionId, action = "perform this action") => {
    if (can(permissionId)) return true;
    appAlert({
      title: "Permission Required",
      message: `You do not have permission to ${action}.`,
    });
    return false;
  }, [can]);

  return {
    can,
    requirePermission,
    permissionsReady: companyRoleLoaded && !companyRoleLoading,
  };
}
