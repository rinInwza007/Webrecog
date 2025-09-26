// Configuration file for environment variables
// สำหรับ Vite ใช้ import.meta.env แทน process.env
// และต้องขึ้นต้นด้วย VITE_ เท่านั้น

const config = {
  // Backend URL configuration
  BACKEND_URL: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
  
  // Supabase configuration (เก็บไว้ที่เดิม)
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || 'https://cykbwnxcvdszxlypzucy.supabase.co',
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5a2J3bnhjdmRzenhseXB6dWN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzIwMDEwMDMsImV4cCI6MjA0NzU3NzAwM30.t51vDsflnqzKVic9tZ_uFpiaS_6RO3J3gOeMJdm0lvo'
}

// Log configuration for debugging (เฉพาะ development)
if (import.meta.env.DEV) {
  console.log('🔧 Configuration loaded:', {
    BACKEND_URL: config.BACKEND_URL,
    NODE_ENV: import.meta.env.MODE,
    IS_PRODUCTION: import.meta.env.PROD
  })
}

export default config