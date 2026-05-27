import { useState, FormEvent, ChangeEvent, FC } from 'react'
import { useAuth } from './AuthContext'
import { useNavigate } from 'react-router-dom'
import Swal from 'sweetalert2'
import image from '../utils/logo/image.png'
import type { AuthError } from '@supabase/supabase-js'

interface LoginProps {
  onSwitchToRegister: () => void
}

const Login: FC<LoginProps> = ({ onSwitchToRegister }) => {
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
  }

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await signIn(email, password)

      if (result.error) {
        const authError = result.error as AuthError
        let errorMessage = 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ'
        
        if (authError.message === 'Invalid login credentials') {
          errorMessage = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
        } else if (authError.message === 'Email not confirmed') {
          errorMessage = 'กรุณายืนยันอีเมลของคุณก่อนเข้าสู่ระบบ'
        } else {
          errorMessage = authError.message
        }

        setError(errorMessage)
        Swal.fire({
          icon: 'error',
          title: 'เข้าสู่ระบบไม่สำเร็จ',
          text: errorMessage,
          confirmButtonColor: '#0071e3'
        })
        return
      }

      console.log('Login success:', email)
      // redirect จะถูกจัดการโดย AppRouter อัตโนมัติเมื่อ appUser ใน AuthContext อัปเดต
    } catch (err) {
      console.error('Login error:', err)
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ'
      setError(message)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: message,
        confirmButtonColor: '#0071e3'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-8 p-10 glass-card">
        <div className="flex justify-center">
          <div className="bg-white/50 p-4 rounded-3xl backdrop-blur-sm shadow-sm">
            <img src={image} alt="Logo" className="h-32 w-32 object-contain" />
          </div>
        </div>
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">
            เข้าสู่ระบบ
          </h2>
          <p className="text-gray-500 font-medium">ระบบเช็คชื่อด้วย Face Recognition</p>
        </div>

        {error && (
          <div className="bg-red-50/50 backdrop-blur-md border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              อีเมล
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={handleEmailChange}
              className="w-full apple-input"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-600 mb-2 ml-1">
              รหัสผ่าน
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={handlePasswordChange}
              className="w-full apple-input"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full apple-button-primary mt-2"
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full mr-3"></div>
                กำลังเข้าสู่ระบบ...
              </div>
            ) : (
              'เข้าสู่ระบบ'
            )}
          </button>

          <div className="text-center pt-2">
            <span className="text-gray-500 text-sm">ยังไม่มีบัญชี? </span>
            <button
              type="button"
              onClick={onSwitchToRegister}
              className="text-[#0071e3] hover:underline font-semibold text-sm"
            >
              สมัครสมาชิก
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Login
