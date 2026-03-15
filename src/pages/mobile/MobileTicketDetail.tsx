import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, update, push } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Phone, MapPin, Truck, Store, Mail, Clock, User, Package,
  MessageSquare, Send, ChevronDown, ChevronUp, DollarSign,
  ClipboardCheck, AlertTriangle, CheckCircle2, XCircle,
  Image as ImageIcon, RefreshCw, FileText
} from 'lucide-react';
import { uploadImageToFirebase } from '../../utils/uploadImage';
import { useToast } from '../../components/ui/ToastProvider';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  'New Lead':          'bg-blue-100 text-blue-700',
  'New B2B Lead':      'bg-indigo-100 text-indigo-700',
  'Following Up':      'bg-amber-100 text-amber-700',
  'Appointment Set':   'bg-cyan-100 text-cyan-700',
  'Active Leads':      'bg-orange-100 text-orange-700',
  'Assigned':          'bg-violet-100 text-violet-700',
  'In-Transit':        'bg-yellow-100 text-yellow-700',
  'Being Inspected':   'bg-purple-100 text-purple-700',
  'Pending QC':        'bg-pink-100 text-pink-700',
  'Revised Offer':     'bg-rose-100 text-rose-700',
  'Negotiation':       'bg-red-100 text-red-700',
  'Payout Processing': 'bg-emerald-100 text-emerald-700',
  'Paid':              'bg-green-100 text-green-700',
  'PAID':              'bg-green-100 text-green-700',
  'In Stock':          'bg-slate-100 text-slate-700',
  'Cancelled':         'bg-gray-100 text-gray-500',
  'Closed (Lost)':     'bg-gray-100 text-gray-500',
  'Returned':          'bg-gray-100 text-gray-500',
};

const METHOD_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  'Pickup':   { icon: <Truck size={14} />, color: 'bg-blue-100 text-blue-600' },
  'Store-in': { icon: <Store size={14} />, color: 'bg-purple-100 text-purple-600' },
  'Mail-in':  { icon: <Mail size={14} />, color: 'bg-orange-100 text-orange-600' },
};

