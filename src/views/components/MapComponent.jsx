
import React, { useEffect, useRef, useState } from 'react';

const hasGoogleMaps = () => typeof window !== 'undefined' && Boolean(window.google?.maps);

const MapComponent = ({ latitude, longitude, zoom = 15, height = '400px' }) => {
  const mapRef = useRef(null);
  const [mapsReady, setMapsReady] = useState(hasGoogleMaps);
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (mapsReady) return undefined;

    const timer = window.setInterval(() => {
      if (hasGoogleMaps()) {
        setMapsReady(true);
        window.clearInterval(timer);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [mapsReady]);

  useEffect(() => {
    if (mapsReady && hasCoordinates && mapRef.current && hasGoogleMaps()) {
      const googleMaps = window.google.maps;
      const map = new googleMaps.Map(mapRef.current, {
        center: { lat, lng },
        zoom: zoom,
      });

      new googleMaps.Marker({
        position: { lat, lng },
        map: map,
      });
    }
  }, [hasCoordinates, lat, lng, mapsReady, zoom]);

  return <div ref={mapRef} style={{ width: '100%', height }} />;
};

export default MapComponent;
