// Service picker — dropdown ที่โหลด service list จาก Sickw + multi-select
// + แสดงราคาต่อ check + รวมราคา bundle
//
// state model: รับ value (array of service id strings) + onChange
// — controlled component, parent เป็นคนเก็บ state จริง

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, X, Loader2, CheckCircle2 } from 'lucide-react';
import { listSickwServices, type SickwService } from '../../utils/sickwApi';

interface Props {
  value: string[];
  onChange: (selected: string[]) => void;
  defaultBundle?: string[]; // จาก settings/sickw/default_bundle — ปุ่ม "ใช้ default"
  disabled?: boolean;
  // ถ้า true: บังคับเลือก 1 ตัว (single mode), false: multi
  singleOnly?: boolean;
}

export function SickwServicePicker({ value, onChange, defaultBundle, disabled, singleOnly }: Props) {
  const [services, setServices] = useState<SickwService[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { services } = await listSickwServices();
        if (alive) setServices(services);
      } catch (e: any) {
        if (alive) setError(e?.message || 'โหลด services ไม่สำเร็จ');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) => s.service.includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [services, search]);

  const selectedServices = useMemo(
    () => value.map((id) => services.find((s) => s.service === id)).filter(Boolean) as SickwService[],
    [value, services]
  );

  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const toggle = (id: string) => {
    if (singleOnly) {
      onChange([id]);
      setOpen(false);
      return;
    }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const applyDefaultBundle = () => {
    if (defaultBundle && defaultBundle.length > 0) onChange(defaultBundle);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-1">
        <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          {singleOnly ? 'Service' : 'Services ที่จะตรวจ'}
        </label>
        {defaultBundle && defaultBundle.length > 0 && (
          <button
            type="button"
            onClick={applyDefaultBundle}
            disabled={disabled}
            className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline disabled:opacity-40"
          >
            ใช้ default ({defaultBundle.length} services)
          </button>
        )}
      </div>

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || loading}
        className="w-full min-h-[44px] px-3 py-2 bg-white border border-slate-200 rounded-lg text-left flex items-center justify-between gap-2 hover:border-blue-400 disabled:opacity-50"
      >
        <div className="flex-1 flex flex-wrap gap-1 items-center">
          {loading ? (
            <span className="text-sm text-slate-400 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> โหลด services...
            </span>
          ) : selectedServices.length === 0 ? (
            <span className="text-sm text-slate-400">เลือก service...</span>
          ) : (
            selectedServices.map((s) => (
              <span
                key={s.service}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[11px] font-bold"
              >
                [{s.service}] {s.name}
                <X
                  size={11}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(s.service);
                  }}
                  className="hover:text-blue-900"
                />
              </span>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selectedServices.length > 0 && (
            <span className="text-[11px] font-mono font-bold text-emerald-700">
              ${totalPrice.toFixed(2)}
            </span>
          )}
          <ChevronDown size={14} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {error && <p className="text-[10px] text-red-600 mt-1">{error}</p>}

      {/* Dropdown */}
      {open && (
        <>
          {/* click outside to close */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 mt-1 z-[70] bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้น service (ชื่อ หรือ ID)..."
                  className="w-full pl-7 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="p-3 text-xs text-slate-400 text-center">ไม่เจอ service ที่ค้นหา</p>
              ) : (
                filtered.map((s) => {
                  const selected = value.includes(s.service);
                  return (
                    <button
                      key={s.service}
                      type="button"
                      onClick={() => toggle(s.service)}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-blue-50 transition ${
                        selected ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {!singleOnly && (
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            selected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                          }`}>
                            {selected && <CheckCircle2 size={12} className="text-white" />}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            <span className="font-mono text-slate-500">[{s.service}]</span> {s.name}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-emerald-700 shrink-0">
                        ${s.price.toFixed(2)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {!singleOnly && value.length > 0 && (
              <div className="p-2 border-t border-slate-100 flex justify-between text-[11px]">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-slate-500 hover:text-slate-800"
                >
                  ล้างทั้งหมด
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="font-bold text-blue-600 hover:text-blue-800"
                >
                  เสร็จ ({value.length} services)
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
