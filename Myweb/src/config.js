const config = {
  // Backend URL configuration with fallback
  BACKEND_URL: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
  
  // Supabase configuration
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL="https://xcnyynemxwhementtkdl.supabase.co",
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_zcTwxxNxmCmOtzQBt7xQjg_aTmixZzs",
  
  // API timeout settings
  API_TIMEOUT: 30000, // 30 seconds
}

// เพิ่ม export default
export default config;

export const apiRequest = async (endpoint, options = {}) => {
  const baseURL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
  const url = `${baseURL}${endpoint}`;
  
  console.log(`🔗 API Request: ${options.method || 'GET'} ${url}`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      // เพิ่ม timeout
      signal: AbortSignal.timeout(30000), // 30 seconds
    });
    
    console.log(`📡 Response Status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`✅ API Success:`, data);
    return data;
    
  } catch (error) {
    console.error(`❌ API Error:`, error);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - กรุณาลองใหม่อีกครั้ง');
    }
    
    if (error.message.includes('Failed to fetch')) {
      throw new Error('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
    }
    
    throw error;
  }
};

// ใช้ในส่วนต่าง ๆ แทน fetch
// ตัวอย่าง:
export const testConnection = async () => {
  try {
    const result = await apiRequest('/api/test');
    return result;
  } catch (error) {
    console.error('Connection test failed:', error);
    throw error;
  }
};