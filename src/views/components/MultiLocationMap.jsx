import React, { useEffect, useRef } from 'react';

export const MultiLocationMap = ({ locations }) => {
  const mapRef = useRef(null);

  useEffect(() => {
    if (locations && locations.length > 0) {
      const map = new window.google.maps.Map(mapRef.current, {
        zoom: 10, // Initial zoom
      });

      const bounds = new window.google.maps.LatLngBounds();

      locations.forEach(location => {
        if (location.latitude && location.longitude) {
          const marker = new window.google.maps.Marker({
            position: { lat: location.latitude, lng: location.longitude },
            map: map,
          });
          bounds.extend(marker.getPosition());
        }
      });

      if (locations.length > 1) {
        map.fitBounds(bounds);
      } else if (locations.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(15);
      }
    }
  }, [locations]);

  return <div ref={mapRef} style={{ width: '100%', height: '400px' }} />;
};

