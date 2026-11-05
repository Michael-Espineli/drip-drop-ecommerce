import { useContext, useCallback } from "react";
import { Context } from "../context/AuthContext";
import { appAlert } from "../utils/appDialog";
import { companyPermissionError, userFacingErrorMessage } from "../utils/permissionErrors";

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
      title: "Drip Drop Permission Required",
      message: userFacingErrorMessage(companyPermissionError(permissionId, action)),
    });
    return false;
  }, [can]);

  return {
    can,
    requirePermission,
    permissionsReady: companyRoleLoaded && !companyRoleLoading,
  };
}
