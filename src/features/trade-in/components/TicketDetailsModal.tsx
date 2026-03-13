// src/features/trade-in/components/modal/TicketDetailsModal.tsx
import React, { useState } from 'react';
import { B2BManager } from './b2b/B2BManager';
import { B2CWorkspace } from './b2c/B2CWorkspace'; // 🌟 ใช้ Workspace แทน Manager
import { InternalQCModal } from './qc/InternalQCModal';
import { AdminChatBox } from '@/components/Fleet/AdminChatBox';
import { useDatabase } from '@/hooks/useDatabase';

export const TicketDetailsModal = ({ job, onClose, onUpdateStatus, onClaimTicket, onSaveNotes, onReviseOffer }: any) => {
  const { data: basePricing } = useDatabase('base_pricing');
  const { data: modelsData } = useDatabase('models');
  const { data: conditionSets } = useDatabase('settings/condition_sets');
  
  const [isQCModalOpen, setIsQCModalOpen] = useState(false);
  const [activeChatJobId, setActiveChatJobId] = useState<string | null>(null);

  if (!job) return null;
  const isB2B = job.type === 'B2B Trade-in';

  return (
    // 🌟 เปลี่ยนจาก div ธรรมดาเป็น fixed inset-0 เพื่อให้ Workspace ทับหน้า Dashboard เดิมทั้งหมด
    <div className="fixed inset-0 z-[100] bg-white overflow-hidden">
      {isB2B ? (
        <B2BManager 
          job={job} onUpdateStatus={onUpdateStatus} onClose={onClose} basePricing={basePricing as any[]} 
        />
      ) : (
        <B2CWorkspace 
          job={job} 
          onUpdateStatus={onUpdateStatus} 
          onClaimTicket={onClaimTicket} 
          onSaveNotes={onSaveNotes} 
          onReviseOffer={onReviseOffer} 
          setIsInspectionModalOpen={setIsQCModalOpen} 
          setActiveChatJobId={setActiveChatJobId}
          onClose={onClose} // 🌟 ตรวจสอบว่าใน B2CWorkspace มีการเรียก onClose เมื่อกดปุ่ม Back
        />
      )}

      {/* 🌟 QC Modal ต้องมี z-index สูงกว่า Workspace (เช่น z-[110]) */}
      <div className="relative z-[110]">
        <InternalQCModal 
          isOpen={isQCModalOpen} 
          onClose={() => setIsQCModalOpen(false)} 
          job={job} 
          modelsData={modelsData as any[]} 
          conditionSets={conditionSets as any[]} 
        />
      </div>
      
      {/* Floating Chat Modal */}
      {activeChatJobId && (
        <div className="fixed inset-0 z-[120]">
          <AdminChatBox jobId={activeChatJobId} onClose={() => setActiveChatJobId(null)} adminName={job.agent_name || "Admin"} />
        </div>
      )}
    </div>
  );
};