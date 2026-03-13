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

    const options = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1280,
      useWebWorker: true,
      fileType: 'image/jpeg'
    };

    console.log(`[Before] ขนาดไฟล์ต้นฉบับ: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
    
    // 🌟 2. สั่งบีบอัด!
    const compressedFile = await imageCompression(file, options);
    
    console.log(`[After] ขนาดไฟล์หลังบีบอัด: ${(compressedFile.size / 1024 / 1024).toFixed(2)} MB`);

    // 3. จัดการตั้งชื่อไฟล์ใหม่ (บังคับให้เป็น .jpg เพราะเราแปลงไฟล์แล้ว)
    const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const fileName = `${Date.now()}_${originalName.replace(/[^a-zA-Z0-9]/g, '')}.jpg`; 
    const fullPath = `${path}/${fileName}`;
    
    const storageRef = ref(storage, fullPath);

    // 4. โยนไฟล์ "ที่บีบอัดแล้ว" (compressedFile) ขึ้น Firebase Storage
    const snapshot = await uploadBytes(storageRef, compressedFile);
    return await getDownloadURL(snapshot.ref);
    
  } catch (error) {
    console.error("Upload or Compression failed:", error);
    throw error;
  }
};