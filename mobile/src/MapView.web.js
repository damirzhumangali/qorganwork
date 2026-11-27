import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const MapContext = createContext(null);

export default function MapView({ initialRegion, initialZoom = 13, onPress, children, style, accessibilityLabel }) {
  const container = useRef(null);
  const handler = useRef(onPress);
  handler.current = onPress;
  const [map, setMap] = useState(null);
  useEffect(() => {
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView(
      [initialRegion.latitude, initialRegion.longitude], initialZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
    }).addTo(instance);
    instance.on('click', event => handler.current?.({ nativeEvent: {
      coordinate: { latitude: event.latlng.lat, longitude: event.latlng.lng },
    } }));
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    setMap(instance);
    return () => { observer.disconnect(); instance.remove(); };
  }, []);
  return <MapContext.Provider value={map}>
    <div ref={container} aria-label={accessibilityLabel}
      style={{ ...StyleSheet.flatten(style), width: '100%', minHeight: 230, zIndex: 0 }} />
    {children}
  </MapContext.Provider>;
}

export function Marker({ coordinate, title }) {
  const map = useContext(MapContext);
  useEffect(() => {
    if (!map) return;
    const marker = L.circleMarker([coordinate.latitude, coordinate.longitude], {
      radius: 9, color: '#FFFFFF', weight: 3, fillColor: '#087CFF', fillOpacity: 1,
    }).addTo(map);
    if (title) { const label = document.createElement('span'); label.textContent = title; marker.bindTooltip(label); }
    return () => marker.remove();
  }, [map, coordinate.latitude, coordinate.longitude, title]);
  return null;
}

export function Circle({ center, radius }) {
  const map = useContext(MapContext);
  useEffect(() => {
    if (!map) return;
    const circle = L.circle([center.latitude, center.longitude], { radius, color: '#087CFF', weight: 1, fillOpacity: 0.12 }).addTo(map);
    return () => circle.remove();
  }, [map, center.latitude, center.longitude, radius]);
  return null;
}
