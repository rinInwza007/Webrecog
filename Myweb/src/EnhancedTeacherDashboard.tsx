import { useState, useEffect, useRef, FC } from 'react'
import Swal from 'sweetalert2'
import { useAuth } from './login/AuthContext'
import { supabase } from './supabaseClient'
import ClassCodeDisplay from './ClassCodeDisplay'
import LiveVideoStream from './LiveVideoStream'
import ClassDetailView from './ClassDetailView'
import config from './config'
import image from './utils/logo/image.png' 
import type { Class, AttendanceSession, AttendanceRecord, User as AppUser } from '@/types'

interface SpoofEvent {
  image_b64: string
  timestamp: string
  spoof_count: number
}

const EnhancedTeacherDashboard: FC = () => {
  //spoof
  const [spoofEvents, setSpoofEvents] = useState<SpoofEvent[]>([])
  const [selectedSpoofImage, setSelectedSpoofImage] = useState<SpoofEvent | null>(null)

  const handleSpoofDetected = (event: SpoofEvent) => {
  setSpoofEvents(prev => [event, ...prev]) // ใหม่สุดขึ้นก่อน
  }

  const { user, signOut } = useAuth()
  const [classes, setClasses] = useState<Class[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [currentSession, setCurrentSession] = useState<any>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([])
  const [motionStats, setMotionStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  
  // เพิ่ม state สำหรับ Class Detail View
  const [selectedClass, setSelectedClass] = useState<Class | null>(null)
  const [showClassDetail, setShowClassDetail] = useState(false)
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showStartSessionModal, setShowStartSessionModal] = useState<string | boolean>(false)
  const [showClassCodeModal, setShowClassCodeModal] = useState<{code: string, name: string} | null>(null)
  const [showSessionDetailsModal, setShowSessionDetailsModal] = useState<any>(null)
  const [showManualCaptureModal, setShowManualCaptureModal] = useState(false)
  const [showAttendanceLogModal, setShowAttendanceLogModal] = useState(false)
  const [activeLogTab, setActiveLogTab] = useState<'logs' | 'attendance'>('logs')
  const [sessionLogs, setSessionLogs] = useState<any[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [selectedClassForSession, setSelectedClassForSession] = useState<Class | null>(null)
  const [showSessionConfigModal, setShowSessionConfigModal] = useState(false)
  
  // Form states
  const [newClass, setNewClass] = useState({
    subject_name: '',
    description: '',
    schedule: ''
  })
  const [sessionConfig, setSessionConfig] = useState({
    duration_hours: 2,
    motion_threshold: 0.1,
    cooldown_seconds: 30,
    on_time_limit_minutes: 30
  })

  // Video/Camera states
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [cameraError, setCameraError] = useState('')

  // FastAPI URL
  const FASTAPI_URL = config.BACKEND_URL

  // Function สำหรับเปิด Class Detail View
  const handleClassClick = (classData: Class) => {
    setSelectedClass(classData)
    setShowClassDetail(true)
  }

  // Function สำหรับกลับจาก Class Detail View
  const handleBackFromClassDetail = () => {
    setShowClassDetail(false)
    setSelectedClass(null)
    // Refresh data เมื่อกลับมา
    fetchTeacherData()
  }

  useEffect(() => {
    fetchTeacherData()
    const interval = setInterval(fetchTeacherData, 5000) // Reduced to 5s for faster polling
    return () => clearInterval(interval)
  }, [user])

  useEffect(() => {
    if (currentSession) {
      fetchMotionStats()
      const statsInterval = setInterval(fetchMotionStats, 10000) // Every 10s
      return () => clearInterval(statsInterval)
    }
  }, [currentSession])

  const fetchTeacherData = async () => {
    try {
      if (!user) return

      console.log('🔍 Fetching data for user:', { id: user.id, email: user.email })

      // Fetch classes
      const { data: classesData, error: classesError } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false })

      if (classesError) throw classesError
      console.log(`📚 Found ${classesData?.length || 0} classes`)
      setClasses(classesData || [])

      // Fetch active sessions with better error handling
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('attendance_sessions')
        .select(`
          *,
          classes!inner(subject_name, class_code)
        `)
        .eq('teacher_email', user.email)
        .eq('status', 'active')
        .order('start_time', { ascending: false })

      if (sessionsError) {
        console.error('Sessions query error:', sessionsError)
        // ลองใช้ query แบบง่ายกว่า
        const { data: simpleSessionsData, error: simpleError } = await supabase
          .from('attendance_sessions')
          .select('*')
          .eq('teacher_email', user.email)
          .eq('status', 'active')
          .order('start_time', { ascending: false })
        
        if (simpleError) {
          throw simpleError
        }
        
        if (simpleSessionsData && simpleSessionsData.length > 0) {
          const sessionWithClasses = []
          for (const session of simpleSessionsData) {
            const { data: classData } = await supabase
              .from('classes')
              .select('subject_name, class_code')
              .eq('class_id', session.class_id)
              .single()
            
            sessionWithClasses.push({
              ...session,
              classes: classData || { subject_name: 'Unknown', class_code: 'N/A' }
            })
          }
          setSessions(sessionWithClasses)
        }
      } else {
        setSessions(sessionsData || [])
      }

      // Set current session with motion detection preference
      const activeSessions = (sessionsData as any[]) || []
      if (activeSessions.length > 0) {
        // ให้ความสำคัญกับ motion detection sessions
        const motionSession = activeSessions.find(s => s.session_type === 'motion_detection')
        const selectedSession = motionSession || activeSessions[0]
        
        setCurrentSession(selectedSession)
        console.log('start_time:', selectedSession.start_time)
        console.log('end_time:', selectedSession.end_time)
        await fetchAttendanceRecords(selectedSession.id)
      } else {
        setCurrentSession(null)
        setAttendanceRecords([])
        setSpoofEvents([])
        setSelectedSpoofImage(null)
      }

    } catch (error) {
      console.error('❌ Error fetching teacher data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttendanceRecords = async (sessionId: string) => { //
    try {
      const { data: records, error } = await supabase
        .from('attendance_records') // ดึงจากตาราง attendance_records แทน student_attendance เพื่อให้ได้ข้อมูลล่าสุดของแต่ละ check-in
        .select('*')
        .eq('session_id', sessionId)
        .order('check_in_time', { ascending: false })

      if (error) throw error

      const enrichedRecords = []
      
      if (records && records.length > 0) {
        // สร้างรายการ email ที่ไม่ซ้ำ
        const uniqueEmails = [...new Set(records.map(r => r.student_email))]
        
        // ดึงข้อมูล users ทั้งหมดในครั้งเดียว
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('email, full_name, school_id')
          .in('email', uniqueEmails)

        if (usersError) {
          console.warn('⚠️ Error fetching users data:', usersError)
        }

        // สร้าง Map สำหรับ lookup ที่เร็วขึ้น
        const usersMap = new Map()
        if (usersData) {
          usersData.forEach(user => {
            usersMap.set(user.email, user)
          })
        }

        // รวมข้อมูล attendance กับ users
        for (const record of records) {
          const userData = usersMap.get(record.student_email)
          
          enrichedRecords.push({
            ...record,
            users: userData || { 
              full_name: 'Unknown User', 
              school_id: record.student_id || 'N/A',
              email: record.student_email
            }
          })
        }
      }

      setAttendanceRecords(enrichedRecords)
      
    } catch (error) {
      console.error('❌ Error fetching attendance records:', error)
      setAttendanceRecords([])
    }
  }

  const fetchSessionLogs = async (sessionId: string) => {
    setLogsLoading(true)
    try {
      // Query activity logs from the database
      const { data: logs, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })

      if (error) throw error
      
      setSessionLogs(logs || [])
    } catch (error) {
      console.error('❌ Error fetching session logs:', error)
      // If activity_logs table doesn't exist, set empty logs
      setSessionLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  const openAttendanceLogModal = async (sessionId?: string) => {
    setShowAttendanceLogModal(true)
    setActiveLogTab('logs')
    
    if (sessionId) {
      await fetchSessionLogs(sessionId)
    } else if (currentSession) {
      await fetchSessionLogs(currentSession.id)
    }
  }


const handleManualCaptureFromVideo = async (imageBlob: Blob) => {
  if (!currentSession) {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text: 'ไม่พบเซสชันที่ใช้งานอยู่'
    })
    return
  }

  setActionLoading(true)

  try {
    const formData = new FormData()
    formData.append('session_id', currentSession.id)
    formData.append('image', imageBlob, 'manual_capture.jpg')
    formData.append('force_capture', 'true')

    const response = await fetch(`${FASTAPI_URL}/api/motion/manual-capture`, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.detail || 'Failed to take manual capture')
    }

    const result = await response.json()

    // รับ spoof data
    if (result.spoof_detected && result.spoof_image_b64) {
      handleSpoofDetected({
        image_b64: result.spoof_image_b64,
        timestamp: result.spoof_timestamp,
        spoof_count: result.spoof_count
      })
    }

    Swal.fire({
      icon: 'success',
      title: 'Manual Capture สำเร็จ!',
      text: `พบใบหน้าจริง: ${result.faces_detected} คน${result.spoof_detected ? ` | ⚠️ หน้าปลอม: ${result.spoof_count} คน` : ''}`,
      timer: 3000,
      showConfirmButton: false
    })
    
    setTimeout(() => {
      fetchAttendanceRecords(currentSession.id)
      fetchSessionLogs(currentSession.id)
    }, 2000)
    
  } catch (error: any) {
    console.error('Error taking manual capture:', error)
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text: 'เกิดข้อผิดพลาดในการถ่ายภาพ: ' + error.message
    })
  } finally {
    setActionLoading(false)
  }
}

  const fetchMotionStats = async () => {
    if (!currentSession) return

    try {
      const response = await fetch(`${FASTAPI_URL}/api/motion/session/${currentSession.id}/live-stats`)
      
      if (response.ok) {
        const data = await response.json()
        console.log('motionStats data:', data)
        
        if (data.session_type === 'motion_detection' || data.success) {
          setMotionStats(data)
        } else {
          setMotionStats({
            ...data,
            isMotionSession: false
          })
        }
      } else {
        setMotionStats(null)
      }
    } catch (error) {
      console.error('❌ Error fetching motion stats:', error)
      setMotionStats(null)
    }
  }

  const generateClassCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  const createClass = async () => {
    if (!newClass.subject_name.trim()) {
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'กรุณากรอกชื่อวิชา'
      })
      return
    }

    setActionLoading(true)

    try {
      const classCode = generateClassCode()
      
      const classData = {
        subject_name: newClass.subject_name.trim(),
        description: newClass.description?.trim() || null,
        schedule: newClass.schedule.trim() || null,
        teacher_id: user?.id,
        teacher_email: user?.email,
        class_code: classCode
      }

      const { error } = await supabase
        .from('classes')
        .insert([classData])

      if (error) throw error

      setShowClassCodeModal({
        code: classCode,
        name: newClass.subject_name
      })
      
      setShowCreateModal(false)
      setNewClass({ subject_name: '', description: '', schedule: '' })
      fetchTeacherData()
    } catch (error: any) {
      console.error('Error creating class:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'เกิดข้อผิดพลาดในการสร้างคลาสเรียน: ' + error.message
      })
    } finally {
      setActionLoading(false)
    }
  }

  const startMotionDetectionSession = async (classId: string | boolean) => {
    if (typeof classId !== 'string') return
    setActionLoading(true)

    try {
      // Get initial camera image if available
      let imageBlob = null
      if (videoRef.current && isCapturing) {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (context) {
          canvas.width = videoRef.current.videoWidth
          canvas.height = videoRef.current.videoHeight
          context.drawImage(videoRef.current, 0, 0)
          
          imageBlob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.8)
          })
        }
      }

      const formData = new FormData()
      formData.append('class_id', classId)
      formData.append('teacher_email', user?.email || '')
      formData.append('duration_hours', sessionConfig.duration_hours.toString())
      formData.append('motion_threshold', sessionConfig.motion_threshold.toString())
      formData.append('cooldown_seconds', sessionConfig.cooldown_seconds.toString())
      formData.append('on_time_limit_minutes', sessionConfig.on_time_limit_minutes.toString())
      
      if (imageBlob) {
        formData.append('initial_image', imageBlob, 'initial.jpg')
      }

      const response = await fetch(`${FASTAPI_URL}/api/session/start-motion-detection`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to start motion detection session')
      }

      Swal.fire({
        icon: 'success',
        title: 'สำเร็จ',
        text: 'เริ่มเซสชัน Motion Detection สำเร็จ!',
        timer: 2000,
        showConfirmButton: false
      })
      
      setShowStartSessionModal(false)
      fetchTeacherData()
      
    } catch (error: any) {
      console.error('Error starting motion detection session:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'เกิดข้อผิดพลาดในการเริ่มเซสชัน: ' + error.message
      })
    } finally {
      setActionLoading(false)
    }
  }
  const handleClassSelected = (cls: Class) => {
  setSelectedClassForSession(cls)
  setShowStartSessionModal(false)
  setShowSessionConfigModal(true)
}

