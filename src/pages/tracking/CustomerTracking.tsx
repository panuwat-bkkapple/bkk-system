// src/pages/CustomerTracking.tsx
import React, { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import { GoogleMap, useJsApiLoader, MarkerF } from '@react-google-maps/api';
import {
  CheckCircle2, Clock, Bike, MapPin,
  Smartphone, ShieldCheck, Phone,
  XCircle, User, ClipboardList, Wallet, Receipt,
  Store, Truck, Package
} from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

const mapContainerStyle = { width: '100%', height: '100%', borderRadius: '1rem' };

export const CustomerTracking = ({ jobId }: { jobId: string }) => {
  const id = jobId;
  const [job, setJob] = useState<any>(null);
  const [rider, setRider] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || "" });

  useEffect(() => {
    if (!id) return;
    const jobRef = ref(db, `jobs/${id}`);
    const unsubscribeJob = onValue(jobRef, (snapshot) => {
      if (snapshot.exists()) {
        setJob({ id: snapshot.key, ...snapshot.val() });
      } else setJob(null);
      setLoading(false);
    });
    return () => unsubscribeJob();
  }, [id]);

  useEffect(() => {
    if (job?.rider_id) {
      const riderRef = ref(db, `riders/${job.rider_id}`);
      const unsubscribeRider = onValue(riderRef, (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.val();
          // Normalize field names from the rider mobile app
          setRider({
            ...raw,
            name: raw.name || raw.fullName || raw.full_name || raw.displayName || raw.display_name || raw.rider_name || '',
            phone: raw.phone || raw.phoneNumber || raw.phone_number || raw.tel || raw.mobile || '',
          });
        }
      });
      return () => unsubscribeRider();
    }
  }, [job?.rider_id]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-blue-500 font-bold animate-pulse">กำลังโหลดข้อมูล...</div>;
  if (!job) return <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50"><ShieldCheck size={48} className="text-slate-300 mb-4" /><h2 className="text-xl font-bold text-slate-500">ไม่พบข้อมูลออเดอร์</h2></div>;

  const isCancelled = job.status === 'Cancelled';
  const receiveMethod = job.receive_method || 'Pickup'; // ตรวจสอบวิธีส่งมอบ
  const slipUrl = job.payment_slip || job.slip_image || job.slip_url || job.payment_proof || job.payment_info?.slip_url || job.documents?.slip_url || null;

  const getCurrentStep = () => {
    if (!job || !job.status) return 0;
    const s = String(job.status).trim().toUpperCase();
    if (slipUrl || ['PAYMENT COMPLETED', 'PAID', 'IN STOCK', 'READY TO SELL', 'COMPLETED', 'DEAL CLOSED', 'DEAL CLOSED (NEGOTIATED)'].includes(s)) return 4;
    if (['PRICE ACCEPTED', 'REVISED OFFER', 'PAYOUT PROCESSING', 'PENDING FINANCE APPROVAL', 'PENDING FINANCE', 'APPROVED'].includes(s)) return 3;
    if (['ARRIVED', 'PENDING QC', 'QC REVIEW', 'BEING INSPECTED'].includes(s)) return 2;
    if (['ACCEPTED', 'IN-TRANSIT', 'APPOINTMENT SET', 'WAITING DROP-OFF'].includes(s)) return 1;
    return 0;
  };
  const currentStep = getCurrentStep();

  // 🌟 ปรับข้อความไทม์ไลน์ให้ตรงกับวิธีส่งมอบ
  const getStep1Details = () => {
    if (receiveMethod === 'Store-in') return { label: 'นัดหมายสาขา', desc: 'ลูกค้านำเครื่องมาที่สาขา', icon: Store };
    if (receiveMethod === 'Mail-in') return { label: 'จัดส่งพัสดุ', desc: 'อยู่ระหว่างการจัดส่งพัสดุ', icon: Truck };
    return { label: 'กำลังเดินทาง', desc: 'ไรเดอร์กำลังเดินทางไปหาคุณ', icon: Bike };
  };
  const step1 = getStep1Details();

  const statuses = [
    { label: 'รับเรื่องแล้ว', desc: 'เจ้าหน้าที่กำลังตรวจสอบคำสั่งซื้อ', icon: Clock },
    step1,
    { label: 'ตรวจสอบสภาพเครื่อง', desc: 'ทีม QC ตรวจสอบฟังก์ชันทั้งหมด', icon: Smartphone },
    { label: 'สรุปยอด / รอโอนเงิน', desc: 'ยืนยันราคา / เจรจา / รอตั้งเบิก', icon: Wallet },
    { label: 'โอนเงินสำเร็จ', desc: 'ลูกค้าได้รับเงินเรียบร้อยแล้ว', icon: Receipt },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA] font-sans max-w-md mx-auto relative shadow-2xl pb-10">
      <div className="bg-blue-600 text-white p-6 rounded-b-[2rem] shadow-lg sticky top-0 z-20">
        <h1 className="text-xl font-black tracking-tight mb-1 flex items-center gap-2"><Smartphone size={20} /> BKK APPLE TRACKING</h1>
        <p className="text-[11px] font-bold text-blue-200 uppercase tracking-widest">ORDER ID: {job.OID || job.ref_no || `#${job.id.slice(-4)}`}</p>
      </div>

      <div className="p-5 space-y-5 -mt-2">

        {/* กล่องข้อมูลลูกค้า */}
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 relative z-10">
          <div className="flex justify-between items-start border-b border-slate-100 pb-3 mb-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">ข้อมูลลูกค้า (Customer)</p>
              <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><div className="p-1 bg-blue-50 text-blue-600 rounded-full"><User size={12} /></div>{job.cust_name || job.customerName || 'ไม่ระบุชื่อ'}</p>
            </div>
            <div className="text-right">
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${receiveMethod === 'Pickup' ? 'bg-blue-50 text-blue-600' :
                receiveMethod === 'Store-in' ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'
                }`}>
                {receiveMethod}
              </span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex-1 pr-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">อุปกรณ์หลัก (Main Device)</p>
              <p className="text-sm font-bold text-slate-800 leading-tight">{job.model}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">ยอดรับซื้อ (สุทธิ)</p>
              <p className={`text-xl font-black ${isCancelled ? 'text-slate-400 line-through' : 'text-emerald-600'}`}>
                {formatCurrency(job.final_price || job.price || 0)}
              </p>
            </div>
          </div>
        </div>

        {/* 🛑 กรณียกเลิก */}
        {isCancelled && (
          <div className="bg-red-50 p-6 rounded-3xl border border-red-100 flex flex-col items-center justify-center text-center shadow-inner animate-in zoom-in duration-300">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-3 shadow-sm border border-red-100"><XCircle size={36} className="text-red-500" /></div>
            <h3 className="text-sm font-black text-red-800 uppercase tracking-widest mb-1">รายการถูกยกเลิก (Cancelled)</h3>
            <p className="text-[10px] font-bold text-red-600 mb-3">คำสั่งซื้อนี้ถูกยกเลิก หรือปฏิเสธการรับซื้อแล้ว</p>
            {job.cancel_reason && (
              <div className="bg-white w-full p-3 rounded-xl border border-red-100 text-left"><p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">เหตุผล (Reason)</p><p className="text-xs font-bold text-red-700">{job.cancel_reason}</p></div>
            )}
          </div>
        )}

        {/* 📋 ข้อมูลการประเมิน (เพิ่มการเปรียบเทียบผลตรวจจริง) */}
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
            <ClipboardList size={14} className="text-blue-500" /> ข้อมูลการประเมิน (Assessment Details)
          </h3>
          <div className="space-y-4">
            {(job.devices && job.devices.length > 0 ? job.devices : [job]).map((device: any, idx: number) => {
              const customerConditions = device.customer_conditions || job.customer_conditions || [];
              const isCustomerNew = device.isNewDevice || job.assessment_details?.isNewDevice;

              // 🌟 ดึงข้อมูลที่ QC ตรวจพบ
              const internalDeductions = device.deductions || (idx === 0 ? job.deductions : []) || [];
              const isInspected = device.inspection_status === "Inspected" || job.inspection_status === "Inspected" || currentStep >= 2;

              return (
                <div key={idx} className="space-y-3">
                  {job.devices && job.devices.length > 1 && (
                    <p className="text-xs font-black text-slate-800 border-l-4 border-blue-500 pl-2 uppercase">{device.model}</p>
                  )}

                  {/* 1. ส่วนที่ลูกค้าแจ้ง (Customer Info) */}
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black uppercase text-slate-400 mb-2 flex items-center gap-1">
                      <User size={10} /> สภาพที่แจ้งเบื้องต้น
                    </p>
                    {isCustomerNew ? (
                      <div className="text-[11px] text-blue-600 font-bold flex items-center gap-1.5"><CheckCircle2 size={14} /> เครื่องใหม่มือ 1 (ยังไม่แกะซีล)</div>
                    ) : customerConditions.length > 0 ? (
                      <ul className="space-y-1.5">
                        {customerConditions.map((c: string, i: number) => {
                          const formattedCond = c.replace(/^\[(.*?)\]\s*(.*)$/, '$1: $2');
                          return (
                            <li key={i} className="text-[11px] font-bold text-slate-600 flex items-start gap-2 leading-relaxed">
                              <span className="text-blue-400 mt-0.5 shrink-0">•</span><span>{formattedCond}</span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-[10px] text-slate-400 italic font-medium">ไม่ได้ระบุสภาพเบื้องต้น</p>
                    )}
                  </div>

                  {/* 2. 🌟 ส่วนผลการตรวจจริง (Internal QC Result) - จะแสดงเมื่อตรวจเสร็จแล้ว */}
                  {isInspected && (
                    <div className={`p-4 rounded-2xl border animate-in fade-in slide-in-from-top-2 duration-500 ${internalDeductions.length > 0 ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
                      <p className={`text-[9px] font-black uppercase mb-2 flex items-center gap-1 ${internalDeductions.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        <ShieldCheck size={10} /> ผลการตรวจสอบจากเจ้าหน้าที่
                      </p>

                      {internalDeductions.length > 0 ? (
                        <div className="space-y-2">
                          <ul className="space-y-1.5">
                            {internalDeductions.map((d: string, i: number) => {
                              const displayItem = d.replace(/^\[(.*?)\]\s*(.*)$/, '$1: $2');
                              return (
                                <li key={i} className="text-[11px] font-black text-amber-700 flex items-start gap-2 leading-relaxed">
                                  <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                                  <span>{displayItem}</span>
                                </li>
                              );
                            })}
                          </ul>
                          <div className="mt-2 pt-2 border-t border-amber-200/50 flex justify-between items-center">
                            <span className="text-[10px] font-bold text-amber-600 italic">* ราคาถูกปรับปรุงตามสภาพจริง</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-emerald-600 font-bold flex items-center gap-1.5">
                          <CheckCircle2 size={14} /> สภาพเครื่องสมบูรณ์ ตรงตามที่ลูกค้าแจ้ง
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ========================================= */}
        {/* 🌟 แสดง UI ตามรูปแบบการส่งมอบ (Method-Specific UI) */}
        {/* ========================================= */}
        {!isCancelled && currentStep >= 1 && currentStep < 4 && (
          <div className="animate-in fade-in slide-in-from-bottom-4">

            {/* 📍 1. กรณี Pickup (โชว์แผนที่ + ข้อมูลไรเดอร์) */}
            {receiveMethod === 'Pickup' && isLoaded && rider && rider.lat && rider.lng && (
              <>
                <div className="bg-white p-2 rounded-3xl shadow-sm border border-slate-100 h-64 relative overflow-hidden mb-4">
                  <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-slate-200 text-[10px] font-black text-blue-600 flex items-center gap-1.5"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span></span> Live GPS Tracking</div>
                  <GoogleMap mapContainerStyle={mapContainerStyle} center={{ lat: rider.lat, lng: rider.lng }} zoom={15} options={{ disableDefaultUI: true }}>
                    <MarkerF position={{ lat: rider.lat, lng: rider.lng }} icon={{ url: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png', scaledSize: new window.google.maps.Size(40, 40) }} />
                  </GoogleMap>
                </div>
                <div className="bg-blue-50 p-5 rounded-3xl border border-blue-100 flex justify-between items-center shadow-inner">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-blue-600 font-black text-xl border border-blue-200">{rider.name?.charAt(0) || 'R'}</div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 mb-0.5">พนักงานเข้ารับเครื่อง</p>
                      <p className="text-sm font-bold text-slate-800">{rider.name}</p>
                      <p className="text-[10px] font-bold text-slate-500 mt-0.5">{rider.vehicle?.plate || 'รถจักรยานยนต์ของบริษัท'}</p>
                    </div>
                  </div>
                  <a href={`tel:${rider.phone}`} className="p-3 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 transition-colors"><Phone size={18} /></a>
                </div>
              </>
            )}

            {/* 🏬 2. กรณี Store-in (โชว์สาขาที่นัดหมาย พร้อมแผนที่) */}
            {receiveMethod === 'Store-in' && (
              <div className="bg-purple-50 p-1 rounded-[2rem] border border-purple-100 shadow-inner overflow-hidden mb-4">

                {/* 🌟 1. แสดงแผนที่ (ถ้ามีข้อมูลพิกัด) */}
                {job.branch_details && isLoaded && (
                  <div className="h-48 w-full rounded-t-[1.8rem] overflow-hidden relative border-b border-purple-100">
                    <GoogleMap
                      mapContainerStyle={mapContainerStyle}
                      center={{ lat: job.branch_details.lat, lng: job.branch_details.lng }}
                      zoom={16}
                      options={{ disableDefaultUI: true, gestureHandling: 'cooperative' }}
                    >
                      <MarkerF position={{ lat: job.branch_details.lat, lng: job.branch_details.lng }} />
                    </GoogleMap>
                    <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm text-[10px] font-black text-purple-600 border border-purple-100">
                      📍 จุดนัดพบ
                    </div>
                  </div>
                )}

                {/* 🌟 2. ข้อมูลสาขา และ ปุ่มนำทาง */}
                <div className="p-5 text-center bg-white rounded-[1.8rem] m-1 shadow-sm border border-purple-50">
                  <Store size={32} className="mx-auto text-purple-500 mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-purple-400 mb-1">สาขาที่นัดหมาย</p>

                  {/* โชว์ชื่อและที่อยู่สาขา */}
                  <p className="text-base font-bold text-purple-800 leading-tight">
                    {job.branch_details?.name || job.store_branch || 'BKK APPLE (Head Office)'}
                  </p>
                  {job.branch_details?.address && (
                    <p className="text-[11px] text-slate-500 mt-2 mb-4 px-2 leading-relaxed">
                      {job.branch_details.address}
                    </p>
                  )}

                  {/* 📍 3. ปุ่มกดเปิดแอป Google Maps (นำทาง) */}
                  {job.branch_details?.lat && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${job.branch_details.lat},${job.branch_details.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full bg-purple-600 text-white font-bold text-xs py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-md shadow-purple-200 hover:bg-purple-700 transition-colors"
                    >
                      <MapPin size={16} /> นำทางด้วย Google Maps
                    </a>
                  )}

                  <p className="text-[10px] font-bold text-purple-400 mt-4 bg-purple-50 p-2 rounded-lg inline-block">
                    กรุณานำอุปกรณ์มาติดต่อที่สาขา พร้อมโชว์หน้าจอนี้ให้พนักงาน
                  </p>
                </div>
              </div>
            )}
            {/* 📦 3. กรณี Mail-in (โชว์ที่อยู่ หรือ เลขพัสดุ) */}
            {receiveMethod === 'Mail-in' && (
              <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 shadow-inner">
                {job.tracking_number ? (
                  // ถ้าแอดมินใส่เลขพัสดุแล้ว
                  <div className="text-center">
                    <Truck size={36} className="mx-auto text-amber-500 mb-3" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">สถานะพัสดุ ({job.courier_name || 'Courier'})</p>
                    <p className="text-xl font-black text-amber-800 tracking-wider">{job.tracking_number}</p>
                    <p className="text-[11px] font-bold text-amber-600 mt-3">พัสดุของคุณอยู่ในระบบแล้ว รอทีมงานรับเข้าสาขาครับ</p>
                  </div>
                ) : (
                  // ถ้าเพิ่งสร้างออเดอร์ ยังไม่มีเลข
                  <div>
                    <div className="flex items-center gap-2 mb-3 text-amber-700 font-black text-sm">
                      <Package size={18} /> ที่อยู่สำหรับจัดส่งพัสดุ
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-amber-200 text-xs text-slate-600 font-bold leading-relaxed">
                      บริษัท บีเคเค เทรดอิน จำกัด<br />
                      123 อาคารเอ็มไพร์ทาวเวอร์ ชั้น 10<br />
                      ถ.สาทรใต้ แขวงยานนาวา เขตสาทร<br />
                      กรุงเทพมหานคร 10120<br />
                      โทรศัพท์: 08x-xxx-xxxx
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* ⏳ ไทม์ไลน์สถานะ */}
        {!isCancelled && (
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mt-4">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2 border-b border-slate-100 pb-2">
              <CheckCircle2 size={14} className="text-emerald-500" /> สถานะปัจจุบัน (Order Status)
            </h3>

            {String(job.status).trim().toUpperCase() === 'REVISED OFFER' && (
              <div className="mb-6 p-4 bg-amber-50 rounded-2xl border border-amber-200 shadow-sm animate-pulse">
                <p className="text-xs font-black text-amber-800 uppercase tracking-widest">⚠️ เจรจาราคารับซื้อใหม่</p>
                <p className="text-[10px] text-amber-700 font-bold mt-1">เจ้าหน้าที่กำลังติดต่อเพื่อเจรจาราคาเนื่องจากสภาพเครื่องไม่ตรงตามประเมิน</p>
              </div>
            )}

            <div className="space-y-6">
              {statuses.map((step, index) => {
                const isCompleted = index < currentStep;
                const isCurrent = index === currentStep;
                const StepIcon = step.icon;

                return (
                  <div key={index} className="flex gap-4 relative">
                    {index < statuses.length - 1 && (
                      <div className={`absolute top-8 left-[19px] bottom-[-24px] w-0.5 ${isCompleted ? 'bg-blue-500' : 'bg-slate-100'}`}></div>
                    )}

                    <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 shrink-0 transition-all duration-300 ${isCompleted ? 'bg-blue-500 border-blue-500 text-white shadow-md shadow-blue-200' :
                      isCurrent ? 'bg-white border-blue-500 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]' :
                        'bg-slate-50 border-slate-200 text-slate-300'
                      }`}>
                      <StepIcon size={18} />
                    </div>

                    <div className="pt-1.5 pb-2">
                      <p className={`text-sm font-black ${isCurrent ? 'text-blue-600' : isCompleted ? 'text-slate-800' : 'text-slate-400'}`}>
                        {step.label}
                      </p>
                      <p className={`text-[10px] mt-0.5 font-bold ${isCurrent ? 'text-blue-400' : 'text-slate-400'}`}>{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 💰 สลิปโอนเงิน */}
        {!isCancelled && currentStep === 4 && slipUrl && (
          <div className="bg-emerald-50 p-6 rounded-3xl shadow-sm border border-emerald-100 animate-in fade-in slide-in-from-bottom-4 mt-6">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-emerald-600 mb-4 flex items-center gap-2 border-b border-emerald-100 pb-2">
              <CheckCircle2 size={16} /> หลักฐานการโอนเงิน (Transfer Slip)
            </h3>
            <div className="bg-white p-2 rounded-2xl shadow-sm border border-emerald-100">
              <img src={slipUrl} alt="Payment Slip" className="w-full h-auto rounded-xl object-contain max-h-[400px]" />
            </div>
            <p className="text-center text-[11px] font-bold text-emerald-600 mt-4">ขอบคุณที่ใช้บริการ BKK APPLE ครับ 🎉</p>
          </div>
        )}

      </div>
    </div>
  );
};