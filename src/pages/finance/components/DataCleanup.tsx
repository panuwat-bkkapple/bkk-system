// src/pages/finance/components/DataCleanup.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { Search, Trash2, AlertTriangle, CheckCircle2, Shield, Filter, XCircle } from 'lucide-react';
import { ref, remove, update } from 'firebase/database';
import { db } from '../../../api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';

// Heuristic: ตรวจว่า job นี้น่าจะเป็นข้อมูลทดสอบ
const getTestSignals = (job: any): string[] => {
  const signals: string[] = [];
  const name = (job.cust_name || '').toLowerCase();
  const model = (job.model || '').toLowerCase();
  const refNo = (job.ref_no || '').toLowerCase();

  // ชื่อมีคำที่บ่งบอกว่าเป็น test
  if (/test|ทดสอบ|demo|dummy|xxx|aaa|bbb|asdf|qwer/i.test(name)) signals.push('ชื่อลูกค้าน่าสงสัย');
  if (/test|ทดสอบ|demo|dummy|xxx|aaa/i.test(model)) signals.push('ชื่อรุ่นน่าสงสัย');

  // ราคาต่ำผิดปกติ (1-10 บาท)
  const price = Number(job.final_price || job.price || 0);
  if (price > 0 && price <= 10) signals.push(`ราคาต่ำผิดปกติ (${price} บาท)`);

  // เบอร์โทรเป็นเลขซ้ำ หรือสั้นเกินไป
  const phone = (job.cust_phone || '').replace(/\D/g, '');
  if (phone && (phone.length < 9 || /^(.)\1+$/.test(phone) || phone === '0000000000' || phone === '1234567890')) signals.push('เบอร์โทรน่าสงสัย');

  // ชื่อสั้นมาก (1-2 ตัวอักษร)
  const trimmedName = (job.cust_name || '').trim();
  if (trimmedName.length > 0 && trimmedName.length <= 2) signals.push('ชื่อสั้นเกินไป');

  return signals;
};

type FilterMode = 'all' | 'suspected' | 'selected';

