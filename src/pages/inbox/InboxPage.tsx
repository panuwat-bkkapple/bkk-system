import { useState, useEffect, useRef, useMemo } from 'react';
import { ref, onValue, push, update, serverTimestamp, remove } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Inbox, MessageSquare, Users, Truck, Send, Search,
  Image as ImageIcon, Plus, X, Phone, User, Clock,
  CheckCheck, Check, ArrowLeft, Trash2, MoreVertical
} from 'lucide-react';
import { uploadImageToFirebase } from '../../utils/uploadImage';
import { useToast } from '../../components/ui/ToastProvider';

// =============================================================================
// Types
// =============================================================================

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
}

interface Message {
  id: string;
  sender: string;
  senderName: string;
  senderRole: 'admin' | 'customer' | 'rider' | 'team';
  text: string;
  imageUrl?: string;
  timestamp: number;
  read: boolean;
}

type TabType = 'all' | 'customer' | 'rider' | 'team';

const TAB_CONFIG: { key: TabType; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'all', label: 'ทั้งหมด', icon: <Inbox size={16} />, color: 'blue' },
  { key: 'customer', label: 'ลูกค้า', icon: <User size={16} />, color: 'emerald' },
  { key: 'rider', label: 'ไรเดอร์', icon: <Truck size={16} />, color: 'orange' },
  { key: 'team', label: 'ทีมงาน', icon: <Users size={16} />, color: 'purple' },
];

// =============================================================================
// Main Component
// =============================================================================

export const InboxPage = () => {
  const toast = useToast();
  const currentUser = useMemo(() => {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  }, []);

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

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
          text: val.text || '',
          imageUrl: val.imageUrl,
          timestamp: val.timestamp || 0,
          read: val.read || false,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
      setMessages(list);

      // Mark messages as read
      Object.entries(data).forEach(([key, val]: [string, any]) => {
        if (val.senderRole !== 'admin' && !val.read) {
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
  }, [conversations, activeTab, searchQuery]);

  const selectedConversation = conversations.find((c) => c.id === selectedConvo);

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
  // Send message
  // ---------------------------------------------------------------------------
  const handleSend = async () => {
    if (!inputText.trim() || !selectedConvo) return;
    const text = inputText.trim();
    setInputText('');
    try {
      await push(ref(db, `inbox/${selectedConvo}/messages`), {
        sender: currentUser?.uid || 'admin',
        senderName: currentUser?.name || 'Admin',
        senderRole: 'admin',
        text,
        timestamp: Date.now(),
        read: false,
      });
      await update(ref(db, `inbox/${selectedConvo}`), {
        lastMessage: text,
        lastMessageAt: Date.now(),
      });
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
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="h-[calc(100vh-52px)] flex bg-[#F5F5F7]">
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
                <h3 className="font-black text-sm text-slate-800 truncate">{selectedConversation.name}</h3>
                <div className="flex items-center gap-2">
                  {selectedConversation.phone && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Phone size={10} /> {selectedConversation.phone}
                    </span>
                  )}
                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${
                    selectedConversation.type === 'customer' ? 'bg-emerald-100 text-emerald-600' : selectedConversation.type === 'rider' ? 'bg-orange-100 text-orange-600' : 'bg-purple-100 text-purple-600'
                  }`}>
                    {selectedConversation.type === 'customer' ? 'ลูกค้า' : selectedConversation.type === 'rider' ? 'ไรเดอร์' : 'ทีมงาน'}
                  </span>
                </div>
              </div>

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

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                  <MessageSquare size={40} className="text-slate-200" />
                  <p className="text-sm font-bold">เริ่มสนทนา</p>
                  <p className="text-xs">พิมพ์ข้อความเพื่อเริ่มแชท</p>
                </div>
              )}

              {messages.map((msg) => {
                const isMe = msg.senderRole === 'admin';
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] p-3 rounded-2xl text-sm ${
                      isMe
                        ? 'bg-blue-600 text-white rounded-tr-sm shadow-md shadow-blue-200'
                        : 'bg-white text-slate-700 border border-slate-200 rounded-tl-sm shadow-sm'
                    }`}>
                      {!isMe && (
                        <p className="text-[10px] font-black text-blue-600 mb-1 uppercase">
                          {msg.senderName}
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

      {/* ===== New Chat Modal ===== */}
      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} onCreate={handleCreateConvo} />}
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
