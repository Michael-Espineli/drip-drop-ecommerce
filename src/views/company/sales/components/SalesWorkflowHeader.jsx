import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import WorkspaceHeader from '../../../../components/workspace/WorkspaceHeader';
import { workspaceButtonClass } from '../../../../components/workspace/workspaceStyles';
import { Context } from '../../../../context/AuthContext';
import useCompanyPermissions from '../../../../hooks/useCompanyPermissions';
import { companyBillingNav } from '../../../../navigation/allNav';
import { canShowCompanyNavigationItem } from '../../../../navigation/companyNavigationPreferences';

export default function SalesWorkflowHeader(props) {
  const { featureFlagsLoaded, isFeatureEnabled } = useContext(Context);
  const { can } = useCompanyPermissions();
  const tabs = companyBillingNav.filter((item) => canShowCompanyNavigationItem(item, {
    featureFlagsLoaded,
    isFeatureEnabled,
    hasCompanyPermission: can,
  }));

  return (
    <>
      {tabs.length > 0 && (
        <nav aria-label="Sales workflow" className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map(({ path, title, icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => workspaceButtonClass({ tone: isActive ? 'blue' : 'slate', active: isActive })}
            >
              <span aria-hidden="true">{icon}</span>
              {title}
            </NavLink>
          ))}
        </nav>
      )}
      <WorkspaceHeader eyebrow="Company finance" {...props} />
    </>
  );
}
