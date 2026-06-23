// SCHEMA มาตรฐานระดับ ENTERPRISE

export type AttributeSchemaItem = {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
};

export const CATEGORY_SCHEMAS: Record<string, AttributeSchemaItem[]> = {
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

// Resolve the attribute schema for a category name. Prefers the admin-editable
// schema stored on the /product_categories record; falls back to the hardcoded
// CATEGORY_SCHEMAS default, then to the Smartphones default as a last resort.
export function resolveCategorySchema(categoryName: string, categories: any[]): AttributeSchemaItem[] {
  const record = (categories || []).find((c: any) => c?.name === categoryName);
  if (record && Array.isArray(record.schema) && record.schema.length > 0) {
    return record.schema as AttributeSchemaItem[];
  }
  if (CATEGORY_SCHEMAS[categoryName]) {
    return CATEGORY_SCHEMAS[categoryName];
  }
  return CATEGORY_SCHEMAS['Smartphones'];
}
