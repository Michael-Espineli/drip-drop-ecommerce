import React, { useEffect, useRef, useState } from 'react';
import { MapPinIcon } from '@heroicons/react/24/outline';

const AddressAutocomplete = ({
  onAddressSelect,
  onInputChange,
  placeholder,
  initialValue,
  customClasses,
  iconClasses,
}) => {
  const autocompleteRef = useRef(null);
  const [inputValue, setInputValue] = useState(initialValue || '');
  const [placesReady, setPlacesReady] = useState(Boolean(window.google?.maps?.places));

  useEffect(() => {
    setInputValue(initialValue || '');
  }, [initialValue]);

  useEffect(() => {
    if (placesReady) return undefined;

    const timer = window.setInterval(() => {
      if (window.google?.maps?.places) {
        setPlacesReady(true);
        window.clearInterval(timer);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [placesReady]);

  useEffect(() => {
    if (!placesReady || !autocompleteRef.current || !window.google?.maps?.places) return undefined;

    const autocomplete = new window.google.maps.places.Autocomplete(
      autocompleteRef.current,
      {
        types: ['address'],
        componentRestrictions: { country: 'us' },
      }
    );

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place && place.address_components) {
        const address = {
          streetAddress: '',
          city: '',
          state: '',
          zipCode: '',
          latitude: place.geometry.location.lat(),
          longitude: place.geometry.location.lng(),
        };

        for (const component of place.address_components) {
          const types = component.types;

          if (types.includes('street_number')) {
            address.streetAddress = `${component.long_name}`;
          }

          if (types.includes('route')) {
            address.streetAddress = `${address.streetAddress} ${component.long_name}`;
          }

          if (types.includes('locality')) {
            address.city = component.long_name;
          }

          if (types.includes('administrative_area_level_1')) {
            address.state = component.short_name;
          }

          if (types.includes('postal_code')) {
            address.zipCode = component.long_name;
          }
        }

        onAddressSelect?.(address);
        onInputChange?.(address.streetAddress || place.formatted_address || '');
        setInputValue(place.formatted_address);
      }
    });

    return () => {
      window.google.maps.event.clearInstanceListeners(autocomplete);
    };
  }, [onAddressSelect, onInputChange, placesReady]);

  return (
    <div className="relative">
        <MapPinIcon className={iconClasses || 'pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-gray-900'} />
        <input
          ref={autocompleteRef}
          type="text"
          placeholder={placeholder || "Enter Address"}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            onInputChange?.(e.target.value);
          }}
          className={customClasses || "w-full p-1 bg-gray-700 rounded-md"}
        />
    </div>
  );
};

export default AddressAutocomplete;
