// src/pages/DispatcherPage.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF, TrafficLayer, PolylineF } from '@react-google-maps/api';
import { useDatabase } from '../../hooks/useDatabase';
import {
  Users, Zap, Clock, Battery,
  Map as MapIcon, GripVertical, Box, Phone, X, MessageSquare
} from 'lucide-react';
import { ref, update, onValue, set } from 'firebase/database';
import { db } from '../../api/firebase';
import { AdminChatBox } from '../../components/Fleet/AdminChatBox';
import { useToast } from '../../components/ui/ToastProvider';
import { JOB_STATUS } from '../../types/job-statuses';

const mapContainerStyle = { width: '100%', height: '100%' };
const center = { lat: 13.7563, lng: 100.5018 };
const AREA_BOUNDS = { minLat: 13.45, maxLat: 14.10, minLng: 100.25, maxLng: 100.95 };

const ACTIVE_STATUSES = [
  'Assigned', 'Accepted', 'Arrived', 'Being Inspected',
  'Price Accepted', 'Revised Offer', 'Payout Processing',
  'Waiting for Handover', 'In-Transit'
];

const STATUS_COLORS: Record<string, string> = {
  'Accepted': '#3B82F6',
  'In-Transit': '#F59E0B',
  'default': '#94A3B8'
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const calculateETA = (distanceKm: number) => Math.ceil((distanceKm / 25) * 60 + 5);

const getJobCoordinates = (jobId: string) => {
  let hash = 0;
  for (let i = 0; i < jobId.length; i++) hash = jobId.charCodeAt(i) + ((hash << 5) - hash);
  const lat = AREA_BOUNDS.minLat + (Math.abs(hash % 100) / 100) * (AREA_BOUNDS.maxLat - AREA_BOUNDS.minLat);
  const lng = AREA_BOUNDS.minLng + (Math.abs((hash >> 3) % 100) / 100) * (AREA_BOUNDS.maxLng - AREA_BOUNDS.minLng);
  return { lat, lng };
};

export const DispatcherPage = () => {
  const toast = useToast();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || "" });

  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: ridersData, loading: ridersLoading } = useDatabase('riders');

  // 🌟 ย้าย State แชทมาไว้ใน Component
  const [activeChatJobId, setActiveChatJobId] = useState<string | null>(null);
  const [dispatchMode, setDispatchMode] = useState('manual');

  useEffect(() => {
    const unsubscribe = onValue(ref(db, 'settings/system/dispatch_mode'), (snapshot) => {
      setDispatchMode(snapshot.exists() ? snapshot.val() : 'manual');
    });
    return () => unsubscribe();
  }, []);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeInfoWindow, setActiveInfoWindow] = useState<string | null>(null);

  const { unassignedJobs, activeJobs } = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return {
      unassignedJobs: list.filter(j =>
        (j.status === 'Active Leads' || (j.status === 'Assigned' && !j.rider_id)) &&
        j.type !== 'Withdrawal'
      ),
      activeJobs: list.filter(j =>
        j.rider_id && ACTIVE_STATUSES.includes(j.status) && j.type !== 'Withdrawal'
      )
    };
  }, [jobs]);

  const riderStatusList = useMemo(() => {
    if (!ridersData) return [];
    const rawRiders = Array.isArray(ridersData) ? ridersData : Object.keys(ridersData).map(k => ({ id: k, ...(ridersData as any)[k] }));
    const selectedJobCoords = selectedJobId ? getJobCoordinates(selectedJobId) : null;

    let processed = rawRiders.map((rider: any) => {
      // Normalize field names from the rider mobile app
      const name = rider.name || rider.fullName || rider.full_name || rider.displayName || rider.display_name || rider.rider_name || '';
      const phone = rider.phone || rider.phoneNumber || rider.phone_number || rider.tel || rider.mobile || '';
      const lat = Number(rider.lat) || 13.75;
      const lng = Number(rider.lng) || 100.50;
      const distance = selectedJobCoords ? calculateDistance(lat, lng, selectedJobCoords.lat, selectedJobCoords.lng) : null;
      const eta = distance ? calculateETA(distance) : null;
      const currentTasks = activeJobs.filter(j => j.rider_id === rider.id);

      return { ...rider, name, phone, lat, lng, distance, eta, status: rider.status || 'Offline', tasks: currentTasks };
    });

    if (selectedJobId) processed.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    return processed;
  }, [ridersData, selectedJobId, activeJobs]);

  const handleAssignJob = async (riderId: string, jobId: string) => {
    try {
      await update(ref(db, `jobs/${jobId}`), { status: JOB_STATUS.RIDER_ASSIGNED, rider_id: riderId, assigned_at: Date.now() });
      setSelectedJobId(null);
    } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e); }
  };

  const handleUnassignJob = async (jobId: string) => {
    if (window.confirm('ต้องการดึงงานนี้กลับเข้าคิว (Unassign) ใช่หรือไม่?')) {
      try {
        await update(ref(db, `jobs/${jobId}`), {
          status: JOB_STATUS.ACTIVE_LEAD,
          rider_id: null,
          assigned_at: null
        });
      } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e); }
    }
  };

  const toggleDispatchMode = async () => {
    const newMode = dispatchMode === 'manual' ? 'broadcast' : 'manual';
    if (window.confirm(`ต้องการเปลี่ยนเป็นโหมด ${newMode === 'broadcast' ? 'แย่งงานอิสระ (Broadcast)' : 'แอดมินจ่ายงาน (Manual)'} ใช่หรือไม่?`)) {
      try {
        await set(ref(db, 'settings/system/dispatch_mode'), newMode);
      } catch (e) {
        toast.error("เปลี่ยนโหมดไม่สำเร็จ");
      }
    }
  };

  if (loadError) return <div className="p-10 text-red-500 font-mono">MAP ERROR: {loadError.message}</div>;
  if (!apiKey) return <div className="p-10 text-amber-500 font-mono">MISSING VITE_GOOGLE_MAPS_API_KEY</div>;
  if (!isLoaded || jobsLoading || ridersLoading) return <div className="h-screen bg-slate-950 flex items-center justify-center text-slate-500 font-mono">CONNECTING TO SATELLITE...</div>;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans">
      <aside className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col shadow-xl z-20">
        <div className="p-5 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Users size={14} /> Fleet Monitoring
          </h2>
          {selectedJobId && <span className="bg-blue-600 text-white text-[8px] px-2 py-0.5 rounded-full animate-pulse">OPTIMIZING</span>}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {riderStatusList.map((rider, index) => (
            <div
              key={rider.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const jId = e.dataTransfer.getData("jobId"); if (jId) handleAssignJob(rider.id, jId); }}
              className={`p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${selectedJobId && index === 0 ? 'border-blue-500 bg-blue-900/20 shadow-lg shadow-blue-900/20' : 'border-slate-800 bg-slate-800/50 hover:border-slate-700'}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${rider.status === 'Online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500'}`}></div>
                  <div>
                    <span className="font-bold text-sm truncate max-w-[120px] block">{rider.name}</span>
                    {rider.tasks.length > 0 ? (
                      <span className="text-[9px] text-blue-400 font-bold flex items-center gap-1"><Box size={10} /> {rider.tasks.length} Active Job(s)</span>
                    ) : (
                      <span className="text-[9px] text-slate-600">No active jobs</span>
                    )}
                  </div>
                </div>
                {selectedJobId && rider.distance !== null && (
                  <div className="text-right">
                    <div className={`text-[10px] font-black ${index === 0 ? 'text-blue-400' : 'text-slate-500'}`}>{rider.distance.toFixed(1)} km</div>
                    <div className="text-[9px] font-bold text-emerald-400 flex items-center gap-1"><Clock size={10} /> ~{rider.eta} mins</div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mb-2">
                <div className={`text-[10px] font-bold flex items-center gap-1 ${rider.battery < 20 ? 'text-red-500 animate-pulse' : 'text-slate-500'}`}>
                  <Battery size={10} /> {rider.battery}% • {rider.status}
                </div>
                {rider.phone && (
                  <a href={`tel:${rider.phone}`} className="text-[9px] bg-slate-700 hover:bg-emerald-600 px-2 py-1 rounded flex items-center gap-1 transition-colors text-white no-underline">
                    <Phone size={10} /> CALL
                  </a>
                )}
              </div>

              {rider.tasks.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1">
                  {rider.tasks.map((task: any) => (
                    <div key={task.id} className="bg-slate-900 p-2 rounded border-l-2 border-blue-500 flex justify-between items-center group hover:bg-slate-800 transition-colors">
                      <div className="truncate w-28">
                        <div className="text-[9px] text-slate-200 truncate">{task.model}</div>
                        <div className="text-[8px] text-slate-500">{task.customer}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setActiveChatJobId(task.id); }}
                          className="relative p-1 hover:bg-slate-700 rounded-md text-slate-400 hover:text-purple-400 transition-all"
                        >
                          <MessageSquare size={14} />
                          {task.chats && Object.values(task.chats).some((c: any) => c.sender === 'rider' && !c.read) && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-purple-500 rounded-full border border-slate-900 animate-pulse"></span>
                          )}
                        </button>
                        <span className="text-[8px] bg-blue-900/30 px-1.5 py-0.5 rounded text-blue-300 border border-blue-900/50">{task.status}</span>
                        {task.status === 'Assigned' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUnassignJob(task.id); }}
                            className="text-slate-500 hover:text-red-400 p-0.5 rounded-md hover:bg-slate-700 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <X size={12} strokeWidth={3} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 relative">
        <GoogleMap mapContainerStyle={mapContainerStyle} center={center} zoom={11}>
          <TrafficLayer />
          {riderStatusList.filter(r => r.status !== 'Offline').map((rider) => (
            <MarkerF
              key={rider.id}
              position={{ lat: rider.lat, lng: rider.lng }}
              icon={{
                url: rider.battery < 20 ? 'https://cdn-icons-png.flaticon.com/512/587/587380.png' : 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png',
                scaledSize: new window.google.maps.Size(35, 35)
              }}
              onClick={() => setActiveInfoWindow(rider.id)}
            >
              {activeInfoWindow === rider.id && (
                <InfoWindowF onCloseClick={() => setActiveInfoWindow(null)}>
                  <div className="text-slate-900 p-2 min-w-[120px]">
                    <p className="font-black text-xs uppercase">{rider.name}</p>
                    <p className="text-[10px] opacity-60 mb-2">{rider.tasks.length} Active Jobs</p>
                    {rider.phone && (
                      <a href={`tel:${rider.phone}`} className="w-full bg-emerald-500 text-white py-1 rounded text-[10px] font-bold flex justify-center gap-1 no-underline hover:bg-emerald-600">
                        <Phone size={10} /> CALL
                      </a>
                    )}
                  </div>
                </InfoWindowF>
              )}
            </MarkerF>
          ))}
          {unassignedJobs.map((job) => (
            <MarkerF
              key={job.id}
              position={getJobCoordinates(job.id)}
              icon={{
                url: 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png',
                scaledSize: new window.google.maps.Size(30, 30)
              }}
            />
          ))}
          {riderStatusList.map(rider => rider.tasks.map((task: any) => (
            <PolylineF
              key={`${rider.id}-${task.id}`}
              path={[{ lat: rider.lat, lng: rider.lng }, getJobCoordinates(task.id)]}
              options={{
                strokeColor: STATUS_COLORS[task.status] || STATUS_COLORS.default,
                strokeOpacity: 0.6,
                strokeWeight: 3,
                icons: [{ icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW }, offset: '50%' }]
              }}
            />
          )))}
        </GoogleMap>
      </main>

      <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col shadow-xl z-20">
        <div className="p-4 border-b border-slate-800 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Zap size={14} /> Incoming Queue
            </h2>
            <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">{unassignedJobs.length}</span>
          </div>
          <div className="flex items-center justify-between bg-slate-800/50 p-2.5 rounded-lg border border-slate-700">
            <span className="text-[10px] text-slate-400 font-bold">MODE:</span>
            <button
              onClick={toggleDispatchMode}
              className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all shadow-sm flex items-center gap-1 ${dispatchMode === 'broadcast'
                ? 'bg-purple-500 hover:bg-purple-600 text-white shadow-purple-500/50'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/50'
                }`}
            >
              {dispatchMode === 'broadcast' ? '📡 BROADCAST' : '🎯 MANUAL'}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-2 overflow-y-auto flex-1">
          {unassignedJobs.length === 0 && <div className="text-center text-slate-600 py-10 text-xs">No pending jobs</div>}
          {unassignedJobs.map(job => (
            <div key={job.id}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("jobId", job.id); setSelectedJobId(job.id); }}
              onDragEnd={() => setSelectedJobId(null)}
              onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}
              className={`p-4 rounded-xl border transition-all cursor-grab active:cursor-grabbing hover:scale-[1.02] ${selectedJobId === job.id ? 'bg-blue-600 border-blue-500 shadow-lg' : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-tighter bg-slate-900 px-1.5 py-0.5 rounded">#{job.id.slice(-4)}</span>
                <span className="text-[10px] text-slate-400 font-mono">{new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className={`font-black text-sm truncate flex items-center gap-2 ${selectedJobId === job.id ? 'text-white' : 'text-slate-200'}`}>
                <GripVertical size={12} className="opacity-30" /> {job.model}
              </div>
              <div className={`text-[10px] mt-1 pl-5 ${selectedJobId === job.id ? 'text-blue-200' : 'text-slate-500'}`}>{job.customer}</div>
            </div>
          ))}
        </div>
      </aside>

      {activeChatJobId && (
        <AdminChatBox
          jobId={activeChatJobId}
          onClose={() => setActiveChatJobId(null)}
          adminName="Admin"
        />
      )}
    </div>
  );
};