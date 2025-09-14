import { useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabaseClient'

const Register = ({ onSwitchToLogin, onRegistrationSuccess }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    schoolId: '', 
    role: 'student'
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { signUp } = useAuth()

  // สร้าง school_id อัตโนมัติ
  const generateSchoolId = (fullName, role) => {
    const timestamp = Date.now().toString().slice(-6) // เอา 6 หลักสุดท้าย
    const namePrefix = fullName.replace(/\s+/g, '').toLowerCase().slice(0, 3)
    const rolePrefix = role === 'student' ? 'STD' : 'TCH'
    return `${rolePrefix}${namePrefix}${timestamp}`.toUpperCase()
  }

  const handleSubmit = async (e) => {
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
        .single()

      if (existingUser) {
        setError('รหัสนักเรียน/อาจารย์นี้มีอยู่แล้ว กรุณาใช้รหัสอื่น')
        setLoading(false)
        return
      }

      // Sign up with Supabase Auth
      const { data, error: signUpError } = await signUp(
        formData.email,
        formData.password,
        {
          full_name: formData.fullName,
          role: formData.role,
          school_id: schoolId
        }
      )

      if (signUpError) {
        setError(signUpError.message)
        return
      }

      if (data.user) {
        // Insert user data into users table
        const { error: insertError } = await supabase
          .from('users')
          .insert([
            {
              user_id: data.user.id,
              email: formData.email,
              full_name: formData.fullName,
              school_id: schoolId, // เพิ่ม school_id
              role: formData.role,
              password_hash: 'managed_by_supabase_auth', // Placeholder since Supabase manages this
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ])

        if (insertError) {
          console.error('Error inserting user data:', insertError)
          setError('เกิดข้อผิดพลาดในการบันทึกข้อมูลผู้ใช้: ' + insertError.message)
          return
        }

        console.log('User registered successfully:', {
          user_id: data.user.id,
          email: formData.email,
          full_name: formData.fullName,
          school_id: schoolId,
          role: formData.role
        })

        // Success - call the callback to proceed to next step
        onRegistrationSuccess(data.user, formData.role)
      }
    } catch (err) {
      console.error('Registration error:', err)
      setError('เกิดข้อผิดพลาดในการสมัครสมาชิก: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-xl shadow-lg">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            สมัครสมาชิก
          </h2>
          <p className="text-gray-600">สร้างบัญชีใหม่สำหรับระบบเช็คชื่อ AI</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
              ชื่อ-นามสกุล *
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              value={formData.fullName}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
              placeholder="กรอกชื่อ-นามสกุล"
            />
          </div>

          <div>
            <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-2">
              ประเภทผู้ใช้ *
            </label>
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
            >
              <option value="student">นักเรียน</option>
              <option value="teacher">อาจารย์</option>
            </select>
          </div>

          <div>
            <label htmlFor="schoolId" className="block text-sm font-medium text-gray-700 mb-2">
              รหัส{formData.role === 'student' ? 'นักเรียน' : 'อาจารย์'}
              <span className="text-gray-500 text-xs ml-1">(ไม่บังคับ - ระบบจะสร้างให้อัตโนมัติ)</span>
            </label>
            <input
              id="schoolId"
              name="schoolId"
              type="text"
              value={formData.schoolId}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
              placeholder={`เช่น ${formData.role === 'student' ? 'STD001' : 'TCH001'} (หรือปล่อยว่างไว้)`}
              maxLength={20}
            />
            {formData.fullName && !formData.schoolId && (
              <p className="text-xs text-gray-500 mt-1">
                ระบบจะสร้างรหัสให้อัตโนมัติ: {generateSchoolId(formData.fullName, formData.role)}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              อีเมล *
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={formData.email}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              รหัสผ่าน *
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={formData.password}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
              ยืนยันรหัสผ่าน *
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              value={formData.confirmPassword}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          {/* แสดงข้อมูลที่จะถูกบันทึก */}
          {formData.fullName && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <h4 className="text-sm font-medium text-green-800 mb-2">ข้อมูลที่จะบันทึก:</h4>
              <ul className="text-xs text-green-700 space-y-1">
                <li>• ชื่อ: {formData.fullName}</li>
                <li>• ประเภท: {formData.role === 'student' ? 'นักเรียน' : 'อาจารย์'}</li>
                <li>• รหัส: {formData.schoolId || generateSchoolId(formData.fullName, formData.role)}</li>
                <li>• อีเมล: {formData.email}</li>
              </ul>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                กำลังสมัครสมาชิก...
              </div>
            ) : (
              '🚀 สมัครสมาชิก'
            )}
          </button>

          <div className="text-center">
            <span className="text-gray-600">มีบัญชีแล้ว? </span>
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-green-600 hover:text-green-700 font-medium"
            >
              เข้าสู่ระบบ
            </button>
          </div>
        </form>

        {/* ข้อมูลเพิ่มเติม */}
        <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600">
          <h4 className="font-medium text-gray-800 mb-2">หมายเหตุ:</h4>
          <ul className="space-y-1">
            <li>• รหัสนักเรียน/อาจารย์จะใช้สำหรับระบบ Face Recognition</li>
            <li>• ถ้าไม่กรอกรหัส ระบบจะสร้างให้อัตโนมัติ</li>
            <li>• นักเรียนจะต้องลงทะเบียนใบหน้าในขั้นตอนถัดไป</li>
            <li>• อาจารย์สามารถใช้งานระบบได้ทันที</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Register