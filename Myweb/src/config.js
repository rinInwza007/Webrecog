// config.js
// กำหนด URL ของ Backend
// ถ้า deploy บน Vercel จะใช้ค่า NEXT_PUBLIC_BACKEND_URL
// ถ้าไม่มี (เช่นตอนรัน local) จะ fallback เป็น localhost:8000

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
