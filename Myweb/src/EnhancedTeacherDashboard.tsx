import { useState, useEffect, useRef, FC } from 'react'
import Swal from 'sweetalert2'
import { useAuth } from './login/AuthContext'
import { supabase } from './supabaseClient'
import ClassCodeDisplay from './ClassCodeDisplay'
import LiveVideoStream from './LiveVideoStream'
import ClassDetailView from './ClassDetailView'
import config from './config'
import image from './utils/logo/image.png' 
import type { Class, AttendanceSession, AttendanceRecord, User as AppUser, MotionCapture } from '@/types'

interface SpoofEvent {
  image_b64: string
  timestamp: string
  spoof_count: number
}

const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
const TIMES = Array.from({ length: 10 }, (_, i) => {
  const hour = i + 8
  return `${hour.toString().padStart(2, '0')}:00`
})
const MultiClassCodeCard: FC<{ classCode: string; className: string }> = ({ classCode, className }) => {
  const [copied, setCopied] = useState(false)
  const [copiedMsg, setCopiedMsg] = useState(false)

  const copyToClipboard = async (text: string, type: 'code' | 'msg') => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    if (type === 'code') {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      setCopiedMsg(true)
      setTimeout(() => setCopiedMsg(false), 2000)
    }
  }

  const shareMessage = `🎓 เข้าร่วมคลาสเรียน "${className}"\n\n📋 รหัสเข้าร่วม: ${classCode}\n\n📱 วิธีการเข้าร่วม:\n1. เข้าสู่ระบบในแอป\n2. คลิก "เข้าร่วมวิชา"\n3. กรอกรหัส: ${classCode}\n\n🔗 ระบบเช็คชื่อด้วย Face Recognition`

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `เข้าร่วมคลาส ${className}`, text: shareMessage })
      } catch (err: any) {
        if (err.name !== 'AbortError') copyToClipboard(shareMessage, 'msg')
      }
    } else {
      copyToClipboard(shareMessage, 'msg')
    }
  }

  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <h4 className="text-base font-bold text-gray-900 mb-3">{className}</h4>

      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-3">
        <p className="text-sm text-blue-600 mb-2">รหัสเข้าร่วมคลาส</p>
        <div className="text-3xl font-bold text-blue-800 font-mono tracking-wider mb-3">
          {classCode}
        </div>
        <button
          onClick={() => copyToClipboard(classCode, 'code')}
          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium transition-colors ${
            copied ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
          }`}
        >
          {copied ? (
            <>
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              คัดลอกแล้ว
            </>
          ) : (
            <>
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              คัดลอกรหัส
            </>
          )}
        </button>
      </div>

      <div className="flex space-x-2">
        <button
          onClick={handleShare}
          className="flex-1 bg-green-600 text-white py-2 px-3 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-1 text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
          </svg>
          <span>แชร์รหัส</span>
        </button>
        <button
          onClick={() => copyToClipboard(shareMessage, 'msg')}
          className={`flex-1 py-2 px-3 rounded-lg transition-colors flex items-center justify-center space-x-1 text-sm ${
            copiedMsg ? 'bg-green-100 text-green-800' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span>{copiedMsg ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ'}</span>
        </button>
      </div>
    </div>
  )
}
const EnhancedTeacherDashboard: FC = () => {
  const [weeklySessionCount, setWeeklySessionCount] = useState(0)
  const fetchWeeklySessionCount = async (classId: string) => {
    const startOfWeek = new Date()
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
    startOfWeek.setHours(0, 0, 0, 0)

    const { count } = await supabase
      .from('attendance_sessions')
      .select('id', { count: 'exact' })
      .eq('class_id', classId)
      .gte('start_time', startOfWeek.toISOString())

    setWeeklySessionCount(count || 0)
  }
  const { user, signOut } = useAuth()
  const [classes, setClasses] = useState<Class[]>([])
  const [sessions, setSessions] = useState<AttendanceSession[]>([])
  const [currentSession, setCurrentSession] = useState<AttendanceSession | null>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [motionStats, setMotionStats] = useState<MotionCapture | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  
  // เพิ่ม state สำหรับ Class Detail View
  const [selectedClass, setSelectedClass] = useState<Class | null>(null)
  const [showClassDetail, setShowClassDetail] = useState(false)
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showClassCodeModal, setShowClassCodeModal] = useState<{code: string, name: string} | null>(null)
  const [showManualCaptureModal, setShowManualCaptureModal] = useState(false)
  const [showAttendanceLogModal, setShowAttendanceLogModal] = useState(false)
  const [showClassAttendanceSettingsModal, setShowClassAttendanceSettingsModal] = useState<Class | null>(null)
  const [activeLogTab, setActiveLogTab] = useState<'logs' | 'attendance'>('logs')
  const [sessionLogs, setSessionLogs] = useState<MotionCapture[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [selectedClassForSession, setSelectedClassForSession] = useState<Class | null>(null)
  const [showSessionConfigModal, setShowSessionConfigModal] = useState(false)
  const [showMultiClassCodeModal, setShowMultiClassCodeModal] = useState<{code: string, name: string}[] | null>(null)
  
  //spoof
  const [spoofEvents, setSpoofEvents] = useState<SpoofEvent[]>([])
  const [selectedSpoofImage, setSelectedSpoofImage] = useState<SpoofEvent | null>(null)

  const handleSpoofDetected = (event: SpoofEvent) => {
    console.log('showClassDetail:', showClassDetail)
    console.log('🚨 Spoof detected:', event)
    setSpoofEvents(prev => [event, ...prev]) // ใหม่สุดขึ้นก่อน
    console.log('spoofEvents after:', spoofEvents)
  }
  
  // Form states
const [newClass, setNewClass] = useState({
  subject_name: '',
  description: '',
  total_weeks: 12,
  max_checkins_per_week: 1,
  sections: [
    { scheduleSlots: [{ day: 'จันทร์', startTime: '', endTime: '' }] }
  ]
})
  const [sessionConfig, setSessionConfig] = useState({
    duration_hours: 2,
    motion_threshold: 0.1,
    cooldown_seconds: 30,
    on_time_limit_minutes: 30
  })

  const [classAttendanceSettings, setClassAttendanceSettings] = useState({
    default_duration_hours: 2,
    default_on_time_limit_minutes: 30
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
      const activeSessions = (sessionsData as AttendanceSession[]) || []
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
      text: 'ไม่พบคาบเรียนที่ใช้งานอยู่'
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
  if (!newClass.subject_name.trim()) { /* validate */ return }

  // validate แต่ละ section
// validate total_weeks และ max_checkins_per_week
 if (!newClass.total_weeks || newClass.total_weeks < 1) {
  Swal.fire({ icon: 'error', title: 'จำนวนสัปดาห์ไม่ถูกต้อง', text: 'กรุณากรอกจำนวนสัปดาห์ของคอร์สอย่างน้อย 1 สัปดาห์' })
  return
}

if (!newClass.max_checkins_per_week || newClass.max_checkins_per_week < 1) {
  Swal.fire({ icon: 'error', title: 'จำนวนเช็คชื่อไม่ถูกต้อง', text: 'กรุณากรอกจำนวนเช็คชื่อต่อสัปดาห์อย่างน้อย 1 ครั้ง' })
  return
}

  // เช็คว่าทุก section มีจำนวนวันเรียนเท่ากัน
  const slotCounts = newClass.sections.map(s => s.scheduleSlots.length)
  const allSame = slotCounts.every(c => c === slotCounts[0])
  if (!allSame) {
    Swal.fire({
      icon: 'error',
      title: 'จำนวนวันเรียนไม่เท่ากัน',
      text: `ทุก Section ต้องมีจำนวนวันเรียนเท่ากัน (${slotCounts.map((c, i) => `Section ${i + 1}: ${c} วัน`).join(', ')})`
    })
    return
  }
  for (let si = 0; si < newClass.sections.length; si++) {
  const section = newClass.sections[si]
  const slots = section.scheduleSlots

  const invalid = slots.some(s => !s.startTime || !s.endTime)
  if (invalid) { /* เดิม */ return }

  const slotCount = slots.length

  
  if (newClass.max_checkins_per_week < slotCount) {
    Swal.fire({ icon: 'error', title: 'จำนวนเช็คชื่อต่อสัปดาห์ไม่ถูกต้อง',
      text: `Section ${si + 1} มี ${slotCount} วันเรียน เช็คชื่อได้ต่อสัปดาห์ต้องมีอย่างน้อย ${slotCount} ครั้ง` })
    return
  }
}

  setActionLoading(true)
  try {
    const suffix = newClass.sections.length > 1
    const insertData = newClass.sections.map((section, idx) => {
  const name = suffix ? `${newClass.subject_name.trim()}[${idx + 1}]` : newClass.subject_name.trim()
  const schedule = section.scheduleSlots.map(s => `${s.day} ${s.startTime}-${s.endTime}`).join(', ')
  return {
    subject_name: name,
    description: newClass.description?.trim() || null,
    schedule,
    total_weeks: newClass.total_weeks || null,
    max_checkins_per_week: newClass.max_checkins_per_week || null,
    teacher_id: user?.id,
    teacher_email: user?.email,
    class_code: generateClassCode()
  }
})

    const { error } = await supabase.from('classes').insert(insertData)
    if (error) throw error

    // แสดง code ของ section แรก (หรือจะ loop แสดงทั้งหมดก็ได้)
    if (insertData.length === 1) {
          setShowClassCodeModal({ code: insertData[0].class_code, name: insertData[0].subject_name })
        } else {
          setShowMultiClassCodeModal(insertData.map(cls => ({
            code: cls.class_code,
            name: cls.subject_name
          })))
        }
    setShowCreateModal(false)
    setNewClass({ subject_name:'', description:'', total_weeks:12,
      max_checkins_per_week:1, sections:[{scheduleSlots:[{day:'จันทร์',startTime:'',endTime:''}]}] })
    fetchTeacherData()
  } catch (error: any) {
    Swal.fire({ icon:'error', title:'เกิดข้อผิดพลาด', text: error.message })
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
        text: 'เริ่มคาบเรียน Motion Detection สำเร็จ!',
        timer: 2000,
        showConfirmButton: false
      })
      
      fetchTeacherData()
      
    } catch (error: any) {
      console.error('Error starting motion detection session:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'เกิดข้อผิดพลาดในการเริ่มคาบเรียน: ' + error.message
      })
    } finally {
      setActionLoading(false)
    }
  }
  const handleClassSelected = (cls: Class) => {
    setSelectedClassForSession(cls)
    
    // ตั้งค่า sessionConfig จากค่าที่บันทึกไว้ในคลาส หรือใช้ค่าเริ่มต้น
    setSessionConfig({
      ...sessionConfig,
      duration_hours: cls.default_duration_hours || 2,
      on_time_limit_minutes: cls.default_on_time_limit_minutes || 30
    })
    fetchWeeklySessionCount(cls.class_id)
    setShowSessionConfigModal(true)
  }

  const updateClassAttendanceSettings = async () => {
    if (!showClassAttendanceSettingsModal) return
    
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from('classes')
        .update({
          default_duration_hours: classAttendanceSettings.default_duration_hours,
          default_on_time_limit_minutes: classAttendanceSettings.default_on_time_limit_minutes,
          attendance_settings_updated_at: new Date().toISOString()
        })
        .eq('class_id', showClassAttendanceSettingsModal.class_id)

      if (error) throw error

      Swal.fire({
        icon: 'success',
        title: 'สำเร็จ',
        text: 'บันทึกการตั้งค่าสำเร็จ',
        timer: 2000,
        showConfirmButton: false
      })
      
      setShowClassAttendanceSettingsModal(null)
      fetchTeacherData()
    } catch (error: any) {
      console.error('Error updating class settings:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'ไม่สามารถบันทึกการตั้งค่าได้: ' + error.message
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleConfirmStartSession = async () => {
    if (!selectedClassForSession) return
    const targetClass = selectedClassForSession
    await startMotionDetectionSession(targetClass.class_id)
    setShowSessionConfigModal(false)
    setSelectedClassForSession(null)
    
    // นำทางไปยังหน้า Class Detail ทันทีเพื่อให้เห็นหน้าจอเช็คชื่อ
    setSelectedClass(targetClass)
    setShowClassDetail(true)
  }

  const endSession = async (sessionId: string) => {
    Swal.fire({
      title: 'คุณต้องการจบคาบเรียนนี้หรือไม่?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'ใช่, จบคาบเรียน!',
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

          // Clear spoof data
          setSpoofEvents([])
          setSelectedSpoofImage(null)

          Swal.fire({
            icon: 'success',
            title: 'สำเร็จ',
            text: 'จบคาบเรียนสำเร็จ!',
            timer: 2000,
            showConfirmButton: false
          })
          fetchTeacherData()
        } catch (error: any) {
          console.error('❌ Error ending session:', error)
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: `เกิดข้อผิดพลาดในการจบคาบเรียน: ${error.message}`
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
        text: 'ไม่พบคาบเรียนที่ใช้งานอยู่'
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
    <div className="min-h-screen bg-blue-50">
      {showClassDetail && selectedClass ? (
        <ClassDetailView
          classData={selectedClass}
          onBack={handleBackFromClassDetail}
          currentSession={currentSession}
          onStartAttendance={handleClassSelected}
          onShowSettings={(cls) => {
            setClassAttendanceSettings({
              default_duration_hours: cls.default_duration_hours || 2,
              default_on_time_limit_minutes: cls.default_on_time_limit_minutes || 30
            });
            setShowClassAttendanceSettingsModal(cls);
          }}
          onManualCapture={handleManualCaptureFromVideo}
          motionStats={motionStats}
          onSpoofDetected={handleSpoofDetected}
          attendanceRecords={attendanceRecords}
          spoofEvents={spoofEvents}
          onShowSpoofImage={setSelectedSpoofImage}
          onEndSession={endSession}
        />
      ) : (

        <>
          {/* Header */}
          <header className="sticky top-0 z-40 bg-blue-600 backdrop-blur-xl border-b border-blue-700 shadow-md">
            <div className="max-w-7xl mx-auto px-6 py-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-4">
                  <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100">
                    <img src={image} alt="Logo" className="h-16 w-16 object-contain" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight text-white">หน้าหลัก อาจารย์</h1>
                    <p className="text-blue-100 text-lg font-medium">ยินดีต้อนรับ, {user?.user_metadata?.full_name || user?.email}</p>
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="bg-white/10 hover:bg-white/20 text-white border border-white/20 py-2 px-5 text-sm flex items-center space-x-2 rounded-xl transition-all"
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
                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="apple-button-primary flex items-center justify-center space-x-3 py-5"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>สร้างคลาสใหม่</span>
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
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setClassAttendanceSettings({
                                  default_duration_hours: cls.default_duration_hours || 2,
                                  default_on_time_limit_minutes: cls.default_on_time_limit_minutes || 30
                                });
                                setShowClassAttendanceSettingsModal(cls);
                              }}
                              className="p-2 hover:bg-[#0071e3]/10 rounded-xl text-gray-400 hover:text-[#0071e3] transition-colors"
                              title="ตั้งค่าเวลาเช็คชื่อ"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                              </svg>
                            </button>
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
                        <div className="flex items-center justify-center space-x-2 mb-4">
                          <p className="text-gray-400 text-sm font-bold">{cls.class_code}</p>
                        </div>
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
        </>
      )}

      {/* Modals */}
      {showCreateModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
    <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}></div>
    <div className="max-w-md w-full glass-card p-10 relative z-10 shadow-2xl scale-100 animate-in fade-in zoom-in duration-300 max-h-[85vh] overflow-y-auto">
      <h3 className="text-2xl font-semibold tracking-tight text-gray-900 mb-6 text-center">สร้างคลาสใหม่</h3>

      <div className="space-y-4">

        {/* ── ข้อมูลร่วมทุก section ── */}
        <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          ข้อมูลร่วมกันทุก Section
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">ชื่อวิชา *</label>
          <input
            className="w-full apple-input"
            placeholder="เช่น English Communication"
            value={newClass.subject_name}
            onChange={(e) => setNewClass({ ...newClass, subject_name: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">คำอธิบาย</label>
          <input
            className="w-full apple-input"
            placeholder="เช่น รายละเอียดวิชา"
            value={newClass.description}
            onChange={(e) => setNewClass({ ...newClass, description: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">จำนวนสัปดาห์</label>
            <input
              type="number"
              className="w-full apple-input"
              value={newClass.total_weeks}
              onChange={(e) => setNewClass({ ...newClass, total_weeks: parseInt(e.target.value) || 1 })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">เช็คชื่อได้ต่อสัปดาห์</label>
            <input
              type="number"
              className="w-full apple-input"
              value={newClass.max_checkins_per_week}
              onChange={(e) => setNewClass({ ...newClass, max_checkins_per_week: parseInt(e.target.value) || 1 })}
            />
          </div>
        </div>

        {/* ── divider ── */}
        <div className="border-t border-gray-100 pt-2">
          <p className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-3">
            Sections — ตารางเรียน
          </p>

          {/* ── Section blocks ── */}
          <div className="space-y-4">
            {newClass.sections.map((section, si) => (
              <div key={si} className="border border-gray-100 rounded-2xl p-4 space-y-3 bg-white/40">

                {/* Section header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold bg-[#0071e3]/10 text-[#0071e3] px-2 py-0.5 rounded-lg">
                      Section {si + 1}
                    </span>
                    {newClass.subject_name && newClass.sections.length > 1 && (
                      <span className="text-[11px] text-gray-400">
                        → {newClass.subject_name}[{si + 1}]
                      </span>
                    )}
                    {newClass.subject_name && newClass.sections.length === 1 && (
                      <span className="text-[11px] text-gray-400">
                        → {newClass.subject_name}
                      </span>
                    )}
                  </div>
                  {si > 0 && (
                      <button
                      onClick={() => {
                        const sections = newClass.sections.filter((_, i) => i !== si)
                        const slotCount = sections[0].scheduleSlots.length
                        setNewClass({ ...newClass, sections, max_checkins_per_week: slotCount })
                      }}
                      className="text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-0.5 rounded-lg transition-all"
                    >
                      ✕ ลบ section นี้
                    </button>
                  )}
                </div>

                {/* Schedule slots */}
                <label className="block text-sm font-medium text-gray-600">ตารางเรียน</label>
                <div className="space-y-2">
                  {section.scheduleSlots.map((slot, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        className="apple-input flex-1"
                        value={slot.day}
                        onChange={(e) => {
                          const sections = [...newClass.sections]
                          sections[si] = {
                            ...sections[si],
                            scheduleSlots: sections[si].scheduleSlots.map((s, i) =>
                              i === idx ? { ...s, day: e.target.value } : s
                            )
                          }
                          setNewClass({ ...newClass, sections })
                        }}
                      >
                        {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>

                      <select
                        className="apple-input flex-1"
                        value={slot.startTime}
                        onChange={(e) => {
                          const sections = [...newClass.sections]
                          sections[si] = {
                            ...sections[si],
                            scheduleSlots: sections[si].scheduleSlots.map((s, i) =>
                              i === idx ? { ...s, startTime: e.target.value, endTime: '' } : s
                            )
                          }
                          setNewClass({ ...newClass, sections })
                        }}
                      >
                        <option value="" disabled>เริ่ม</option>
                        {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>

                      <select
                        className="apple-input flex-1"
                        value={slot.endTime}
                        disabled={!slot.startTime}
                        onChange={(e) => {
                          const sections = [...newClass.sections]
                          sections[si] = {
                            ...sections[si],
                            scheduleSlots: sections[si].scheduleSlots.map((s, i) =>
                              i === idx ? { ...s, endTime: e.target.value } : s
                            )
                          }
                          setNewClass({ ...newClass, sections })
                        }}
                      >
                        <option value="" disabled>จบ</option>
                        {TIMES.filter(t => !slot.startTime || t > slot.startTime)
                          .map(t => <option key={t} value={t}>{t}</option>)}
                      </select>

                      {section.scheduleSlots.length > 1 && (
                        <button
                          onClick={() => {
                            const sections = [...newClass.sections]
                            sections[si] = {
                              ...sections[si],
                              scheduleSlots: sections[si].scheduleSlots.filter((_, i) => i !== idx)
                            }
                            const newSlotCount = sections[si].scheduleSlots.length
                            setNewClass({ 
                              ...newClass, 
                              sections,
                              max_checkins_per_week: newSlotCount
                            })
                          }}
                          className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}

                  {/* ปุ่มเพิ่มวันเรียนภายใน section */}
                  <button
                    onClick={() => {
                      const sections = [...newClass.sections]
                      sections[si] = {
                        ...sections[si],
                        scheduleSlots: [
                          ...sections[si].scheduleSlots,
                          { day: 'จันทร์', startTime: '', endTime: '' }
                        ]
                      }
                      const newSlotCount = sections[si].scheduleSlots.length
                      setNewClass({ 
                        ...newClass, 
                        sections,
                        max_checkins_per_week: newSlotCount
                      })
                    }}
                    className="w-full py-2 border border-dashed border-[#0071e3]/40 text-[#0071e3] text-xs font-medium rounded-xl hover:bg-[#0071e3]/5 transition-all"
                  >
                    + เพิ่ม เรียนใน Section {si + 1}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ปุ่มเพิ่ม Section */}
          <button
            onClick={() => {
              const firstSectionSlots = newClass.sections[0].scheduleSlots
              const newSection = {
                scheduleSlots: firstSectionSlots.map(slot => ({
                  day: slot.day,
                  startTime: '',
                  endTime: ''
                }))
              }
              const sections = [...newClass.sections, newSection]
              const slotCount = sections[0].scheduleSlots.length
              setNewClass({ ...newClass, sections, max_checkins_per_week: slotCount })
            }}
            className="w-full mt-3 py-2 border border-dashed border-gray-200 text-gray-400 text-sm rounded-xl hover:border-gray-300 hover:text-gray-500 transition-all"
          >
            + เพิ่ม Section
          </button>

          {/* Preview ชื่อที่จะสร้าง */}
          {newClass.sections.length > 1 && newClass.subject_name && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-gray-400">จะสร้าง:</span>
              {newClass.sections.map((_, i) => (
                <span key={i} className="text-[11px] bg-gray-50 border border-gray-100 rounded-lg px-2 py-0.5 text-gray-500">
                  {newClass.subject_name}[{i + 1}]
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── ปุ่มยืนยัน ── */}
        <div className="flex space-x-3 pt-2">
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
            {actionLoading
              ? 'กำลังสร้าง...'
              : newClass.sections.length > 1
                ? `สร้างคลาส (${newClass.sections.length} Section)`
                : 'สร้างคลาส'}
          </button>
        </div>

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
              setSelectedClassForSession(null)
            }}
          />
          <div className="max-w-md w-full glass-card overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            {/* Header */}
            <div className="bg-[#0071e3] p-8 text-white text-center">
              <div className="text-3xl mb-2">🚀</div>
              <h3 className="text-2xl font-semibold tracking-tight">ยืนยันการเริ่มเช็คชื่อ</h3>
              <p className="text-white/70 text-sm mt-1">{selectedClassForSession.subject_name}</p>
            </div>

            <div className="p-8 space-y-6">
              <p className="text-center text-gray-600">คุณต้องการเริ่มการเช็คชื่อสำหรับคลาสนี้ใช่หรือไม่?</p>
              
              {/* Summary of settings */}
              <div className="bg-gray-50/80 rounded-2xl p-5 border border-gray-100 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">🕐 ระยะเวลาคลาส:</span>
                  <span className="font-bold text-gray-900">{sessionConfig.duration_hours} ชม.</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">⏰ มาทันภายใน:</span>
                  <span className="font-bold text-green-600">{sessionConfig.on_time_limit_minutes} นาที</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-200 pt-2">
                  <span className="text-sm text-gray-500">⚠️ หลัง {sessionConfig.on_time_limit_minutes} นาที:</span>
                  <span className="font-bold text-yellow-600">บันทึกว่าสาย</span>
                </div>
              </div>
                <div className="flex justify-between items-center border-t border-gray-200 pt-2">
                        <span className="text-sm text-gray-500">📅 สัปดาห์นี้เช็คไปแล้ว:</span>
<span className="font-bold text-[#0071e3]">
  {weeklySessionCount} / {selectedClassForSession?.max_checkins_per_week || '?'} ครั้ง
</span>
                      </div>
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => {
                    setShowSessionConfigModal(false)
                    setSelectedClassForSession(null)
                  }}
                  className="flex-1 apple-button-secondary py-3 text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleConfirmStartSession}
                  disabled={actionLoading}
                  className="flex-1 apple-button-primary py-3 text-sm bg-[#0071e3] hover:bg-[#0077ed]"
                >
                  {actionLoading ? 'กำลังเริ่ม...' : 'ยืนยันเริ่มเช็คชื่อ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showClassAttendanceSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowClassAttendanceSettingsModal(null)}
          />
          <div className="max-w-md w-full glass-card overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            
            {/* Header */}
            <div className="bg-[#0071e3] p-8 text-white text-center">
              <div className="text-3xl mb-2">⚙️</div>
              <h3 className="text-2xl font-semibold tracking-tight">ตั้งค่าเวลาเช็คชื่อ (Template)</h3>
              <p className="text-white/70 text-sm mt-1">{showClassAttendanceSettingsModal.subject_name}</p>
            </div>

            <div className="p-8 space-y-6">
              {/* Duration */}
              <div className="bg-gray-50/80 rounded-2xl p-5">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  🕐 ระยะเวลาของคลาสเรียน
                </label>
                <div className="flex items-center space-x-4">
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={1}
                    value={classAttendanceSettings.default_duration_hours}
                    onChange={(e) =>
                      setClassAttendanceSettings({ ...classAttendanceSettings, default_duration_hours: parseFloat(e.target.value) })
                    }
                    className="flex-1 accent-[#0071e3]"
                  />
                  <span className="text-[#0071e3] font-bold text-sm w-16 text-right">
                    {classAttendanceSettings.default_duration_hours.toFixed(0)} ชม.
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1 px-0.5">
                  <span>1 ชม.</span><span>8 ชม.</span>
                </div>
              </div>
                    
              {/* On-time limit */}
              <div className="bg-gray-50/80 rounded-2xl p-5">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  ⏰ เวลามาทัน (นาทีหลังเริ่มคาบเรียน)
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
                    value={classAttendanceSettings.default_on_time_limit_minutes}
                    onChange={(e) =>
                      setClassAttendanceSettings({
                        ...classAttendanceSettings,
                        default_on_time_limit_minutes: parseInt(e.target.value),
                      })
                    }
                    className="flex-1 accent-[#0071e3]"
                  />
                  <span className="text-[#0071e3] font-bold text-sm w-16 text-right">
                    {classAttendanceSettings.default_on_time_limit_minutes} นาที
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1 px-0.5">
                  <span>5 นาที</span><span>60 นาที</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => setShowClassAttendanceSettingsModal(null)}
                  className="flex-1 apple-button-secondary py-3 text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={updateClassAttendanceSettings}
                  disabled={actionLoading}
                  className="flex-1 apple-button-primary py-3 text-sm bg-[#0071e3] hover:bg-[#0077ed]"
                >
                  {actionLoading ? 'กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
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
      {showMultiClassCodeModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto">
            <div className="p-6">

              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-gray-900">รหัสเข้าร่วมคลาส</h3>
                <button onClick={() => setShowMultiClassCodeModal(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4 mb-6">
                {showMultiClassCodeModal.map((cls, i) => (
                  <MultiClassCodeCard key={i} classCode={cls.code} className={cls.name} />
                ))}
              </div>

              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h5 className="font-medium text-gray-900 mb-2">วิธีการให้นักเรียนเข้าร่วม:</h5>
                <ol className="text-sm text-gray-600 space-y-1">
                  <li>1. แชร์รหัสประจำ Section ให้นักเรียนแต่ละกลุ่ม</li>
                  <li>2. นักเรียนเข้าสู่ระบบและคลิก "เข้าร่วมวิชา"</li>
                  <li>3. กรอกรหัสที่ได้รับและกดเข้าร่วม</li>
                </ol>
              </div>

              <div className="text-center">
                <button onClick={() => setShowMultiClassCodeModal(null)} className="text-gray-500 hover:text-gray-700 text-sm">
                  ปิดหน้าต่าง
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
      {/* Attendance Log Modal */}
      {showAttendanceLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowAttendanceLogModal(false)}></div>
          <div className="max-w-4xl w-full glass-card max-h-[85vh] flex flex-col overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-8 border-b border-white/40 flex justify-between items-center bg-white/30">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-gray-900">บันทึกคาบเรียน</h3>
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
                      <p>ยังไม่มีบันทึกกิจกรรมในคาบเรียนนี้</p>
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
                      <p>ยังไม่มีนักเรียนเช็คชื่อในคาบเรียนนี้</p>
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
      {selectedSpoofImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div 
            className="absolute inset-0 bg-black/20 backdrop-blur-sm" 
            onClick={() => setSelectedSpoofImage(null)}
          />
          <div className="relative z-10 w-full max-w-xl bg-white rounded-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
            
            {/* Image */}
            <div className="relative">
              <img 
                src={`data:image/jpeg;base64,${selectedSpoofImage.image_b64}`}
                alt="Spoof Detection"
                className="w-full object-cover"
              />
              <button 
                onClick={() => setSelectedSpoofImage(null)}
                className="absolute top-4 right-4 bg-black/30 hover:bg-black/50 backdrop-blur-sm p-2 rounded-full transition-all"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Info */}
            <div className="px-6 py-5 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                พบใบหน้าปลอม <span className="font-semibold text-gray-900">{selectedSpoofImage.spoof_count} คน</span>
                {' · เวลา '}
                {new Date(selectedSpoofImage.timestamp).toLocaleTimeString('th-TH', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit'
                })}
              </p>
              <button
                onClick={() => setSelectedSpoofImage(null)}
                className="text-sm text-gray-400 hover:text-gray-700 font-medium transition-colors"
              >
                ปิด
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
