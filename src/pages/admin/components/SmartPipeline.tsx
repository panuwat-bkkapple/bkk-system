import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export const SmartPipeline = ({ job }: { job: any }) => {
  const s = String(job?.status || '').toLowerCase();
  let currentStep = 0;

  const hasBeenPaid = !!job?.paid_at || !!job?.payment_slip ||
    ['paid', 'payment completed', 'deal closed', 'sent to qc lab', 'in stock', 'waiting for handover'].includes(s) ||
    job?.qc_logs?.some((l: any) => ['paid', 'payment completed'].includes(l.action?.toLowerCase()));

  if (['cancelled', 'closed (lost)', 'returned'].includes(s)) currentStep = 0;
  else if (hasBeenPaid || ['payout processing', 'waiting for finance'].includes(s)) currentStep = 4;
  else if (['being inspected', 'pending qc', 'qc review', 'revised offer', 'negotiation'].includes(s)) currentStep = 3;
  else if (['active leads', 'arrived', 'in-transit', 'accepted'].includes(s)) currentStep = 2;
  else if (['new lead', 'following up', 'appointment set'].includes(s)) currentStep = 1;

  const steps = [
    { num: 1, label: 'SALES & DEAL' },
    { num: 2, label: 'LOGISTICS' },
    { num: 3, label: 'INSPECTION' },
    { num: 4, label: 'FINANCE & QC' }
  ];

  return (
    <div className="flex items-start justify-between w-full pt-2 pb-8">
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.num;
        const isActive = currentStep === step.num;

        return (
          <React.Fragment key={step.num}>
            <div className="relative flex flex-col items-center z-10 shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300 ${isCompleted ? 'bg-emerald-500 text-white' : isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 ring-4 ring-blue-50' : 'bg-slate-100 text-slate-300'}`}>
                {isCompleted ? <CheckCircle2 size={16} /> : step.num}
              </div>
              <span className={`absolute top-10 text-[8px] w-20 text-center font-black uppercase tracking-widest ${isActive ? 'text-blue-600' : isCompleted ? 'text-emerald-600' : 'text-slate-300'}`}>
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className="flex-1 h-[2px] mx-2 bg-slate-200 relative mt-4">
                <div className={`absolute top-0 left-0 h-full bg-emerald-500 transition-all duration-500 ${isCompleted ? 'w-full' : 'w-0'}`}></div>
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  );
};