import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ref, onValue, push, update, serverTimestamp, remove, increment, query, orderByChild, equalTo, limitToLast, get, type DataSnapshot } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Inbox, MessageSquare, Users, Truck, Send, Search,
  Image as ImageIcon, Plus, X, Phone, User, Clock,
  CheckCheck, Check, ArrowLeft, Trash2, MoreVertical,
  Bot, UserCheck, RotateCcw, CheckCircle2, AlertTriangle, Globe, FileText, Pencil, Mail, MapPin, History
} from 'lucide-react';
import { uploadImageToFirebase } from '../../utils/uploadImage';
import { useToast } from '../../components/ui/ToastProvider';
import QuoteComposer from './QuoteComposer';
import ContactEditModal from './ContactEditModal';
import { CustomerTimelineModal } from '../../components/customer/CustomerTimelineModal';

// =============================================================================
// Types
// =============================================================================

// Conversations under inbox/ come from two producers:
//   - the website chat widget (bkk-frontend-next) — keyed by customer uid,
//     carries status/assignment/identity fields written by chatWidgetAiReply
//   - manually created admin chats (NewChatModal) — legacy, no status fields
type ConvoStatus = 'ai' | 'waiting_human' | 'human' | 'resolved';

interface Conversation {
  id: string;
  type: 'customer' | 'rider' | 'team';
  name: string;
  phone?: string;
  avatar?: string;
  lastMessage: string;
  lastMessageAt: number;
  unreadCount: number;
  createdAt: number;
  jobId?: string;
  jobModel?: string;
  status?: ConvoStatus;
  assigned_staff_id?: string;
  assigned_staff_name?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  customer_address?: string;
  phone_source?: 'chat' | 'account' | 'admin';
  identity_confirmed?: boolean;
  identity_confirmed_by?: string;
  source_url?: string;
  matched_orders_count?: number;
  crm_customer_id?: string;
  escalation?: { reason?: string; summary?: string; at?: number; live_summary?: string; live_summary_at?: number };
}

interface Message {
  id: string;
  sender: string;
  senderName: string;
  senderRole: 'admin' | 'customer' | 'rider' | 'team' | 'ai' | 'system';
  kind?: 'text' | 'system';
  text: string;
  imageUrl?: string;
  timestamp: number;
  read: boolean;
}

// Customer-context column (คอลัมน์ที่ 3) — profile mirror of users/{uid}
// (written by the customer website: checkout address form / order submit /
// Google sign-in) + the customer's latest jobs. Read-only context for staff.
interface CustomerProfile {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  id_address?: string;
}

interface RecentJob {
  id: string;
  ref_no?: string;
  model?: string;
  status?: string;
  net_payout?: number;
  created_at?: number;
  cust_name?: string;
  cust_phone?: string;
  cust_email?: string;
  cust_address?: string;
}

type TabType = 'all' | 'customer' | 'rider' | 'team';
type StatusFilter = 'all' | 'waiting_human' | 'ai' | 'human' | 'resolved';

const TAB_CONFIG: { key: TabType; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'all', label: 'ทั้งหมด', icon: <Inbox size={16} />, color: 'blue' },
  { key: 'customer', label: 'ลูกค้า', icon: <User size={16} />, color: 'emerald' },
  { key: 'rider', label: 'ไรเดอร์', icon: <Truck size={16} />, color: 'orange' },
  { key: 'team', label: 'ทีมงาน', icon: <Users size={16} />, color: 'purple' },
];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'ทุกสถานะ' },
  { key: 'waiting_human', label: 'รอเจ้าหน้าที่' },
  { key: 'ai', label: 'AI ดูแล' },
  { key: 'human', label: 'เจ้าหน้าที่ดูแล' },
  { key: 'resolved', label: 'ปิดแล้ว' },
];

