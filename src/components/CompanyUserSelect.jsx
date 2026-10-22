import React, { useId, useMemo } from "react";
import Select from "react-select";
import { getCompanyUserDisplayName, sortCompanyUsersByName } from "../utils/companyUsers";

const getOptionLabel = (companyUser) => companyUser.label || getCompanyUserDisplayName(companyUser);
const getOptionValue = (companyUser) => companyUser.userId || companyUser.value || companyUser.id || "";
const noOptionsMessage = ({ inputValue }) => inputValue ? "No matching company users" : "No company users found";
const styles = {
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
};

export default function CompanyUserSelect({ options = [], ...props }) {
  const instanceId = useId();
  const sortedOptions = useMemo(() => sortCompanyUsersByName(options), [options]);

  return (
    <Select
      instanceId={instanceId}
      classNamePrefix="react-select"
      getOptionLabel={getOptionLabel}
      getOptionValue={getOptionValue}
      options={sortedOptions}
      placeholder="Select company user"
      noOptionsMessage={noOptionsMessage}
      isSearchable
      menuPosition="fixed"
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      styles={styles}
      {...props}
    />
  );
}
