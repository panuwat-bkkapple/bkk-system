'use client';

import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Upload, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadImageToFirebase } from '../../../../utils/uploadImage';

/**
 * รูปตามตัวเลือก (Option Images)
 *
 * ให้ตั้งรูปเฉพาะตัวเลือกของ modifier option ได้ เช่น Case: Titanium / Black Titanium
 * คนละรูปกัน — ตัวเลือกที่ไม่ตั้งรูปจะ fallback ไปใช้รูปสินค้าหลักของรุ่น (imageUrl)
 * รูปถูกเก็บที่ attributeModifiers[key].options[i].imageUrl และถูกฝังลง variants
 * ที่ generate ตอน save (ดู resolveOptionImage ใน variantGenerator.ts)
 */

interface OptionImageEditorProps {
  editingItem: any;
  onEditingItemChange: (item: any) => void;
}

const OptionImageRow: React.FC<{
  value: string;
  imageUrl?: string;
  fallbackUrl?: string;
  onChange: (url: string) => void;
}> = ({ value, imageUrl, fallbackUrl, onChange }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImageToFirebase(file, 'product-images');
      onChange(url);
      toast.success(`ตั้งรูปของ "${value}" สำเร็จ`);
    } catch (err: any) {
      toast.error(err.message || 'อัพโหลดรูปไม่สำเร็จ');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const shownUrl = imageUrl || fallbackUrl;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-10 h-10 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
        {shownUrl
          ? <img src={shownUrl} alt={value} className={`max-h-full p-0.5 object-contain ${imageUrl ? '' : 'opacity-30'}`} />
          : <ImageIcon size={16} className="text-slate-300" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-700 truncate">{value}</div>
        <div className="text-[10px] font-medium text-slate-400 truncate">
          {imageUrl ? 'รูปเฉพาะตัวเลือกนี้' : 'ใช้รูปสินค้าหลัก (default)'}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        title="อัพโหลดรูปของตัวเลือกนี้"
        className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100 hover:bg-blue-600 hover:text-white transition-colors disabled:opacity-50 shrink-0"
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
      </button>
      {imageUrl && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="ลบรูป — กลับไปใช้รูปสินค้าหลัก"
          className="p-2 bg-slate-50 text-slate-400 rounded-lg border border-slate-200 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export const OptionImageEditor: React.FC<OptionImageEditorProps> = ({
  editingItem,
  onEditingItemChange,
}) => {
  const schema: any[] = editingItem.attributesSchema || [];
  const modifiers: Record<string, { options: any[] }> = editingItem.attributeModifiers || {};

  // เอาเฉพาะ attribute ที่มีตัวเลือก (ค่าไม่ว่าง) ให้ตั้งรูปได้
  const attrsWithOptions = schema.filter(
    attr => (modifiers[attr.key]?.options || []).some((o: any) => (o.value || '').trim() !== '')
  );
  if (attrsWithOptions.length === 0) return null;

  const setOptionImage = (attrKey: string, optIdx: number, url: string) => {
    const mods = { ...modifiers };
    const opts = [...(mods[attrKey]?.options || [])];
    const next: any = { ...opts[optIdx] };
    // ลบ key ทิ้งเมื่อเคลียร์ — Firebase update() ไม่รับ undefined และไม่อยากเก็บ '' ค้าง
    if (url) next.imageUrl = url;
    else delete next.imageUrl;
    opts[optIdx] = next;
    mods[attrKey] = { options: opts };
    onEditingItemChange({ ...editingItem, attributeModifiers: mods });
  };

  return (
    <div>
      <label className="text-xs font-bold text-slate-500 mb-1.5 block">รูปตามตัวเลือก (Option Images)</label>
      <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 space-y-2">
        {attrsWithOptions.map(attr => (
          <div key={attr.key}>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{attr.label}</div>
            <div className="divide-y divide-slate-100">
              {(modifiers[attr.key]?.options || []).map((opt: any, idx: number) => {
                if ((opt.value || '').trim() === '') return null;
                return (
                  <OptionImageRow
                    key={`${opt.value}-${idx}`}
                    value={opt.value}
                    imageUrl={opt.imageUrl}
                    fallbackUrl={editingItem.imageUrl}
                    onChange={(url) => setOptionImage(attr.key, idx, url)}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <p className="text-[10px] text-slate-400 font-medium pt-1">
          ตั้งรูปเฉพาะตัวเลือกที่หน้าตาต่างกัน เช่น Titanium / Black Titanium — ตัวเลือกที่ไม่ตั้งจะใช้รูปสินค้าหลักอัตโนมัติ
        </p>
      </div>
    </div>
  );
};

export default OptionImageEditor;
