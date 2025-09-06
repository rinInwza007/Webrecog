import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://cykbwnxcvdszxlypzucy.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5a2J3bnhjdmRzenhseXB6dWN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzIwMDEwMDMsImV4cCI6MjA0NzU3NzAwM30.t51vDsflnqzKVic9tZ_uFpiaS_6RO3J3gOeMJdm0lvo'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)