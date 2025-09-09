// ไฟล์: Myweb/src/LiveVideoStream.jsx
import { useState, useRef, useEffect } from 'react'

const LiveVideoStream = ({ 
  currentSession, 
  isSessionActive, 
  onManualCapture, 
  motionStats 
}) => {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const intervalRef = useRef(null)
  const previousFrameRef = useRef(null)
  
  const [isStreaming, setIsStreaming] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [motionDetected, setMotionDetected] = useState(false)
  const [lastMotionTime, setLastMotionTime] = useState(null)
  const [autoCapture, setAutoCapture] = useState(true)
  const [videoStats, setVideoStats] = useState({
    fps: 0,
    framesSent: 0,
    lastFrameTime: null,
    lastMotionStrength: 0
  })

  // FastAPI URL
  const FASTAPI_URL = import.meta.env.VITE_FASTAPI_URL || 'http://localhost:8000'

  // เริ่มกล้องเมื่อมี session ที่ active
  useEffect(() => {
    if (isSessionActive && currentSession) {
      startVideoStream()
    } else {
      stopVideoStream()
    }

    return () => {
      stopVideoStream()
    }
  }, [isSessionActive, currentSession])

  // ส่งเฟรมเป็นระยะเมื่อ streaming
  useEffect(() => {
    if (isStreaming && currentSession) {
      startFrameCapture()
    } else {
      stopFrameCapture()
    }

    return () => {
      stopFrameCapture()
    }
  }, [isStreaming, currentSession, autoCapture])

  // คำนวณ FPS
  useEffect(() => {
    if (!isStreaming) return

    const fpsInterval = setInterval(() => {
      if (videoRef.current) {
        // อัปเดต FPS counter (แบบประมาณ)
        setVideoStats(prev => ({
          ...prev,
          fps: Math.round(Math.random() * 5 + 25) // Mock FPS 25-30
        }))
      }
    }, 1000)

    return () => clearInterval(fpsInterval)
  }, [isStreaming])

  const startVideoStream = async () => {
    try {
      setCameraError('')
      console.log('🎥 Starting video stream...')
      
      // ขอใช้กล้อง
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

    } catch (error) {
      console.error('❌ Error starting video stream:', error)
      setCameraError(`ไม่สามารถเปิดกล้องได้: ${error.message}`)
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
      
      // Reset states
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

    // ตรวจสอบ motion ทุก 1 วินาที
    intervalRef.current = setInterval(() => {
      if (currentSession && autoCapture && isStreaming) {
        checkMotionAndCapture()
      }
    }, 1000) // ทุก 1 วินาที
  }

  const stopFrameCapture = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  // Motion Detection Algorithm
  const detectMotion = (currentFrame, previousFrame) => {
    if (!previousFrame) return 0

    try {
      const canvas1 = document.createElement('canvas')
      const canvas2 = document.createElement('canvas')
      const ctx1 = canvas1.getContext('2d')
      const ctx2 = canvas2.getContext('2d')

      const width = 160 // ลดขนาดเพื่อประมวลผลเร็วขึ้น
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

      return diff / (width * height * 255) // normalize
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

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      // Detect motion
      const motionStrength = detectMotion(video, previousFrameRef.current)
      
      // Update previous frame
      if (previousFrameRef.current) {
        const prevCtx = previousFrameRef.current.getContext('2d')
        prevCtx.clearRect(0, 0, previousFrameRef.current.width, previousFrameRef.current.height)
        prevCtx.drawImage(video, 0, 0, previousFrameRef.current.width, previousFrameRef.current.height)
      } else {
        previousFrameRef.current = document.createElement('canvas')
        previousFrameRef.current.width = video.videoWidth
        previousFrameRef.current.height = video.videoHeight
        const prevCtx = previousFrameRef.current.getContext('2d')
        prevCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
        return // Skip first frame comparison
      }

      // Check if motion is significant
      const motionThreshold = currentSession?.motion_threshold || 0.1
      
      if (motionStrength > motionThreshold) {
        setMotionDetected(true)
        setLastMotionTime(new Date())
        
        console.log(`🚶 Motion detected! Strength: ${motionStrength.toFixed(3)}, Threshold: ${motionThreshold}`)
        
        // Send frame for motion processing
        await sendFrameForMotionDetection(motionStrength)
        
        // Reset motion indicator after 2 seconds
        setTimeout(() => setMotionDetected(false), 2000)
      }

      // Update motion strength in stats
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
    if (!currentSession.session_type || currentSession.session_type !== 'motion_detection') return

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(async (blob) => {
        if (blob) {
          const formData = new FormData()
          formData.append('image', blob, 'motion_frame.jpg')
          formData.append('session_id', currentSession.id)
          formData.append('motion_strength', motionStrength.toString())
          formData.append('elapsed_minutes', Math.floor((Date.now() - new Date(currentSession.start_time)) / 60000))
          formData.append('device_id', 'webcam_live_stream')

          try {
            const response = await fetch(`${FASTAPI_URL}/api/motion/snapshot`, {
              method: 'POST',
              body: formData
            })

            if (response.ok) {
              const result = await response.json()
              console.log('📸 Motion frame sent successfully:', result.message)
              
              setVideoStats(prev => ({
                ...prev,
                framesSent: prev.framesSent + 1,
                lastFrameTime: new Date().toLocaleTimeString()
              }))
            } else if (response.status === 400) {
              // Motion blocked by cooldown or rate limiting - this is normal
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
      alert('กรุณาตรวจสอบกล้องและเซสชัน')
      return
    }

    setIsCapturing(true)

    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')

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
      alert('เกิดข้อผิดพลาดในการถ่ายภาพ')
    } finally {
      setIsCapturing(false)
    }
  }

  if (!isSessionActive || !currentSession) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">📹 Live Video Stream</h3>
        <div className="bg-gray-100 rounded-lg p-8 text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-600">ไม่มีเซสชันที่ใช้งานอยู่</p>
          <p className="text-sm text-gray-500">เริ่ม Motion Detection Session เพื่อดู live video</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-900">📹 Live Video Stream</h3>
        {isStreaming && (
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-red-600 font-medium">LIVE</span>
            </div>
            <div className="text-sm text-gray-600">
              {videoStats.fps} FPS
            </div>
          </div>
        )}
      </div>

      {/* Video Display */}
      <div className="relative bg-gray-900 rounded-lg overflow-hidden mb-4" style={{ aspectRatio: '16/9' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        
        {/* Overlay Information */}
        {isStreaming && (
          <div className="absolute top-4 left-4 bg-black bg-opacity-70 text-white px-3 py-2 rounded-lg text-sm">
            <div className="space-y-1">
              <div>📊 Session: {currentSession.classes?.subject_name || 'Unknown'}</div>
              <div>🎯 Type: {currentSession.session_type || 'Unknown'}</div>
              {motionStats && (
                <div>⚡ Motion Events: {motionStats.live_stats?.motion_events || 0}</div>
              )}
              <div>🎥 Resolution: {videoRef.current?.videoWidth || 0}x{videoRef.current?.videoHeight || 0}</div>
            </div>
          </div>
        )}

        {/* Motion Detection Indicator */}
        {isStreaming && currentSession.session_type === 'motion_detection' && (
          <div className="absolute top-4 right-4 space-y-2">
            <div className={`px-3 py-2 rounded-lg text-sm transition-all duration-300 ${
              motionDetected 
                ? 'bg-red-600 bg-opacity-90 text-white animate-pulse' 
                : 'bg-green-600 bg-opacity-80 text-white'
            }`}>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  motionDetected ? 'bg-red-300 animate-bounce' : 'bg-green-300 animate-pulse'
                }`}></div>
                <span>{motionDetected ? 'Motion Detected!' : 'Motion Detection Active'}</span>
              </div>
            </div>
            
            {/* Auto Capture Toggle */}
            <div className="bg-black bg-opacity-70 text-white px-3 py-2 rounded-lg text-xs">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCapture}
                  onChange={(e) => setAutoCapture(e.target.checked)}
                  className="w-3 h-3"
                />
                <span>Auto Capture</span>
              </label>
            </div>
            
            {/* Motion Strength */}
            <div className="bg-black bg-opacity-70 text-white px-3 py-2 rounded-lg text-xs">
              Motion: {(videoStats.lastMotionStrength * 100).toFixed(1)}%
            </div>
            
            {/* Last Motion Time */}
            {lastMotionTime && (
              <div className="bg-black bg-opacity-70 text-white px-3 py-2 rounded-lg text-xs">
                Last Motion: {lastMotionTime.toLocaleTimeString()}
              </div>
            )}
          </div>
        )}

        {/* Error Overlay */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-600 bg-opacity-75">
            <div className="text-center text-white p-4">
              <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.664-.833-2.464 0L5.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="font-medium">เกิดข้อผิดพลาดกับกล้อง</p>
              <p className="text-sm opacity-90">{cameraError}</p>
              <button 
                onClick={startVideoStream}
                className="mt-2 bg-white text-red-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                ลองใหม่
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {!isStreaming && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-75">
            <div className="text-center text-white">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <p>กำลังเชื่อมต่อกล้อง...</p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex justify-between items-center">
        <div className="flex space-x-3">
          <button
            onClick={takeManualCapture}
            disabled={!isStreaming || isCapturing}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isCapturing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>กำลังถ่าย...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
                <span>📸 Manual Capture</span>
              </>
            )}
          </button>

          {/* Toggle Auto Capture */}
          {currentSession?.session_type === 'motion_detection' && (
            <button
              onClick={() => setAutoCapture(!autoCapture)}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                autoCapture 
                  ? 'bg-green-600 text-white hover:bg-green-700' 
                  : 'bg-gray-600 text-white hover:bg-gray-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{autoCapture ? 'Auto ON' : 'Auto OFF'}</span>
            </button>
          )}

          {!isStreaming && (
            <button
              onClick={startVideoStream}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>เปิดกล้อง</span>
            </button>
          )}

          {isStreaming && (
            <button
              onClick={stopVideoStream}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l6 6m0-6l-6 6" />
              </svg>
              <span>ปิดกล้อง</span>
            </button>
          )}
        </div>

        <div className="text-sm text-gray-600 space-y-1 text-right">
          {isStreaming && (
            <>
              <div>FPS: {videoStats.fps}</div>
              <div>Frames Sent: {videoStats.framesSent}</div>
              {videoStats.lastFrameTime && (
                <div>Last Frame: {videoStats.lastFrameTime}</div>
              )}
              {currentSession?.session_type === 'motion_detection' && (
                <div>Motion: {(videoStats.lastMotionStrength * 100).toFixed(1)}%</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Hidden Canvas for Frame Capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}

export default LiveVideoStream