// 3. In your startMotionDetectionSession, change the signature to accept
//    classId from selectedClassForSession instead of the modal state:
const handleConfirmStartSession = async () => {
  if (!selectedClassForSession) return
  await startMotionDetectionSession(selectedClassForSession.class_id)
  setShowSessionConfigModal(false)
  setSelectedClassForSession(null)
}

  const endSession = async (sessionId: string) => {
    Swal.fire({
      title: 'คุณต้องการจบเซสชันนี้หรือไม่?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'ใช่, จบเซสชัน!',
      cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
      if (result.isConfirmed) {
        setActionLoading(true)
        try {
          let endpoint = `${FASTAPI_URL}/api/session/${sessionId}/end`
          if (currentSession?.session_type === 'motion_detection') {
            endpoint = `${FASTAPI_URL}/api/session/${sessionId}/end-motion`
          }
          const response = await fetch(endpoint, { method: 'PUT' })
          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.detail || `Failed to end session (${response.status})`)
          }
          setCurrentSession(null)      
          setAttendanceRecords([])    
          Swal.fire({
            icon: 'success',
            title: 'สำเร็จ',
            text: 'จบเซสชันสำเร็จ!',
            timer: 2000,
            showConfirmButton: false
          })
          fetchTeacherData()
        } catch (error: any) {
          console.error('❌ Error ending session:', error)
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: `เกิดข้อผิดพลาดในการจบเซสชัน: ${error.message}`
          })
        } finally {
          setActionLoading(false)
        }
      }
    })
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        } 
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setIsCapturing(true)
        setCameraError('')
      }
    } catch (error: any) {
      console.error('Error starting camera:', error)
      setCameraError('ไม่สามารถเปิดกล้องได้: ' + error.message)
    }
  }

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      const tracks = stream.getTracks()
      tracks.forEach(track => track.stop())
      videoRef.current.srcObject = null
      setIsCapturing(false)
    }
  }

  const takeManualCapture = async () => {
    if (!currentSession) {
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'ไม่พบเซสชันที่ใช้งานอยู่'
      })
      return
    }

    if (!videoRef.current || !isCapturing) {
      Swal.fire({
        icon: 'warning',
        title: 'คำแนะนำ',
        text: 'กรุณาเปิดกล้องก่อน'
      })
      return
    }

    setActionLoading(true)

    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      context.drawImage(videoRef.current, 0, 0)
      
      const imageBlob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      })

      if (!imageBlob) return

      const formData = new FormData()
      formData.append('session_id', currentSession.id)
      formData.append('image', imageBlob, 'manual_capture.jpg')
      formData.append('force_capture', 'true')

      const response = await fetch(`${FASTAPI_URL}/api/motion/manual-capture`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to take manual capture')
      }

      Swal.fire({
        icon: 'success',
        title: 'สำเร็จ',
        text: 'Manual Capture สำเร็จ!',
        timer: 2000,
        showConfirmButton: false
      })
      
      setTimeout(() => {
        fetchAttendanceRecords(currentSession.id)
      }, 2000)
      
    } catch (error: any) {
      console.error('Error taking manual capture:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'เกิดข้อผิดพลาดในการถ่ายภาพ: ' + error.message
      })
    } finally {
      setActionLoading(false)
    }
  }

  const deleteClass = async (classId: string, className: string) => {
    Swal.fire({
      title: `คุณต้องการลบคลาส "${className}" ใช่หรือไม่?`,
      text: "การดำเนินการนี้ไม่สามารถย้อนกลับได้!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'ใช่, ลบเลย!',
      cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
      if (result.isConfirmed) {
        setActionLoading(true)
        try {
          const { error } = await supabase
            .from('classes')
            .delete()
            .eq('class_id', classId)

          if (error) throw error

          Swal.fire({
            icon: 'success',
            title: 'สำเร็จ',
            text: 'ลบคลาสเรียนสำเร็จ',
            timer: 2000,
            showConfirmButton: false
          })
          fetchTeacherData()
        } catch (error: any) {
          console.error('Error deleting class:', error)
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'เกิดข้อผิดพลาดในการลบคลาสเรียน: ' + error.message
          })
        } finally {
          setActionLoading(false)
        }
      }
    })
  }

  const handleSignOut = async () => {
    Swal.fire({
      title: 'คุณต้องการออกจากระบบใช่หรือไม่?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'ใช่, ออกจากระบบ',
      cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
      if (result.isConfirmed) {
        stopCamera()
        await Swal.fire({
          icon: 'success',
          title: 'ออกจากระบบสำเร็จ',
          text: 'หวังว่าจะได้พบกันใหม่นะ!',
          timer: 1500,
          showConfirmButton: false
        })
        await signOut()
      }
    })
  }

  // ถ้ากำลังแสดง Class Detail View ให้แสดง component นั้น
  if (showClassDetail && selectedClass) {
    return (
      <ClassDetailView 
        classData={selectedClass} 
        onBack={handleBackFromClassDetail}
      />
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    )
  }

  return ( 
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/60 backdrop-blur-xl border-b border-white/40 shadow-sm rounded-xl">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100">
                <img src={image} alt="Logo" className="h-14 w-14 object-contain" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">แดชบอร์ดอาจารย์</h1>
                <p className="text-gray-500 text-sm font-medium">ยินดีต้อนรับ, {user?.user_metadata?.full_name || user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="apple-button-secondary py-2 px-5 text-sm flex items-center space-x-2 border-red-100 hover:bg-red-50 hover:text-red-600 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Current Session Status */}
        {currentSession && (
          <div className="glass-card bg-[#0071e3]/10 border-[#0071e3]/20 p-8 mb-10 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#0071e3]/5 rounded-full blur-3xl -mr-32 -mt-32"></div>
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <div className="flex items-center space-x-2 mb-2">
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  <h3 className="text-sm font-bold text-[#0071e3] uppercase tracking-wider">เซสชันที่กำลังดำเนินการ</h3>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">{currentSession.classes?.subject_name}</h2>
                <p className="text-gray-500 font-medium">รหัสคลาส: {currentSession.classes?.class_code}</p>
              </div>
              <div className="flex flex-wrap gap-4 mt-3">


              {/*เวลาเข้าเรียน มาสาย*/}
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-gray-400">🟢 เริ่มเซสชัน:</span>
              <span className="font-semibold text-gray-700">
                {currentSession.start_time?.split('T')[1]?.slice(0, 5) || '-'}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-gray-400">⚠️ เข้าสายหลัง:</span>
              <span className="font-semibold text-yellow-600">
                {currentSession.start_time && currentSession.on_time_limit_minutes
                  ? new Date(
                      new Date(currentSession.start_time).getTime() +
                      currentSession.on_time_limit_minutes * 60000
                    ).toISOString().split('T')[1]?.slice(0, 5)
                  : '-'}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-gray-400">🔴 จบเซสชัน:</span>
              <span className="font-semibold text-gray-700">
                {currentSession.end_time?.split('T')[1]?.slice(0, 5) || '-'}
              </span>
            </div>
          </div>

              
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setShowManualCaptureModal(true)}
                  disabled={currentSession.session_type !== 'motion_detection'}
                  className="apple-button-secondary bg-white py-2.5 text-sm disabled:opacity-50"
                >
                  📸 Manual Capture
                </button>
                <button
                  onClick={() => openAttendanceLogModal()}
                  className="apple-button-secondary bg-white py-2.5 text-sm"
                >
                  📋 บันทึกการเช็คชื่อ
                </button>
                {/* <button
                  onClick={() => setShowSessionDetailsModal(currentSession)}
                  className="apple-button-secondary bg-white py-2.5 text-sm"
                >
                  📊 รายละเอียด
                </button> */}
                <button
                  onClick={() => endSession(currentSession.id)}
                  disabled={actionLoading}
                  className="apple-button-primary bg-red-600 hover:bg-red-700 py-2.5 text-sm"
                >
                  🛑 จบเซสชัน
                </button>
              </div>
            </div>
              
            {motionStats && currentSession && (
              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Motion Events</p>
                  <p className="text-2xl font-semibold text-gray-900">{motionStats.motion_events || 0}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Snapshots</p>
                  <p className="text-2xl font-semibold text-gray-900">{motionStats.snapshots_taken || 0}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Efficiency</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {motionStats.snapshots_taken && motionStats.motion_events
                      ? Math.round((motionStats.snapshots_taken / motionStats.motion_events) * 100)
                      : 0}%
                  </p>
                </div>
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Attendance</p>
                  <p className="text-2xl font-semibold text-gray-900">{motionStats.attendance_records || 0}</p>
                </div>
              </div>
            )}
          </div>
        )}

        
      {selectedSpoofImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedSpoofImage(null)}
          />
          <div className="relative w-full max-w-2xl bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 overflow-hidden">
            
            {/* Header */}
            <div className="p-6 border-b border-red-100 bg-red-50/50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">⚠️ ตรวจพบใบหน้าปลอม</h3>
                <p className="text-sm text-gray-500">
                  {selectedSpoofImage.timestamp.split('T')[1]?.slice(0, 5)}
                  {' · '}พบ {selectedSpoofImage.spoof_count} ใบหน้า
                </p>
              </div>
              <button
                onClick={() => setSelectedSpoofImage(null)}
                className="w-8 h-8 rounded-full bg-white/50 flex items-center justify-center text-gray-500 hover:bg-white transition-all"
              >
                ✕
              </button>
            </div>

            {/* Image */}
            <div className="p-6">
              <img
                src={`data:image/jpeg;base64,${selectedSpoofImage.image_b64}`}
                alt="spoof detected"
                className="w-full rounded-2xl object-contain max-h-[60vh] border border-red-200"
              />
            </div>

            {/* Footer */}
            <div className="p-6 pt-0">
              <button
                onClick={() => setSelectedSpoofImage(null)}
                className="w-full apple-button-secondary py-3 text-sm"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
                  {/* Live Camera + Attendance Panel */}
          {currentSession && (
            <div className="flex gap-6 mb-10">
              
              {/* Left — Camera 70% */}
              <div className="w-[80%]">
                <div className="glass-card p-2 overflow-hidden h-full">
                  <LiveVideoStream
                    currentSession={currentSession}
                    isSessionActive={currentSession !== null}
                    onManualCapture={handleManualCaptureFromVideo}
                    motionStats={motionStats}
                    onSpoofDetected={handleSpoofDetected}
                    onAttendanceDetected={() => {
                      console.log('✨ Attendance detected, refreshing records...')
                      fetchAttendanceRecords(currentSession.id)
                      fetchSessionLogs(currentSession.id)
                    }}
                  />
                </div>
              </div>

              {/* Right — Panel 30% */}
              <div className="w-[20%] flex flex-col gap-4">

                {/* นักเรียนที่เช็คชื่อแล้ว */}
                <div className="glass-card overflow-hidden flex-1">
                  <div className="p-4 border-b border-white/40 bg-white/30 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                      </span>
                      <h2 className="text-sm font-semibold text-gray-900">นักเรียนที่เช็คชื่อแล้ว</h2>
                    </div>
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">
                      {attendanceRecords.length} คน
                    </span>
                  </div>

                  <div className="overflow-y-auto" style={{ maxHeight: '320px' }}>
                    {attendanceRecords.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <div className="text-3xl mb-2">👀</div>
                        <p className="text-xs font-medium">ยังไม่มีนักเรียนเช็คชื่อ</p>
                      </div>
                    ) : (
                      <div className="p-3 space-y-2">
                        {attendanceRecords.map((record, index) => (
                          <div
                            key={record.id || index}
                            className="flex items-center space-x-3 p-3 bg-white/50 rounded-xl border border-white/60"
                          >
                            {/* Avatar */}
                            <div className="w-8 h-8 rounded-full bg-[#0071e3]/10 flex items-center justify-center text-[#0071e3] font-bold text-xs flex-shrink-0">
                              {record.users?.full_name?.charAt(0) || '?'}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 text-xs truncate">
                                {record.users?.full_name || 'Unknown'}
                              </p>
                              <p className="text-[10px] text-gray-400">{record.users?.school_id || 'N/A'}</p>
                              {record.face_match_score != null && (
                                <div className="flex items-center space-x-1 mt-1">
                                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        record.face_match_score >= 0.8 ? 'bg-green-500'
                                        : record.face_match_score >= 0.6 ? 'bg-yellow-400'
                                        : 'bg-red-400'
                                      }`}
                                      style={{ width: `${Math.round(record.face_match_score * 100)}%` }}
                                    />
                                  </div>
                                  <span className={`text-[10px] font-bold ${
                                    record.face_match_score >= 0.8 ? 'text-green-600'
                                    : record.face_match_score >= 0.6 ? 'text-yellow-600'
                                    : 'text-red-500'
                                  }`}>
                                    {Math.round(record.face_match_score * 100)}%
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Status + Time */}
                            <div className="text-right flex-shrink-0">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                record.status === 'present' ? 'bg-green-100 text-green-700'
                                : record.status === 'late' ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-gray-100 text-gray-500'
                              }`}>
                                {record.status === 'present' ? 'มา' : record.status === 'late' ? 'สาย' : record.status}
                              </span>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {record.check_in_time?.split('T')[1]?.slice(0, 5) || ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>



                {/* หน้าปลอม */}
                {spoofEvents.length > 0 && (
                  <div className="glass-card overflow-hidden">
                    <div className="p-4 border-b border-white/40 bg-red-50/30 flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        <span className="flex h-2.5 w-2.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                        </span>
                        <h2 className="text-sm font-semibold text-gray-900">⚠️ หน้าปลอม</h2>
                      </div>
                      <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">
                        {spoofEvents.length} ครั้ง
                      </span>
                    </div>

                    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: '200px' }}>
                      {spoofEvents.map((event, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 bg-red-50/50 rounded-xl border border-red-100"
                        >
                          <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-sm flex-shrink-0">
                              🚨
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 text-xs">Unknown</p>
                              <p className="text-[10px] text-gray-400">
                                {event.timestamp.split('T')[1]?.slice(0, 5)} · {event.spoof_count} ใบหน้า
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedSpoofImage(event)}
                            className="text-[10px] px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-500 hover:text-white transition-all"
                          >
                            ดูภาพ
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}


        {/* Stats Cards & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10">
          <div className="lg:col-span-1 glass-card p-8 flex flex-col justify-center items-center text-center">
            <div className="w-20 h-20 bg-[#0071e3]/10 rounded-3xl flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="text-gray-500 font-semibold uppercase tracking-wider text-xs mb-1">คลาสที่สอนทั้งหมด</p>
            <p className="text-5xl font-bold text-gray-900">{classes.length}</p>
          </div>

          <div className="lg:col-span-2 glass-card p-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-6">เมนูจัดการ</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => setShowCreateModal(true)}
                className="apple-button-primary flex items-center justify-center space-x-3 py-5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>สร้างคลาสใหม่</span>
              </button>
              
              <button
                onClick={() => setShowStartSessionModal(true)}
                disabled={currentSession !== null}
                className="apple-button-secondary bg-green-500/10 text-green-700 border-green-200 hover:bg-green-500 hover:text-white flex items-center justify-center space-x-3 py-5 disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span>เริ่มเช็คชื่อ</span>
              </button>
            </div>
          </div>
        </div>

        {/* Classes Section */}
        <div className="glass-card overflow-hidden">
          <div className="p-8 border-b border-white/40 flex justify-between items-center bg-white/30">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">📚 คลาสเรียนของฉัน</h2>
            {classes.length > 0 && (
              <span className="bg-[#0071e3]/10 text-[#0071e3] px-3 py-1 rounded-full text-xs font-bold">
                {classes.length} คลาส
              </span>
            )}
          </div>

          <div className="p-8">
            {classes.length === 0 ? (
              <div className="text-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
                <div className="bg-white w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <p className="text-gray-500 font-medium mb-6">คุณยังไม่มีคลาสเรียนในขณะนี้</p>
                <button onClick={() => setShowCreateModal(true)} className="apple-button-primary">สร้างคลาสแรกของคุณ</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {classes.map((cls) => (
                  <div 
                    key={cls.class_id} 
                    className="glass-morphism p-6 hover:shadow-lg hover:border-[#0071e3]/30 transition-all group cursor-pointer"
                    onClick={() => handleClassClick(cls)}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="bg-[#0071e3]/10 p-3 rounded-2xl group-hover:bg-[#0071e3] group-hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                      <div className="flex space-x-1">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setShowClassCodeModal({code: cls.class_code, name: cls.subject_name}) }}
                          className="p-2 hover:bg-[#0071e3]/10 rounded-xl text-gray-400 hover:text-[#0071e3] transition-colors"
                          title="แชร์รหัส"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteClass(cls.class_id, cls.subject_name) }}
                          className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-colors"
                          title="ลบ"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1 group-hover:text-[#0071e3] transition-colors">{cls.subject_name}</h3>
                    <p className="text-gray-400 text-sm font-bold mb-4">{cls.class_code}</p>
                    <div className="flex items-center text-[#0071e3] text-sm font-semibold opacity-0 group-hover:opacity-100 transition-all">
                      <span>เข้าจัดการคลาส</span>
                      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}></div>
          <div className="max-w-md w-full glass-card p-10 relative z-10 shadow-2xl scale-100 animate-in fade-in zoom-in duration-300">
            <h3 className="text-2xl font-semibold tracking-tight text-gray-900 mb-6 text-center">สร้างคลาสใหม่</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">ชื่อวิชา</label>
                <input 
                  className="w-full apple-input"
                  placeholder="เช่น วิทยาการคอมพิวเตอร์"
                  value={newClass.subject_name}
                  onChange={(e) => setNewClass({...newClass, subject_name: e.target.value})}
                />
              </div>
              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => setShowCreateModal(false)} 
                  className="flex-1 apple-button-secondary py-3"
                >
                  ยกเลิก
                </button>
                <button 
                  onClick={createClass} 
                  disabled={actionLoading}
                  className="flex-1 apple-button-primary py-3"
                >
                  {actionLoading ? 'กำลังสร้าง...' : 'สร้างคลาส'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showStartSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowStartSessionModal(false)}></div>
          <div className="max-w-md w-full glass-card overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="bg-[#0071e3] p-8 text-white text-center">
              <h3 className="text-2xl font-semibold tracking-tight">เริ่มระบบเช็คชื่อ</h3>
              <p className="text-white/70 text-sm mt-1">เลือกคลาสเรียนที่ต้องการเช็คชื่อ</p>
            </div>
            
            <div className="p-8">
              <div className="space-y-3 max-h-80 overflow-y-auto mb-8 pr-2">
                {classes.length === 0 ? (
                  <p className="text-center text-gray-400 py-6">ไม่พบคลาสเรียน</p>
                ) : (
                  classes.map((cls) => (
                    <button
                      key={cls.class_id}
                      onClick={() => handleClassSelected(cls)}
                      disabled={actionLoading}
                      className="w-full text-left p-5 rounded-2xl border border-gray-100 hover:border-[#0071e3]/30 hover:bg-[#0071e3]/5 transition-all group flex justify-between items-center"
                    >
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-[#0071e3] transition-colors">{cls.subject_name}</p>
                        <p className="text-xs text-gray-400 font-bold">{cls.class_code}</p>
                      </div>
                      <div className="bg-[#0071e3]/10 text-[#0071e3] p-2 rounded-xl group-hover:bg-[#0071e3] group-hover:text-white transition-all">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        </svg>
                      </div>
                    </button>
                  ))
                )}
              </div>

              <button
                onClick={() => setShowStartSessionModal(false)}
                className="w-full apple-button-secondary py-3 text-sm"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
      {showSessionConfigModal && selectedClassForSession && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
    <div
      className="absolute inset-0 bg-black/20 backdrop-blur-sm"
      onClick={() => {
        setShowSessionConfigModal(false)
        setShowStartSessionModal(true)
      }}
    />
    <div className="max-w-md w-full glass-card overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
      
      {/* Header */}
      <div className="bg-[#0071e3] p-8 text-white text-center">
        <div className="text-3xl mb-2">⚙️</div>
        <h3 className="text-2xl font-semibold tracking-tight">ตั้งค่าเซสชัน</h3>
        <p className="text-white/70 text-sm mt-1">{selectedClassForSession.subject_name}</p>
      </div>

      <div className="p-8 space-y-6">

        {/* Duration */}
        <div className="bg-gray-50/80 rounded-2xl p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-3">
            🕐 ระยะเวลาของคลาส
          </label>
          <div className="flex items-center space-x-4">
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.5}
              value={sessionConfig.duration_hours}
              onChange={(e) =>
                setSessionConfig({ ...sessionConfig, duration_hours: parseFloat(e.target.value) })
              }
              className="flex-1 accent-[#0071e3]"
            />
            <span className="text-[#0071e3] font-bold text-sm w-16 text-right">
              {sessionConfig.duration_hours.toFixed(1)} ชม.
            </span>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1 px-0.5">
            <span>0.5 ชม.</span><span>6 ชม.</span>
          </div>
        </div>

        {/* On-time limit */}
        <div className="bg-gray-50/80 rounded-2xl p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            ⏰ เวลามาทัน (นาทีหลังเริ่มเซสชัน)
          </label>
          <p className="text-xs text-gray-400 mb-3">
            นักเรียนที่เช็คชื่อหลังจากนี้จะถูกบันทึกว่า "สาย"
          </p>
          <div className="flex items-center space-x-4">
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={sessionConfig.on_time_limit_minutes}
              onChange={(e) =>
                setSessionConfig({
                  ...sessionConfig,
                  on_time_limit_minutes: parseInt(e.target.value),
                })
              }
              className="flex-1 accent-[#0071e3]"
            />
            <span className="text-[#0071e3] font-bold text-sm w-16 text-right">
              {sessionConfig.on_time_limit_minutes} นาที
            </span>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1 px-0.5">
            <span>5 นาที</span><span>60 นาที</span>
          </div>

          {/* Visual timeline hint */}
          <div className="mt-4 flex items-center space-x-2 text-xs">
            <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full font-semibold">มาทัน</span>
            <div className="flex-1 h-1 bg-gradient-to-r from-green-400 to-yellow-400 rounded-full" />
            <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full font-semibold">สาย</span>
            <div className="flex-1 h-1 bg-yellow-300 rounded-full" />
            <span className="text-gray-400">{sessionConfig.duration_hours * 60} นาที</span>
          </div>
        </div>

        {/* Summary */}
        <div className="border border-[#0071e3]/20 bg-[#0071e3]/5 rounded-2xl p-4 text-sm text-gray-600 space-y-1">
          <p>📚 คลาส: <span className="font-semibold text-gray-900">{selectedClassForSession.subject_name}</span></p>
          <p>⏱ ระยะเวลา: <span className="font-semibold text-gray-900">{sessionConfig.duration_hours} ชั่วโมง</span></p>
          <p>✅ มาทันภายใน: <span className="font-semibold text-gray-900">{sessionConfig.on_time_limit_minutes} นาที</span></p>
          <p>⚠️ หลัง {sessionConfig.on_time_limit_minutes} นาที: <span className="font-semibold text-yellow-600">บันทึกว่าสาย</span></p>
        </div>

        {/* Actions */}
        <div className="flex space-x-3 pt-2">
          <button
            onClick={() => {
              setShowSessionConfigModal(false)
              setShowStartSessionModal(true)
            }}
            className="flex-1 apple-button-secondary py-3 text-sm"
          >
            ย้อนกลับ
          </button>
          <button
            onClick={handleConfirmStartSession}
            disabled={actionLoading}
            className="flex-1 apple-button-primary py-3 text-sm bg-[#0071e3] hover:bg-[#0077ed]"
          >
            {actionLoading ? 'กำลังเริ่ม...' : '🚀 เริ่มเช็คชื่อ'}
          </button>
        </div>
      </div>
    </div>
  </div>
)}

      {showClassCodeModal && (
        <ClassCodeDisplay
          classCode={showClassCodeModal.code}
          className={showClassCodeModal.name}
          onClose={() => setShowClassCodeModal(null)}
        />
      )}
      
      {/* Attendance Log Modal */}
      {showAttendanceLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowAttendanceLogModal(false)}></div>
          <div className="max-w-4xl w-full glass-card max-h-[85vh] flex flex-col overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-8 border-b border-white/40 flex justify-between items-center bg-white/30">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-gray-900">บันทึกเซสชัน</h3>
                <p className="text-gray-500 text-sm font-medium">ติดตามกิจกรรมและการเช็คชื่อทั้งหมด</p>
              </div>
              <button
                onClick={() => setShowAttendanceLogModal(false)}
                className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-xl transition-all"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex border-b border-white/40 bg-white/10 px-8">
              <button
                onClick={() => setActiveLogTab('logs')}
                className={`py-4 px-6 text-sm font-bold transition-all relative ${
                  activeLogTab === 'logs' ? 'text-[#0071e3]' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                กิจกรรม (Logs)
                {activeLogTab === 'logs' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#0071e3] rounded-t-full"></div>}
              </button>
              <button
                onClick={() => setActiveLogTab('attendance')}
                className={`py-4 px-6 text-sm font-bold transition-all relative ${
                  activeLogTab === 'attendance' ? 'text-[#0071e3]' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                รายการเช็คชื่อ ({attendanceRecords.length})
                {activeLogTab === 'attendance' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#0071e3] rounded-t-full"></div>}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              {activeLogTab === 'logs' ? (
                <div className="space-y-4">
                  {logsLoading ? (
                    <div className="text-center py-12">
                      <div className="animate-spin h-8 w-8 border-2 border-[#0071e3] border-t-transparent rounded-full mx-auto mb-4"></div>
                      <p className="text-gray-500">กำลังโหลดบันทึกกิจกรรม...</p>
                    </div>
                  ) : sessionLogs.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <p>ยังไม่มีบันทึกกิจกรรมในเซสชันนี้</p>
                    </div>
                  ) : (
                    sessionLogs.map((log, idx) => (
                      <div key={idx} className="flex items-start space-x-4 p-4 glass-morphism bg-white/40 border-white/60">
                        <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                          log.activity_type === 'error' ? 'bg-red-500' :
                          log.activity_type === 'attendance' ? 'bg-green-500' : 'bg-[#0071e3]'
                        }`}></div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">{log.message || log.activity_type}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight mt-1">
                            {new Date(log.created_at).toLocaleTimeString('th-TH')}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {attendanceRecords.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <p>ยังไม่มีนักเรียนเช็คชื่อในเซสชันนี้</p>
                    </div>
                  ) : (
                    attendanceRecords.map((record, idx) => (
                      <div key={idx} className="flex items-center justify-between p-4 glass-morphism bg-white/40 border-white/60">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 bg-[#0071e3]/10 rounded-xl flex items-center justify-center text-[#0071e3] font-bold">
                            {record.users?.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{record.users?.full_name || 'Unknown'}</p>
                            <p className="text-xs text-gray-400">{record.student_email}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                            record.status === 'present' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
                          }`}>
                            {record.status === 'present' ? 'มาเรียน' : 'มาสาย'}
                          </span>
                          <p className="text-[10px] text-gray-400 font-bold mt-1">
                            {new Date(record.check_in_time).toLocaleTimeString('th-TH')}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="p-8 bg-white/30 border-t border-white/40">
              <button
                onClick={() => setShowAttendanceLogModal(false)}
                className="w-full apple-button-secondary py-3"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Capture Modal */}
      {showManualCaptureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowManualCaptureModal(false)}></div>
          <div className="max-w-md w-full glass-card p-10 relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <h3 className="text-2xl font-semibold tracking-tight text-gray-900 mb-6 text-center">📸 Manual Capture</h3>
            
            <div className="relative bg-gray-900 rounded-3xl overflow-hidden aspect-video mb-8">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              {!isCapturing && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-800/60 backdrop-blur-sm">
                  <button 
                    onClick={startCamera}
                    className="apple-button-primary"
                  >
                    เปิดกล้อง
                  </button>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-xs mb-6 text-center">
                {cameraError}
              </div>
            )}

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  stopCamera()
                  setShowManualCaptureModal(false)
                }}
                className="flex-1 apple-button-secondary py-3"
              >
                ยกเลิก
              </button>
              <button
                onClick={takeManualCapture}
                disabled={actionLoading || !isCapturing}
                className="flex-1 apple-button-primary py-3"
              >
                {actionLoading ? 'กำลังบันทึก...' : 'ถ่ายภาพ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EnhancedTeacherDashboard
