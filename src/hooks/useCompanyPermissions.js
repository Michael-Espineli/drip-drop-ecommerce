import { useContext, useCallback } from "react";
import { Context } from "../context/AuthContext";

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
    alert(`You do not have permission to ${action}.`);
    return false;
  }, [can]);

  return {
    can,
    requirePermission,
    permissionsReady: companyRoleLoaded && !companyRoleLoading,
  };
}