// Pipeline steps
const PIPELINE = [
  { label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off'] },
  { label: 'รับเครื่อง', statuses: ['Active Leads', 'Assigned', 'Arrived', 'In-Transit'] },
  { label: 'ตรวจสอบ', statuses: ['Being Inspected', 'Pending QC', 'QC Review', 'Revised Offer', 'Negotiation'] },
  { label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID', 'In Stock', 'Completed'] },
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const MobileTicketDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const currentUser = useMemo(() => {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  }, []);

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showActions, setShowActions] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Load job
  useEffect(() => {
    if (!id) return;
    const unsub = onValue(ref(db, `jobs/${id}`), (snap) => {
      if (snap.exists()) setJob({ id: snap.key, ...snap.val() });
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  // Load chat messages
  useEffect(() => {
    if (!id) return;
    const unsub = onValue(ref(db, `jobs/${id}/chats`), (snap) => {
      if (!snap.exists()) { setMessages([]); return; }
      const data = snap.val();
      const list = Object.entries(data)
        .map(([key, val]: [string, any]) => ({ key, ...val }))
        .sort((a: any, b: any) => a.timestamp - b.timestamp);
      setMessages(list);

      // Count unread from rider
      const unread = Object.values(data).filter((m: any) => m.sender === 'rider' && !m.read).length;
      setUnreadCount(unread);
    });
    return () => unsub();
  }, [id]);

  // Auto scroll chat
  useEffect(() => {
    if (showChat) chatScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  // Mark chat as read when opened
  useEffect(() => {
    if (!showChat || !id) return;
    messages.forEach((msg) => {
      if (msg.sender === 'rider' && !msg.read) {
        update(ref(db, `jobs/${id}/chats/${msg.key}`), { read: true });
      }
    });
  }, [showChat, messages, id]);

  if (loading) return <div className="flex items-center justify-center h-full"><RefreshCw size={24} className="animate-spin text-slate-400" /></div>;
  if (!job) return <div className="flex items-center justify-center h-full text-red-500 font-bold">ไม่พบข้อมูลงาน</div>;

  const isCancelled = ['cancelled', 'closed (lost)', 'returned'].includes((job.status || '').toLowerCase());
  const basePrice = Number(job.final_price || job.price || 0);
  const pickupFee = job.receive_method === 'Pickup' ? Number(job.pickup_fee || 0) : 0;
  const couponValue = Number(job.applied_coupon?.value || 0);
  const netPayout = Math.max(0, basePrice - pickupFee + couponValue);

  // Pipeline progress
  const currentStepIdx = PIPELINE.findIndex((step) => step.statuses.includes(job.status));

  const makeLog = (action: string, details: string) => ({
    action, details, by: currentUser?.name || 'Admin', timestamp: Date.now()
  });

  // Actions
  const handleCall = () => {
    if (!job.cust_phone) { toast.warning('ไม่พบเบอร์โทร'); return; }
    window.location.href = `tel:${job.cust_phone}`;
  };

  const handleClaim = async () => {
    const next = job.status === 'New Lead' ? 'Following Up' : job.status;
    await update(ref(db, `jobs/${job.id}`), {
      agent_name: currentUser?.name || 'Admin',
      agent_id: currentUser?.uid || 'admin',
      status: next, is_read: true,
      qc_logs: [makeLog('Claimed Ticket', 'รับเคสผ่าน Mobile'), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
    toast.success('รับเคสสำเร็จ');
    setShowActions(false);
  };

  const handleUpdateStatus = async (newStatus: string, details: string) => {
    await update(ref(db, `jobs/${job.id}`), {
      status: newStatus,
      qc_logs: [makeLog(newStatus, details), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
    toast.success(`อัพเดทเป็น ${newStatus}`);
    setShowActions(false);
  };

  // Chat handlers
  const handleSendChat = async () => {
    if (!chatInput.trim() || !id) return;
    const text = chatInput.trim();
    setChatInput('');
    await push(ref(db, `jobs/${id}/chats`), {
      sender: 'admin',
      senderName: currentUser?.name || 'Admin',
      text, timestamp: Date.now(), read: false
    });
  };

  const handleChatImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !id) return;
    setIsUploading(true);
    try {
      const url = await uploadImageToFirebase(e.target.files[0], `jobs/${id}/chats/images`);
      await push(ref(db, `jobs/${id}/chats`), {
        sender: 'admin', senderName: currentUser?.name || 'Admin',
        text: '📷 ส่งรูปภาพ', imageUrl: url,
        timestamp: Date.now(), read: false
      });
    } catch { toast.error('อัปโหลดรูปไม่สำเร็จ'); }
    finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Available quick actions based on status
  const quickActions = getQuickActions(job.status, isCancelled);

  return (
    <div className="h-full flex flex-col">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">

          {/* === Device Info Card === */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-black text-slate-800">{job.model || 'ไม่ระบุรุ่น'}</h2>
                <p className="text-xs text-slate-400 font-bold">{job.ref_no || `#${(job.id || '').slice(-6)}`}</p>
              </div>
              <div className="flex items-center gap-2">
                {job.receive_method && METHOD_CONFIG[job.receive_method] && (
                  <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${METHOD_CONFIG[job.receive_method].color}`}>
                    {METHOD_CONFIG[job.receive_method].icon}
                    {job.receive_method}
                  </span>
                )}
              </div>
            </div>

            {/* Status badge */}
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[job.status] || 'bg-slate-100 text-slate-600'}`}>
              {job.status}
            </span>

            {/* Pipeline */}
            <div className="flex items-center gap-1 mt-4">
              {PIPELINE.map((step, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`h-1.5 w-full rounded-full ${
                    i <= currentStepIdx ? 'bg-blue-500' :
                    isCancelled ? 'bg-red-200' : 'bg-slate-200'
                  }`} />
                  <span className={`text-[9px] font-bold ${
                    i <= currentStepIdx ? 'text-blue-600' : 'text-slate-400'
                  }`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* === Price Summary Card === */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={16} className="text-emerald-500" />
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">ราคา</h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">ราคาเครื่อง</span>
                <span className="font-bold text-slate-800">฿{basePrice.toLocaleString()}</span>
              </div>
              {pickupFee > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">ค่าไรเดอร์</span>
                  <span className="font-bold text-red-500">-฿{pickupFee.toLocaleString()}</span>
                </div>
              )}
              {couponValue > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">คูปอง ({job.applied_coupon?.code})</span>
                  <span className="font-bold text-green-500">+฿{couponValue.toLocaleString()}</span>
                </div>
              )}
              <div className="border-t border-slate-100 pt-2 flex justify-between">
                <span className="text-sm font-bold text-slate-600">ยอดโอนลูกค้า</span>
                <span className="text-lg font-black text-emerald-600">฿{netPayout.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* === Customer Info Card === */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <User size={16} className="text-blue-500" />
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">ข้อมูลลูกค้า</h3>
            </div>
            <div className="space-y-2.5">
              {job.cust_name && (
                <div className="flex items-center gap-2 text-sm">
                  <User size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-700">{job.cust_name}</span>
                </div>
              )}
              {job.cust_phone && (
                <button onClick={handleCall} className="flex items-center gap-2 text-sm text-blue-600">
                  <Phone size={14} className="shrink-0" />
                  <span className="underline">{job.cust_phone}</span>
                </button>
              )}
              {(job.cust_address || job.store_branch) && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-600">{job.cust_address || job.store_branch}</span>
                </div>
              )}
              {job.agent_name && (
                <div className="flex items-center gap-2 text-sm">
                  <ClipboardCheck size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-600">ผู้รับผิดชอบ: <b>{job.agent_name}</b></span>
                </div>
              )}
              {job.pickup_schedule && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-600">
                    นัดหมาย: {job.pickup_schedule.date || ''} {job.pickup_schedule.time || ''}
                    {job.pickup_schedule.type === 'instant' && ' (ด่วน)'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* === Device Details (if available) === */}
          {job.devices && job.devices.length > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Package size={16} className="text-purple-500" />
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                  รายละเอียดเครื่อง ({job.devices.length})
                </h3>
              </div>
              <div className="space-y-3">
                {job.devices.map((dev: any, i: number) => (
                  <div key={i} className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="font-bold text-slate-700">{dev.model || dev.brand || `เครื่อง #${i + 1}`}</span>
                      {dev.price && <span className="font-bold text-emerald-600">฿{Number(dev.price).toLocaleString()}</span>}
                    </div>
                    {dev.grade && <p className="text-xs text-slate-500">เกรด: {dev.grade}</p>}
                    {dev.serial && <p className="text-xs text-slate-400">SN: {dev.serial}</p>}
                    {dev.storage && <p className="text-xs text-slate-400">ความจุ: {dev.storage}</p>}
                    {dev.color && <p className="text-xs text-slate-400">สี: {dev.color}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* === Activity Log (collapsible) === */}
          {job.qc_logs && job.qc_logs.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="w-full flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-slate-400" />
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                    ประวัติ ({job.qc_logs.length})
                  </h3>
                </div>
                {showLogs ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>
              {showLogs && (
                <div className="px-4 pb-4 space-y-2 max-h-64 overflow-y-auto">
                  {job.qc_logs.map((log: any, i: number) => (
                    <div key={i} className="flex gap-3 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-700">{log.action}</p>
                        {log.details && <p className="text-slate-500">{log.details}</p>}
                        <p className="text-slate-400 mt-0.5">
                          {log.by} · {new Date(log.timestamp).toLocaleString('th-TH')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* === Quick Actions === */}
          {!isCancelled && quickActions.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowActions(!showActions)}
                className="w-full flex items-center justify-between p-4"
              >
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                  ดำเนินการ
                </h3>
                {showActions ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>
              {showActions && (
                <div className="px-4 pb-4 space-y-2">
                  {!job.agent_name && (
                    <button
                      onClick={handleClaim}
                      className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold"
                    >
                      รับเคสนี้ (Claim)
                    </button>
                  )}
                  {quickActions.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => handleUpdateStatus(action.status, action.log)}
                      className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${action.style}`}
                    >
                      {action.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      if (confirm('ยืนยันยกเลิกงานนี้?')) {
                        const reason = prompt('เหตุผลที่ยกเลิก:');
                        if (reason) {
                          update(ref(db, `jobs/${job.id}`), {
                            status: 'Cancelled', cancel_reason: reason,
                            qc_logs: [makeLog('Cancelled', `ยกเลิก: ${reason}`), ...(job.qc_logs || [])],
                            updated_at: Date.now()
                          });
                          toast.success('ยกเลิกงานแล้ว');
                          setShowActions(false);
                        }
                      }
                    }}
                    className="w-full py-3 rounded-xl text-sm font-bold border border-red-200 text-red-500 bg-red-50"
                  >
                    ยกเลิกงาน
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Spacer for bottom bar */}
          <div className="h-20" />
        </div>
      </div>

      {/* === Bottom Action Bar === */}
      <div className="shrink-0 bg-white border-t border-slate-200 p-3 flex gap-2 safe-bottom">
        <button
          onClick={handleCall}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-500 text-white rounded-xl font-bold text-sm"
        >
          <Phone size={18} /> โทร
        </button>
        <button
          onClick={() => setShowChat(true)}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm relative"
        >
          <MessageSquare size={18} /> แชท
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-5 h-5 rounded-full flex items-center justify-center font-black">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* === Chat Modal (fullscreen on mobile) === */}
      {showChat && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col safe-top safe-bottom">
          {/* Chat Header */}
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg"><MessageSquare size={16} /></div>
              <div>
                <h3 className="text-sm font-bold">{job.model}</h3>
                <p className="text-[10px] text-slate-400">{job.ref_no || `#${(job.id || '').slice(-6)}`}</p>
              </div>
            </div>
            <button onClick={() => setShowChat(false)} className="p-2 hover:bg-slate-800 rounded-full">
              <XCircle size={22} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <MessageSquare size={36} className="mx-auto text-slate-200 mb-2" />
                <p className="text-sm font-bold">ยังไม่มีข้อความ</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const isAdmin = msg.sender === 'admin';
              return (
                <div key={i} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                    isAdmin
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-tl-sm shadow-sm'
                  }`}>
                    {!isAdmin && <p className="text-[10px] font-black text-blue-600 mb-1">{msg.senderName}</p>}
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    {msg.imageUrl && (
                      <img
                        src={msg.imageUrl}
                        alt="attachment"
                        className="mt-2 rounded-lg w-full max-h-48 object-cover"
                        onClick={() => window.open(msg.imageUrl, '_blank')}
                      />
                    )}
                    <p className="text-[8px] mt-1 text-right opacity-50">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={chatScrollRef} />
          </div>

          {/* Chat Input */}
          {!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Cancelled'].includes(job.status) ? (
            <div className="p-3 bg-white border-t border-slate-100 flex gap-2 items-center shrink-0">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleChatImage} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-2.5 text-slate-400 hover:text-blue-600 rounded-xl"
              >
                {isUploading ? <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : <ImageIcon size={20} />}
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                placeholder="พิมพ์ข้อความ..."
                className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim()}
                className="p-2.5 bg-blue-600 text-white rounded-xl disabled:bg-slate-200"
              >
                <Send size={18} />
              </button>
            </div>
          ) : (
            <div className="p-4 bg-slate-100 text-center shrink-0">
              <span className="text-xs font-bold text-slate-500">แชทถูกปิดแล้ว (จบงาน)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Quick Actions by Status
// ---------------------------------------------------------------------------

function getQuickActions(status: string, isCancelled: boolean) {
  if (isCancelled) return [];

  const actions: { label: string; status: string; log: string; style: string }[] = [];

  switch (status) {
    case 'New Lead':
      actions.push({ label: 'เริ่มติดตาม (Following Up)', status: 'Following Up', log: 'เริ่มติดตามลูกค้า', style: 'bg-amber-500 text-white' });
      actions.push({ label: 'นัดหมายแล้ว (Appointment Set)', status: 'Appointment Set', log: 'ลูกค้ายืนยันนัดหมาย', style: 'bg-cyan-500 text-white' });
      break;
    case 'Following Up':
      actions.push({ label: 'นัดหมายแล้ว (Appointment Set)', status: 'Appointment Set', log: 'ลูกค้ายืนยันนัดหมาย', style: 'bg-cyan-500 text-white' });
      break;
    case 'Appointment Set':
    case 'Waiting Drop-off':
      actions.push({ label: 'เริ่มดำเนินการ (Active Leads)', status: 'Active Leads', log: 'เริ่มดำเนินการ', style: 'bg-orange-500 text-white' });
      break;
    case 'Active Leads':
    case 'Assigned':
      actions.push({ label: 'กำลังเดินทาง (In-Transit)', status: 'In-Transit', log: 'ไรเดอร์กำลังเดินทาง', style: 'bg-yellow-500 text-white' });
      break;
    case 'In-Transit':
    case 'Arrived':
      actions.push({ label: 'รับเครื่องแล้ว ตรวจสอบ (Being Inspected)', status: 'Being Inspected', log: 'ได้รับเครื่องแล้ว เริ่มตรวจสอบ', style: 'bg-purple-500 text-white' });
      break;
    case 'Being Inspected':
    case 'Pending QC':
    case 'QC Review':
      actions.push({ label: 'ผ่าน QC → Payout', status: 'Payout Processing', log: 'ผ่านการตรวจสอบ ดำเนินการจ่ายเงิน', style: 'bg-emerald-500 text-white' });
      actions.push({ label: 'ต้องเจรจาราคา (Negotiation)', status: 'Negotiation', log: 'ต้องเจรจาราคากับลูกค้า', style: 'bg-red-500 text-white' });
      break;
    case 'Revised Offer':
    case 'Negotiation':
      actions.push({ label: 'ตกลงราคา → Payout', status: 'Payout Processing', log: 'ลูกค้าตกลงราคา เริ่มจ่ายเงิน', style: 'bg-emerald-500 text-white' });
      break;
    case 'Payout Processing':
      actions.push({ label: 'จ่ายเงินแล้ว (Paid)', status: 'Paid', log: 'โอนเงินให้ลูกค้าเรียบร้อย', style: 'bg-green-600 text-white' });
      break;
    case 'Paid':
    case 'PAID':
      actions.push({ label: 'เข้าสต็อก (In Stock)', status: 'In Stock', log: 'นำเข้าสต็อกเรียบร้อย', style: 'bg-slate-700 text-white' });
      break;
  }

  return actions;
}
