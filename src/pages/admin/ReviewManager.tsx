'use client';

import React, { useState, useEffect } from 'react';
import { ref, onValue, update, remove } from 'firebase/database';
// ⚠️ แก้ไข path db ให้ตรงกับโปรเจกต์ของคุณ
import { db } from '../../api/firebase'; 
import {
  Star, MessageSquareQuote, CheckCircle2, XCircle,
  Trash2, Clock, Search, Filter, AlertTriangle
} from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

export default function ReviewManager() {
  const toast = useToast();
  const [reviews, setReviews] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [searchTerm, setSearchTerm] = useState('');

  // 1. ดึงข้อมูลรีวิวจาก Firebase
  useEffect(() => {
    const reviewsRef = ref(db, 'reviews');
    const unsubscribe = onValue(reviewsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const reviewsArray = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => b.created_at - a.created_at); // เรียงจากใหม่ไปเก่า
        setReviews(reviewsArray);
      } else {
        setReviews([]);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 2. ฟังก์ชันจัดการสถานะรีวิว
  const handleUpdateStatus = async (reviewId: string, newStatus: 'approved' | 'rejected') => {
    try {
      await update(ref(db, `reviews/${reviewId}`), {
        status: newStatus,
        updated_at: Date.now()
      });
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการอัปเดตสถานะ');
    }
  };

  const handleDelete = async (reviewId: string) => {
    if (window.confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรีวิวนี้ทิ้งถาวร?')) {
      try {
        await remove(ref(db, `reviews/${reviewId}`));
      } catch (error) {
        toast.error('เกิดข้อผิดพลาดในการลบรีวิว');
      }
    }
  };

  // 3. คำนวณสถิติ (Dashboard Stats)
  const pendingCount = reviews.filter(r => r.status === 'pending').length;
  const approvedCount = reviews.filter(r => r.status === 'approved').length;
  const totalRating = reviews.filter(r => r.status === 'approved').reduce((sum, r) => sum + (r.ratings?.overall || 0), 0);
  const avgRating = approvedCount > 0 ? (totalRating / approvedCount).toFixed(1) : '0.0';

  // 4. กรองข้อมูลตาม Tab และการค้นหา
  const filteredReviews = reviews.filter(review => {
    const matchFilter = filter === 'all' || review.status === filter;
    const matchSearch = (review.comment || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                        (review.model_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchFilter && matchSearch;
  });

  // UI สำหรับวาดดาว
  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(star => (
          <Star key={star} size={14} className={star <= rating ? "fill-[#FFB900] text-[#FFB900]" : "fill-slate-100 text-slate-200"} />
        ))}
      </div>
    );
  };

  if (isLoading) return <div className="p-8 text-center text-slate-500">กำลังโหลดข้อมูลรีวิว...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans text-slate-800">
      
      {/* 📊 Dashboard Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black mb-6 flex items-center gap-2">
          <MessageSquareQuote className="text-blue-600" /> จัดการรีวิวจากลูกค้า (Review Manager)
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
              <Clock size={24} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">รอตรวจสอบ (Pending)</p>
              <p className="text-2xl font-black text-slate-800">{pendingCount} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">อนุมัติแล้ว (Approved)</p>
              <p className="text-2xl font-black text-slate-800">{approvedCount} <span className="text-sm font-medium text-slate-500">รายการ</span></p>
            </div>
          </div>
          <div className="bg-gradient-to-br from-blue-600 to-[#144EE3] p-6 rounded-2xl shadow-md text-white flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-white/20 text-[#D4FF00] flex items-center justify-center shrink-0 backdrop-blur-sm">
              <Star size={24} className="fill-[#D4FF00]" />
            </div>
            <div>
              <p className="text-xs font-bold text-blue-100 uppercase tracking-widest">คะแนนเฉลี่ย (Average)</p>
              <p className="text-3xl font-black">{avgRating} <span className="text-sm font-medium text-blue-100">/ 5.0</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* 🎛️ Filters & Search */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-6 flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
          {['pending', 'approved', 'rejected', 'all'].map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab as any)}
              className={`flex-1 sm:flex-none px-4 py-2 text-sm font-bold rounded-lg capitalize transition-all ${filter === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab} {tab === 'pending' && pendingCount > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="ค้นหาจากรุ่น หรือเนื้อหารีวิว..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* 📋 Review List */}
      <div className="space-y-4">
        {filteredReviews.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-100 border-dashed">
            <Filter size={48} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">ไม่พบรายการรีวิวในหมวดหมู่นี้</p>
          </div>
        ) : (
          filteredReviews.map((review) => (
            <div key={review.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-6 hover:shadow-md transition-shadow">
              
              {/* Left Info */}
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black text-lg shrink-0">
                    {review.user_id === 'anonymous' ? 'A' : 'U'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{review.model_name}</span>
                      {review.is_verified_trade_in && (
                        <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <CheckCircle2 size={10} /> Verified
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                      {new Date(review.created_at).toLocaleString('th-TH')} | Job: {review.job_id?.slice(-6) || 'N/A'}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-slate-700 text-sm italic">"{review.comment || 'ไม่มีคอมเมนต์เพิ่มเติม'}"</p>
                </div>
              </div>

              {/* Middle Ratings */}
              <div className="w-full md:w-48 shrink-0 bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-600">ภาพรวม</span>
                  {renderStars(review.ratings?.overall || 0)}
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-600">ราคา</span>
                  {renderStars(review.ratings?.price || 0)}
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-600">บริการ</span>
                  {renderStars(review.ratings?.service || 0)}
                </div>
              </div>

              {/* Right Actions */}
              <div className="w-full md:w-40 shrink-0 flex flex-col gap-2 justify-center border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                {review.status === 'pending' && (
                  <>
                    <button onClick={() => handleUpdateStatus(review.id, 'approved')} className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-colors flex justify-center items-center gap-2">
                      <CheckCircle2 size={16} /> อนุมัติ (โชว์)
                    </button>
                    <button onClick={() => handleUpdateStatus(review.id, 'rejected')} className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl transition-colors flex justify-center items-center gap-2">
                      <XCircle size={16} /> ปฏิเสธ (ซ่อน)
                    </button>
                  </>
                )}
                {review.status === 'approved' && (
                  <div className="text-center w-full py-2 bg-emerald-50 text-emerald-600 text-sm font-bold rounded-xl border border-emerald-100 flex justify-center items-center gap-2">
                    <CheckCircle2 size={16} /> อนุมัติแล้ว
                  </div>
                )}
                {review.status === 'rejected' && (
                  <div className="text-center w-full py-2 bg-red-50 text-red-600 text-sm font-bold rounded-xl border border-red-100 flex justify-center items-center gap-2">
                    <XCircle size={16} /> ซ่อนอยู่
                  </div>
                )}
                
                {/* ปุ่มลบ (สำหรับแอดมินลบขยะทิ้ง) */}
                {(review.status === 'approved' || review.status === 'rejected') && (
                  <button onClick={() => handleDelete(review.id)} className="w-full mt-2 py-2 text-slate-400 hover:text-red-500 text-xs font-bold transition-colors flex justify-center items-center gap-1 underline">
                    <Trash2 size={14} /> ลบถาวร
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}