// src/components/StatusBadge.tsx
import React from 'react';

export const StatusBadge = ({ status }: { status: string }) => {
  const config: Record<string, { label: string; color: string }> = {
    'Active Leads': { label: 'Active Leads', color: 'bg-blue-100 text-blue-700' },
    'In-Transit': { label: 'In-Transit', color: 'bg-indigo-100 text-indigo-700' },
    'Delivered': { label: 'Delivered', color: 'bg-teal-100 text-teal-700' },
    'Being Inspected': { label: 'Being Inspected', color: 'bg-amber-100 text-amber-700' },
    'Revised Offer': { label: 'Revised Offer', color: 'bg-orange-100 text-orange-700' },
    'Seller Accepted': { label: 'Seller Accepted', color: 'bg-emerald-100 text-emerald-700' },
    'Payout Processing': { label: 'Payout Processing', color: 'bg-purple-100 text-purple-700' },
    'Completed': { label: 'Completed', color: 'bg-green-100 text-green-700' },
    'Returned': { label: 'Returned', color: 'bg-red-100 text-red-700' },
    'Cancelled': { label: 'Cancelled', color: 'bg-gray-100 text-gray-700' },
  };

  const current = config[status] || { label: status, color: 'bg-gray-100 text-gray-600' };

  return (
    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${current.color}`}>
      {current.label}
    </span>
  );
};