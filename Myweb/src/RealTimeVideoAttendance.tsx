import { useState, useRef, useEffect, FC } from 'react'
import config from './config'
import type { AttendanceListItem, StreamStats } from '@/types'

interface RealTimeVideoAttendanceProps {
  classId: string
  teacherEmail: string
  onSessionEnd?: (attendanceList: AttendanceListItem[]) => void
}

const RealTimeVideoAttendance: FC<RealTimeVideoAttendanceProps> = ({ classId, teacherEmail, onSessionEnd }) => {
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [stats, setStats] = useState<StreamStats>({
    frames_processed: 0,
    faces_detected: 0,
    faces_recognized: 0,
    attendance_recorded: 0
  })
  const [attendanceList, setAttendanceList] = useState<AttendanceListItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const FASTAPI_URL = config.BACKEND_URL

  const startVideoStream = async () => {
    try {
      setLoading(true)
      setError('')

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      const formData = new FormData()
      formData.append('class_id', classId)
      formData.append('teacher_email', teacherEmail)
      formData.append('on_time_limit_minutes', '15')
      formData.append('duration_hours', '3')

      const response = await fetch(`${FASTAPI_URL}/api/realtime/start-stream`, {
        method: 'POST',
        body: formData
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.detail || 'Failed to start session')
      }

      setSessionId(result.session_id)
      setIsStreaming(true)

      connectWebSocket(result.session_id)
      startFrameProcessing()

    } catch (err: any) {
      setError(`Failed to start video stream: ${err.message}`)
      stopVideoStream()
    } finally {
      setLoading(false)
    }
  }

  const connectWebSocket = (id: string) => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase = FASTAPI_URL.replace(/^http/, wsProtocol)
    const wsUrl = `${wsBase}/ws/realtime/${id}`
    
    wsRef.current = new WebSocket(wsUrl)

    wsRef.current.onopen = () => {
      console.log('🔗 WebSocket connected')
    }

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      switch (data.type) {
        case 'frame_result':
          if (data.success && data.new_attendance) {
            data.new_attendance.forEach((attendance: any) => {
              setAttendanceList(prev => [...prev, {
                id: Date.now() + Math.random(),
                studentName: attendance.student_name,
                studentId: attendance.student_id,
                status: attendance.status,
                confidence: attendance.confidence,
                timestamp: attendance.timestamp,
                isManual: false
              }])
            })
          }
          
          if (data.frame_stats) {
            setStats(data.frame_stats)
          }
          break

        case 'stats_update':
          if (data.stream_info) {
            console.log('📊 Stats update:', data.stream_info)
          }
          break

        case 'error':
          setError(`WebSocket error: ${data.message}`)
          break

        default:
          console.log('📡 WebSocket message:', data)
      }
    }

    wsRef.current.onclose = () => {
      console.log('🔌 WebSocket disconnected')
    }

    wsRef.current.onerror = (err) => {
      console.error('❌ WebSocket error:', err)
      setError('WebSocket connection failed')
    }
  }

  const startFrameProcessing = () => {
    intervalRef.current = setInterval(() => {
      if (videoRef.current && canvasRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        captureAndSendFrame()
      }
    }, 500)
  }

  const captureAndSendFrame = () => {
    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) return
      
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const frameData = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'frame',
          frame_data: frameData
        }))
      }
    } catch (error) {
      console.error('Error capturing frame:', error)
    }
  }

  const stopVideoStream = async () => {
    try {
      setLoading(true)

      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }

      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }

      if (sessionId) {
        await fetch(`${FASTAPI_URL}/api/realtime/${sessionId}/stop`, {
          method: 'PUT'
        })
      }

      setIsStreaming(false)
      const currentAttendanceList = [...attendanceList]
      setSessionId(null)
      
      if (onSessionEnd) {
        onSessionEnd(currentAttendanceList)
      }

    } catch (error: any) {
      setError(`Error stopping stream: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleManualCheckin = async (studentEmail: string, status: any = 'present') => {
    if (!sessionId) return

    try {
      const formData = new FormData()
      formData.append('student_email', studentEmail)
      formData.append('status', status)

      const response = await fetch(`${FASTAPI_URL}/api/realtime/${sessionId}/manual-checkin`, {
        method: 'POST',
        body: formData
      })

      const result = await response.json()

      if (result.success) {
        setAttendanceList(prev => [...prev, {
          id: Date.now(),
          studentName: result.student_name,
          studentId: studentEmail,
          status: result.status,
          confidence: 1.0,
          timestamp: result.timestamp,
          isManual: true
        }])
      } else {
        setError(result.detail || 'Manual check-in failed')
      }
    } catch (error: any) {
      setError(`Manual check-in error: ${error.message}`)
    }
  }

  useEffect(() => {
    return () => {
      // stopVideoStream is async, but we can't await it here easily
      // Basic cleanup
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (wsRef.current) wsRef.current.close()
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop())
    }
  }, [])

  return (
    <div className="min-h-screen bg-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                📹 Real-time Video Attendance
              </h1>
              <p className="text-gray-600">
                Class: {classId} | Teacher: {teacherEmail}
              </p>
              {sessionId && (
                <p className="text-sm text-blue-600 mt-1">
                  Session ID: {sessionId}
                </p>
              )}
            </div>
            
            <div className="flex space-x-4">
              {!isStreaming ? (
                <button
                  onClick={startVideoStream}
                  disabled={loading}
                  className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>Starting...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Start Class</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={stopVideoStream}
                  disabled={loading}
                  className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>Stopping...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l6 6m0-6l-6 6" />
                      </svg>
                      <span>End Class</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            ❌ {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-900">Video Stream</h2>
                {isStreaming && (
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-red-600 font-medium">LIVE</span>
                  </div>
                )}
              </div>
              
              <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                
                {!isStreaming && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-75">
                    <div className="text-center text-white">
                      <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p className="text-lg">Camera Not Active</p>
                      <p className="text-sm opacity-75">Click "Start Class" to begin video streaming</p>
                    </div>
                  </div>
                )}
                
                {isStreaming && (
                  <div className="absolute top-4 left-4 bg-black bg-opacity-60 text-white px-3 py-2 rounded-lg text-sm">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span>Processing: {stats.frames_processed} frames</span>
                    </div>
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            {isStreaming && (
              <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Processing Statistics</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">{stats.frames_processed}</div>
                    <div className="text-sm text-blue-600">Frames Processed</div>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">{stats.faces_detected}</div>
                    <div className="text-sm text-green-600">Faces Detected</div>
                  </div>
                  <div className="text-center p-4 bg-purple-50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600">{stats.faces_recognized}</div>
                    <div className="text-sm text-purple-600">Faces Recognized</div>
                  </div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <div className="text-2xl font-bold text-orange-600">{stats.attendance_recorded}</div>
                    <div className="text-sm text-orange-600">Attendance Recorded</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-900">Live Attendance</h3>
                <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded">
                  {attendanceList.length} Students
                </span>
              </div>

              {isStreaming && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Manual Check-in</h4>
                  <div className="flex space-x-2">
                    <input
                      type="email"
                      placeholder="student@email.com"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                      onKeyPress={(e: any) => {
                        if (e.key === 'Enter') {
                          handleManualCheckin(e.target.value)
                          e.target.value = ''
                        }
                      }}
                    />
                    <button
                      onClick={(e: any) => {
                        const input = e.target.parentNode.querySelector('input')
                        if (input.value) {
                          handleManualCheckin(input.value)
                          input.value = ''
                        }
                      }}
                      className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                    >
                      ✓
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {attendanceList.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                    </svg>
                    <p>No attendance recorded yet</p>
                    <p className="text-sm">Students will appear here automatically</p>
                  </div>
                ) : (
                  attendanceList.map((attendance) => (
                    <div
                      key={attendance.id}
                      className={`p-3 rounded-lg border-l-4 ${
                        attendance.status === 'present' 
                          ? 'bg-green-50 border-green-400' 
                          : 'bg-yellow-50 border-yellow-400'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-gray-900">
                            {attendance.studentName}
                          </div>
                          <div className="text-sm text-gray-600">
                            {attendance.studentId}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {new Date(attendance.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                            attendance.status === 'present' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {attendance.status.toUpperCase()}
                          </span>
                          <div className="text-xs text-gray-500 mt-1">
                            {attendance.isManual ? '👤 Manual' : `🤖 ${(attendance.confidence * 100).toFixed(1)}%`}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {attendanceList.length > 0 && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg shadow">
                  <h4 className="text-sm font-medium text-green-800 mb-2">🎉 นักเรียนล่าสุดที่เช็คชื่อ</h4>
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-gray-900">
                        {attendanceList[attendanceList.length - 1].studentName}
                      </div>
                      <div className="text-sm text-gray-600">
                        {attendanceList[attendanceList.length - 1].studentId}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium text-green-600">
                        {attendanceList[attendanceList.length - 1].status.toUpperCase()}
                      </span>
                      <div className="text-xs text-gray-500">
                        {new Date(attendanceList[attendanceList.length - 1].timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {isStreaming && (
              <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">System Status</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Video Stream</span>
                    <span className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-sm text-green-600">Active</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Face Detection</span>
                    <span className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-sm text-green-600">Running</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">WebSocket</span>
                    <span className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${
                        wsRef.current?.readyState === WebSocket.OPEN ? 'bg-green-500' : 'bg-red-500'
                      }`}></div>
                      <span className={`text-sm ${
                        wsRef.current?.readyState === WebSocket.OPEN ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {wsRef.current?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected'}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Processing Rate</span>
                    <span className="text-sm text-blue-600">2 FPS</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!isStreaming && (
          <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">🎯 How It Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl">📹</span>
                </div>
                <h4 className="font-medium text-gray-900 mb-2">1. Start Video Stream</h4>
                <p className="text-sm text-gray-600">
                  Click "Start Class" to begin real-time video streaming from your camera
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl">🤖</span>
                </div>
                <h4 className="font-medium text-gray-900 mb-2">2. Automatic Detection</h4>
                <p className="text-sm text-gray-600">
                  AI processes video frames to detect and recognize student faces automatically
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl">✅</span>
                </div>
                <h4 className="font-medium text-gray-900 mb-2">3. Instant Attendance</h4>
                <p className="text-sm text-gray-600">
                  Students are automatically marked present when detected, with manual override available
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default RealTimeVideoAttendance
