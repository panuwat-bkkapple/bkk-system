'use client';

import React, { useState, useEffect } from 'react';
import { ref, onValue, push, update, remove } from 'firebase/database';
import { db } from '../../api/firebase';
import { Store, Plus, MapPin, Trash2, Edit3, Save, X, Navigation } from 'lucide-react';
import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';

export default function BranchManager() {
    const [branches, setBranches] = useState<any[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({
        name: '',
        address: '',
        mapInfo: '',
        lat: 13.7563, // ค่าเริ่มต้น กรุงเทพฯ
        lng: 100.5018,
        isActive: true
    });

    const { isLoaded } = useJsApiLoader({
        // @ts-ignore
        googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || "", libraries: ['places', 'geometry'] // 🌟 อย่าลืมเพิ่ม 'geometry' เพื่อให้คำนวณระยะทางได้นะครับ
    });

    useEffect(() => {
        const branchRef = ref(db, 'settings/branches');
        return onValue(branchRef, (snap) => {
            if (snap.exists()) {
                const data = snap.val();
                setBranches(Object.keys(data).map(key => ({ id: key, ...data[key] })));
            } else { setBranches([]); }
        });
    }, []);

    const handleSave = async () => {
        if (!form.name || !form.address) return alert('กรุณากรอกข้อมูลให้ครบถ้วน');
        const branchRef = ref(db, 'settings/branches');

        if (editingId) {
            await update(ref(db, `settings/branches/${editingId}`), form);
        } else {
            await push(branchRef, { ...form, created_at: Date.now() });
        }
        closeModal();
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setForm({ name: '', address: '', mapInfo: '', lat: 13.7563, lng: 100.5018, isActive: true });
    };

    const editBranch = (b: any) => {
        setForm(b);
        setEditingId(b.id);
        setIsModalOpen(true);
    };

    const deleteBranch = async (id: string) => {
        if (window.confirm('ยืนยันการลบสาขานี้?')) {
            await remove(ref(db, `settings/branches/${id}`));
        }
    };

    const updateAddressFromCoords = (lat: number, lng: number) => {
        if (window.google) {
            const geocoder = new window.google.maps.Geocoder();
            geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                if (status === "OK" && results?.[0]) {
                    // 🌟 เอาชื่อที่อยู่ที่ได้จาก Google มาใส่ในช่อง Address อัตโนมัติ
                    setForm(prev => ({ ...prev, address: results[0].formatted_address }));
                }
            });
        }
    };

    const searchAddressOnMap = () => {
        if (window.google && form.address) {
            const geocoder = new window.google.maps.Geocoder();
            // 🌟 ส่งข้อความในช่องที่อยู่ ไปถามหาพิกัด Lat/Lng
            geocoder.geocode({ address: form.address }, (results, status) => {
                if (status === "OK" && results?.[0]) {
                    const lat = results[0].geometry.location.lat();
                    const lng = results[0].geometry.location.lng();
                    // 🌟 อัปเดตพิกัด ซึ่งจะทำให้แผนที่และหมุดขยับไปตำแหน่งใหม่ทันที
                    setForm(prev => ({ ...prev, lat, lng }));
                } else {
                    alert("ไม่พบพิกัดจากที่อยู่นี้ กรุณาลองพิมพ์ชื่อถนน, เขต หรือจุดสังเกตเพิ่มเติมครับ");
                }
            });
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto font-sans">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-2xl font-black flex items-center gap-2"><Store className="text-blue-600" /> จัดการสาขา (Branch Manager)</h1>
                <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-100"><Plus size={20} /> เพิ่มสาขาใหม่</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {branches.map(branch => (
                    <div key={branch.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-4">
                            <div className="bg-blue-50 p-3 rounded-xl text-blue-600"><Store size={24} /></div>
                            <div className="flex gap-2">
                                <button onClick={() => editBranch(branch)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors"><Edit3 size={18} /></button>
                                <button onClick={() => deleteBranch(branch.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                            </div>
                        </div>
                        <h3 className="font-black text-lg text-slate-800 mb-1">{branch.name}</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-3">{branch.mapInfo}</p>
                        <p className="text-sm text-slate-600 leading-relaxed mb-4">{branch.address}</p>
                        <div className="text-[10px] font-bold text-slate-400 bg-slate-50 p-2 rounded-lg flex items-center gap-2">
                            <Navigation size={12} /> {branch.lat.toFixed(4)}, {branch.lng.toFixed(4)}
                        </div>
                    </div>
                ))}
            </div>

            {/* 🛠️ Modal สำหรับเพิ่ม/แก้ไขสาขา */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]">
                        <div className="p-8 flex-1 overflow-y-auto">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-black">{editingId ? 'แก้ไขข้อมูลสาขา' : 'เพิ่มสาขาใหม่'}</h2>
                                <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">ชื่อสาขา</label>
                                    <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-600" />
                                </div>
                                <div>
                                    <div>
                                        <div className="flex justify-between items-end mb-1 block">
                                            <label className="text-xs font-bold text-slate-400 uppercase">ที่อยู่ (Address)</label>
                                            {/* 🌟 เพิ่มปุ่มนี้ เพื่อให้กดสั่งแผนที่วิ่งไปหาที่อยู่ได้ */}
                                            <button
                                                type="button"
                                                onClick={searchAddressOnMap}
                                                className="text-[11px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md font-bold hover:bg-blue-100 transition-colors"
                                            >
                                                📍 ค้นหาพิกัดแผนที่
                                            </button>
                                        </div>
                                        <textarea
                                            value={form.address}
                                            onChange={e => setForm({ ...form, address: e.target.value })}
                                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-600 h-24"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">จุดสังเกต / ข้อมูลแผนที่ (Short Info)</label>
                                    <input type="text" value={form.mapInfo} onChange={e => setForm({ ...form, mapInfo: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-600" />
                                </div>
                                <div className="pt-4 border-t flex justify-end gap-3">
                                    <button onClick={closeModal} className="px-6 py-3 font-bold text-slate-500">ยกเลิก</button>
                                    <button onClick={handleSave} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black flex items-center gap-2"><Save size={20} /> บันทึกข้อมูล</button>
                                </div>
                            </div>
                        </div>

                        <div className="w-full md:w-1/2 bg-slate-100 relative min-h-[300px]">
                            {isLoaded && (
                                <GoogleMap
                                    mapContainerStyle={{ width: '100%', height: '100%' }}
                                    center={{ lat: form.lat, lng: form.lng }}
                                    zoom={15}
                                    onClick={(e) => {
                                        if (e.latLng) {
                                            const lat = e.latLng.lat();
                                            const lng = e.latLng.lng();
                                            setForm({ ...form, lat, lng });
                                            updateAddressFromCoords(lat, lng); // 🌟 เรียกใช้ตรงนี้ตอนคลิกแผนที่
                                        }
                                    }}
                                >
                                    <MarkerF
                                        position={{ lat: form.lat, lng: form.lng }}
                                        draggable={true}
                                        onDragEnd={(e) => {
                                            if (e.latLng) {
                                                const lat = e.latLng.lat();
                                                const lng = e.latLng.lng();
                                                setForm({ ...form, lat, lng });
                                                updateAddressFromCoords(lat, lng); // 🌟 เรียกใช้ตรงนี้ตอนลากหมุด
                                            }
                                        }}
                                    />
                                </GoogleMap>
                            )}
                            <div className="absolute top-4 left-4 bg-white/90 p-3 rounded-xl shadow-md text-[10px] font-bold z-10">
                                📍 คลิกบนแผนที่หรือลากหมุดเพื่อตั้งพิกัดร้าน
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}