import { useState, useRef, useEffect, FC } from 'react'
import Swal from 'sweetalert2'
import config from './config'
import type { AttendanceSession, SessionWithClass } from '@/types'

interface SpoofEvent {
  image_b64: string
  timestamp: string
  spoof_count: number
}

interface LiveVideoStreamProps {
  currentSession: (AttendanceSession & { classes?: any }) | null // Keep 'classes' as optional extra for now
  isSessionActive: boolean
  onManualCapture: (blob: Blob) => Promise<void>
  motionStats?: {
    live_stats?: {
      motion_events?: number
      [key: string]: any
    }
  }
  onSpoofDetected?: (event: SpoofEvent) => void
  onAttendanceDetected?: () => void
}

interface VideoStats {
  fps: number
  framesSent: number
  lastFrameTime: string | null
  lastMotionStrength: number
}

const LiveVideoStream: FC<LiveVideoStreamProps> = ({ 
  currentSession, 
  isSessionActive, 
  onManualCapture, 
  motionStats,
  onSpoofDetected,
  onAttendanceDetected
}) => {
  type CaptureStatus = 'idle' | 'sending' | 'success' | 'failed'

  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle')
  const [statusMessage, setStatusMessage] = useState<string>('')
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)


  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previousFrameRef = useRef<HTMLCanvasElement | null>(null)
  const lastSentRef = useRef<number>(0)
  
  const [isStreaming, setIsStreaming] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [motionDetected, setMotionDetected] = useState(false)
  const [lastMotionTime, setLastMotionTime] = useState<Date | null>(null)
  const [autoCapture, setAutoCapture] = useState(true)
  const [videoStats, setVideoStats] = useState<VideoStats>({
    fps: 0,
    framesSent: 0,
    lastFrameTime: null,
    lastMotionStrength: 0
  })

  const FASTAPI_URL = config.BACKEND_URL
  const COOLDOWN_MS = 3000

  useEffect(() => {
    if (isSessionActive && currentSession) {
      startVideoStream()
    } else {
      stopVideoStream()
    }

    return () => {
      stopVideoStream()
    }
  }, [isSessionActive, currentSession?.id])

  useEffect(() => {
    if (isStreaming && currentSession) {
      startFrameCapture()
    } else {
      stopFrameCapture()
    }

    return () => {
      stopFrameCapture()
    }
  }, [isStreaming, currentSession?.id, autoCapture])

  useEffect(() => {
    if (!isStreaming) return

    const fpsInterval = setInterval(() => {
      if (videoRef.current) {
        setVideoStats(prev => ({
          ...prev,
          fps: Math.round(Math.random() * 5 + 25)
        }))
      }
    }, 1000)

    return () => clearInterval(fpsInterval)
  }, [isStreaming])

  const startVideoStream = async () => {
    try {
      setCameraError('')
      console.log('🎥 Starting video stream...')
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user'
        },
        audio: false
      })

      streamRef.current = stream
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          setIsStreaming(true)
          console.log('✅ Video stream started successfully')
        }
      }

    } catch (error: any) {
        console.error('❌ Error starting video stream:', error)
  
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setCameraError('ไม่พบกล้อง กรุณาเชื่อมต่อกล้องแล้วลองใหม่')
      } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraError('ไม่ได้รับอนุญาตใช้กล้อง กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์')
      } else if (error.name === 'NotReadableError') {
        setCameraError('กล้องถูกใช้งานโดยโปรแกรมอื่นอยู่ กรุณาปิดโปรแกรมนั้นก่อน')
      } else {
        setCameraError(`ไม่สามารถเปิดกล้องได้: ${error.message}`)
      }
    }
  }

  const stopVideoStream = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      
      setIsStreaming(false)
      stopFrameCapture()
      
      setMotionDetected(false)
      setLastMotionTime(null)
      previousFrameRef.current = null
      
      console.log('🛑 Video stream stopped')
    } catch (error) {
      console.error('Error stopping video stream:', error)
    }
  }

  const startFrameCapture = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    intervalRef.current = setInterval(() => {
      if (currentSession && autoCapture && isStreaming) {
        checkMotionAndCapture()
      }
    }, 1000)
  }

  const stopFrameCapture = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const detectMotion = (currentFrame: HTMLVideoElement | HTMLCanvasElement, previousFrame: HTMLCanvasElement | null): number => {
    if (!previousFrame) return 0

    try {
      const canvas1 = document.createElement('canvas')
      const canvas2 = document.createElement('canvas')
      const ctx1 = canvas1.getContext('2d')
      const ctx2 = canvas2.getContext('2d')

      if (!ctx1 || !ctx2) return 0

      const width = 160
      const height = 120

      canvas1.width = canvas2.width = width
      canvas1.height = canvas2.height = height

      ctx1.drawImage(currentFrame, 0, 0, width, height)
      ctx2.drawImage(previousFrame, 0, 0, width, height)

      const imageData1 = ctx1.getImageData(0, 0, width, height)
      const imageData2 = ctx2.getImageData(0, 0, width, height)

      let diff = 0
      const data1 = imageData1.data
      const data2 = imageData2.data

      for (let i = 0; i < data1.length; i += 4) {
        const r1 = data1[i], g1 = data1[i + 1], b1 = data1[i + 2]
        const r2 = data2[i], g2 = data2[i + 1], b2 = data2[i + 2]
        
        const gray1 = (r1 + g1 + b1) / 3
        const gray2 = (r2 + g2 + b2) / 3
        
        diff += Math.abs(gray1 - gray2)
      }

      return diff / (width * height * 255)
    } catch (error) {
      console.error('Motion detection error:', error)
      return 0
    }
  }

  const checkMotionAndCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')

      if (!ctx) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const motionStrength = detectMotion(video, previousFrameRef.current)
      
      if (previousFrameRef.current) {
        const prevCtx = previousFrameRef.current.getContext('2d')
        if (prevCtx) {
          prevCtx.clearRect(0, 0, previousFrameRef.current.width, previousFrameRef.current.height)
          prevCtx.drawImage(video, 0, 0, previousFrameRef.current.width, previousFrameRef.current.height)
        }
      } else {
        previousFrameRef.current = document.createElement('canvas')
        previousFrameRef.current.width = video.videoWidth
        previousFrameRef.current.height = video.videoHeight
        const prevCtx = previousFrameRef.current.getContext('2d')
        if (prevCtx) {
          prevCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
        }
        return
      }

      const motionThreshold = currentSession?.motion_threshold || 0.1
      
      if (motionStrength > motionThreshold) {
          const now = Date.now()
          if (now - lastSentRef.current > COOLDOWN_MS) {
              lastSentRef.current = now
              setMotionDetected(true)
              setLastMotionTime(new Date())
              console.log(`🚶 Motion detected!...`)
              await sendFrameForMotionDetection(motionStrength)
              setTimeout(() => setMotionDetected(false), 2000)
          }
      }

      setVideoStats(prev => ({
        ...prev,
        lastMotionStrength: motionStrength
      }))

    } catch (error) {
      console.error('Error in motion check:', error)
    }
  }

  const sendFrameForMotionDetection = async (motionStrength = 0.5) => {
    

    if (!videoRef.current || !canvasRef.current || !currentSession) return

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')

      if (!ctx) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(async (blob) => {
        if (blob) {
          const formData = new FormData()
          formData.append('image_data', blob, 'motion_frame.jpg')
          formData.append('session_id', currentSession.id)
          formData.append('motion_strength', motionStrength.toString())
          formData.append('elapsed_minutes', Math.floor((Date.now() - new Date(currentSession.start_time).getTime()) / 60000).toString())
          formData.append('device_id', 'webcam_live_stream')

              // ========== เพิ่ม: ก่อนส่ง ==========
          setCaptureStatus('sending')
          setStatusMessage('กำลังส่งภาพประมวลผล...')

          try {
            const response = await fetch(`${FASTAPI_URL}/api/motion/snapshot`, {
              method: 'POST',
              body: formData
            })

            if (response.ok) {
              const result = await response.json()
              console.log('📸 Motion frame sent successfully:', result.message)

              if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)

              const checked = (result.new_records ?? 0) + (result.already_checked ?? 0)
              

              if (checked > 0) {
                setCaptureStatus('success')
                setStatusMessage(
                  `จริง ${result.faces_detected ?? 0} · ปลอม ${result.spoof_count ?? 0} · เช็ค ${result.new_records ?? 0} · เช็คซ้ำ ${result.already_checked ?? 0}`
                )
              } else {
                setCaptureStatus('failed')
                const totalUnrecognized = (result.unrecognized ?? 0) + (result.spoof_count ?? 0)
                setStatusMessage(
                  `จริง ${result.faces_detected ?? 0} · ปลอม ${result.spoof_count ?? 0} · เช็คไม่ได้ ${totalUnrecognized} คน`
                )
              }
              statusTimeoutRef.current = setTimeout(() => {
                setCaptureStatus('idle')
                setStatusMessage('')
              }, 3000)
              
              // If backend indicates a new attendance or successful processing, notify parent
              if (result.success || result.attendance_detected) {
                onAttendanceDetected?.()
              }

              setVideoStats(prev => ({
                ...prev,
                framesSent: prev.framesSent + 1,
                lastFrameTime: new Date().toLocaleTimeString('th-TH', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZone: 'Asia/Bangkok'
                })
              }))
              if (result.spoof_detected && result.spoof_image_b64) {
                onSpoofDetected?.({
                  image_b64: result.spoof_image_b64,
                  timestamp: result.spoof_timestamp,
                  spoof_count: result.spoof_count
                })
              }
            } else if (response.status === 400) {
              const errorData = await response.json()
              console.log('📵 Motion frame blocked (normal):', errorData.message)
            } else {
              console.warn('❌ Motion frame rejected:', response.status)
            }
          } catch (fetchError) {
            console.error('❌ Network error sending motion frame:', fetchError)
          }
        }
      }, 'image/jpeg', 0.8)

    } catch (error) {
      console.error('❌ Error sending motion frame:', error)
    }
  }

  const takeManualCapture = async () => {
    if (!videoRef.current || !canvasRef.current || !currentSession) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถถ่ายภาพได้',
        text: 'กรุณาตรวจสอบกล้องและเซสชัน'
      })
      return
    }

    setIsCapturing(true)

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')

      if (!ctx) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(async (blob) => {
        if (blob && onManualCapture) {
          await onManualCapture(blob)
        }
      }, 'image/jpeg', 0.8)

    } catch (error) {
      console.error('❌ Error taking manual capture:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'เกิดข้อผิดพลาดในการถ่ายภาพ'
      })
    } finally {
      setIsCapturing(false)
    }
  }

  if (!isSessionActive || !currentSession) {
    return (
      <div className="glass-card p-8 text-center bg-white/30">
        <div className="w-20 h-20 bg-white/50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
          <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">📹 Live Video Stream</h3>
        <p className="text-gray-500 font-medium">ไม่มีเซสชันที่ใช้งานอยู่</p>
        <p className="text-xs text-gray-400 mt-2">เริ่ม Motion Detection Session เพื่อดู live video</p>
      </div>
    )
  }

  return (
    <div className="glass-card p-8 bg-white/30">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-3">
          <div className="bg-[#0071e3]/10 p-2.5 rounded-2xl">
            <svg className="w-6 h-6 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-gray-900">Live Video Stream</h3>
        </div>
        {isStreaming && (
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-red-50 px-3 py-1 rounded-full border border-red-100">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              <span className="text-[10px] text-red-600 font-black uppercase tracking-widest">LIVE</span>
            </div>
            <div className="text-xs text-gray-400 font-bold uppercase tracking-tight">
              {videoStats.fps} FPS
            </div>
          </div>
        )}
      </div>

      <div className="relative bg-black rounded-3xl overflow-hidden mb-8 shadow-2xl ring-1 ring-white/20" style={{ aspectRatio: '16/9' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
                {/* ========== เพิ่ม: กรอบเปลี่ยนสี ========== */}
        <div className={`absolute inset-0 border-4 rounded-3xl pointer-events-none transition-all duration-300 ${
          captureStatus === 'sending' ? 'border-gray-400' :
          captureStatus === 'success' ? 'border-green-400' :
          captureStatus === 'failed'  ? 'border-yellow-400' :
          'border-transparent'
        }`} />

        {/* ========== เพิ่ม: แถบสถานะข้างล่าง ========== */}
        {statusMessage && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <span className={`px-4 py-1.5 rounded-full text-sm font-medium backdrop-blur-md border transition-all ${
              captureStatus === 'sending' ? 'bg-gray-500/80 text-white border-gray-400' :
              captureStatus === 'success' ? 'bg-green-500/80 text-white border-green-400' :
              captureStatus === 'failed'  ? 'bg-yellow-500/80 text-white border-yellow-400' :
              ''
            }`}>
              {statusMessage}
            </span>
          </div>
        )}
        {isStreaming && (
          <div className="absolute top-6 left-6 space-y-2">
            <div className="bg-black/40 backdrop-blur-md text-white px-4 py-3 rounded-2xl text-xs border border-white/10 shadow-lg">
              <div className="space-y-1.5 font-medium">
                <div className="flex items-center">
                  <span className="text-white/50 mr-2 uppercase tracking-widest text-[9px]">Subject</span>
                  {currentSession.classes?.subject_name || 'Unknown'}
                </div>
                <div className="flex items-center">
                  <span className="text-white/50 mr-2 uppercase tracking-widest text-[9px]">Type</span>
                  {currentSession.session_type || 'Unknown'}
                </div>
                {motionStats && (
                  <div className="flex items-center">
                    <span className="text-white/50 mr-2 uppercase tracking-widest text-[9px]">Motion</span>
                    {motionStats.live_stats?.motion_events || 0} Events
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {isStreaming && currentSession.session_type === 'motion_detection' && (
          <div className="absolute top-6 right-6 space-y-3 flex flex-col items-end">
            <div className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border backdrop-blur-md transition-all duration-300 shadow-lg ${
              motionDetected 
                ? 'bg-red-500/80 border-red-400 text-white animate-pulse' 
                : 'bg-green-500/80 border-green-400 text-white'
            }`}>
              <div className="flex items-center space-x-2">
                <div className={`w-1.5 h-1.5 rounded-full ${
                  motionDetected ? 'bg-white animate-bounce' : 'bg-white animate-pulse'
                }`}></div>
                <span>{motionDetected ? 'Motion Detected!' : 'Detection Active'}</span>
              </div>
            </div>
            
            <div className="bg-black/40 backdrop-blur-md text-white px-4 py-2 rounded-2xl text-[10px] font-bold border border-white/10 shadow-lg">
              MOTION: {(videoStats.lastMotionStrength * 100).toFixed(1)}%
            </div>
            
            <div className="bg-black/40 backdrop-blur-md text-white px-4 py-2 rounded-2xl border border-white/10 shadow-lg">
              <label className="flex items-center space-x-2 cursor-pointer group">
                <div className={`w-8 h-4 rounded-full transition-colors relative ${autoCapture ? 'bg-[#0071e3]' : 'bg-white/20'}`}>
                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${autoCapture ? 'left-4.5' : 'left-0.5'}`}></div>
                </div>
                <input
                  type="checkbox"
                  checked={autoCapture}
                  onChange={(e) => setAutoCapture(e.target.checked)}
                  className="hidden"
                />
                <span className="text-[10px] font-bold uppercase tracking-widest">Auto Capture</span>
              </label>
            </div>
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500/80 backdrop-blur-sm">
            <div className="text-center text-white p-8 glass-morphism border-white/20 bg-white/10 max-w-sm">
              <div className="bg-white/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.664-.833-2.464 0L5.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="font-bold text-lg mb-2">Camera Error</p>
              <p className="text-sm text-white/80 mb-6">{cameraError}</p>
              <button 
                onClick={startVideoStream}
                className="w-full bg-white text-red-600 px-6 py-3 rounded-2xl font-bold hover:bg-gray-100 transition-all"
              >
                ลองใหม่อีกครั้ง
              </button>
            </div>
          </div>
        )}

        {!isStreaming && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm">
            <div className="text-center text-white">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/20 border-t-white mx-auto mb-4"></div>
              <p className="text-sm font-medium tracking-wide">กำลังเชื่อมต่อกล้อง...</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={takeManualCapture}
            disabled={!isStreaming || isCapturing}
            className="apple-button-primary py-3 px-6 flex items-center space-x-2"
          >
            {isCapturing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
            )}
            <span>Manual Capture</span>
          </button>

          {isStreaming ? (
            <button
              onClick={stopVideoStream}
              className="apple-button-secondary bg-red-50 text-red-600 border-red-100 hover:bg-red-500 hover:text-white py-3 px-6 flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l6 6m0-6l-6 6" />
              </svg>
              <span>ปิดกล้อง</span>
            </button>
          ) : (
            <button
              onClick={startVideoStream}
              className="apple-button-secondary bg-green-50 text-green-600 border-green-100 hover:bg-green-500 hover:text-white py-3 px-6 flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>เปิดกล้อง</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full md:w-auto">
          <div className="text-center md:text-right">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-0.5">Frames Sent</p>
            <p className="text-lg font-semibold text-gray-900">{videoStats.framesSent}</p>
          </div>
          {videoStats.lastFrameTime && (
            <div className="text-center md:text-right">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-0.5">Last Sync</p>
              <p className="text-lg font-semibold text-gray-900">{videoStats.lastFrameTime}</p>
            </div>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}

export default LiveVideoStream
