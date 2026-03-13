import React, { useState, useEffect, useRef } from 'react';
import { ref, onValue, push, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { Send, X, MessageSquare, User, Image as ImageIcon } from 'lucide-react';
import { uploadImageToFirebase } from '../../utils/uploadImage'; // 🌟 ดึงฟังก์ชันอัปโหลดรูปมาใช้

interface AdminChatBoxProps {
  jobId: string;
  onClose: () => void;
  adminName: string;
}

export const AdminChatBox = ({ jobId, onClose, adminName }: AdminChatBoxProps) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [jobInfo, setJobInfo] = useState<any>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const jobRef = ref(db, `jobs/${jobId}`);
    const unsubscribe = onValue(jobRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setJobInfo(data);
        if (data.chats) {
          const msgArray = Object.values(data.chats).sort((a: any, b: any) => a.timestamp - b.timestamp);
          setMessages(msgArray);

          Object.keys(data.chats).forEach(key => {
            if (data.chats[key].sender === 'rider' && !data.chats[key].read) {
              update(ref(db, `jobs/${jobId}/chats/${key}`), { read: true });
            }
          });
        }
      }
    });
    return () => unsubscribe();
  }, [jobId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    const msgText = inputText.trim();
    try {
      await push(ref(db, `jobs/${jobId}/chats`), {
        sender: 'admin',
        senderName: adminName,
        text: msgText,
        timestamp: Date.now(),
        read: false
      });
      setInputText("");

      // Notify rider via Cloud Function
      fetch('https://asia-southeast1-bkk-apple-tradein.cloudfunctions.net/notifyChatMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, sender: 'Admin', senderName: adminName, text: msgText }),
      }).catch(() => {});
    } catch (error) {
      // silently handled
    }
  };

  // 🌟 ฟังก์ชันส่งรูปภาพฝั่งแอดมิน
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !jobId) return;
    const file = e.target.files[0];
    setIsUploading(true);

    try {
      const imageUrl = await uploadImageToFirebase(file, `jobs/${jobId}/chats/images`);

      await push(ref(db, `jobs/${jobId}/chats`), {
        sender: 'admin',
        senderName: adminName,
        text: '📷 ส่งรูปภาพ',
        imageUrl: imageUrl,
        timestamp: Date.now(),
        read: false
      });

      // Notify rider via Cloud Function
      fetch('https://asia-southeast1-bkk-apple-tradein.cloudfunctions.net/notifyChatMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, sender: 'Admin', senderName: adminName, imageUrl }),
      }).catch(() => {});
    } catch (error) {
      alert("ไม่สามารถอัปโหลดรูปภาพได้");
    } finally {
      setIsUploading(false);
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    }
  };

  if (!jobInfo) return null;

  return (
    <div className="fixed bottom-5 right-5 w-96 h-[500px] bg-white shadow-2xl rounded-2xl border border-slate-200 flex flex-col z-[100] animate-in slide-in-from-right-5">
      <div className="p-4 bg-slate-900 text-white rounded-t-2xl flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500 rounded-lg"><MessageSquare size={18} /></div>
          <div>
            <h3 className="text-sm font-bold leading-none">{jobInfo.model}</h3>
            <p className="text-[10px] text-slate-400 mt-1">Order ID: {jobInfo.OID || jobInfo.ref_no || `#${jobId.slice(-4)}`}</p>
          </div>
        </div>
        <button onClick={onClose} className="hover:bg-slate-800 p-1 rounded-full transition-colors"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
        {messages.length === 0 && (
          <div className="text-center py-10">
            <User size={32} className="mx-auto text-slate-300 mb-2" />
            <p className="text-xs text-slate-400">ยังไม่มีการสนทนาในงานนี้</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isAdmin = msg.sender === 'admin';
          return (
            <div key={i} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                isAdmin ? 'bg-blue-600 text-white rounded-tr-none shadow-md shadow-blue-200' : 'bg-white text-slate-700 border border-slate-200 rounded-tl-none shadow-sm'
              }`}>
                {!isAdmin && <p className="text-[10px] font-black text-blue-600 mb-1 uppercase">{msg.senderName}</p>}
                <p>{msg.text}</p>
                {/* 🌟 แสดงรูปภาพในแชท */}
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="attachment" className="mt-2 rounded-lg w-full max-h-48 object-cover border border-black/10" />
                )}
                <p className={`text-[8px] mt-1 text-right opacity-50`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>

      {['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Cancelled'].includes(jobInfo.status) ? (
        <div className="p-4 bg-slate-100 border-t border-slate-200 text-center rounded-b-2xl">
          <span className="text-xs font-bold text-slate-500 flex items-center justify-center gap-2">
            🔒 แชทถูกปิดแล้ว (จบงาน)
          </span>
        </div>
      ) : (
        <div className="p-4 bg-white border-t border-slate-100 flex gap-2 rounded-b-2xl items-center">
          {/* 🌟 ปุ่มอัปโหลดรูปฝั่งแอดมิน */}
          <input type="file" accept="image/*" className="hidden" ref={chatFileInputRef} onChange={handleImageUpload} />
          <button
            onClick={() => chatFileInputRef.current?.click()}
            disabled={isUploading}
            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
            title="ส่งรูปภาพ"
          >
             {isUploading ? <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div> : <ImageIcon size={20} />}
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="พิมพ์ข้อความตอบโต้..."
            className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-slate-200 transition-all"
          >
            <Send size={18} />
          </button>
        </div>
      )}
    </div>
  );
};