// SCHEMA มาตรฐานระดับ ENTERPRISE
export const CATEGORY_SCHEMAS: Record<string, {key: string, label: string, type: string, options?: string[]}[]> = {
  'Smartphones': [
    { key: 'storage', label: 'Storage (ความจุ)', type: 'text' }
  ],
  'Tablets': [
    { key: 'connectivity', label: 'Network (เครือข่าย)', type: 'select', options: ['Wi-Fi', 'Wi-Fi + Cellular'] },
    { key: 'storage', label: 'Storage (ความจุ)', type: 'text' }
  ],
  'Mac / Laptop': [
    { key: 'processor', label: 'Processor (ชิป)', type: 'text' },
    { key: 'ram', label: 'RAM (หน่วยความจำ)', type: 'text' },
    { key: 'storage', label: 'Storage (ความจุ)', type: 'text' },
    { key: 'display', label: 'Display (จอ)', type: 'select', options: ['Standard Glass', 'Nano-Texture'] }
  ],
  'Smart Watch': [
    { key: 'size', label: 'Size (ขนาด)', type: 'text' },
    { key: 'case_material', label: 'Case (วัสดุ)', type: 'select', options: ['Aluminium', 'Stainless Steel', 'Titanium', 'Black Titanium'] },
    { key: 'connectivity', label: 'Network (ระบบ)', type: 'select', options: ['GPS', 'GPS + Cellular'] }
  ],
  'Camera': [
    { key: 'type', label: 'Type (ประเภท)', type: 'text' }
  ],
  'Game System': [
    { key: 'storage', label: 'Storage / Edition', type: 'text' }
  ]
};
