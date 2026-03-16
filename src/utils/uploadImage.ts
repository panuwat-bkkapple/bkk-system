// src/utils/uploadImage.ts
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../api/firebase";
import imageCompression from 'browser-image-compression';

export const uploadImageToFirebase = async (file: File, path: string): Promise<string> => {
  try {
    // 🌟 ดักจับไฟล์ต้องห้าม! ถ้าไรเดอร์เลือกไฟล์ .dng จากแอป Files ให้เด้งเตือนเลย
    const fileNameLower = file.name.toLowerCase();
    if (fileNameLower.endsWith('.dng') || fileNameLower.endsWith('.raw') || fileNameLower.endsWith('.heic')) {
       alert(`ระบบไม่รองรับไฟล์รูปภาพดิบ (${file.name})\nกรุณาตั้งค่ากล้องให้ถ่ายเป็น JPEG หรือแคปหน้าจอก่อนอัปโหลดครับ`);
       throw new Error("Unsupported file format: DNG/RAW");
    }

    // PNG/WebP คงฟอร์แมตเดิมเพื่อรักษา transparency, ที่เหลือแปลง JPEG
    const keepFormat = file.type === 'image/png' || file.type === 'image/webp';
    const outputType = keepFormat ? file.type : 'image/jpeg';
    const ext = keepFormat ? (file.type === 'image/png' ? '.png' : '.webp') : '.jpg';

    const options = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1280,
      useWebWorker: true,
      fileType: outputType as string,
    };

    const compressedFile = await imageCompression(file, options);

    const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const fileName = `${Date.now()}_${originalName.replace(/[^a-zA-Z0-9]/g, '')}${ext}`;
    const fullPath = `${path}/${fileName}`;
    
    const storageRef = ref(storage, fullPath);

    // 4. โยนไฟล์ "ที่บีบอัดแล้ว" (compressedFile) ขึ้น Firebase Storage
    const snapshot = await uploadBytes(storageRef, compressedFile);
    return await getDownloadURL(snapshot.ref);
    
  } catch (error) {
    throw error;
  }
};