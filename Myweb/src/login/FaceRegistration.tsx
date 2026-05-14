import {
  useState,
  useRef,
  useEffect,
  FC
} from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from './AuthContext'
import config from '../config'
import type { User as SupabaseUser } from '@supabase/supabase-js'

interface Photo {
  blob: Blob
  preview: string
  pose: string
  label: string
}

interface EnrollmentResult {
  success: boolean
  images_processed: number
  total_images: number
  quality_score: number
  enrollment_type: string
}

interface UserData {
  school_id: string
  email: string
  full_name: string
}

interface FaceRegistrationProps {
  onComplete: () => void
}

const POSES = [
  { id: 'front', label: 'หน้าตรง', icon: '👤' },
  { id: 'left', label: 'หันซ้าย', icon: '👈' },
  { id: 'right', label: 'หันขวา', icon: '👉' }
]

const FaceRegistration: FC<FaceRegistrationProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [capturedPhotos, setCapturedPhotos] = useState<Photo[]>([])
  const [uploading, setUploading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [cameraActive, setCameraActive] = useState<boolean>(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const { user } = useAuth()

  const FASTAPI_URL: string = config.BACKEND_URL

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setCameraActive(true)
      }
    } catch (err) {
      console.error('Error accessing camera:', err)
      setError('ไม่สามารถเข้าถึงกล้องได้ กรุณาตรวจสอบการอนุญาตใช้งานกล้อง')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    
    // Flip horizontal for natural preview if needed, but here we just capture as is
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    
    canvas.toBlob((blob) => {
      if (blob) {
        const preview = URL.createObjectURL(blob)
        const newPhoto: Photo = {
          blob,
          preview,
          pose: POSES[currentStep].id,
          label: POSES[currentStep].label
        }

        const updatedPhotos = [...capturedPhotos]
        updatedPhotos[currentStep] = newPhoto
        setCapturedPhotos(updatedPhotos)

        if (currentStep < POSES.length - 1) {
          setCurrentStep(currentStep + 1)
        }
      }
    }, 'image/jpeg', 0.9)
  }

  const retakePhoto = (index: number) => {
    setCurrentStep(index)
  }

  const getUserData = async (): Promise<UserData | null> => {
    try {
      if (!user) throw new Error('User not authenticated')
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('school_id, email, full_name')
        .eq('user_id', user.id)
        .single()

      if (userError) throw userError
      return userData as UserData
    } catch (error) {
      console.error('Error getting user data:', error)
      return null
    }
  }

  const handleSubmit = async () => {
    if (capturedPhotos.length < POSES.length) {
      setError('กรุณาถ่ายรูปให้ครบทุกท่าทาง')
      return
    }

    setUploading(true)
    setError('')
    setUploadProgress(0)

    try {
      const userData = await getUserData()
      if (!userData) throw new Error('ไม่พบข้อมูลผู้ใช้')

      const formData = new FormData()
      formData.append('student_id', userData.school_id)
      formData.append('student_email', userData.email)

      capturedPhotos.forEach((photo) => {
        formData.append('images', photo.blob, `${photo.pose}.jpg`)
      })

      setUploadProgress(50)

      const response = await fetch(`${FASTAPI_URL}/api/face/enroll-advanced`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'การลงทะเบียนใบหน้าล้มเหลว')
      }

      const result = await response.json() as EnrollmentResult
      setUploadProgress(100)
      setSuccess('✅ ลงทะเบียนใบหน้าสำเร็จ! กำลังเข้าสู่ระบบ...')
      
      setTimeout(() => {
        onComplete()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-4xl w-full glass-card overflow-hidden">
        <div className="md:flex">
          {/* Left Side: Camera & Capture */}
          <div className="md:w-2/3 p-8 bg-black/5 flex flex-col items-center justify-center relative min-h-[500px]">
            <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-inner bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }} // Mirror for user
              />
              
              {/* Guide Overlay */}
              <div className="absolute inset-0 border-[20px] border-black/40 rounded-2xl pointer-events-none"></div>
              <div className="absolute inset-10 border-2 border-white/30 border-dashed rounded-full pointer-events-none"></div>
              
              {/* Pose Instruction Overlay */}
              <div className="absolute top-6 left-0 right-0 text-center">
                <span className="bg-white/20 backdrop-blur-md text-white px-6 py-2 rounded-full text-lg font-medium border border-white/20">
                  {POSES[currentStep].label} {POSES[currentStep].icon}
                </span>
              </div>
            </div>

            <button
              onClick={capturePhoto}
              disabled={uploading || !cameraActive}
              className="absolute bottom-12 bg-white/90 backdrop-blur-md text-gray-900 w-20 h-20 rounded-full flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-all disabled:opacity-50 border border-white/50"
            >
              <div className="w-14 h-14 border-4 border-gray-900/10 rounded-full bg-white shadow-sm"></div>
            </button>
          </div>

          {/* Right Side: Status & Preview */}
          <div className="md:w-1/3 p-10 flex flex-col">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900 mb-2">ลงทะเบียนใบหน้า</h2>
            <p className="text-gray-500 mb-8 text-sm font-medium">ถ่ายรูปภาพ 3 ท่าทางเพื่อยืนยันตัวตน</p>

            <div className="space-y-3 flex-1">
              {POSES.map((pose, index) => (
                <div 
                  key={pose.id}
                  onClick={() => capturedPhotos[index] && retakePhoto(index)}
                  className={`flex items-center p-4 rounded-2xl border transition-all cursor-pointer ${
                    currentStep === index 
                      ? 'border-[#0071e3] bg-[#0071e3]/5 shadow-sm' 
                      : capturedPhotos[index] 
                        ? 'border-green-200 bg-green-50/50' 
                        : 'border-gray-100 bg-gray-50/50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-4 text-xs font-bold ${
                    capturedPhotos[index] ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                    {capturedPhotos[index] ? '✓' : index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm text-gray-800">{pose.label}</p>
                    <p className="text-xs text-gray-400">{capturedPhotos[index] ? 'บันทึกแล้ว' : 'ยังไม่ได้ถ่าย'}</p>
                  </div>
                  {capturedPhotos[index] && (
                    <img 
                      src={capturedPhotos[index].preview} 
                      alt="preview" 
                      className="w-12 h-12 rounded-xl object-cover border-2 border-white shadow-sm"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 pt-8 border-t border-gray-100">
              {error && (
                <div className="mb-4 text-xs text-red-600 bg-red-50/50 backdrop-blur-sm p-3 rounded-xl border border-red-100">
                  ⚠️ {error}
                </div>
              )}
              {success && (
                <div className="mb-4 text-xs text-green-600 bg-green-50/50 backdrop-blur-sm p-3 rounded-xl border border-green-100">
                  {success}
                </div>
              )}
              
              <button
                onClick={handleSubmit}
                disabled={uploading || capturedPhotos.length < POSES.length}
                className="w-full apple-button-primary py-4"
              >
                {uploading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full mr-3"></div>
                    กำลังบันทึกข้อมูล...
                  </div>
                ) : (
                  'บันทึกใบหน้าทั้งหมด'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FaceRegistration