const StatusPill = ({ status, assignedName }: { status?: ConvoStatus; assignedName?: string }) => {
  if (!status) return null;
  const config: Record<ConvoStatus, { label: string; cls: string }> = {
    ai: { label: 'AI ดูแล', cls: 'bg-violet-100 text-violet-600' },
    waiting_human: { label: 'รอเจ้าหน้าที่', cls: 'bg-amber-100 text-amber-700' },
    human: { label: assignedName || 'เจ้าหน้าที่', cls: 'bg-blue-100 text-blue-600' },
    resolved: { label: 'ปิดแล้ว', cls: 'bg-emerald-100 text-emerald-600' },
  };
  const c = config[status];
  return (
    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap ${c.cls}`}>
      {c.label}
    </span>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const InboxPage = () => {
  const toast = useToast();
  const location = useLocation();
  const isMobileApp = location.pathname.startsWith('/mobile');
  const currentUser = useMemo(() => {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  }, []);

  const staffId: string = currentUser?.uid || currentUser?.id || 'admin';
  const staffName: string = currentUser?.name || 'Admin';

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showQuoteComposer, setShowQuoteComposer] = useState(false);
  const [showContactEdit, setShowContactEdit] = useState(false);
  const [showCustomerTimeline, setShowCustomerTimeline] = useState(false);
  // คอลัมน์ที่ 3 — customer context ของแชทเว็บ (key = uid ลูกค้า)
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Load conversations
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const convoRef = ref(db, 'inbox');
    const unsub = onValue(convoRef, (snapshot) => {
      if (!snapshot.exists()) {
        setConversations([]);
        return;
      }
      const data = snapshot.val();
      const list: Conversation[] = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        type: val.type || 'customer',
        name: val.name || 'ไม่ระบุชื่อ',
        phone: val.phone,
        avatar: val.avatar,
        lastMessage: val.lastMessage || '',
        lastMessageAt: val.lastMessageAt || val.createdAt || 0,
        unreadCount: val.unreadCount || 0,
        createdAt: val.createdAt || 0,
        jobId: val.jobId,
        jobModel: val.jobModel,
        status: val.status,
        assigned_staff_id: val.assigned_staff_id,
        assigned_staff_name: val.assigned_staff_name,
        customer_name: val.customer_name,
        customer_phone: val.customer_phone,
        customer_email: val.customer_email,
        customer_address: val.customer_address,
        phone_source: val.phone_source,
        identity_confirmed: val.identity_confirmed,
        identity_confirmed_by: val.identity_confirmed_by,
        source_url: val.source_url,
        matched_orders_count: val.matched_orders_count,
        crm_customer_id: val.crm_customer_id,
        escalation: val.escalation,
      }));
      list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      setConversations(list);
    });
    return () => unsub();
  }, []);

  // ---------------------------------------------------------------------------
  // Load messages for selected conversation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedConvo) {
      setMessages([]);
      return;
    }
    const msgRef = ref(db, `inbox/${selectedConvo}/messages`);
    const unsub = onValue(msgRef, (snapshot) => {
      if (!snapshot.exists()) {
        setMessages([]);
        return;
      }
      const data = snapshot.val();
      const list: Message[] = Object.entries(data)
        .map(([id, val]: [string, any]) => ({
          id,
          sender: val.sender || '',
          senderName: val.senderName || '',
          senderRole: val.senderRole || 'admin',
          kind: val.kind || 'text',
          text: val.text || '',
          imageUrl: val.imageUrl,
          timestamp: val.timestamp || 0,
          read: val.read || false,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
      setMessages(list);

      // Mark messages as read (customer sees "อ่านแล้ว" on their bubbles)
      Object.entries(data).forEach(([key, val]: [string, any]) => {
        if (val.senderRole !== 'admin' && val.senderRole !== 'system' && !val.read) {
          update(ref(db, `inbox/${selectedConvo}/messages/${key}`), { read: true });
        }
      });
      // Reset unread count
      update(ref(db, `inbox/${selectedConvo}`), { unreadCount: 0 });
    });
    return () => unsub();
  }, [selectedConvo]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ---------------------------------------------------------------------------
  // Filter conversations
  // ---------------------------------------------------------------------------
  const filteredConversations = useMemo(() => {
    let list = conversations;
    if (activeTab !== 'all') {
      list = list.filter((c) => c.type === activeTab);
    }
    if (statusFilter !== 'all') {
      list = list.filter((c) => c.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone?.includes(q) ||
          c.lastMessage.toLowerCase().includes(q)
      );
    }
    return list;
  }, [conversations, activeTab, statusFilter, searchQuery]);

  const selectedConversation = conversations.find((c) => c.id === selectedConvo);

  // ---- Customer context (คอลัมน์ที่ 3): users/{uid} profile + latest jobs ----
  // เฉพาะแชทจากเว็บ (มี status = key เป็น uid ลูกค้า) — แชท legacy ไม่มี uid
  const isWebsiteChat = !!selectedConversation?.status;
  useEffect(() => {
    setProfile(null);
    setRecentJobs([]);
    if (!selectedConvo || !isWebsiteChat) return;
    const unsub = onValue(
      ref(db, `users/${selectedConvo}`),
      (snap) => {
        const u = snap.val();
        setProfile(
          u
            ? { name: u.name, phone: u.phone, email: u.email, address: u.address, id_address: u.id_address }
            : null
        );
      },
      () => setProfile(null)
    );
    // Orders for this person come from TWO joins, merged: by uid (the account's
    // own self-checkout orders) AND by crm_customer_id (the CRM contact — this
    // is what surfaces ADMIN-created orders, which carry no customer uid). The
    // contact pointer is set on the conversation by save_customer_info / the
    // admin re-link. Dedup by job id.
    const crmId = selectedConversation?.crm_customer_id;
    const byId: Record<string, RecentJob> = {};
    const collect = (snap: DataSnapshot) => {
      snap.forEach((j) => {
        const v = j.val() || {};
        byId[j.key as string] = {
          id: j.key as string,
          ref_no: v.ref_no,
          model: v.model,
          status: v.status,
          net_payout: v.net_payout,
          created_at: v.created_at,
          cust_name: v.cust_name,
          cust_phone: v.cust_phone,
          cust_email: v.cust_email,
          cust_address: v.cust_address,
        };
      });
    };
    Promise.all([
      get(query(ref(db, 'jobs'), orderByChild('uid'), equalTo(selectedConvo), limitToLast(5))).then(collect).catch(() => {}),
      crmId
        ? get(query(ref(db, 'jobs'), orderByChild('crm_customer_id'), equalTo(crmId), limitToLast(5))).then(collect).catch(() => {})
        : Promise.resolve(),
    ]).then(() => {
      const merged = Object.values(byId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      setRecentJobs(merged.slice(0, 5));
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConvo, isWebsiteChat, selectedConversation?.crm_customer_id]);

  // ข้อมูลติดต่อแบบ merged — ลำดับความน่าเชื่อ: ที่แอดมิน/ระบบเขียนไว้บนแชท >
  // โปรไฟล์บัญชี (ลูกค้ากรอกเองที่ checkout) > ออเดอร์ล่าสุด
  const latestJob = recentJobs[0];
  const contact = {
    name:
      selectedConversation?.customer_name || profile?.name || latestJob?.cust_name || selectedConversation?.name || '',
    phone: selectedConversation?.customer_phone || profile?.phone || latestJob?.cust_phone || '',
    email: selectedConversation?.customer_email || profile?.email || latestJob?.cust_email || '',
    address:
      selectedConversation?.customer_address || profile?.address || latestJob?.cust_address || profile?.id_address || '',
  };

  // บทสนทนาอื่นของลูกค้าคนเดียวกัน (join ด้วยเบอร์ normalize 0xxxxxxxx)
  // — inbox ผูกด้วย uid คนละ session/uid จึงเป็นคนละแชท แต่เบอร์เดียวกัน = คนเดียวกัน
  const linkedConvos = useMemo(() => {
    const norm = (s?: string) => {
      let d = (s || '').replace(/\D/g, '');
      if (d.startsWith('66')) d = '0' + d.slice(2);
      return d;
    };
    const cur = norm(selectedConversation?.customer_phone || selectedConversation?.phone);
    if (!cur || cur.length < 9) return [];
    return conversations
      .filter((c) => c.id !== selectedConvo && norm(c.customer_phone || c.phone) === cur)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [conversations, selectedConversation, selectedConvo]);

  // ---------------------------------------------------------------------------
  // Unread counts per tab
  // ---------------------------------------------------------------------------
  const unreadCounts = useMemo(() => {
    const counts = { all: 0, customer: 0, rider: 0, team: 0 };
    conversations.forEach((c) => {
      if (c.unreadCount > 0) {
        counts.all += c.unreadCount;
        counts[c.type] += c.unreadCount;
      }
    });
    return counts;
  }, [conversations]);

  // ---------------------------------------------------------------------------
  // Console actions: takeover / return to AI / resolve
  // The AI responder (chatWidgetAiReply) goes silent whenever status is
  // 'human' — taking over is what mutes it, handing back re-arms it.
  // ---------------------------------------------------------------------------
  const writeSystemMessage = async (convoId: string, text: string) => {
    await push(ref(db, `inbox/${convoId}/messages`), {
      sender: 'system',
      senderRole: 'system',
      kind: 'system',
      text,
      timestamp: Date.now(),
      read: true,
    });
  };

  const handleTakeover = async () => {
    if (!selectedConvo) return;
    try {
      await update(ref(db, `inbox/${selectedConvo}`), {
        status: 'human',
        assigned_staff_id: staffId,
        assigned_staff_name: staffName,
        ai_typing: false,
      });
      await writeSystemMessage(selectedConvo, `${staffName} เข้าร่วมการสนทนา`);
      await update(ref(db, `inbox/${selectedConvo}`), { customer_unread: increment(1) });
      toast.success('รับเรื่องแล้ว');
    } catch {
      toast.error('รับเรื่องไม่สำเร็จ');
    }
  };

  const handleReturnToAi = async () => {
    if (!selectedConvo) return;
    try {
      await update(ref(db, `inbox/${selectedConvo}`), {
        status: 'ai',
        assigned_staff_id: null,
        assigned_staff_name: null,
      });
      await writeSystemMessage(selectedConvo, 'ส่งกลับให้ผู้ช่วย AI ดูแลต่อ');
      toast.success('ส่งกลับให้ AI แล้ว');
    } catch {
      toast.error('ดำเนินการไม่สำเร็จ');
    }
  };

  const handleResolve = async () => {
    if (!selectedConvo) return;
    try {
      await update(ref(db, `inbox/${selectedConvo}`), {
        status: 'resolved',
        assigned_staff_id: null,
        assigned_staff_name: null,
      });
      await writeSystemMessage(selectedConvo, 'เจ้าหน้าที่ปิดการสนทนา หากมีคำถามเพิ่มเติมทักมาได้เลย');
      await update(ref(db, `inbox/${selectedConvo}`), { customer_unread: increment(1) });
      toast.success('ปิดการสนทนาแล้ว');
    } catch {
      toast.error('ปิดการสนทนาไม่สำเร็จ');
    }
  };

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  const handleSend = async () => {
    if (!inputText.trim() || !selectedConvo) return;
    const text = inputText.trim();
    setInputText('');
    try {
      // Replying to a widget conversation the AI still owns = implicit
      // takeover, so the AI stops answering mid-thread.
      const convo = conversations.find((c) => c.id === selectedConvo);
      const isWidgetConvo = !!convo?.status;
      if (isWidgetConvo && (convo?.status !== 'human' || convo?.assigned_staff_id !== staffId)) {
        await update(ref(db, `inbox/${selectedConvo}`), {
          status: 'human',
          assigned_staff_id: staffId,
          assigned_staff_name: staffName,
          ai_typing: false,
        });
      }
      await push(ref(db, `inbox/${selectedConvo}/messages`), {
        sender: staffId,
        senderName: staffName,
        senderRole: 'admin',
        kind: 'text',
        text,
        timestamp: Date.now(),
        read: false,
      });
      const updates: Record<string, unknown> = {
        lastMessage: text,
        lastMessageAt: Date.now(),
      };
      if (isWidgetConvo) updates.customer_unread = increment(1);
      await update(ref(db, `inbox/${selectedConvo}`), updates);
    } catch {
      toast.error('ส่งข้อความไม่สำเร็จ');
    }
  };

  // ---------------------------------------------------------------------------
  // Send image
  // ---------------------------------------------------------------------------
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedConvo) return;
    const file = e.target.files[0];
    setIsUploading(true);
    try {
      const imageUrl = await uploadImageToFirebase(file, `inbox/${selectedConvo}/images`);
      await push(ref(db, `inbox/${selectedConvo}/messages`), {
        sender: currentUser?.uid || 'admin',
        senderName: currentUser?.name || 'Admin',
        senderRole: 'admin',
        text: '📷 ส่งรูปภาพ',
        imageUrl,
        timestamp: Date.now(),
        read: false,
      });
      await update(ref(db, `inbox/${selectedConvo}`), {
        lastMessage: '📷 ส่งรูปภาพ',
        lastMessageAt: Date.now(),
      });
    } catch {
      toast.error('ไม่สามารถอัปโหลดรูปภาพได้');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ---------------------------------------------------------------------------
  // Create new conversation
  // ---------------------------------------------------------------------------
  const handleCreateConvo = async (type: 'customer' | 'rider' | 'team', name: string, phone?: string) => {
    if (!name.trim()) return;
    try {
      const newRef = push(ref(db, 'inbox'));
      await update(newRef, {
        type,
        name: name.trim(),
        phone: phone?.trim() || null,
        lastMessage: '',
        lastMessageAt: Date.now(),
        unreadCount: 0,
        createdAt: Date.now(),
      });
      setSelectedConvo(newRef.key);
      setShowNewChat(false);
      setShowMobileChat(true);
      toast.success('สร้างแชทใหม่สำเร็จ');
    } catch {
      toast.error('ไม่สามารถสร้างแชทได้');
    }
  };

  // ---------------------------------------------------------------------------
  // Delete conversation
  // ---------------------------------------------------------------------------
  const handleDeleteConvo = async () => {
    if (!selectedConvo) return;
    if (!window.confirm('ต้องการลบการสนทนานี้หรือไม่?')) return;
    try {
      await remove(ref(db, `inbox/${selectedConvo}`));
      setSelectedConvo(null);
      setShowMobileChat(false);
      setShowMenu(false);
      toast.success('ลบการสนทนาแล้ว');
    } catch {
      toast.error('ไม่สามารถลบได้');
    }
  };

  // ---------------------------------------------------------------------------
  // Merge / unmerge identity (ยืนยันว่าแชทเบอร์เดียวกันเป็นลูกค้าคนเดียวกัน)
  // ไม่ย้าย message — แค่ตั้งธง identity_confirmed บนทุกแชทของกลุ่ม (staff-only)
  // ---------------------------------------------------------------------------
  const handleConfirmMerge = async () => {
    if (!selectedConvo) return;
    const ids = [selectedConvo, ...linkedConvos.map((c) => c.id)];
    const now = Date.now();
    try {
      await Promise.all(
        ids.map((id) =>
          update(ref(db, `inbox/${id}`), {
            identity_confirmed: true,
            identity_confirmed_by: staffName,
            identity_confirmed_at: now,
          })
        )
      );
      toast.success('ยืนยันรวมเป็นลูกค้าเดียวกันแล้ว');
    } catch {
      toast.error('รวมไม่สำเร็จ');
    }
  };

  const handleUnmerge = async () => {
    if (!selectedConvo) return;
    const ids = [selectedConvo, ...linkedConvos.map((c) => c.id)];
    try {
      await Promise.all(
        ids.map((id) => update(ref(db, `inbox/${id}`), { identity_confirmed: false }))
      );
      toast.success('ยกเลิกการรวมแล้ว');
    } catch {
      toast.error('ยกเลิกไม่สำเร็จ');
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    // ใน MobileLayout พื้นที่คอนเทนต์คือ flex-1 (มี top bar + tab bar กินที่) —
    // ต้องใช้ h-full ให้พอดีกรอบ ไม่งั้นหน้าล้น viewport แล้ว iOS ดันหน้าเลื่อน
    // ตอนเปิดคีย์บอร์ด ทำให้ header ห้องแชท (ปุ่มรับเรื่อง/คืน AI) หลุดจอ
    <div className={`${isMobileApp ? 'h-full' : 'h-[calc(100vh-52px)]'} flex bg-[#F5F5F7]`}>
      {/* ===== LEFT PANEL: Conversation List ===== */}
      <div className={`${showMobileChat ? 'hidden lg:flex' : 'flex'} w-full lg:w-[380px] flex-col bg-white border-r border-slate-200`}>
        {/* Header */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-xl">
                <Inbox size={22} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-lg font-black text-slate-800">Inbox</h1>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  {conversations.length} การสนทนา
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowNewChat(true)}
              className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-200"
            >
              <Plus size={18} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อ, เบอร์โทร..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-3 border-b border-slate-100">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all relative ${
                activeTab === tab.key
                  ? `bg-${tab.color}-100 text-${tab.color}-600`
                  : 'text-slate-400 hover:bg-slate-50'
              }`}
              style={activeTab === tab.key ? {
                backgroundColor: tab.color === 'blue' ? '#DBEAFE' : tab.color === 'emerald' ? '#D1FAE5' : tab.color === 'orange' ? '#FFEDD5' : '#F3E8FF',
                color: tab.color === 'blue' ? '#2563EB' : tab.color === 'emerald' ? '#059669' : tab.color === 'orange' ? '#EA580C' : '#9333EA',
              } : {}}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              {unreadCounts[tab.key] > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-black">
                  {unreadCounts[tab.key] > 9 ? '9+' : unreadCounts[tab.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Status filter (website chat conversations) */}
        <div className="flex gap-1.5 px-4 py-2 border-b border-slate-100 overflow-x-auto no-scrollbar">
          {STATUS_FILTERS.map((f) => {
            const count = f.key === 'all'
              ? conversations.filter((c) => !!c.status).length
              : conversations.filter((c) => c.status === f.key).length;
            return (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors ${
                  statusFilter === f.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {f.label}{f.key !== 'all' && count > 0 ? ` ${count}` : ''}
              </button>
            );
          })}
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
              <MessageSquare size={40} className="text-slate-200" />
              <p className="text-sm font-bold">ไม่มีการสนทนา</p>
              <p className="text-xs">กดปุ่ม + เพื่อเริ่มแชทใหม่</p>
            </div>
          ) : (
            filteredConversations.map((convo) => (
              <button
                key={convo.id}
                onClick={() => {
                  setSelectedConvo(convo.id);
                  setShowMobileChat(true);
                }}
                className={`w-full flex items-center gap-3 px-5 py-4 border-b border-slate-50 hover:bg-slate-50 transition-all text-left ${
                  selectedConvo === convo.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                }`}
              >
                {/* Avatar */}
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0 ${
                  convo.type === 'customer' ? 'bg-emerald-500' : convo.type === 'rider' ? 'bg-orange-500' : 'bg-purple-500'
                }`}>
                  {convo.type === 'customer' ? <User size={18} /> : convo.type === 'rider' ? <Truck size={18} /> : <Users size={18} />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-sm text-slate-800 truncate">{convo.name}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                      {formatTime(convo.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400 truncate flex-1">
                      {convo.lastMessage || 'ยังไม่มีข้อความ'}
                    </p>
                    {convo.unreadCount > 0 && (
                      <span className="bg-blue-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-black shrink-0 ml-2">
                        {convo.unreadCount > 9 ? '9+' : convo.unreadCount}
                      </span>
                    )}
                  </div>
                  {convo.status && (
                    <div className="mt-1">
                      <StatusPill status={convo.status} assignedName={convo.assigned_staff_name} />
                    </div>
                  )}
                  {convo.jobModel && (
                    <p className="text-[10px] text-blue-500 font-bold mt-0.5 truncate">
                      📱 {convo.jobModel}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ===== RIGHT PANEL: Chat Window ===== */}
      <div className={`${showMobileChat ? 'flex' : 'hidden lg:flex'} flex-1 flex-col bg-white`}>
        {selectedConvo && selectedConversation ? (
          <>
            {/* Chat Header */}
            <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3 bg-white">
              <button
                onClick={() => {
                  setShowMobileChat(false);
                  setSelectedConvo(null);
                }}
                className="lg:hidden p-1 text-slate-400 hover:text-slate-600"
              >
                <ArrowLeft size={20} />
              </button>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm ${
                selectedConversation.type === 'customer' ? 'bg-emerald-500' : selectedConversation.type === 'rider' ? 'bg-orange-500' : 'bg-purple-500'
              }`}>
                {selectedConversation.type === 'customer' ? <User size={16} /> : selectedConversation.type === 'rider' ? <Truck size={16} /> : <Users size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-black text-sm text-slate-800 truncate flex items-center gap-1.5">
                  {selectedConversation.customer_name || selectedConversation.name}
                  {selectedConversation.status && (
                    <button
                      onClick={() => setShowContactEdit(true)}
                      title="แก้ข้อมูลติดต่อลูกค้า"
                      className="text-slate-300 hover:text-blue-600 transition-colors shrink-0"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                  {/* ประวัติลูกค้า 360 — staff only, อ่านอย่างเดียว (join ด้วยเบอร์) */}
                  {(selectedConversation.customer_phone || selectedConversation.phone) && (
                    <button
                      onClick={() => setShowCustomerTimeline(true)}
                      title="ดูประวัติลูกค้า (ซื้อ/ขาย) จากเบอร์นี้"
                      className="text-slate-300 hover:text-violet-600 transition-colors shrink-0"
                    >
                      <History size={12} />
                    </button>
                  )}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {(selectedConversation.customer_phone || selectedConversation.phone) && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Phone size={10} /> {selectedConversation.customer_phone || selectedConversation.phone}
                      {selectedConversation.customer_phone && (
                        <span className={`font-black px-1 py-0.5 rounded ${
                          selectedConversation.phone_source === 'chat'
                            ? 'bg-amber-100 text-amber-700'
                            : selectedConversation.phone_source === 'admin'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {selectedConversation.phone_source === 'chat'
                            ? 'แจ้งในแชท'
                            : selectedConversation.phone_source === 'admin'
                              ? 'แอดมินยืนยัน'
                              : 'จากบัญชี'}
                        </span>
                      )}
                    </span>
                  )}
                  {selectedConversation.customer_email && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 truncate max-w-[160px]">
                      <Mail size={10} /> {selectedConversation.customer_email}
                    </span>
                  )}
                  {selectedConversation.customer_address && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 truncate max-w-[180px]">
                      <MapPin size={10} /> {selectedConversation.customer_address}
                    </span>
                  )}
                  <StatusPill status={selectedConversation.status} assignedName={selectedConversation.assigned_staff_name} />
                  {selectedConversation.source_url && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 truncate max-w-[180px]">
                      <Globe size={10} /> {selectedConversation.source_url}
                    </span>
                  )}
                  {!selectedConversation.status && (
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${
                      selectedConversation.type === 'customer' ? 'bg-emerald-100 text-emerald-600' : selectedConversation.type === 'rider' ? 'bg-orange-100 text-orange-600' : 'bg-purple-100 text-purple-600'
                    }`}>
                      {selectedConversation.type === 'customer' ? 'ลูกค้า' : selectedConversation.type === 'rider' ? 'ไรเดอร์' : 'ทีมงาน'}
                    </span>
                  )}
                </div>
              </div>

              {/* Console actions (website chat conversations only) */}
              {selectedConversation.status && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {(selectedConversation.status === 'ai' || selectedConversation.status === 'waiting_human' ||
                    (selectedConversation.status === 'human' && selectedConversation.assigned_staff_id !== staffId)) && (
                    <button
                      onClick={handleTakeover}
                      className="hidden sm:flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      <UserCheck size={12} /> รับเรื่อง
                    </button>
                  )}
                  {selectedConversation.status === 'human' && selectedConversation.assigned_staff_id === staffId && (
                    <button
                      onClick={handleReturnToAi}
                      className="hidden sm:flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-violet-300 text-violet-600 hover:bg-violet-50 transition-colors"
                    >
                      <RotateCcw size={12} /> คืนให้ AI
                    </button>
                  )}
                  {selectedConversation.status !== 'resolved' && (
                    <button
                      onClick={handleResolve}
                      className="hidden sm:flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition-colors"
                    >
                      <CheckCircle2 size={12} /> ปิดจ็อบ
                    </button>
                  )}
                </div>
              )}

              {/* Menu */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <MoreVertical size={18} />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl py-1 w-48 z-50">
                    <button
                      onClick={handleDeleteConvo}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={14} /> ลบการสนทนา
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Console action bar — mobile (จอเล็กปุ่มบน header ถูกซ่อน จึงโชว์เป็นแถบเต็มความกว้างแทน) */}
            {selectedConversation.status && (
              <div className="sm:hidden flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white">
                {(selectedConversation.status === 'ai' || selectedConversation.status === 'waiting_human' ||
                  (selectedConversation.status === 'human' && selectedConversation.assigned_staff_id !== staffId)) && (
                  <button
                    onClick={handleTakeover}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-full bg-blue-600 text-white active:bg-blue-700 transition-colors"
                  >
                    <UserCheck size={14} /> รับเรื่อง
                  </button>
                )}
                {selectedConversation.status === 'human' && selectedConversation.assigned_staff_id === staffId && (
                  <button
                    onClick={handleReturnToAi}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-full border border-violet-300 text-violet-600 active:bg-violet-50 transition-colors"
                  >
                    <RotateCcw size={14} /> คืนให้ AI
                  </button>
                )}
                {selectedConversation.status !== 'resolved' && (
                  <button
                    onClick={handleResolve}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-full border border-emerald-300 text-emerald-600 active:bg-emerald-50 transition-colors"
                  >
                    <CheckCircle2 size={14} /> ปิดจ็อบ
                  </button>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50">
              {/* AI hand-off summary — lets staff reply without re-reading the thread */}
              {selectedConversation.escalation?.summary && selectedConversation.status === 'waiting_human' && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800">
                    <p className="font-black mb-0.5">AI สรุปเรื่องส่งต่อ</p>
                    <p>{selectedConversation.escalation.summary}</p>
                    {/* Live handoff note — AI keeps talking while queued (holding
                        mode) and refreshes this so staff can pick up mid-flow */}
                    {selectedConversation.escalation.live_summary && (
                      <p className="mt-1"><span className="font-black">อัปเดตล่าสุดระหว่างรอ:</span> {selectedConversation.escalation.live_summary}</p>
                    )}
                    {(selectedConversation.matched_orders_count || 0) > 0 && (
                      <p className="mt-1 font-bold">พบ {selectedConversation.matched_orders_count} ออเดอร์จากเบอร์ที่ลูกค้าแจ้ง (ยังไม่ยืนยันตัวตน)</p>
                    )}
                  </div>
                </div>
              )}

              {/* ตรวจพบแชทเบอร์เดียวกัน (คนละ session/uid) — ต้องกดยืนยันก่อนถึงถือว่าเป็นคนเดียวกัน */}
              {linkedConvos.length > 0 && (
                selectedConversation.identity_confirmed ? (
                  /* ยืนยันรวมแล้ว */
                  <div className="flex items-start gap-2 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
                    <Users size={15} className="text-violet-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-violet-800 flex-1 min-w-0">
                      <p className="font-black mb-1.5 flex items-center gap-1">
                        <CheckCircle2 size={12} className="text-violet-500" /> ลูกค้าคนเดียวกัน (ยืนยันแล้ว) · อีก {linkedConvos.length} แชท
                      </p>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {linkedConvos.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => { setSelectedConvo(c.id); setShowMobileChat(true); }}
                            title={c.lastMessage}
                            className="px-2.5 py-1 rounded-full bg-white border border-violet-200 text-violet-700 font-bold hover:bg-violet-100 transition-colors max-w-[220px] truncate"
                          >
                            {(c.customer_name || c.name)} · {formatTime(c.lastMessageAt)}
                          </button>
                        ))}
                        <button
                          onClick={handleUnmerge}
                          className="px-2 py-1 rounded-full text-violet-400 hover:text-red-500 hover:bg-red-50 transition-colors text-[11px]"
                        >
                          ยกเลิกการรวม
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* เสนอให้รวม — ยังไม่ยืนยัน (gate) */
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <Users size={15} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 flex-1 min-w-0">
                      <p className="font-black mb-0.5">ตรวจพบลูกค้าที่อาจเป็นคนเดียวกัน</p>
                      <p className="mb-1.5">มีอีก {linkedConvos.length} แชทที่ใช้เบอร์เดียวกัน — ตรวจสอบก่อนแล้วกดยืนยันว่าเป็นลูกค้าคนเดียวกัน</p>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {linkedConvos.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => { setSelectedConvo(c.id); setShowMobileChat(true); }}
                            title={c.lastMessage}
                            className="px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-700 font-bold hover:bg-amber-100 transition-colors max-w-[200px] truncate"
                          >
                            ดู: {(c.customer_name || c.name)} · {formatTime(c.lastMessageAt)}
                          </button>
                        ))}
                        <button
                          onClick={handleConfirmMerge}
                          className="px-3 py-1 rounded-full bg-violet-600 text-white font-bold hover:bg-violet-700 transition-colors flex items-center gap-1"
                        >
                          <CheckCircle2 size={12} /> ยืนยันรวมเป็นลูกค้าเดียวกัน
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}

              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                  <MessageSquare size={40} className="text-slate-200" />
                  <p className="text-sm font-bold">เริ่มสนทนา</p>
                  <p className="text-xs">พิมพ์ข้อความเพื่อเริ่มแชท</p>
                </div>
              )}

              {messages.map((msg) => {
                if (msg.senderRole === 'system' || msg.kind === 'system') {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <p className="text-[11px] text-slate-500 bg-slate-200/70 rounded-full px-3.5 py-1 text-center max-w-[90%]">
                        {msg.text}
                      </p>
                    </div>
                  );
                }
                const isMe = msg.senderRole === 'admin';
                const isAi = msg.senderRole === 'ai';
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] p-3 rounded-2xl text-sm ${
                      isMe
                        ? 'bg-blue-600 text-white rounded-tr-sm shadow-md shadow-blue-200'
                        : isAi
                          ? 'bg-violet-50 text-slate-700 border border-violet-200 rounded-tl-sm shadow-sm'
                          : 'bg-white text-slate-700 border border-slate-200 rounded-tl-sm shadow-sm'
                    }`}>
                      {!isMe && (
                        <p className={`text-[10px] font-black mb-1 uppercase flex items-center gap-1 ${isAi ? 'text-violet-600' : 'text-blue-600'}`}>
                          {isAi && <Bot size={11} />}
                          {isAi ? (msg.senderName || 'AI Assistant') : msg.senderName}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      {msg.imageUrl && (
                        <img
                          src={msg.imageUrl}
                          alt="attachment"
                          className="mt-2 rounded-lg w-full max-h-48 object-cover border border-black/10 cursor-pointer"
                          onClick={() => window.open(msg.imageUrl, '_blank')}
                        />
                      )}
                      <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-[8px] opacity-50">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isMe && (
                          msg.read
                            ? <CheckCheck size={10} className="opacity-50" />
                            : <Check size={10} className="opacity-30" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={scrollRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-white border-t border-slate-100 flex gap-2 items-center">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors disabled:opacity-50"
              >
                {isUploading ? (
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ImageIcon size={20} />
                )}
              </button>
              {/* สร้างใบเสนอราคา — เฉพาะแชทจากเว็บ (มี status) */}
              {selectedConversation.status && (
                <button
                  onClick={() => setShowQuoteComposer(true)}
                  title="สร้างใบเสนอราคา"
                  className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                >
                  <FileText size={20} />
                </button>
              )}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="พิมพ์ข้อความ..."
                className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <button
                onClick={handleSend}
                disabled={!inputText.trim()}
                className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all shadow-md shadow-blue-200 disabled:shadow-none"
              >
                <Send size={18} />
              </button>
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <div className="p-6 bg-slate-100 rounded-3xl">
              <Inbox size={48} className="text-slate-300" />
            </div>
            <h3 className="text-lg font-black text-slate-500">เลือกการสนทนา</h3>
            <p className="text-sm text-slate-400">เลือกจากรายการด้านซ้าย หรือสร้างแชทใหม่</p>
          </div>
        )}
      </div>

      {/* ===== คอลัมน์ที่ 3: Customer Context (จอกว้าง xl ขึ้นไป, เฉพาะแชทเว็บ) ===== */}
      {selectedConvo && selectedConversation && isWebsiteChat && (
        <div className="hidden xl:flex w-[300px] shrink-0 flex-col bg-white border-l border-slate-200 overflow-y-auto">
          {/* ข้อมูลติดต่อ */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider">ข้อมูลลูกค้า</h4>
              <button
                onClick={() => setShowContactEdit(true)}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <Pencil size={11} /> แก้ไข
              </button>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <User size={14} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-sm font-bold text-slate-800 leading-snug">{contact.name || '—'}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <Phone size={14} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-600">{contact.phone || <span className="text-slate-300">ยังไม่มีเบอร์</span>}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <Mail size={14} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-600 break-all">{contact.email || <span className="text-slate-300">ยังไม่มีอีเมล</span>}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <MapPin size={14} className="text-slate-300 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-500 leading-relaxed">{contact.address || <span className="text-slate-300">ยังไม่มีที่อยู่</span>}</p>
              </div>
            </div>
            {(profile || latestJob) && (
              <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
                เติมอัตโนมัติจาก{profile ? ' บัญชีลูกค้า (กรอกที่หน้า checkout)' : ''}
                {profile && latestJob ? ' และ' : ''}
                {latestJob ? ' ออเดอร์ล่าสุด' : ''}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="p-4 border-b border-slate-100 space-y-2">
            <button
              onClick={() => setShowQuoteComposer(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
            >
              <FileText size={15} /> ออกใบเสนอราคา
            </button>
            {contact.phone && (
              <button
                onClick={() => setShowCustomerTimeline(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors"
              >
                <History size={15} /> ประวัติลูกค้า 360
              </button>
            )}
          </div>

          {/* Escalation */}
          {selectedConversation.escalation?.summary && (
            <div className="p-4 border-b border-slate-100">
              <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-amber-500" /> AI ส่งต่อเพราะ
              </h4>
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 leading-relaxed">
                {selectedConversation.escalation.summary}
                {selectedConversation.escalation.live_summary && (
                  <><br /><span className="font-black">อัปเดตล่าสุดระหว่างรอ:</span> {selectedConversation.escalation.live_summary}</>
                )}
              </p>
            </div>
          )}

          {/* ออเดอร์ล่าสุด */}
          <div className="p-4">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">
              ออเดอร์ล่าสุด{recentJobs.length > 0 ? ` (${recentJobs.length})` : ''}
            </h4>
            {recentJobs.length === 0 ? (
              <p className="text-xs text-slate-300">ยังไม่มีออเดอร์ของบัญชีนี้</p>
            ) : (
              <div className="space-y-2">
                {recentJobs.map((j) => (
                  <div key={j.id} className="border border-slate-100 rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black text-slate-700 truncate">{j.ref_no || j.id.slice(-6).toUpperCase()}</p>
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
                        {j.status || '-'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">{j.model || '-'}</p>
                    {typeof j.net_payout === 'number' && j.net_payout > 0 && (
                      <p className="text-[11px] font-bold text-emerald-600 mt-0.5">{j.net_payout.toLocaleString('th-TH')} บาท</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== New Chat Modal ===== */}
      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} onCreate={handleCreateConvo} />}

      {/* ===== Contact Edit Modal ===== */}
      {showContactEdit && selectedConvo && selectedConversation && (
        <ContactEditModal
          convoId={selectedConvo}
          // Prefill จากข้อมูล merged (แชท > โปรไฟล์บัญชีที่ลูกค้ากรอกหน้า checkout >
          // ออเดอร์ล่าสุด) — แอดมินไม่ต้องกรอกซ้ำจากศูนย์
          initial={{
            customer_name: contact.name,
            customer_phone: contact.phone,
            customer_email: contact.email,
            customer_address: contact.address,
          }}
          onClose={() => setShowContactEdit(false)}
        />
      )}

      {/* ===== Customer Timeline 360 (staff only, read-only) ===== */}
      {showCustomerTimeline && selectedConversation &&
        (selectedConversation.customer_phone || selectedConversation.phone) && (
        <CustomerTimelineModal
          phone={(selectedConversation.customer_phone || selectedConversation.phone) as string}
          name={selectedConversation.customer_name || selectedConversation.name}
          onClose={() => setShowCustomerTimeline(false)}
        />
      )}

      {/* ===== Quote Composer (แอดมินส่งใบเสนอราคาเข้าแชท) ===== */}
      {showQuoteComposer && selectedConvo && (
        <QuoteComposer
          convoId={selectedConvo}
          staffId={staffId}
          staffName={staffName}
          onClose={() => setShowQuoteComposer(false)}
          onSent={async () => {
            // ส่งการ์ดแล้ว = แอดมินรับเคสโดยปริยาย (AI หยุดตอบ) เหมือน handleSend
            const convo = conversations.find((c) => c.id === selectedConvo);
            if (convo?.status && (convo.status !== 'human' || convo.assigned_staff_id !== staffId)) {
              await update(ref(db, `inbox/${selectedConvo}`), {
                status: 'human',
                assigned_staff_id: staffId,
                assigned_staff_name: staffName,
                ai_typing: false,
              });
            }
          }}
        />
      )}
    </div>
  );
};

// =============================================================================
// New Chat Modal
// =============================================================================

const NewChatModal = ({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (type: 'customer' | 'rider' | 'team', name: string, phone?: string) => void;
}) => {
  const [type, setType] = useState<'customer' | 'rider' | 'team'>('customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const typeOptions = [
    { key: 'customer' as const, label: 'ลูกค้า', icon: <User size={18} />, color: 'emerald' },
    { key: 'rider' as const, label: 'ไรเดอร์', icon: <Truck size={18} />, color: 'orange' },
    { key: 'team' as const, label: 'ทีมงาน', icon: <Users size={18} />, color: 'purple' },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-800">สร้างแชทใหม่</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Type selector */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">ประเภท</label>
            <div className="flex gap-2">
              {typeOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setType(opt.key)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all font-bold text-xs ${
                    type === opt.key
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
              ชื่อ {type === 'customer' ? 'ลูกค้า' : type === 'rider' ? 'ไรเดอร์' : 'สมาชิก'}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="กรอกชื่อ..."
              className="w-full px-4 py-3 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              autoFocus
            />
          </div>

          {/* Phone (optional) */}
          {type !== 'team' && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">เบอร์โทร (ถ้ามี)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0xx-xxx-xxxx"
                className="w-full px-4 py-3 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors">
            ยกเลิก
          </button>
          <button
            onClick={() => onCreate(type, name, phone)}
            disabled={!name.trim()}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-md shadow-blue-200 disabled:shadow-none"
          >
            สร้างแชท
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Helpers
// =============================================================================

function formatTime(ts: number): string {
  if (!ts) return '';
  const now = new Date();
  const date = new Date(ts);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'ตอนนี้';
  if (diffMin < 60) return `${diffMin} นาที`;
  if (diffHour < 24) return `${diffHour} ชม.`;
  if (diffDay < 7) return `${diffDay} วัน`;
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
