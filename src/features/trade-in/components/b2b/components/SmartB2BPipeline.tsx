import React from 'react';
import { CheckCircle2 } from 'lucide-react';

interface SmartB2BPipelineProps {
  status: string;
}

export const SmartB2BPipeline = ({ status }: SmartB2BPipelineProps) => {
  const s = String(status || '').toLowerCase();
  let currentStep = 0;

  if (['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(s)) currentStep = 1;
  else if (['site visit & grading', 'auditor assigned'].includes(s)) currentStep = 2;
  else if (['final quote sent', 'final quote accepted', 'negotiation'].includes(s)) currentStep = 3;
  else if (['po issued', 'waiting for invoice/tax inv.'].includes(s)) currentStep = 4;
  else if (['pending finance approval', 'payment completed'].includes(s)) currentStep = 5;
  else if (['in stock', 'completed'].includes(s)) currentStep = 6;
  else if (['cancelled', 'closed (lost)', 'returned'].includes(s)) currentStep = 0;

  const steps = [
    { num: 1, label: 'PRE-QUOTE' },
    { num: 2, label: 'INSPECT' },
    { num: 3, label: 'FINAL QUOTE' },
    { num: 4, label: 'DOCS' },
    { num: 5, label: 'FINANCE' },
    { num: 6, label: 'COMPLETED' }
  ];

  return (
    <div className="flex items-start justify-between w-full pt-2 pb-6">
       {steps.map((step, index) => {
          const isCompleted = currentStep > step.num;
          const isActive = currentStep === step.num;

          return (
            <React.Fragment key={step.num}>
               <div className="relative flex flex-col items-center z-10 shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300 ${isCompleted ? 'bg-indigo-500 text-white' : isActive ? 'bg-indigo-700 text-white shadow-lg shadow-indigo-200 ring-4 ring-indigo-50' : 'bg-slate-200 text-slate-400'}`}>
                    {isCompleted ? <CheckCircle2 size={16}/> : step.num}
                  </div>
                  <span className={`absolute top-10 text-[8px] w-16 text-center font-black uppercase tracking-widest leading-tight ${isActive ? 'text-indigo-700' : isCompleted ? 'text-indigo-500' : 'text-slate-400'}`}>
                    {step.label}
                  </span>
               </div>
               {index < steps.length - 1 && (
                 <div className="flex-1 h-[2px] mx-1 bg-slate-200 relative mt-4">
                    <div className={`absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-500 ${isCompleted ? 'w-full' : 'w-0'}`}></div>
                 </div>
               )}
            </React.Fragment>
          )
       })}
    </div>
  );
};
