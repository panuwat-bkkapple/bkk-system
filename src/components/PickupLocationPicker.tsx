// Reusable pickup-location picker for the admin ticket edit flows.
//
// Lets an admin set/refine the customer's pickup coordinates two ways
// (the user asked for both):
//   1. Geocode — type/keep the address, tap "ค้นหาพิกัดจากที่อยู่" to resolve
//      it to a pin via the Google Maps JS Geocoder.
//   2. Pin confirm — tap the map or drag the marker for an exact spot.
//
// It only reports coordinates (lat/lng) upward; the parent owns the address
// text. Writing the new cust_lat/cust_lng triggers the onPickupLocationChanged
// Cloud Function which recomputes the rider fee / payout automatically.

import { useState } from 'react';
import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';
import { MapPin, Search } from 'lucide-react';

const BANGKOK = { lat: 13.7563, lng: 100.5018 };
// Match BranchManager's loader options exactly — useJsApiLoader is a singleton
// keyed by options, and mismatched options throw at runtime.
const LIBRARIES: ('places' | 'geometry')[] = ['places', 'geometry'];

// Resolve an address string to coordinates via the Maps JS Geocoder. Returns
// null if Maps isn't loaded, the address is blank, or no match is found.
// Exported so save handlers can reconcile a stale pin when the admin edits the
// address text without touching the map (the rider navigates by the pin, so a
// stale pin sends them to the wrong place).
export function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.google || !address?.trim()) {
      resolve(null);
      return;
    }
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results?.[0]) {
        resolve({ lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() });
      } else {
        resolve(null);
      }
    });
  });
}

interface Props {
  address: string;
  lat?: number;
  lng?: number;
  onChange: (coords: { lat: number; lng: number }) => void;
  height?: number;
}

export default function PickupLocationPicker({ address, lat, lng, onChange, height = 220 }: Props) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '',
    libraries: LIBRARIES,
  });
  const [searching, setSearching] = useState(false);

  const hasPin = typeof lat === 'number' && typeof lng === 'number';
  const center = hasPin ? { lat: lat as number, lng: lng as number } : BANGKOK;

  const handleGeocode = async () => {
    if (!address?.trim()) return;
    setSearching(true);
    const coords = await geocodeAddress(address);
    setSearching(false);
    if (coords) onChange(coords);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleGeocode}
        disabled={!isLoaded || searching || !address?.trim()}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-blue-50 text-blue-600 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Search size={13} /> {searching ? 'กำลังค้นหา...' : 'ค้นหาพิกัดจากที่อยู่'}
      </button>
      <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height }}>
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={center}
            zoom={hasPin ? 16 : 11}
            onClick={(e) => { if (e.latLng) onChange({ lat: e.latLng.lat(), lng: e.latLng.lng() }); }}
          >
            {hasPin && (
              <MarkerF
                position={{ lat: lat as number, lng: lng as number }}
                draggable
                onDragEnd={(e) => { if (e.latLng) onChange({ lat: e.latLng.lat(), lng: e.latLng.lng() }); }}
              />
            )}
          </GoogleMap>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">กำลังโหลดแผนที่...</div>
        )}
      </div>
      <p className="text-[10px] text-slate-500 flex items-center gap-1">
        <MapPin size={11} />
        {hasPin
          ? `พิกัด: ${(lat as number).toFixed(5)}, ${(lng as number).toFixed(5)} — ลากหมุด/แตะแผนที่เพื่อปรับ`
          : 'แตะแผนที่ หรือกด "ค้นหาพิกัดจากที่อยู่" เพื่อตั้งจุดรับเครื่อง'}
      </p>
    </div>
  );
}
