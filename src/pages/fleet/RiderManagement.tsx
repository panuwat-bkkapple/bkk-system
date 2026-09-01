import React, { useState, useEffect } from 'react';
import { ref, onValue, update, remove } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  UserCheck, XCircle, Search, Bike, CreditCard, ShieldAlert,
  FileText, CheckCircle2, Star, Map, Ban, RefreshCw, Save, AlertTriangle, Activity,
  Pencil, Trash2
} from 'lucide-react';

// การเปลี่ยนสถานะไรเดอร์ผ่าน callable ตัวเดียว (functions/rider-accounts.js)
// ไม่ใช่ update() ตรง เพราะ rules ของ riders แยกได้แค่ admin/ไม่ใช่ admin —
// gate CEO/MANAGER และการปิดบัญชี Auth ตอนระงับต้องอยู่ฝั่ง server เท่านั้น
type RiderAction = 'approve' | 'reject' | 'suspend' | 'unsuspend';
const setRiderStatus = async (riderId: string, action: RiderAction, reason?: string | null) => {
  const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminRiderSetStatus');
  return (await fn({ riderId, action, reason: reason ?? null })).data as {
    ok: boolean; action: RiderAction; authAccountFound: boolean;
  };
};

export const RiderManagement = () => {
  const toast = useToast();
  const [riders, setRiders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRider, setSelectedRider] = useState<any>(null);
  const [filter, setFilter] = useState<'Pending' | 'Active' | 'Suspended' | 'Rejected'>('Pending');
  
  const [editScore, setEditScore] = useState<number>(100);
  const [editZone, setEditZone] = useState<string>('Unassigned');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editEmergency, setEditEmergency] = useState('');
  const [editPlate, setEditPlate] = useState('');
  const [editVehicleModel, setEditVehicleModel] = useState('');
  // ประเภทยานพาหนะ — Cloud Function อ่านที่ riders/{id}/vehicle_type ใช้ 2 อย่าง:
  // เลือกชุดอัตราค่าวิ่ง (settings/logistics_rates/by_vehicle) และคิดเวลาถึง
  // ลูกค้าตามเส้นทางที่ยานพาหนะนั้นวิ่งได้จริง (มอเตอร์ไซค์ขึ้นทางด่วนไม่ได้)
  const [editVehicleType, setEditVehicleType] = useState<'motorcycle' | 'car'>('motorcycle');
  const [editBankName, setEditBankName] = useState('');
  const [editBankAccount, setEditBankAccount] = useState('');
  // สถานะการจ้าง — ตัดสินวิธีทางภาษีของค่าตอบแทนที่จ่ายให้ไรเดอร์คนนี้:
  // ลูกจ้างประจำ = เงินได้ ม.40(1) เข้าระบบเงินเดือน (ภ.ง.ด.1) ไม่หัก ณ ที่จ่าย
  // รายเที่ยว | รับจ้างอิสระ = ค่าจ้างทำของ/ค่าบริการ ต้องหัก ณ ที่จ่ายและออก
  // หนังสือรับรอง (50 ทวิ) + ยื่น ภ.ง.ด.3
  // ค่าว่าง = ยังไม่ระบุ ระบบจะไม่เดาวิธีทางภาษีให้
  const [editEmploymentType, setEditEmploymentType] = useState<'' | 'employee' | 'freelance'>('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editTaxAddress, setEditTaxAddress] = useState('');

  // Normalize rider data: map alternative field names from the rider mobile app
  // to the field names expected by this admin panel
  const normalizeRider = (id: string, raw: any) => {
    const name = raw.name || raw.fullName || raw.full_name || raw.displayName || raw.display_name || raw.rider_name || '';
    const phone = raw.phone || raw.phoneNumber || raw.phone_number || raw.tel || raw.mobile || '';
    const email = raw.email || raw.emailAddress || raw.email_address || '';
    const emergency_contact = raw.emergency_contact || raw.emergencyContact || raw.emergency_phone || raw.emergency_tel || '';

    // Vehicle: support both nested object and flat fields
    const vehicle = {
      type: (String(raw.vehicle_type || raw.vehicle?.type || '').toLowerCase() === 'car'
        ? 'car'
        : 'motorcycle') as 'motorcycle' | 'car',
      plate: raw.vehicle?.plate || raw.vehicle_plate || raw.licensePlate || raw.license_plate || raw.plate || raw.plate_number || '',
      model: raw.vehicle?.model || raw.vehicle_model || raw.vehicleModel || raw.car_model || raw.model || '',
    };

    // Bank: support both nested object and flat fields
    const bank = {
      name: raw.bank?.name || raw.bank_name || raw.bankName || '',
      account: raw.bank?.account || raw.bank_account || raw.bankAccount || raw.account_number || '',
    };

    // Documents: support both nested object and flat fields
    const documents = raw.documents ? raw.documents : (
      (raw.idCard || raw.id_card || raw.selfie || raw.license || raw.driving_license) ? {
        idCard: raw.idCard || raw.id_card || '',
        selfie: raw.selfie || raw.selfie_url || '',
        license: raw.license || raw.driving_license || raw.driver_license || '',
      } : null
    );

    // Determine approval status
    let approval_status = raw.approval_status;
    if (!approval_status) {
      if (['Online', 'Offline', 'Busy'].includes(raw.status)) {
        approval_status = 'Active';
      } else {
        approval_status = raw.status || 'Pending';
      }
    }

    return {
      ...raw,
      id,
      name,
      phone,
      email,
      emergency_contact,
      vehicle,
      bank,
      documents,
      approval_status,
    };
  };

  // ดึงข้อมูลไรเดอร์ทั้งหมดแบบ Realtime
  useEffect(() => {
    const ridersRef = ref(db, 'riders');
    const unsubscribe = onValue(ridersRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const ridersArray = Object.keys(data).map(key => normalizeRider(key, data[key]));
        ridersArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        setRiders(ridersArray);
      } else {
        setRiders([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // กรองตาม approval_status แทน status เดิม
  const filteredRiders = riders.filter(r => r.approval_status === filter);

  useEffect(() => {
    if (selectedRider) {
      setEditScore(selectedRider.score !== undefined ? selectedRider.score : 100);
      setEditZone(selectedRider.zone || 'Unassigned');
      setEditName(selectedRider.name || '');
      setEditPhone(selectedRider.phone || '');
      setEditEmail(selectedRider.email || '');
      setEditEmergency(selectedRider.emergency_contact || '');
      setEditPlate(selectedRider.vehicle?.plate || '');
      setEditVehicleModel(selectedRider.vehicle?.model || '');
      setEditVehicleType(selectedRider.vehicle?.type === 'car' ? 'car' : 'motorcycle');
      setEditBankName(selectedRider.bank?.name || '');
      setEditEmploymentType(selectedRider.employment?.type || '');
      setEditTaxId(selectedRider.employment?.tax_id || '');
      setEditTaxAddress(selectedRider.employment?.tax_address || '');
      setEditBankAccount(selectedRider.bank?.account || '');
      setIsEditingProfile(false);
    }
  }, [selectedRider]);

  const getTierInfo = (score: number) => {
    if (score >= 90) return { label: 'Tier 1 (Premium)', color: 'text-amber-500 bg-amber-50 border-amber-200' };
    if (score >= 60) return { label: 'Tier 2 (Standard)', color: 'text-blue-600 bg-blue-50 border-blue-200' };
    return { label: 'Tier 3 (Warning)', color: 'text-red-600 bg-red-50 border-red-200' };
  };

  // ข้อความ error มาจาก server (role ไม่ผ่าน / ไม่พบไรเดอร์ / ปิดบัญชี Auth
  // ไม่สำเร็จ) — แสดงตรงๆ ดีกว่าข้อความกลางๆ เพราะแต่ละกรณีแก้คนละแบบ
  const failed = (error: unknown) =>
    toast.error('เกิดข้อผิดพลาด: ' + ((error as { message?: string })?.message || error));

  // 🌟 1. ฟังก์ชันอนุมัติ
  const handleApprove = async (riderId: string) => {
    if (window.confirm('ยืนยันการอนุมัติไรเดอร์ท่านนี้?')) {
      try {
        await setRiderStatus(riderId, 'approve');
        setSelectedRider(null);
        toast.success('อนุมัติสำเร็จ! ไรเดอร์สามารถเข้าสู่ระบบและเริ่มรับงานได้ทันที');
      } catch (error) { failed(error); }
    }
  };

  // 🌟 2. ฟังก์ชันไม่อนุมัติ
  const handleReject = async (riderId: string) => {
    const reason = window.prompt('ระบุเหตุผลที่ไม่อนุมัติ (เช่น เอกสารไม่ชัดเจน):');
    if (reason !== null) {
      try {
        const res = await setRiderStatus(riderId, 'reject', reason);
        setSelectedRider(null);
        toast.success(
          res.authAccountFound
            ? 'ปฏิเสธแล้ว — ปิดบัญชีเข้าใช้งานของไรเดอร์คนนี้เรียบร้อย'
            : 'ปฏิเสธแล้ว (ไม่พบบัญชีเข้าใช้งานของไรเดอร์คนนี้)'
        );
      } catch (error) { failed(error); }
    }
  };

  // 🌟 3. ฟังก์ชันระงับการใช้งาน (แบน)
  const handleSuspend = async (riderId: string) => {
    const reason = window.prompt('ระบุเหตุผลที่ระงับการใช้งานไรเดอร์คนนี้:');
    if (reason !== null) {
      try {
        const res = await setRiderStatus(riderId, 'suspend', reason);
        setSelectedRider(null);
        toast.success(
          res.authAccountFound
            ? 'ระงับแล้ว — ไรเดอร์ถูกเตะออกจากระบบและ login ใหม่ไม่ได้'
            : 'ระงับแล้ว (ไม่พบบัญชีเข้าใช้งานของไรเดอร์คนนี้)'
        );
      } catch (error) { failed(error); }
    }
  };

  // 🌟 4. ฟังก์ชันปลดแบน
  const handleUnsuspend = async (riderId: string) => {
    if (window.confirm('ต้องการปลดแบนให้ไรเดอร์กลับมารับงานได้ตามปกติใช่หรือไม่?')) {
      try {
        await setRiderStatus(riderId, 'unsuspend');
        setSelectedRider(null);
        toast.success('ปลดแบนแล้ว — ไรเดอร์กลับมา login และรับงานได้ตามปกติ');
      } catch (error) { failed(error); }
    }
  };

  const handleSaveProfile = async (riderId: string) => {
    try {
      const updates: any = { score: Number(editScore), zone: editZone };
      if (isEditingProfile) {
        updates.name = editName;
        updates.phone = editPhone;
        updates.email = editEmail;
        updates.emergency_contact = editEmergency;
        updates.vehicle = { plate: editPlate, model: editVehicleModel, type: editVehicleType };
        // แบนที่ root ด้วย เพราะ computeRiderFee อ่าน riders/{id}/vehicle_type
        // ตรงๆ (อ่านฟิลด์เดียวถูกกว่าดึง object ทั้งก้อน)
        updates.vehicle_type = editVehicleType;
        updates.bank = { name: editBankName, account: editBankAccount };
        // เก็บรวมเป็น object เดียวเพื่อให้ฝั่งจ่ายเงินอ่านครบในที่เดียว —
        // เลขบัตร/ที่อยู่จำเป็นสำหรับออกหนังสือรับรองหักภาษี ณ ที่จ่าย
        updates.employment = {
          type: editEmploymentType || null,
          tax_id: editTaxId.trim() || null,
          tax_address: editTaxAddress.trim() || null,
        };
      }
      await update(ref(db, `riders/${riderId}`), updates);
      toast.success('บันทึกข้อมูลสำเร็จ!');
      setSelectedRider(null);
    } catch (error) { toast.error('เกิดข้อผิดพลาด: ' + error); }
  };

  const handleDeleteRider = async (riderId: string) => {
    if (window.confirm(`ยืนยันการลบไรเดอร์ ID: ${riderId}?\n\nข้อมูลจะถูกลบออกจากระบบถาวร ไม่สามารถกู้คืนได้`)) {
      try {
        await remove(ref(db, `riders/${riderId}`));
        setSelectedRider(null);
        toast.success('ลบไรเดอร์สำเร็จ');
      } catch (error) { toast.error('เกิดข้อผิดพลาด: ' + error); }
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse font-bold">กำลังโหลดข้อมูล...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><UserCheck className="text-emerald-500" /> จัดการและอนุมัติไรเดอร์ (Rider Management)</h1>
          <p className="text-sm text-gray-500 mt-1">ตรวจสอบเอกสาร จัดโซน ให้คะแนนความประพฤติ และจัดการสถานะ</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-200 pb-2">
        {(['Pending', 'Active', 'Suspended', 'Rejected'] as const).map(f => (
          <button 
            key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 font-bold text-sm rounded-t-lg transition-all flex items-center gap-2 ${filter === f ? 'text-emerald-600 border-b-2 border-emerald-500' : 'text-gray-400 hover:text-gray-600'}`}
          >
            {f === 'Pending' ? 'รออนุมัติ' : f === 'Active' ? 'ใช้งานอยู่ (Active)' : f === 'Suspended' ? 'ถูกระงับ (Suspended)' : 'ไม่อนุมัติ'} 
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${filter === f ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100'}`}>
              {riders.filter(r => r.approval_status === f).length}
            </span>
          </button>
        ))}
      </div>

      {/* ตารางรายชื่อ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-100">
              <th className="p-4 font-bold">ชื่อ-นามสกุล</th>
              <th className="p-4 font-bold">ข้อมูลติดต่อ</th>
              <th className="p-4 font-bold">รถประจำตำแหน่ง</th>
              <th className="p-4 font-bold text-center">โซน / คะแนน (Tier)</th>
              <th className="p-4 font-bold text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filteredRiders.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-gray-400">ไม่มีข้อมูลในสถานะนี้</td></tr>
            ) : (
              filteredRiders.map(rider => {
                const score = rider.score !== undefined ? rider.score : 100;
                const tierInfo = getTierInfo(score);
                
                return (
                  <tr key={rider.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 font-bold text-gray-800">
                      {rider.name || <span className="text-gray-300 italic text-sm">ไม่มีข้อมูล</span>}
                      {rider.approval_status === 'Active' && (rider.status === 'Online' || rider.status === 'Busy') && (
                        <span className={`ml-2 inline-block w-2 h-2 rounded-full ${rider.status === 'Online' ? 'bg-emerald-500' : 'bg-amber-500'}`} title={rider.status}></span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-semibold text-gray-700">{rider.phone || <span className="text-gray-300">-</span>}</div>
                      <div className="text-[10px] text-gray-400">{rider.email || '-'}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded w-fit">{rider.vehicle?.plate || '-'}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{rider.vehicle?.model || '-'}</div>
                    </td>
                    <td className="p-4 text-center">
                      {filter === 'Pending' || filter === 'Rejected' ? (
                        <span className="text-xs text-gray-400">-</span>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] font-bold bg-purple-50 text-purple-600 border border-purple-100 px-2 py-0.5 rounded flex items-center gap-1"><Map size={10}/> {rider.zone || 'Unassigned'}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${tierInfo.color}`}><Star size={10}/> {score} pt ({tierInfo.label})</span>
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <button 
                        onClick={() => setSelectedRider(rider)}
                        className="px-4 py-2 bg-gray-900 text-white text-[10px] uppercase tracking-widest font-bold rounded-lg shadow-sm hover:bg-gray-800 transition-all"
                      >
                        {filter === 'Pending' ? 'ตรวจสอบ' : 'จัดการ'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 🟢 Modal ตรวจสอบ/จัดการ ไรเดอร์ */}
      {selectedRider && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95">
            {/* Header */}
            <div className={`p-6 border-b flex justify-between items-center ${selectedRider.approval_status === 'Suspended' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  {selectedRider.approval_status === 'Suspended' && <AlertTriangle className="text-red-500"/>}
                  {selectedRider.approval_status === 'Pending' ? 'ตรวจสอบเอกสารไรเดอร์' : 'จัดการประวัติไรเดอร์'}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs font-mono text-gray-500 bg-white px-2 py-0.5 rounded border">ID: {selectedRider.id}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${selectedRider.approval_status === 'Active' ? 'bg-emerald-100 text-emerald-700' : selectedRider.approval_status === 'Suspended' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {selectedRider.approval_status}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedRider(null)} className="p-2 bg-white rounded-full text-gray-500 hover:bg-red-50 hover:text-red-500 shadow-sm transition-colors"><XCircle size={24} /></button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 bg-gray-50/30">
              
              {/* คอลัมน์ซ้าย: ข้อมูลตัวหนังสือ & การจัดการ Score/Zone */}
              <div className="space-y-6">
                
                {/* แสดงกล่องปรับแต่งคะแนนและโซน */}
                {(selectedRider.approval_status === 'Active' || selectedRider.approval_status === 'Suspended') && (
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-5 rounded-2xl border border-blue-100 shadow-sm">
                    <h3 className="font-bold text-blue-900 flex items-center gap-2 mb-4 border-b border-blue-200 pb-2"><Activity size={18}/> ประสิทธิภาพ & โซนทำงาน</h3>
                    
                    <div className="space-y-4">
                      {/* Zone Selection */}
                      <div>
                        <label className="text-xs font-bold text-blue-800 mb-1 flex items-center gap-1"><Map size={14}/> โซนหลัก (Main Zone)</label>
                        <select 
                          value={editZone} 
                          onChange={(e) => setEditZone(e.target.value)}
                          className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-blue-500"
                        >
                          <option value="Unassigned">ไม่ได้ระบุโซน</option>
                          <option value="BKK-North">กรุงเทพฯ เหนือ (ดอนเมือง, รังสิต)</option>
                          <option value="BKK-South">กรุงเทพฯ ใต้ (พระราม 2, บางขุนเทียน)</option>
                          <option value="BKK-East">กรุงเทพฯ ตะวันออก (บางนา, ลาดกระบัง)</option>
                          <option value="BKK-CBD">กรุงเทพฯ ชั้นใน (สุขุมวิท, สาทร)</option>
                          <option value="Thonburi">ฝั่งธนบุรี (จรัญฯ, ปิ่นเกล้า)</option>
                        </select>
                      </div>

                      {/* Score Adjustment */}
                      <div>
                        <label className="text-xs font-bold text-blue-800 mb-1 flex items-center gap-1"><Star size={14}/> คะแนนความประพฤติ (Score)</label>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setEditScore(Math.max(0, editScore - 5))} className="bg-white border border-red-200 text-red-500 w-8 h-8 rounded-lg font-bold hover:bg-red-50">-5</button>
                          <input 
                            type="number" 
                            value={editScore} 
                            onChange={(e) => setEditScore(Number(e.target.value))}
                            className="flex-1 bg-white border border-blue-200 rounded-xl px-3 py-2 text-center text-lg font-black text-blue-700 outline-none"
                          />
                          <button onClick={() => setEditScore(Math.min(100, editScore + 5))} className="bg-white border border-emerald-200 text-emerald-500 w-8 h-8 rounded-lg font-bold hover:bg-emerald-50">+5</button>
                        </div>
                        <div className="text-center mt-2">
                           <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getTierInfo(editScore).color}`}>
                             จัดอยู่ในกลุ่ม: {getTierInfo(editScore).label}
                           </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                  <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2"><UserCheck size={18} className="text-gray-500"/> ข้อมูลส่วนตัว</h3>
                    {(selectedRider.approval_status === 'Active' || selectedRider.approval_status === 'Suspended') && (
                      <button onClick={() => setIsEditingProfile(!isEditingProfile)} className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors ${isEditingProfile ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}>
                        <Pencil size={12}/> {isEditingProfile ? 'กำลังแก้ไข' : 'แก้ไข'}
                      </button>
                    )}
                  </div>
                  {isEditingProfile ? (
                    <div className="space-y-3 text-sm">
                      <div><label className="text-xs text-gray-500 font-medium">ชื่อ-นามสกุล</label><input type="text" value={editName} onChange={e => setEditName(e.target.value)} placeholder="ชื่อจริง นามสกุล" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div><label className="text-xs text-gray-500 font-medium">เบอร์โทร</label><input type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="เช่น 0812345678" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div><label className="text-xs text-gray-500 font-medium">อีเมล</label><input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="email@example.com" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div className="bg-red-50 p-3 rounded-lg"><label className="text-xs text-red-600 font-medium">ติดต่อฉุกเฉิน</label><input type="tel" value={editEmergency} onChange={e => setEditEmergency(e.target.value)} placeholder="เบอร์โทรฉุกเฉิน" className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 font-bold text-red-700 outline-none focus:border-red-400" /></div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between"><span className="text-gray-500">ชื่อ-นามสกุล:</span> <span className="font-bold">{selectedRider.name || <span className="text-gray-300 italic">ไม่มีข้อมูล</span>}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">เบอร์โทร:</span> <span className="font-bold">{selectedRider.phone || <span className="text-gray-300 italic">ไม่มีข้อมูล</span>}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">อีเมล:</span> <span className="font-bold">{selectedRider.email || <span className="text-gray-300 italic">ไม่มีข้อมูล</span>}</span></div>
                      <div className="flex justify-between bg-red-50 p-2 rounded-lg"><span className="text-red-600 font-medium">ติดต่อฉุกเฉิน:</span> <span className="font-bold text-red-700">{selectedRider.emergency_contact || '-'}</span></div>
                    </div>
                  )}
                </div>

                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4 border-b pb-2"><Bike size={18} className="text-orange-500"/> ข้อมูลรถ & บัญชี</h3>
                  {isEditingProfile ? (
                    <div className="space-y-3 text-sm">
                      <div><label className="text-xs text-gray-500 font-medium">ป้ายทะเบียน</label><input type="text" value={editPlate} onChange={e => setEditPlate(e.target.value)} placeholder="เช่น กทม 1234" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div><label className="text-xs text-gray-500 font-medium">รุ่นรถ</label><input type="text" value={editVehicleModel} onChange={e => setEditVehicleModel(e.target.value)} placeholder="เช่น Honda Wave สีแดง" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div>
                        <label className="text-xs text-gray-500 font-medium">ประเภทยานพาหนะ</label>
                        <select value={editVehicleType} onChange={e => setEditVehicleType(e.target.value as 'motorcycle' | 'car')} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400">
                          <option value="motorcycle">มอเตอร์ไซค์</option>
                          <option value="car">รถยนต์</option>
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">ใช้เลือกชุดอัตราค่าวิ่ง และคิดเวลาถึงลูกค้า — ลูกค้าจะเห็นว่าไรเดอร์มาด้วยรถอะไร เพื่อเตรียมที่จอด</p>
                      </div>
                      <div className="pt-3 mt-3 border-t">
                        <label className="text-xs text-gray-500 font-medium">สถานะการจ้าง (มีผลทางภาษี)</label>
                        <select
                          value={editEmploymentType}
                          onChange={e => setEditEmploymentType(e.target.value as '' | 'employee' | 'freelance')}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400"
                        >
                          <option value="">— ยังไม่ระบุ —</option>
                          <option value="employee">ลูกจ้างประจำ (เงินเดือน/ค่าจ้าง ภ.ง.ด.1)</option>
                          <option value="freelance">รับจ้างอิสระ (หัก ณ ที่จ่าย + 50 ทวิ ภ.ง.ด.3)</option>
                        </select>
                        <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                          ลูกจ้างประจำ = ค่าเที่ยวเป็นส่วนหนึ่งของค่าจ้าง เข้าระบบเงินเดือน ไม่หัก ณ ที่จ่ายรายเที่ยว<br />
                          รับจ้างอิสระ = บริษัทมีหน้าที่หักภาษี ณ ที่จ่ายและออกหนังสือรับรองให้
                        </p>
                      </div>
                      <div><label className="text-xs text-gray-500 font-medium">เลขประจำตัวผู้เสียภาษี / เลขบัตรประชาชน</label><input type="text" value={editTaxId} onChange={e => setEditTaxId(e.target.value)} placeholder="13 หลัก (ใช้ออกหนังสือรับรองหักภาษี)" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div><label className="text-xs text-gray-500 font-medium">ที่อยู่ตามบัตร (สำหรับเอกสารภาษี)</label><input type="text" value={editTaxAddress} onChange={e => setEditTaxAddress(e.target.value)} placeholder="ที่อยู่ที่จะพิมพ์บนหนังสือรับรอง" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div className="pt-3 mt-3 border-t"><label className="text-xs text-gray-500 font-medium">ธนาคาร</label><input type="text" value={editBankName} onChange={e => setEditBankName(e.target.value)} placeholder="เช่น กสิกรไทย" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                      <div><label className="text-xs text-gray-500 font-medium">เลขบัญชี</label><input type="text" value={editBankAccount} onChange={e => setEditBankAccount(e.target.value)} placeholder="เลขบัญชีธนาคาร" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold outline-none focus:border-blue-400" /></div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between"><span className="text-gray-500">ป้ายทะเบียน:</span> <span className="font-bold bg-orange-100 text-orange-800 px-2 py-0.5 rounded">{selectedRider.vehicle?.plate || '-'}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">รุ่นรถ:</span> <span className="font-medium">{selectedRider.vehicle?.model || '-'}</span></div>
                      <div className="flex justify-between mt-4 pt-4 border-t"><span className="text-gray-500">สถานะการจ้าง:</span> <span className={`font-bold ${selectedRider.employment?.type ? 'text-gray-800' : 'text-amber-600'}`}>{selectedRider.employment?.type === 'employee' ? 'ลูกจ้างประจำ' : selectedRider.employment?.type === 'freelance' ? 'รับจ้างอิสระ' : 'ยังไม่ระบุ'}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">เลขผู้เสียภาษี:</span> <span className="font-bold">{selectedRider.employment?.tax_id || '-'}</span></div>
                      <div className="flex justify-between mt-4 pt-4 border-t"><span className="text-gray-500">ธนาคาร:</span> <span className="font-bold">{selectedRider.bank?.name || '-'}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">เลขบัญชี:</span> <span className="font-bold text-emerald-600">{selectedRider.bank?.account || '-'}</span></div>
                    </div>
                  )}
                </div>

                {selectedRider.approval_status === 'Suspended' && (
                  <div className="bg-red-50 p-5 rounded-2xl border border-red-200">
                    <h3 className="font-bold text-red-800 flex items-center gap-2 mb-2"><AlertTriangle size={18}/> สาเหตุที่ถูกระงับ</h3>
                    <p className="text-sm text-red-600">{selectedRider.suspend_reason || 'ไม่มีการระบุเหตุผล'}</p>
                  </div>
                )}
              </div>

              {/* คอลัมน์ขวา: เอกสารรูปภาพ */}
              <div className="space-y-4">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-2"><FileText size={18} className="text-purple-500"/> เอกสารประจำตัว</h3>
                {selectedRider.documents ? (
                  <div className="space-y-4">
                    <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm group relative">
                      <p className="text-xs font-bold text-gray-500 mb-2">1. รูปถ่ายบัตรประชาชน</p>
                      <a href={selectedRider.documents.idCard} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-gray-100">
                        <img src={selectedRider.documents.idCard} alt="ID Card" className="w-full h-40 object-cover hover:scale-105 transition-transform" />
                      </a>
                    </div>
                    <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm group relative">
                      <p className="text-xs font-bold text-gray-500 mb-2">2. รูปเซลฟี่คู่บัตรประชาชน</p>
                      <a href={selectedRider.documents.selfie} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-gray-100">
                        <img src={selectedRider.documents.selfie} alt="Selfie" className="w-full h-40 object-cover hover:scale-105 transition-transform" />
                      </a>
                    </div>
                    <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm group relative">
                      <p className="text-xs font-bold text-gray-500 mb-2">3. ใบอนุญาตขับขี่</p>
                      <a href={selectedRider.documents.license} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-gray-100">
                        <img src={selectedRider.documents.license} alt="License" className="w-full h-40 object-cover hover:scale-105 transition-transform" />
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 p-8 rounded-2xl text-center border border-dashed border-gray-300">
                    <ShieldAlert size={32} className="text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-500 font-bold text-sm">ยังไม่มีการอัปโหลดเอกสาร</p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-6 border-t border-gray-100 bg-white flex justify-between items-center gap-3">

              <div className="flex gap-2">
                {selectedRider.approval_status === 'Active' && (
                  <button onClick={() => handleSuspend(selectedRider.id)} className="px-4 py-2.5 rounded-xl font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-2 text-sm">
                    <Ban size={16}/> ระงับการใช้งาน
                  </button>
                )}
                {selectedRider.approval_status === 'Suspended' && (
                  <button onClick={() => handleUnsuspend(selectedRider.id)} className="px-4 py-2.5 rounded-xl font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors flex items-center gap-2 text-sm">
                    <RefreshCw size={16}/> ปลดแบน (Reactivate)
                  </button>
                )}
                <button onClick={() => handleDeleteRider(selectedRider.id)} className="px-4 py-2.5 rounded-xl font-bold text-red-500 bg-white border border-red-200 hover:bg-red-50 transition-colors flex items-center gap-2 text-sm">
                  <Trash2 size={16}/> ลบไรเดอร์
                </button>
              </div>

              <div className="flex gap-3">
                {selectedRider.approval_status === 'Pending' && (
                  <>
                    <button onClick={() => handleReject(selectedRider.id)} className="px-6 py-3 rounded-xl font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors">ไม่อนุมัติ</button>
                    <button onClick={() => handleApprove(selectedRider.id)} className="px-8 py-3 rounded-xl font-bold text-white bg-emerald-500 shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition-colors flex items-center gap-2"><CheckCircle2 size={20} /> อนุมัติเข้าทำงาน</button>
                  </>
                )}

                {(selectedRider.approval_status === 'Active' || selectedRider.approval_status === 'Suspended') && (
                  <button onClick={() => handleSaveProfile(selectedRider.id)} className="px-8 py-3 rounded-xl font-bold text-white bg-blue-600 shadow-lg shadow-blue-200 hover:bg-blue-700 transition-colors flex items-center gap-2">
                    <Save size={18} /> บันทึกข้อมูล
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};