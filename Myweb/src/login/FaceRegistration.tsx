import {
  useState,
  useRef,
  useEffect,
  useCallback,
  FC
} from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../supabaseClient'
import { useAuth } from './AuthContext'
import config from '../config'
// ========== [เพิ่ม] Import MediaPipe ==========
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
// ==============================================

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

// ========== [เพิ่ม] Threshold มุมหน้า ==========
// ratio = (nose.x - leftEar.x) / (rightEar.x - leftEar.x)
// หน้าตรง: 0.35 - 0.65
// หันซ้าย: < 0.22 
// หันขวา: > 0.78
const POSE_THRESHOLDS = {
  front: { min: 0.35, max: 0.65 },
  left:  { min: 0.78, max: 1.0  },  
  right: { min: 0.0,  max: 0.22 } 
}
// ================================================

const FaceRegistration: FC<FaceRegistrationProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [capturedPhotos, setCapturedPhotos] = useState<Photo[]>([])
  const [uploading, setUploading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [cameraActive, setCameraActive] = useState<boolean>(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)

  // ========== [เพิ่ม] State สำหรับ MediaPipe ==========
  const [poseReady, setPoseReady] = useState<boolean>(false)       // ปุ่มถ่ายรูปพร้อมกดหรือยัง
  const [poseGuide, setPoseGuide] = useState<string>('กำลังโหลด...') // ข้อความแนะนำผู้ใช้
  const [mpLoaded, setMpLoaded] = useState<boolean>(false)          // MediaPipe โหลดเสร็จหรือยัง
  // ====================================================

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // ========== [เพิ่ม] Ref สำหรับ MediaPipe ==========
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  const animationRef = useRef<number>(0)
  const currentStepRef = useRef<number>(0) // ใช้ใน loop โดยไม่ต้อง re-render
  // ===================================================


  //delay for testing
  const [poseHoldProgress, setPoseHoldProgress] = useState<number>(0) // 0-100
  const poseHoldStartRef = useRef<number | null>(null) // เวลาที่เริ่มจับ Pose
  const HOLD_DURATION = 3000 // 3 วินาที


  const { user } = useAuth()
  const FASTAPI_URL: string = config.BACKEND_URL

  // ===== sync currentStep → currentStepRef =====
  useEffect(() => {
    currentStepRef.current = currentStep
  }, [currentStep])

  // ===== เริ่มกล้อง =====
  useEffect(() => {
    startCamera()
    return () => {
      stopCamera()
      cancelAnimationFrame(animationRef.current)  // [เพิ่ม] หยุด loop ตอน unmount
    }
  }, [])

  // ========== [เพิ่ม] โหลด MediaPipe FaceLandmarker ==========
  useEffect(() => {
    const loadMediaPipe = async () => {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )
        const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numFaces: 1
        })
        faceLandmarkerRef.current = landmarker
        setMpLoaded(true)
        setPoseGuide('จัดหน้าให้ตรงกับท่าทางที่กำหนด')
      } catch (err) {
        console.error('MediaPipe load error:', err)
        // ถ้าโหลดไม่ได้ ให้กดถ่ายได้เลยเพื่อไม่ให้ blocking
        setMpLoaded(true)
        setPoseReady(true)
        setPoseGuide('ไม่สามารถโหลด Face Detection ได้')
      }
    }
    loadMediaPipe()
  }, [])
  // ============================================================

  // ========== [เพิ่ม] Loop ตรวจจับมุมหน้าทุก Frame ==========
  const detectLoop = useCallback(() => {
    const video = videoRef.current
    const landmarker = faceLandmarkerRef.current

    if (!video || !landmarker || video.readyState < 2) {
      animationRef.current = requestAnimationFrame(detectLoop)
      return
    }

    try {
      const results = landmarker.detectForVideo(video, performance.now())

      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0]

        const nose     = landmarks[1]
        const leftEar  = landmarks[234]
        const rightEar = landmarks[454]
        const forehead = landmarks[10]
        const chin     = landmarks[152]

        const yawRatio   = (nose.x - leftEar.x) / (rightEar.x - leftEar.x)
        const pitchRatio = (nose.y - forehead.y) / (chin.y - forehead.y)
        const isPitchOk = pitchRatio >= 0.44 && pitchRatio <= 0.60

        const step = currentStepRef.current
        const pose = POSES[step]
        const threshold = POSE_THRESHOLDS[pose.id as keyof typeof POSE_THRESHOLDS]

        const isYawOk = yawRatio >= threshold.min && yawRatio <= threshold.max
        const isReady = isYawOk && isPitchOk

        setPoseReady(isReady)

        if (isReady) {
  // เริ่มจับเวลา
          if (!poseHoldStartRef.current) {
            poseHoldStartRef.current = performance.now()
          }
          const elapsed = performance.now() - poseHoldStartRef.current
          const progress = Math.min((elapsed / HOLD_DURATION) * 100, 100)
          setPoseHoldProgress(progress)

          if (elapsed >= HOLD_DURATION) {
            setPoseReady(true)
            setPoseGuide('✅ พร้อมถ่าย! กด ถ่ายรูป ได้เลย')
          } else {
            setPoseReady(false)
            setPoseGuide(`🕐 ค้างไว้... ${Math.ceil((HOLD_DURATION - elapsed) / 1000)} วินาที`)
          }
        } else {
          // ขยับออก → reset
          poseHoldStartRef.current = null
          setPoseHoldProgress(0)
          setPoseReady(false)

          if (!isPitchOk) {
            setPoseGuide(pitchRatio > 0.44 ? 'กรุณาเงยหน้าขึ้น' : 'กรุณาก้มหน้าลง')
          } else {
            if (pose.id === 'front') {
              setPoseGuide('กรุณาหันหน้าตรงเข้ากล้อง')
            } else if (pose.id === 'left') {
              setPoseGuide('กรุณาหันหน้าไปทางซ้าย')
            } else {
              setPoseGuide('กรุณาหันหน้าไปทางขวา')
            }
          }
        }
      } else {
        setPoseReady(false)
        setPoseGuide('ไม่พบใบหน้า กรุณาเข้ามาในกรอบ')
      }
    } catch (e) {
      // ignore frame error
    }

    animationRef.current = requestAnimationFrame(detectLoop)
  }, [])

  // เริ่ม loop หลังจาก MediaPipe โหลดเสร็จและกล้องพร้อม
  useEffect(() => {
    if (mpLoaded && cameraActive) {
      animationRef.current = requestAnimationFrame(detectLoop)
    }
    return () => cancelAnimationFrame(animationRef.current)
  }, [mpLoaded, cameraActive, detectLoop])
  // ============================================================

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
    // ========== [เพิ่ม] เช็คว่า Pose พร้อมก่อนถ่าย ==========
    if (!poseReady) return
    // =========================================================

    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
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

        // ========== [เพิ่ม] Reset poseReady หลังถ่าย ==========
        setPoseReady(false)
        setPoseGuide('จัดหน้าให้ตรงกับท่าทางถัดไป')
        // ========================================================

        if (currentStep < POSES.length - 1) {
          setCurrentStep(currentStep + 1)
        }
      }
    }, 'image/jpeg', 0.9)
  }

  const retakePhoto = (index: number) => {
    setCurrentStep(index)
    // ========== [เพิ่ม] Reset poseReady ตอนถ่ายใหม่ ==========
    setPoseReady(false)
    // ==========================================================
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

    // [เพิ่ม] หยุด loop ตอน submit
    cancelAnimationFrame(animationRef.current)

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

      Swal.fire({
        icon: 'success',
        title: 'ลงทะเบียนใบหน้าสำเร็จ!',
        text: 'กำลังพาคุณกลับไปยังหน้าเข้าสู่ระบบ...',
        timer: 3000,
        showConfirmButton: false,
        allowOutsideClick: false
      }).then(() => {
        stopCamera()
        onComplete()
      })
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์')
      // [เพิ่ม] เริ่ม loop ใหม่ถ้า submit ล้มเหลว
      animationRef.current = requestAnimationFrame(detectLoop)
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
                style={{ transform: 'scaleX(-1)' }}
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Guide Overlay */}
              <div className="absolute inset-0 border-[20px] border-black/40 rounded-2xl pointer-events-none"></div>

              {/* ========== [เพิ่ม] กรอบเปลี่ยนสีตาม poseReady ========== */}
              <div className={`absolute inset-10 border-2 border-dashed rounded-full pointer-events-none transition-colors duration-300 ${
                poseReady ? 'border-green-400' : 'border-white/30'
              }`}></div>
              {/* ========================================================= */}

              {/* Pose Instruction Overlay */}
              <div className="absolute top-6 left-0 right-0 text-center">
                <span className="bg-white/20 backdrop-blur-md text-white px-6 py-2 rounded-full text-lg font-medium border border-white/20">
                  {POSES[currentStep].label} {POSES[currentStep].icon}
                </span>
              </div>

              {/* ========== [เพิ่ม] แสดง poseGuide ใต้กรอบ ========== */}
              <div className="absolute bottom-24 left-0 right-0 text-center">
                <span className={`backdrop-blur-md px-4 py-1.5 rounded-full text-sm font-medium border transition-colors duration-300 ${
                  poseReady
                    ? 'bg-green-500/80 text-white border-green-400'
                    : 'bg-black/40 text-white/80 border-white/10'
                }`}>
                  {poseGuide}
                </span>
              </div>
              
              {/* ====================================================== */}
            </div>

            {/* ========== [เพิ่ม] ปุ่มถ่ายรูปเปลี่ยนสีตาม poseReady ========== */}
            <button
              onClick={capturePhoto}
              disabled={uploading || !cameraActive || !poseReady}
              className={`absolute bottom-12 backdrop-blur-md text-gray-900 w-14 h-14 rounded-full flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-all border ${
                poseReady
                  ? 'bg-white/90 border-white/50 cursor-pointer'
                  : 'bg-white/30 border-white/20 cursor-not-allowed opacity-50'
              }`}
            >
              <div className={`w-14 h-14 border-4 rounded-full shadow-sm transition-colors duration-300 ${
                poseReady ? 'border-green-400 bg-white' : 'border-gray-900/10 bg-white'
              }`}></div>
            </button>
            {/* ============================================================= */}
          </div>

          {/* Right Side: Status & Preview */}
          <div className="md:w-1/3 p-10 flex flex-col">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900 mb-2">ลงทะเบียนใบหน้า</h2>
            <p className="text-gray-500 mb-8 text-sm font-medium">ถ่ายรูปภาพ 3 ท่าทางเพื่อยืนยันตัวตน</p>

            {/* ========== [เพิ่ม] แสดงสถานะ MediaPipe ========== */}
            <div className={`mb-4 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 ${
              mpLoaded ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
            }`}>
              <div className={`w-2 h-2 rounded-full ${mpLoaded ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></div>
              {mpLoaded ? 'Face Detection พร้อมใช้งาน' : 'กำลังโหลด Face Detection...'}
            </div>
            {/* ================================================= */}

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
                    กำลังบันทึกข้อมูล... ใช้เวลาประมาณ 3 นาที
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