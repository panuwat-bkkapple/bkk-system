import React from 'react';
import {
  Smartphone, Tablet, Laptop, Watch, Camera, Gamepad2, Headphones,
  Monitor, Speaker, Keyboard, Mouse, HardDrive, Cpu, Package,
  type LucideIcon,
} from 'lucide-react';

// Icon registry for product categories. The `icon` field stored on a
// product_categories record is a key into this map; the customer frontend
// mirrors the same key set so both surfaces render the same glyph.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  watch: Watch,
  camera: Camera,
  gamepad: Gamepad2,
  headphones: Headphones,
  monitor: Monitor,
  speaker: Speaker,
  keyboard: Keyboard,
  mouse: Mouse,
  harddrive: HardDrive,
  cpu: Cpu,
  package: Package,
};

export const CATEGORY_ICON_KEYS: string[] = Object.keys(CATEGORY_ICONS);

// Returns the icon element for a given key, falling back to Package when the
// key is unknown or missing.
export function getCategoryIcon(key?: string, size: number = 18): JSX.Element {
  const Icon = (key && CATEGORY_ICONS[key]) || Package;
  return <Icon size={size} />;
}
