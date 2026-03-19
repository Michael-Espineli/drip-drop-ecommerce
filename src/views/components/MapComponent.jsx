
import React, { useEffect, useRef } from 'react';

const MapComponent = ({ latitude, longitude, zoom }) => {
  const mapRef = useRef(null);

  useEffect(() => {
    if (latitude && longitude) {
      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: latitude, lng: longitude },
        zoom: zoom,
      });

      new window.google.maps.Marker({
        position: { lat: latitude, lng: longitude },
        map: map,
      });
    }
  }, [latitude, longitude]);

  return <div ref={mapRef} style={{ width: '100%', height: '400px' }} />;
};

export default MapComponent;
