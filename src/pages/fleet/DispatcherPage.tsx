// src/pages/DispatcherPage.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF, TrafficLayer, PolylineF } from '@react-google-maps/api';
import { useDatabase } from '../../hooks/useDatabase';
import {
  Users, Zap, Clock, Battery,
  Map as MapIcon, GripVertical, Box, Phone, X, MessageSquare, MapPin
} from 'lucide-react';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../../api/firebase';
import { AdminChatBox } from '../../components/Fleet/AdminChatBox';
import { hasUnreadFrom } from '../../utils/jobChats';
import { JOB_EVENT } from '../../utils/jobTransitions';
import { runJobTransition } from '../../utils/runJobTransition';
import { useToast } from '../../components/ui/ToastProvider';
import { jobPin, riderPin } from '../../utils/dispatchPins';
import { JOB_STATUS } from '../../types/job-statuses';
import { statusIs, statusIn } from '../../utils/statusCompare';

const mapContainerStyle = { width: '100%', height: '100%' };
const center = { lat: 13.7563, lng: 100.5018 };

// canonical เท่านั้น — เทียบผ่าน statusIn ซึ่ง normalize ฝั่งงาน (สะกดเก่า Assigned /
// Accepted / Arrived / Waiting for Handover / In-Transit ตกที่ canonical ของมันเอง)
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  JOB_STATUS.RIDER_ASSIGNED, JOB_STATUS.RIDER_ACCEPTED, JOB_STATUS.RIDER_ARRIVED, JOB_STATUS.BEING_INSPECTED,
  JOB_STATUS.PRICE_ACCEPTED, JOB_STATUS.REVISED_OFFER, JOB_STATUS.PAYOUT_PROCESSING,
  JOB_STATUS.WAITING_FOR_HANDOVER, JOB_STATUS.RIDER_EN_ROUTE, JOB_STATUS.RIDER_RETURNING,
]);