export const DataCleanup = () => {
  const toast = useToast();
  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: transactions, loading: txLoading } = useDatabase('transactions');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<FilterMode>('suspected');
  const [isDeleting, setIsDeleting] = useState(false);

  const jobList = useMemo(() => {
    const list = (Array.isArray(jobs) ? jobs : []).map((j: any) => ({
      ...j,
      testSignals: getTestSignals(j),
    }));
    // เรียง: มี signal เยอะ → บน, ไม่มี signal → ล่าง
    return list.sort((a: any, b: any) => b.testSignals.length - a.testSignals.length);
  }, [jobs]);

  const suspectedCount = useMemo(() => jobList.filter((j: any) => j.testSignals.length > 0).length, [jobList]);

  const filteredJobs = useMemo(() => {
    let list = jobList;

    if (filterMode === 'suspected') list = list.filter((j: any) => j.testSignals.length > 0);
    if (filterMode === 'selected') list = list.filter((j: any) => selectedIds.has(j.id));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((j: any) =>
        (j.ref_no || '').toLowerCase().includes(q) ||
        (j.cust_name || '').toLowerCase().includes(q) ||
        (j.model || '').toLowerCase().includes(q) ||
        (j.id || '').toLowerCase().includes(q) ||
        (j.cust_phone || '').includes(q)
      );
    }

    return list;
  }, [jobList, filterMode, searchQuery, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      filteredJobs.forEach((j: any) => next.add(j.id));
      return next;
    });
  };

  const deselectAll = () => setSelectedIds(new Set());

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;

    const txList = Array.isArray(transactions) ? transactions : [];

    if (!confirm(`⚠️ ยืนยันลบ ${selectedIds.size} รายการ?\n\nรายการที่เลือกจะถูกลบออกจากระบบถาวร (jobs + transactions ที่เกี่ยวข้อง)\n\nกรุณาตรวจสอบให้แน่ใจว่าเป็นข้อมูลทดสอบทั้งหมด`)) return;

    // Double confirm
    if (!confirm(`🔴 ยืนยันอีกครั้ง: ลบ ${selectedIds.size} รายการถาวร?`)) return;

    setIsDeleting(true);
    try {
      const updates: Record<string, null> = {};

      for (const jobId of selectedIds) {
        // ลบ job
        updates[`jobs/${jobId}`] = null;

        // ลบ transactions ที่เกี่ยวข้อง
        txList.filter(t => t.ref_job_id === jobId).forEach(t => {
          updates[`transactions/${t.id}`] = null;
        });
      }

      await update(ref(db), updates);
      toast.success(`ลบ ${selectedIds.size} รายการสำเร็จ!`);
      setSelectedIds(new Set());
    } catch (e) {
      toast.error('เกิดข้อผิดพลาด: ' + e);
    } finally {
      setIsDeleting(false);
    }
  };

  if (jobsLoading || txLoading) {
    return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">กำลังสแกนข้อมูล...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-red-50 border border-red-200 rounded-[2rem] p-6">
        <h3 className="text-lg font-black text-red-800 flex items-center gap-2">
          <Shield className="text-red-600" /> ล้างข้อมูลทดสอบ (Data Cleanup)
        </h3>
        <p className="text-xs font-bold text-red-600 mt-1">
          ระบบตรวจหา Jobs ที่น่าสงสัยว่าเป็นข้อมูลทดสอบ (ชื่อมีคำว่า test, ราคาต่ำผิดปกติ, เบอร์โทรไม่จริง) — กรุณาตรวจสอบก่อนลบ
        </p>
      </div>

      {/* Summary + Actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-slate-500">
            ทั้งหมด <strong className="text-slate-800">{jobList.length}</strong> รายการ
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-bold text-amber-600">
            น่าสงสัย <strong>{suspectedCount}</strong> รายการ
          </span>
          {selectedIds.size > 0 && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-sm font-bold text-red-600">
                เลือกแล้ว <strong>{selectedIds.size}</strong> รายการ
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <button onClick={deselectAll} className="px-4 py-2 text-xs font-black uppercase text-slate-500 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all">
                ยกเลิกทั้งหมด
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={isDeleting}
                className="px-6 py-2.5 text-xs font-black uppercase text-white bg-red-500 rounded-xl hover:bg-red-600 active:scale-95 transition-all shadow-lg shadow-red-200 flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 size={14} />
                {isDeleting ? 'กำลังลบ...' : `ลบ ${selectedIds.size} รายการ`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter Tabs + Search */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          <button onClick={() => setFilterMode('suspected')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5 transition-all ${filterMode === 'suspected' ? 'bg-amber-500 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}>
            <AlertTriangle size={12} /> น่าสงสัย ({suspectedCount})
          </button>
          <button onClick={() => setFilterMode('all')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5 transition-all ${filterMode === 'all' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}>
            <Filter size={12} /> ทั้งหมด ({jobList.length})
          </button>
          {selectedIds.size > 0 && (
            <button onClick={() => setFilterMode('selected')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5 transition-all ${filterMode === 'selected' ? 'bg-red-500 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}>
              <Trash2 size={12} /> เลือกแล้ว ({selectedIds.size})
            </button>
          )}
        </div>

        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="ค้นหา OID, ชื่อ, รุ่น, เบอร์โทร..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
          />
        </div>

        {filteredJobs.length > 0 && (
          <button onClick={selectAllVisible} className="px-4 py-2.5 text-[10px] font-black uppercase text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-all border border-blue-200">
            เลือกทั้งหน้า ({filteredJobs.length})
          </button>
        )}
      </div>

      {/* Table */}
      {filteredJobs.length > 0 ? (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-widest">
              <tr>
                <th className="p-4 pl-6 w-10"></th>
                <th className="p-4">Job / OID</th>
                <th className="p-4">ลูกค้า</th>
                <th className="p-4">เครื่อง</th>
                <th className="p-4 text-right">ราคา</th>
                <th className="p-4">สถานะ</th>
                <th className="p-4">สร้างเมื่อ</th>
                <th className="p-4">สาเหตุที่สงสัย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredJobs.map((job: any) => {
                const isSelected = selectedIds.has(job.id);
                const hasSuspicion = job.testSignals.length > 0;
                return (
                  <tr
                    key={job.id}
                    onClick={() => toggleSelect(job.id)}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-red-50 hover:bg-red-100' : hasSuspicion ? 'bg-amber-50/30 hover:bg-amber-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="p-4 pl-6">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(job.id)}
                        className="w-4 h-4 rounded border-slate-300 text-red-500 focus:ring-red-400 cursor-pointer"
                      />
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-blue-600 text-xs">{job.ref_no || '-'}</div>
                      <div className="text-[9px] font-mono text-slate-400 mt-0.5">{job.id}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-slate-800 text-sm">{job.cust_name || '-'}</div>
                      <div className="text-[10px] text-slate-400">{job.cust_phone || '-'}</div>
                    </td>
                    <td className="p-4 text-xs font-bold text-slate-600">{job.model || '-'}</td>
                    <td className="p-4 text-right font-black text-sm">
                      {formatCurrency(Number(job.final_price || job.price || 0))}
                    </td>
                    <td className="p-4">
                      <span className="text-[9px] font-black uppercase bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">
                        {job.status || '-'}
                      </span>
                    </td>
                    <td className="p-4 text-[10px] font-bold text-slate-400">
                      {job.created_at ? formatDate(job.created_at) : '-'}
                    </td>
                    <td className="p-4">
                      {hasSuspicion ? (
                        <div className="flex flex-wrap gap-1">
                          {job.testSignals.map((s: string, i: number) => (
                            <span key={i} className="text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex items-center gap-3">
          <CheckCircle2 className="text-emerald-500" size={20} />
          <span className="font-bold text-emerald-700 text-sm">
            {filterMode === 'suspected' ? 'ไม่พบรายการที่น่าสงสัย' : 'ไม่พบรายการที่ตรงกับเงื่อนไข'}
          </span>
        </div>
      )}
    </div>
  );
};
