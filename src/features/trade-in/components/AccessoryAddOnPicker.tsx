import React from 'react';
import { Paperclip } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import {
  accessoryModelsForDevice,
  findModelByDisplayName,
  representativeUsedPrice,
  type JobAccessoryItem,
} from '../../../utils/accessoryItems';

interface AccessoryAddOnPickerProps {
  /** raw /models list (useDatabase('models')) */
  modelsData: any;
  /** ชื่อรุ่นบน ticket เช่น "iPad Air 11 (Wi-Fi | 256GB)" — ใช้หา model record */
  deviceDisplayName: string;
  items: JobAccessoryItem[];
  onChange: (items: JobAccessoryItem[]) => void;
}

/**
 * Add-on "ขายพร้อมอุปกรณ์เสริม" ตอนสร้าง ticket — โผล่เฉพาะเมื่อรุ่นที่เลือกเป็น
 * iPad (category Tablets) และมี accessory model ที่ compatible ในระบบ. ราคาที่
 * เลือกจะถูกบวกเข้ายอดรวม (price) โดยผู้เรียก — component นี้จัดการแค่รายการ.
 */
export const AccessoryAddOnPicker: React.FC<AccessoryAddOnPickerProps> = ({
  modelsData, deviceDisplayName, items, onChange,
}) => {
  const deviceModel = findModelByDisplayName(modelsData, deviceDisplayName);
  const accessories = accessoryModelsForDevice(modelsData, deviceModel);
  if (accessories.length === 0) return null;

  const toggle = (m: any, checked: boolean) => {
    if (checked) {
      onChange([...items, {
        id: m.id,
        model_id: m.id,
        model_name: m.name,
        price: representativeUsedPrice(m),
      }]);
    } else {
      onChange(items.filter(it => it.id !== m.id));
    }
  };

  const setPrice = (id: string, price: number) => {
    onChange(items.map(it => (it.id === id ? { ...it, price } : it)));
  };

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
      <label className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
        <Paperclip size={14} /> ขายพร้อมอุปกรณ์เสริม (Apple เท่านั้น)
      </label>
      <div className="space-y-2">
        {accessories.map((m: any) => {
          const selected = items.find(it => it.id === m.id);
          return (
            <div
              key={m.id}
              className={`p-3 rounded-2xl border-2 transition-all ${selected ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-100'}`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!selected}
                  onChange={e => toggle(m, e.target.checked)}
                  className="w-5 h-5 accent-indigo-600 shrink-0"
                />
                {m.imageUrl && <img src={m.imageUrl} alt="" className="w-9 h-9 rounded-lg object-contain bg-slate-50 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="font-black text-sm text-slate-800 truncate">{m.name}</div>
                  {!selected && representativeUsedPrice(m) > 0 && (
                    <div className="text-[10px] font-bold text-slate-400">ราคากลาง {formatCurrency(representativeUsedPrice(m))}</div>
                  )}
                </div>
                {selected && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-black text-indigo-400">฿</span>
                    <input
                      type="number"
                      min={0}
                      value={selected.price || ''}
                      onChange={e => setPrice(m.id, Number(e.target.value) || 0)}
                      className="w-24 p-2 bg-white border border-indigo-200 rounded-xl font-black text-sm text-indigo-700 outline-none text-right"
                      placeholder="0"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 0 && (
        <p className="text-[10px] font-bold text-indigo-500">
          รวมอุปกรณ์เสริม {items.length} ชิ้น {formatCurrency(items.reduce((s, it) => s + (Number(it.price) || 0), 0))} — บวกเข้ายอดรับซื้อรวมอัตโนมัติ
        </p>
      )}
    </div>
  );
};
