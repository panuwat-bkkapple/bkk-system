// src/pages/sales/POS.tsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { formatCurrency, formatDate } from '../../utils/formatters';
import {
    ScanLine, ShoppingCart, Trash2, CreditCard, Banknote,
    Smartphone, Package, User, CheckCircle2, X, Plus, Minus, Receipt, Printer
} from 'lucide-react';
import { ref, update, push, get, runTransaction } from 'firebase/database';
import { db } from '../../api/firebase';

export const POS = () => {
    const toast = useToast();
    const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
    const availableDevices = useMemo(() => {
        const list = Array.isArray(jobs) ? jobs : [];
        return list.filter(j => j.status === 'Ready to Sell');
    }, [jobs]);

    const { data: products, loading: productsLoading } = useDatabase('products');
    const availableSkus = useMemo(() => {
        const list = Array.isArray(products) ? products : [];
        return list.filter(p => p && p.sku && p.name);
    }, [products]);

    const [barcodeInput, setBarcodeInput] = useState('');
    const [cart, setCart] = useState<any[]>([]);
    const [discount, setDiscount] = useState<number>(0);
    const [customer, setCustomer] = useState({ name: '', phone: '' });

    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'CREDIT'>('TRANSFER');
    const [receivedAmount, setReceivedAmount] = useState<number>(0);
    const [receiptData, setReceiptData] = useState<any>(null);
    const barcodeInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isCheckoutOpen && !receiptData) barcodeInputRef.current?.focus();
    }, [cart, isCheckoutOpen, receiptData]);

    const handleScan = (e: React.FormEvent) => {
        e.preventDefault();
        const code = barcodeInput.trim();
        if (!code) return;

        const foundDevice = availableDevices.find(d =>
            d.serial === code || d.imei === code || d.ref_no === code || d.qc_txn_id === code
        );

        if (foundDevice) {
            if (cart.find(item => item.id === foundDevice.id)) {
                toast.warning('เครื่องนี้อยู่ในตะกร้าแล้ว!');
            } else {
                setCart([...cart, {
                    id: foundDevice.id,
                    type: 'DEVICE',
                    name: foundDevice.model || 'Unknown Device',
                    code: foundDevice.serial || foundDevice.imei || foundDevice.ref_no,
                    price: Number(foundDevice.promo_price) || Number(foundDevice.selling_price) || 0,
                    cost: Number(foundDevice.final_price) || Number(foundDevice.price) || 0,
                    qty: 1,
                    refData: foundDevice
                }]);
            }
            setBarcodeInput('');
            return;
        }

        const foundSku = availableSkus.find(s => s.sku === code);
        if (foundSku) {
            handleAddSku(foundSku);
            setBarcodeInput('');
            return;
        }

        toast.warning('ไม่พบข้อมูลสินค้าในระบบ (หรือสินค้าอาจยังไม่พร้อมขาย)');
        setBarcodeInput('');
    };

    const handleAddSku = (skuItem: any) => {
        const currentStock = Number(skuItem.stock) || 0;
        if (currentStock <= 0) { toast.warning('สินค้านี้หมดสต็อกแล้ว ไม่สามารถเพิ่มได้!'); return; }

        const existingItem = cart.find(item => item.id === skuItem.id);
        if (existingItem) {
            if (existingItem.qty >= currentStock) { toast.warning(`มีสินค้าในสต็อกเพียง ${currentStock} ชิ้น`); return; }
            setCart(cart.map(item => item.id === skuItem.id ? { ...item, qty: item.qty + 1 } : item));
        } else {
            setCart([...cart, {
                id: skuItem.id,
                type: 'SKU',
                name: skuItem.name || 'Unknown',
                code: skuItem.sku || 'N/A',
                price: Number(skuItem.price) || 0,
                cost: Number(skuItem.cost) || 0,
                qty: 1,
                refData: skuItem
            }]);
        }
    };

    const updateQty = (id: string, delta: number) => {
        setCart(cart.map(item => {
            if (item.id === id && item.type === 'SKU') {
                const newQty = item.qty + delta;
                const maxStock = Number(item.refData.stock) || 0;
                if (newQty > maxStock) { toast.warning(`เพิ่มไม่ได้ สต็อกเหลือแค่ ${maxStock} ชิ้น`); return item; }
                return newQty > 0 ? { ...item, qty: newQty } : item;
            }
            return item;
        }));
    };

    const removeFromCart = (id: string) => setCart(cart.filter(item => item.id !== id));

    const subtotal = cart.reduce((sum, item) => sum + ((Number(item.price) || 0) * item.qty), 0);
    const totalCost = cart.reduce((sum, item) => sum + ((Number(item.cost) || 0) * item.qty), 0);
    const grandTotal = Math.max(0, subtotal - (Number(discount) || 0));

    // 🔥 โค้ด Checkout ที่คลีนความซ้ำซ้อนออกแล้ว
    const processCheckout = async () => {
        if (cart.length === 0) { toast.warning('ตะกร้าว่างเปล่า'); return; }
        if (paymentMethod === 'CASH' && receivedAmount < grandTotal) { toast.warning('รับเงินมาไม่พอ!'); return; }

        try {
            const receiptNo = `REC-${Date.now().toString().slice(-6)}`;
            const timestamp = Date.now();

            const saleRecord = {
                receipt_no: receiptNo,
                customer_name: customer.name || 'ลูกค้าทั่วไป',
                customer_phone: customer.phone || '',
                subtotal, discount: Number(discount) || 0, grand_total: grandTotal, total_cost: totalCost,
                net_profit: grandTotal - totalCost, payment_method: paymentMethod, items: cart, sold_at: timestamp,
                cashier: 'Admin (Main Store)'
            };
            await push(ref(db, 'sales'), saleRecord);

            // 🎯 ระบบบันทึก CRM ที่ปลอดภัย (ทำงานรอบเดียว)
            if (customer.phone) {
                const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
                if (cleanPhone.length < 9 || cleanPhone.length > 10) {
                    // Invalid phone number, skipping CRM update
                } else {
                const customerRef = ref(db, `customers/CUS_${cleanPhone}`); // ใส่ CUS_ ป้องกัน Firebase งง
                const snap = await get(customerRef);
                const existingData = snap.exists() ? snap.val() : { total_spent: 0, total_sold_qty: 0 };

                await update(customerRef, {
                    name: customer.name || 'ลูกค้าทั่วไป',
                    phone: cleanPhone,
                    total_spent: (Number(existingData.total_spent) || 0) + (Number(grandTotal) || 0),
                    last_purchase: timestamp,
                    updated_at: timestamp,
                    created_at: existingData.created_at || timestamp
                });
                }
            }

            const deviceUpdates = cart.filter(item => item.type === 'DEVICE').map(async (deviceItem) => {
                await update(ref(db, `jobs/${deviceItem.id}`), { status: 'Sold', sold_at: timestamp, receipt_no: receiptNo, customer_info: customer });
            });

            const skuUpdates = cart.filter(item => item.type === 'SKU').map(async (skuItem) => {
                const stockRef = ref(db, `products/${skuItem.id}/stock`);
                await runTransaction(stockRef, (currentStock) => {
                    const stock = Number(currentStock) || 0;
                    if (stock < skuItem.qty) return; // abort if insufficient
                    return stock - skuItem.qty;
                });
                await update(ref(db, `products/${skuItem.id}`), { updated_at: timestamp });
            });

            await Promise.all([...deviceUpdates, ...skuUpdates]);

            setReceiptData({ ...saleRecord, receivedAmount: paymentMethod === 'CASH' ? receivedAmount : grandTotal, changeAmount: paymentMethod === 'CASH' ? receivedAmount - grandTotal : 0 });
            setIsCheckoutOpen(false);
        } catch (error) {
            toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + error);
        }
    };

    const handleFinishSale = () => {
        setCart([]); setDiscount(0); setCustomer({ name: '', phone: '' }); setReceivedAmount(0); setReceiptData(null);
    };

    if (jobsLoading || productsLoading) return <div className="p-10 text-center font-bold text-slate-400 animate-pulse">Loading POS System...</div>;

    return (
        <div className="h-screen flex bg-slate-100 overflow-hidden font-sans relative">
            {/* 🟢 LEFT PANEL: SCAN & PRODUCTS */}
            <div className="flex-1 flex flex-col p-6">
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 mb-6 flex flex-col gap-2 relative">
                    <a href="/" className="absolute top-6 right-6 px-4 py-2 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs uppercase hover:bg-red-50 hover:text-red-500 transition-colors shadow-sm">Exit POS</a>
                    <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2"><ScanLine className="text-blue-600" /> POS Register</h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scan Barcode / IMEI / Serial Number / SKU</p>
                    <form onSubmit={handleScan} className="relative mt-2">
                        <ScanLine className="absolute left-4 top-4 text-slate-400" size={24} />
                        <input ref={barcodeInputRef} type="text" value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} placeholder="สแกนบาร์โค้ดตรงนี้ แล้วกด Enter..." className="w-full pl-14 pr-6 py-4 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 rounded-2xl font-mono text-xl font-black outline-none transition-colors" disabled={!!receiptData} />
                        <button type="submit" className="absolute right-3 top-3 bg-blue-600 text-white px-6 py-2 rounded-xl font-bold uppercase text-xs shadow-md">Enter</button>
                    </form>
                </div>

                <div className="flex-1 bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Package size={16} /> Quick Add Accessories</h2>
                    <div className="grid grid-cols-4 gap-4 overflow-y-auto pr-2 pb-4">
                        {availableSkus.length === 0 ? (
                            <div className="col-span-4 p-10 text-center text-slate-400 font-bold italic border-2 border-dashed border-slate-200 rounded-2xl">ยังไม่มีอุปกรณ์เสริมในระบบ</div>
                        ) : (
                            availableSkus.map(sku => {
                                const isOutOfStock = Number(sku.stock) <= 0;
                                return (
                                    <div key={sku.id} onClick={() => !isOutOfStock && handleAddSku(sku)} className={`p-4 rounded-2xl border transition-all flex flex-col justify-between h-32 ${isOutOfStock ? 'bg-red-50 border-red-200 opacity-60 cursor-not-allowed' : 'bg-slate-50 border-slate-200 hover:border-blue-400 hover:shadow-md cursor-pointer active:scale-95'}`}>
                                        <div><div className="text-[9px] font-mono text-slate-400 font-bold mb-1">{sku.sku}</div><div className="font-bold text-sm text-slate-800 leading-tight line-clamp-2">{sku.name}</div></div>
                                        <div className="flex justify-between items-end"><span className={`text-xs font-bold ${isOutOfStock ? 'text-red-500' : 'text-slate-400'}`}>{isOutOfStock ? 'หมดสต็อก' : `Stock: ${sku.stock}`}</span><span className="text-lg font-black text-blue-600">฿{Number(sku.price || 0).toLocaleString()}</span></div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* 🔴 RIGHT PANEL: CART & CHECKOUT */}
            <div className="w-[400px] bg-white border-l border-slate-200 shadow-2xl flex flex-col z-10 relative">
                <div className="p-5 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3"><User size={14} /> Customer (Optional)</div>
                    <div className="flex gap-2">
                        <input type="text" placeholder="ชื่อลูกค้า..." value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} className="flex-1 bg-white border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold outline-none focus:border-blue-500" />
                        <input type="text" placeholder="เบอร์โทร..." value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} className="flex-1 bg-white border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold outline-none focus:border-blue-500" />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-100/50">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-300"><ShoppingCart size={48} className="mb-2 opacity-50" /><p className="font-bold uppercase tracking-widest text-xs">ตะกร้าว่างเปล่า</p></div>
                    ) : (
                        cart.map((item) => (
                            <div key={item.id} className={`p-4 rounded-2xl border shadow-sm relative group ${item.type === 'DEVICE' ? 'bg-white border-blue-100' : 'bg-white border-slate-200'}`}>
                                <button onClick={() => removeFromCart(item.id)} className="absolute -top-2 -right-2 bg-red-100 text-red-500 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-500 hover:text-white"><X size={14} /></button>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex-1 pr-4">
                                        <div className="flex items-center gap-1.5 mb-0.5">{item.type === 'DEVICE' ? <Smartphone size={12} className="text-blue-500" /> : <Package size={12} className="text-slate-400" />}<span className="font-black text-sm leading-tight">{item.name}</span></div>
                                        <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">{item.type === 'DEVICE' ? `SN/IMEI: ${item.code}` : `SKU: ${item.code}`}</div>
                                    </div>
                                    <div className="font-black text-slate-800 text-right">฿{((item.price || 0) * item.qty).toLocaleString()}</div>
                                </div>
                                {item.type === 'SKU' && (
                                    <div className="flex items-center justify-between mt-3 bg-slate-50 p-1 rounded-lg w-fit border border-slate-100"><button onClick={() => updateQty(item.id, -1)} className="p-1 text-slate-400 hover:text-slate-800"><Minus size={14} /></button><span className="w-8 text-center font-bold text-xs">{item.qty}</span><button onClick={() => updateQty(item.id, 1)} className="p-1 text-slate-400 hover:text-slate-800"><Plus size={14} /></button></div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="bg-slate-900 text-white rounded-t-[2rem] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] p-6 z-20">
                    <div className="space-y-2 mb-4">
                        <div className="flex justify-between text-slate-400 text-xs font-bold uppercase tracking-widest"><span>Subtotal</span><span>฿{subtotal.toLocaleString()}</span></div>
                        <div className="flex justify-between items-center text-slate-400 text-xs font-bold uppercase tracking-widest"><span>Discount</span><div className="flex items-center gap-1"><span>- ฿</span><input type="number" value={discount || ''} onChange={e => setDiscount(Number(e.target.value))} className="w-20 bg-slate-800 text-white text-right px-2 py-1 rounded outline-none focus:ring-1 focus:ring-blue-500" /></div></div>
                    </div>
                    <hr className="border-slate-700 my-4" />
                    <div className="flex justify-between items-end mb-6"><span className="text-sm font-black uppercase tracking-widest text-slate-300">Total</span><span className="text-4xl font-black tracking-tighter text-blue-400">฿{grandTotal.toLocaleString()}</span></div>
                    <button onClick={() => setIsCheckoutOpen(true)} disabled={cart.length === 0} className={`w-full py-5 rounded-2xl font-black text-lg uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 transition-all ${cart.length === 0 ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'}`}>Pay / Checkout <ShoppingCart size={20} /></button>
                </div>
            </div>

            {/* 💳 CHECKOUT MODAL */}
            {isCheckoutOpen && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white rounded-[2rem] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
                        <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center"><h3 className="font-black text-xl text-slate-800 uppercase tracking-tight flex items-center gap-2"><CreditCard size={24} className="text-blue-600" /> Payment</h3><button onClick={() => setIsCheckoutOpen(false)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-full shadow-sm"><X size={20} /></button></div>
                        <div className="p-8 grid grid-cols-2 gap-8">
                            <div className="bg-slate-900 text-white p-8 rounded-3xl flex flex-col justify-center items-center relative overflow-hidden shadow-inner"><div className="absolute top-0 right-0 p-4 opacity-10"><Receipt size={100} /></div><span className="text-xs font-black text-blue-400 uppercase tracking-widest mb-2 relative z-10">Amount Due</span><span className="text-5xl font-black tracking-tighter relative z-10">฿{grandTotal.toLocaleString()}</span></div>
                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Payment Method</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[ { id: 'TRANSFER', icon: <Banknote size={18} />, label: 'โอนเงิน' }, { id: 'CASH', icon: <Banknote size={18} />, label: 'เงินสด' }, { id: 'CREDIT', icon: <CreditCard size={18} />, label: 'บัตรเครดิต' } ].map(method => (
                                            <button key={method.id} onClick={() => { setPaymentMethod(method.id as any); setReceivedAmount(grandTotal); }} className={`p-3 rounded-xl flex flex-col items-center gap-2 border-2 transition-all ${paymentMethod === method.id ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-sm' : 'bg-white border-slate-100 text-slate-500 hover:border-slate-300'}`}>{method.icon}<span className="text-[10px] font-black uppercase">{method.label}</span></button>
                                        ))}
                                    </div>
                                </div>
                                {paymentMethod === 'CASH' && (
                                    <div className="animate-in slide-in-from-top-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Cash Received</label>
                                        <div className="relative"><span className="absolute left-4 top-4 font-black text-slate-400">฿</span><input type="number" value={receivedAmount || ''} onChange={e => setReceivedAmount(Number(e.target.value))} className="w-full pl-10 pr-4 py-3 bg-white border-2 border-slate-200 rounded-xl font-black text-xl outline-none focus:border-green-500" /></div>
                                        {receivedAmount > grandTotal && (<div className="mt-3 p-3 bg-green-50 text-green-700 rounded-xl border border-green-200 flex justify-between items-center font-bold text-sm"><span className="uppercase text-[10px] font-black tracking-widest">Change (เงินทอน)</span><span className="text-lg">฿{(receivedAmount - grandTotal).toLocaleString()}</span></div>)}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-6 bg-slate-50 border-t border-slate-100"><button onClick={processCheckout} disabled={paymentMethod === 'CASH' && receivedAmount < grandTotal} className={`w-full py-5 rounded-2xl font-black text-lg uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-2 ${(paymentMethod === 'CASH' && receivedAmount < grandTotal) ? 'bg-slate-300 text-white cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-500 active:scale-95'}`}><CheckCircle2 size={24} /> Confirm Payment</button></div>
                    </div>
                </div>
            )}

            {/* 🧾 RECEIPT MODAL */}
            {receiptData && (
                <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4 backdrop-blur-sm print:bg-white print:p-0 print:block">
                    <style>{`@media print { body * { visibility: hidden; } #printable-receipt, #printable-receipt * { visibility: visible; } #printable-receipt { position: absolute; left: 0; top: 0; width: 80mm; margin: 0; padding: 0; box-shadow: none; border-radius: 0; } }`}</style>
                    <div className="flex gap-6 items-start">
                        <div id="printable-receipt" className="bg-white w-[80mm] min-h-[100mm] p-6 text-black font-sans shadow-2xl rounded-lg print:rounded-none">
                            <div className="text-center mb-6"><h2 className="text-xl font-black tracking-tight uppercase">BKK APPLE PRO</h2><p className="text-[10px] font-bold text-gray-500 mt-1">Bangkok, Thailand</p><p className="text-[10px] font-bold text-gray-500">Tax ID: 01055xxxxxxxx</p></div>
                            <div className="text-[10px] font-mono mb-4 border-b border-dashed border-gray-300 pb-4"><div className="flex justify-between mb-1"><span>Receipt No:</span> <span className="font-bold">{receiptData.receipt_no}</span></div><div className="flex justify-between mb-1"><span>Date:</span> <span>{new Date(receiptData.sold_at).toLocaleString('th-TH')}</span></div><div className="flex justify-between mb-1"><span>Cashier:</span> <span>{receiptData.cashier}</span></div><div className="flex justify-between"><span>Customer:</span> <span>{receiptData.customer_name}</span></div></div>
                            <div className="mb-4 border-b border-dashed border-gray-300 pb-4"><div className="text-[10px] font-bold uppercase mb-2">Items</div>
                                {receiptData.items.map((item: any, idx: number) => (<div key={idx} className="text-[10px] mb-2"><div className="flex justify-between font-bold"><span className="truncate pr-2">{item.name}</span><span>{item.qty} x {item.price.toLocaleString()}</span></div>{item.type === 'DEVICE' && (<div className="text-[9px] text-gray-500">IMEI/SN: {item.code}</div>)}<div className="text-right mt-0.5">฿{(item.price * item.qty).toLocaleString()}</div></div>))}
                            </div>
                            <div className="text-[10px] mb-6"><div className="flex justify-between mb-1"><span>Subtotal:</span> <span>฿{receiptData.subtotal.toLocaleString()}</span></div>{receiptData.discount > 0 && <div className="flex justify-between mb-1 text-red-500"><span>Discount:</span> <span>-฿{receiptData.discount.toLocaleString()}</span></div>}<div className="flex justify-between font-black text-sm mt-2 pt-2 border-t border-gray-200"><span>TOTAL:</span> <span>฿{receiptData.grand_total.toLocaleString()}</span></div></div>
                            <div className="text-[10px] mb-6 border-b border-dashed border-gray-300 pb-4"><div className="flex justify-between mb-1"><span>Payment Method:</span> <span>{receiptData.payment_method}</span></div>{receiptData.payment_method === 'CASH' && (<><div className="flex justify-between mb-1"><span>Cash Received:</span> <span>฿{receiptData.receivedAmount.toLocaleString()}</span></div><div className="flex justify-between"><span>Change:</span> <span>฿{receiptData.changeAmount.toLocaleString()}</span></div></>)}</div>
                            <div className="text-center text-[9px] text-gray-500"><p className="font-bold text-black mb-1">Thank you for your purchase!</p><p>สินค้าซื้อแล้วไม่รับเปลี่ยนคืนทุกกรณี</p><p>โปรดเก็บใบเสร็จเพื่อเป็นหลักฐานการรับประกัน</p></div>
                        </div>
                        <div className="flex flex-col gap-3 print:hidden">
                            <button onClick={() => window.print()} className="bg-blue-600 text-white p-4 rounded-2xl shadow-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 w-48 font-black uppercase text-sm"><Printer size={20} /> Print Receipt</button>
                            <button onClick={handleFinishSale} className="bg-white text-slate-700 p-4 rounded-2xl shadow-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 w-48 font-black uppercase text-sm border border-slate-200"><ScanLine size={20} /> New Sale</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};