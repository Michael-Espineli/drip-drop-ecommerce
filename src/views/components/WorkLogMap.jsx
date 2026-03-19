
import React, { useEffect, useRef } from 'react';
import { format } from 'date-fns';

export const WorkLogMap = ({ logs }) => {
  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);

  useEffect(() => {
    if (!window.google || !window.google.maps) {
      console.error("Google Maps script not loaded.");
      return;
    }

    if (infoWindowRef.current) {
        infoWindowRef.current.close();
    }

    if (logs && logs.length > 0) {
      const map = new window.google.maps.Map(mapRef.current, {
        zoom: 10,
      });

      const infoWindow = new window.google.maps.InfoWindow();
      infoWindowRef.current = infoWindow;

      const bounds = new window.google.maps.LatLngBounds();

      logs.forEach(log => {
        if (log.latitude && log.longitude) {
          const position = { lat: log.latitude, lng: log.longitude };
          
          const marker = new window.google.maps.Marker({
            position: position,
            map: map,
            title: log.userName || 'Log Location'
          });

          marker.addListener('click', () => {
            const timeString = log.time ? format(log.time.toDate(), 'p') : 'No time recorded';
            const contentString = `
              <div style="font-family: Arial, sans-serif; padding: 8px;">
                <p style="font-weight: bold; margin: 0 0 4px 0;">${log.userName || 'N/A'}</p>
                <p style="margin: 0;">Time: ${timeString}</p>
              </div>
            `;
            
            infoWindow.setContent(contentString);
            infoWindow.open(map, marker);
          });

          bounds.extend(position);
        }
      });

      if (logs.length > 0) {
        map.fitBounds(bounds);
      }
      
      if (logs.length === 1) {
          map.setCenter(bounds.getCenter());
          if (map.getZoom() > 15) {
              map.setZoom(15);
          }
      }

    } else {
        const map = new window.google.maps.Map(mapRef.current, {
            zoom: 10,
            center: { lat: 34.052235, lng: -118.243683 } // Default to a central location
        });
    }
  }, [logs]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: '400px' }} />;
};