const STATUS_COLORS: Record<string, string> = {
  'Accepted': '#3B82F6',
  'Rider Accepted': '#3B82F6',
  'In-Transit': '#F59E0B',
  'Rider En Route': '#F59E0B',
  'Rider Returning': '#F59E0B',
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
        (statusIs(j, JOB_STATUS.ACTIVE_LEAD) ||
          (statusIs(j, JOB_STATUS.RIDER_ASSIGNED) && !j.rider_id)) &&
        j.type !== 'Withdrawal'
      ),
      activeJobs: list.filter(j =>
        j.rider_id && statusIn(j, ACTIVE_STATUSES) && j.type !== 'Withdrawal'
      )
    };
  }, [jobs]);

  const riderStatusList = useMemo(() => {
    if (!ridersData) return [];
    const rawRiders = Array.isArray(ridersData) ? ridersData : Object.keys(ridersData).map(k => ({ id: k, ...(ridersData as any)[k] }));
    // งานที่เลือกอยู่ + หมุดของมัน — ไม่มีหมุด = เรียงตามระยะทางไม่ได้เลย
    const selectedJob = selectedJobId
      ? [...unassignedJobs, ...activeJobs].find((j) => j.id === selectedJobId) ?? null
      : null;
    const selectedJobCoords = jobPin(selectedJob);

    const processed = rawRiders.map((rider: any) => {
      // Normalize field names from the rider mobile app
      const name = rider.name || rider.fullName || rider.full_name || rider.displayName || rider.display_name || rider.rider_name || '';
      const phone = rider.phone || rider.phoneNumber || rider.phone_number || rider.tel || rider.mobile || '';
      const pin = riderPin(rider);
      // ระยะทางมีความหมายก็ต่อเมื่อ **ทั้งสองฝั่ง** มีหมุดจริง ขาดฝั่งไหนก็ null
      // และ null ต้องถูกแสดงว่า "ไม่มีตำแหน่ง" ไม่ใช่ถูกแปลงเป็นเลขไกลๆ เงียบๆ
      const distance = pin && selectedJobCoords
        ? calculateDistance(pin.lat, pin.lng, selectedJobCoords.lat, selectedJobCoords.lng)
        : null;
      const eta = distance !== null ? calculateETA(distance) : null;
      const currentTasks = activeJobs.filter(j => j.rider_id === rider.id);

      return { ...rider, name, phone, pin, distance, eta, status: rider.status || 'Offline', tasks: currentTasks };
    });

    // เรียงเฉพาะคนที่มีระยะทางจริง ส่วนคนที่วัดไม่ได้ต่อท้ายแบบ **มีป้ายบอก**
    // (ของเดิมใช้ `(a.distance || 999)` ซึ่งกลืนคนที่ไม่มีตำแหน่งไปอยู่ท้ายแถว
    // โดยไม่มีอะไรบอกว่าเขาไม่ได้อยู่ไกล — เขาแค่ไม่มีใครรู้ว่าอยู่ไหน)
    if (!selectedJobCoords) return processed;
    const ranked = processed.filter((r) => r.distance !== null).sort((a, b) => a.distance - b.distance);
    const unranked = processed.filter((r) => r.distance === null);
    return [...ranked, ...unranked];
  }, [ridersData, selectedJobId, activeJobs, unassignedJobs]);

  // งานที่เลือกอยู่มีหมุดไหม — ใช้เตือนบนหัวคอลัมน์ว่าเรียงตามระยะทางไม่ได้
  const selectedJobHasPin = useMemo(() => {
    if (!selectedJobId) return true;
    const job = [...unassignedJobs, ...activeJobs].find((j) => j.id === selectedJobId);
    return jobPin(job) !== null;
  }, [selectedJobId, unassignedJobs, activeJobs]);

  // จำนวนงานในคิวที่ไม่มีหมุด — ปักบนแผนที่ไม่ได้ ต้องบอกให้เห็น ไม่ใช่หายไปเฉยๆ
  const jobsWithoutPin = useMemo(
    () => unassignedJobs.filter((j) => jobPin(j) === null).length,
    [unassignedJobs],
  );

  // rider_id กับ assigned_at ไปใน patch ของ transaction เดียวกับสถานะ ไม่ใช่
  // write ที่สอง — งานที่มีสถานะ Rider Assigned แต่ยังไม่มี rider_id คืองาน
  // ที่หายไปจากทั้งสองคิว: ไม่อยู่ในคิวว่างให้ใครรับ และไม่มีใครถืออยู่
  const handleAssignJob = async (riderId: string, jobId: string) => {
    const res = await runJobTransition(jobId, JOB_EVENT.RIDER_ASSIGNED, {
      patch: { rider_id: riderId, assigned_at: Date.now() },
    });
    if (!res.ok) { toast.error(res.message); return; }
    setSelectedJobId(null);
  };

  // ดึงงานกลับเข้าคิว — engine เป็นคนล้าง rider_id/assigned_at ผ่าน `clears`
  // ของ rider_unassigned ไคลเอนต์จึงไม่ต้องจำว่ามีฟิลด์อะไรต้องล้างบ้าง
  //
  // **ไม่ใช่ rider_withdrew** ถึงจะดูคล้ายกัน: ตัวนั้นลง Following Up เพราะ
  // ไรเดอร์รับปากลูกค้าไว้แล้วหายไป ต้องมีคนโทรบอก ส่วนแอดมินสับเปลี่ยนคนเอง
  // ไม่มีอะไรต้องอธิบาย งานกลับเข้าคิวแย่งงานตรงๆ
  const handleUnassignJob = async (jobId: string) => {
    if (!window.confirm('ต้องการดึงงานนี้กลับเข้าคิว (Unassign) ใช่หรือไม่?')) return;
    const res = await runJobTransition(jobId, JOB_EVENT.RIDER_UNASSIGNED);
    if (!res.ok) toast.error(res.message);
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
          {selectedJobId && (selectedJobHasPin
            ? <span className="bg-blue-600 text-white text-[8px] px-2 py-0.5 rounded-full animate-pulse">OPTIMIZING</span>
            : <span className="bg-amber-500 text-slate-950 text-[8px] px-2 py-0.5 rounded-full font-black">NO PIN</span>)}
        </div>
        {selectedJobId && !selectedJobHasPin && (
          <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/30 text-[10px] font-bold text-amber-400 leading-relaxed">
            งานใบนี้ไม่มีหมุดจุดรับเครื่อง — เรียงไรเดอร์ตามระยะทางไม่ได้
            <span className="block text-amber-500/70 font-normal mt-0.5">
              จ่ายงานได้ตามปกติ แต่ตัวเลขระยะทาง/ETA จะไม่ขึ้น
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {riderStatusList.map((rider, index) => (
            <div
              key={rider.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const jId = e.dataTransfer.getData("jobId"); if (jId) handleAssignJob(rider.id, jId); }}
              className={`p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${selectedJobId && index === 0 && rider.distance !== null ? 'border-blue-500 bg-blue-900/20 shadow-lg shadow-blue-900/20' : 'border-slate-800 bg-slate-800/50 hover:border-slate-700'}`}
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
                {selectedJobId && (rider.distance !== null ? (
                  <div className="text-right">
                    <div className={`text-[10px] font-black ${index === 0 ? 'text-blue-400' : 'text-slate-500'}`}>{rider.distance.toFixed(1)} km</div>
                    <div className="text-[9px] font-bold text-emerald-400 flex items-center gap-1"><Clock size={10} /> ~{rider.eta} mins</div>
                  </div>
                ) : (
                  /* วัดระยะไม่ได้ ต้องบอกว่าเพราะอะไร — ไม่ใช่ปล่อยช่องว่าง
                     ให้เดาว่าไรเดอร์คนนี้อยู่ไกล */
                  <div className="text-right">
                    <div className="text-[9px] font-black text-amber-500 uppercase tracking-wide">
                      {rider.pin ? 'งานไม่มีหมุด' : 'ไม่มีตำแหน่ง'}
                    </div>
                    <div className="text-[8px] text-slate-600">วัดระยะไม่ได้</div>
                  </div>
                ))}
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
                          {hasUnreadFrom(task, 'rider') && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-purple-500 rounded-full border border-slate-900 animate-pulse"></span>
                          )}
                        </button>
                        <span className="text-[8px] bg-blue-900/30 px-1.5 py-0.5 rounded text-blue-300 border border-blue-900/50">{task.status}</span>
                        {statusIs(task, JOB_STATUS.RIDER_ASSIGNED) && (
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
          {riderStatusList.filter(r => r.status !== 'Offline' && r.pin).map((rider) => (
            <MarkerF
              key={rider.id}
              position={rider.pin}
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
          {/* ปักเฉพาะงานที่มีหมุดจริง — งานที่ไม่มีหมุดปักไม่ได้ และถูกนับไว้ที่
              ป้าย "ไม่มีหมุด" ในคิวด้านขวาแทน ไม่ใช่ปักมั่วให้ครบจำนวน */}
          {unassignedJobs.map((job) => ({ job, pin: jobPin(job) })).filter(({ pin }) => pin).map(({ job, pin }) => (
            <MarkerF
              key={job.id}
              position={pin!}
              icon={{
                url: 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png',
                scaledSize: new window.google.maps.Size(30, 30)
              }}
            />
          ))}
          {riderStatusList.map(rider => rider.tasks
            .map((task: any) => ({ task, taskPin: jobPin(task) }))
            .filter(({ taskPin }: any) => rider.pin && taskPin)
            .map(({ task, taskPin }: any) => (
            <PolylineF
              key={`${rider.id}-${task.id}`}
              path={[rider.pin, taskPin]}
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
            <div className="flex items-center gap-1.5">
              {jobsWithoutPin > 0 && (
                <span
                  title="งานที่ไม่มี cust_lat/cust_lng — ปักบนแผนที่ไม่ได้ และเรียงไรเดอร์ตามระยะทางไม่ได้"
                  className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full"
                >
                  {jobsWithoutPin} ไม่มีหมุด
                </span>
              )}
              <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">{unassignedJobs.length}</span>
            </div>
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
              {jobPin(job) === null && (
                <div className="mt-2 ml-5 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                  <MapPin size={9} /> ไม่มีหมุด
                </div>
              )}
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