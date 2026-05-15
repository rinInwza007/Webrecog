import { useState, ChangeEvent, FormEvent, FC } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from '../supabaseClient'
import type { User as SupabaseUser, AuthError } from '@supabase/supabase-js'
import type { User as AppUser } from '../types/user'
import type { UserRole } from '../types/common'

interface RegisterProps {
  onSwitchToLogin: () => void
  onRegistrationSuccess: (user: SupabaseUser, role: UserRole) => void
}

interface FormData {
  email: string
  password: string
  confirmPassword: string
  fullName: string
  schoolId: string
  role: UserRole
}

const Register: FC<RegisterProps> = ({ onSwitchToLogin, onRegistrationSuccess }) => {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    schoolId: '',
    role: 'student'
  })
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('') // ข้อความแสดงความสำเร็จหลังสมัครสมาชิก
  const { signUp } = useAuth()

  // สร้าง school_id อัตโนมัติ
  const generateSchoolId = (fullName: string, role: UserRole): string => {
    const timestamp = Date.now().toString().slice(-6) // เอา 6 หลักสุดท้าย
    const namePrefix = fullName.replace(/\s+/g, '').toLowerCase().slice(0, 3)
    const rolePrefix = role === 'student' ? 'STD' : 'TCH'
    return `${rolePrefix}${namePrefix}${timestamp}`.toUpperCase()
  }

  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ): void => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Validate form
    if (formData.password !== formData.confirmPassword) {
      setError('รหัสผ่านไม่ตรงกัน')
      setLoading(false)
      return
    }

    if (formData.password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      setLoading(false)
      return
    }

    if (!formData.fullName.trim()) {
      setError('กรุณากรอกชื่อ-นามสกุล')
      setLoading(false)
      return
    }

    try {
      // สร้าง school_id อัตโนมัติถ้าไม่มีการกรอก
      let schoolId = formData.schoolId.trim()
      if (!schoolId) {
        schoolId = generateSchoolId(formData.fullName, formData.role)
      }

      // ตรวจสอบว่า school_id ซ้ำหรือไม่
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('school_id')
        .eq('school_id', schoolId)
        .maybeSingle()

      if (checkError) {
        setError('เกิดข้อผิดพลาดในการตรวจสอบข้อมูล')
        setLoading(false)
        return
      }

      if (existingUser) {
        setError('รหัสนักเรียน/อาจารย์นี้มีอยู่แล้ว กรุณาใช้รหัสอื่น')
        setLoading(false)
        return
      }

      // Sign up with Supabase Auth
      const result = await signUp(formData.email, formData.password, {
        full_name: formData.fullName,
        role: formData.role,
        school_id: schoolId
      })

      if (result.error) {
        const authError = result.error as AuthError
        setError(authError.message || 'เกิดข้อผิดพลาดในการสมัครสมาชิก')
        return
      }

      if (result.data?.user) {
        const authUser = result.data.user as SupabaseUser

        // Insert user data into users table
        const appUserData: AppUser = {
          user_id: authUser.id,
          email: formData.email,
          full_name: formData.fullName,
          school_id: schoolId,
          role: formData.role,
          password_hash: 'managed_by_supabase_auth',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }

        const { error: insertError } = await supabase
          .from('users')
          .insert([appUserData])

        if (insertError) {
          console.error('Error inserting user data:', insertError)
          setError('เกิดข้อผิดพลาดในการบันทึกข้อมูลผู้ใช้: ' + insertError.message)
          return
        }

        console.log('User registered successfully:', appUserData)

        // Success - call the callback to proceed to next step
        //onRegistrationSuccess(authUser, formData.role)
        if (formData.role === 'teacher') {
          setSuccess('สมัครสมาชิกสำเร็จ!')
          setTimeout(() => {
            onRegistrationSuccess(authUser, formData.role)
          }, 3000)
        } else {
          onRegistrationSuccess(authUser, formData.role)
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error('Registration error:', err)
      setError('เกิดข้อผิดพลาดในการสมัครสมาชิก: ' + errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      {success && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-white/30 backdrop-blur-md" />
        <div className="relative w-[90vw] max-w-lg bg-white/60 backdrop-blur-xl border border-white/50 rounded-3xl shadow-2xl p-12 flex flex-col items-center gap-6">
          <div className="w-24 h-24 rounded-full bg-green-100/80 flex items-center justify-center text-5xl shadow-inner">
            ✅
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold text-gray-900">
              {formData.role === 'teacher' ? 'สมัครสมาชิกสำเร็จ!' : 'สมัครสมาชิกสำเร็จ!'}
            </h2>
            <p className="text-gray-500 text-sm">
              {formData.role === 'teacher' 
                ? 'กำลังกลับไปที่หน้าเข้าสู่ระบบ...' 
                : 'กำลังไปยังขั้นตอนลงทะเบียนใบหน้า...'}
            </p>
          </div>
          <div className="animate-spin h-6 w-6 border-2 border-gray-200 border-t-green-500 rounded-full" />
        </div>
      </div>
    )}
      <div className="max-w-md w-full space-y-8 p-10 glass-card">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">
            สมัครสมาชิก
          </h2>
          <p className="text-gray-500 font-medium">สร้างบัญชีใหม่สำหรับระบบเช็คชื่อ AI</p>
        </div>

        {error && (
          <div className="bg-red-50/50 backdrop-blur-md border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              ชื่อ-นามสกุล *
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              value={formData.fullName}
              onChange={handleInputChange}
              className="w-full apple-input"
              placeholder="กรอกชื่อ-นามสกุล"
            />
          </div>

          <div>
            <label htmlFor="role" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              ประเภทผู้ใช้ *
            </label>
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={handleInputChange}
              className="w-full apple-input appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M5%207.5L10%2012.5L15%207.5%22%20stroke%3D%22%236B7280%22%20stroke-width%3D%221.66667%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E')] bg-[length:20px_20px] bg-[right_1rem_center] bg-no-repeat"
            >
              <option value="student">นักเรียน</option>
              <option value="teacher">อาจารย์</option>
            </select>
          </div>

          <div>
            <label htmlFor="schoolId" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              รหัส{formData.role === 'student' ? 'นักเรียน' : 'อาจารย์'}
              <span className="text-gray-400 text-xs ml-1">(ไม่บังคับ - ระบบจะสร้างให้อัตโนมัติ)</span>
            </label>
            <input
              id="schoolId"
              name="schoolId"
              type="text"
              value={formData.schoolId}
              onChange={handleInputChange}
              className="w-full apple-input"
              placeholder={`เช่น ${formData.role === 'student' ? 'STD001' : 'TCH001'} (หรือปล่อยว่างไว้)`}
              maxLength={20}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              อีเมล *
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={formData.email}
              onChange={handleInputChange}
              className="w-full apple-input"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              รหัสผ่าน *
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={formData.password}
              onChange={handleInputChange}
              className="w-full apple-input"
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              ยืนยันรหัสผ่าน *
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              value={formData.confirmPassword}
              onChange={handleInputChange}
              className="w-full apple-input"
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full apple-button-primary mt-4"
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full mr-3"></div>
                กำลังสมัครสมาชิก...
              </div>
            ) : (
              '🚀 สมัครสมาชิก'
            )}
          </button>

          <div className="text-center pt-2">
            <span className="text-gray-500 text-sm">มีบัญชีแล้ว? </span>
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-[#0071e3] hover:underline font-semibold text-sm"
            >
              เข้าสู่ระบบ
            </button>
          </div>
        </form>

        <div className="bg-white/30 backdrop-blur-sm border border-white/40 rounded-2xl p-4 text-xs text-gray-500">
          <h4 className="font-semibold text-gray-700 mb-2 uppercase tracking-wider">หมายเหตุ:</h4>
          <ul className="space-y-1">
            <li>• รหัสนักเรียน/อาจารย์จะใช้สำหรับระบบ Face Recognition</li>
            <li>• ถ้าไม่กรอกรหัส ระบบจะสร้างให้อัตโนมัติ</li>
            <li>• นักเรียนจะต้องลงทะเบียนใบหน้าในขั้นตอนถัดไป</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Register
