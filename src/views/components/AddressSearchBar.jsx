import React from 'react';
import AddressAutocomplete from './AddressAutocomplete';

const AddressSearchBar = ({ onAddressSelect, label, initialValue }) => {

  return (
    <div>
      <label>{label}</label>
      <AddressAutocomplete
        onAddressSelect={onAddressSelect}
        placeholder="Enter an address"
        initialValue={initialValue}
      />
    </div>
  );
};

export default AddressSearchBar;
