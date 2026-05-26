import { useState, useEffect, FC } from 'react'
import Swal from 'sweetalert2'
import { useAuth } from './login/AuthContext'
import { supabase } from './supabaseClient'
import image from './utils/logo/image.png'
import type { StudentEnrollment, Class, AttendanceRecord, AttendanceSession } from '@/types'

interface EnrollmentWithClass extends StudentEnrollment {
  classes: Class | null
  stats?: {
    total: number
    present: number
    late: number
    absent: number
    percentage: number
    attendedCount: number
    totalSessions: number
  }
  latestSession?: AttendanceSession | null
  latestRecord?: AttendanceRecord | null
}

interface DetailedAttendance extends AttendanceRecord {
  session?: AttendanceSession
}

const StudentDashboard: FC = () => {
  const { user, appUser, signOut } = useAuth()
  const [classes, setClasses] = useState<EnrollmentWithClass[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<DetailedAttendance[]>([])
  const [loading, setLoading] = useState(true)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [selectedClass, setSelectedClass] = useState<EnrollmentWithClass | null>(null)
  const [classCode, setClassCode] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (user && appUser) {
      fetchStudentData()
    }
  }, [user, appUser])

  const fetchStudentData = async () => {
    try {
      setLoading(true)
      if (!user || !appUser) return
      
      // 1. Fetch Enrollments
      const { data: enrollments, error: enrollmentError } = await supabase
        .from('student_enrollments')
        .select('*, classes(*)')
        .eq('student_id', user.id)

      if (enrollmentError) throw enrollmentError

      // 2. Fetch Attendance Records for this student
      const { data: records, error: recordsError } = await supabase
        .from('attendance_records')
        .select('*, session:attendance_sessions(*)')
        .eq('student_email', appUser.email)
        .order('check_in_time', { ascending: false })

      if (recordsError) throw recordsError
      
      setAttendanceRecords(records as DetailedAttendance[])

      // 2.5 Fetch ALL sessions for the classes the student is enrolled in
      const classIds = enrollments?.map(e => e.class_id) || []
      let allSessions: AttendanceSession[] = []
      if (classIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
          .from('attendance_sessions')
          .select('*')
          .in('class_id', classIds)
          .order('start_time', { ascending: false })
        
        if (!sessionsError) {
          allSessions = sessions || []
        }
      }

      // 3. Process data to add stats to classes
      const processedClasses: EnrollmentWithClass[] = (enrollments || []).map(enrollment => {
        const classRecords = (records || []).filter(r => r.session?.class_id === enrollment.class_id)
        const classSessions = allSessions.filter(s => s.class_id === enrollment.class_id)
        
        const present = classRecords.filter(r => r.status === 'present').length
        const late = classRecords.filter(r => r.status === 'late').length
        const leave = classRecords.filter(r => r.status === 'leave').length
        const attendedCount = present + late + leave
        const totalSessions = classSessions.length
        
        const latestSession = classSessions.length > 0 ? classSessions[0] : null
        const latestRecord = latestSession ? classRecords.find(r => r.session_id === latestSession.id) : null

        return {
          ...enrollment,
          stats: {
            total: classRecords.length,
            present,
            late,
            absent: Math.max(0, totalSessions - (present + late + leave)),
            percentage: totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : 0,
            attendedCount,
            totalSessions
          },
          latestSession,
          latestRecord
        }
      })

      setClasses(processedClasses)

    } catch (error: any) {
      console.error('Error fetching student data:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message
      })
    } finally {
      setLoading(false)
    }
  }

  const joinClass = async () => {
    if (!classCode.trim()) {
      Swal.fire({
        icon: 'warning',
        title: 'คำแนะนำ',
        text: 'กรุณากรอกรหัสวิชา'
      })
      return
    }

    setActionLoading(true)

    try {
      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select('*')
        .eq('class_code', classCode.trim().toUpperCase())
        .single()

      if (classError || !classData) {
        Swal.fire({
          icon: 'error',
          title: 'ไม่พบข้อมูล',
          text: 'ไม่พบรหัสวิชาที่ระบุ กรุณาตรวจสอบรหัสให้ถูกต้อง'
        })
        return
      }

      const { data: existingEnrollment } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('student_id', user?.id)
        .eq('class_id', classData.class_id)
        .single()

      if (existingEnrollment) {
        Swal.fire({
          icon: 'info',
          title: 'ข้อมูลซ้ำ',
          text: 'คุณได้ลงทะเบียนวิชานี้แล้ว'
        })
        return
      }

      const { error: enrollError } = await supabase
        .from('student_enrollments')
        .insert([
          {
            student_id: user?.id,
            class_id: classData.class_id
          }
        ])

      if (enrollError) throw enrollError

      Swal.fire({
        icon: 'success',
        title: 'สำเร็จ',
        text: `เข้าร่วมวิชา "${classData.subject_name}" สำเร็จ!`,
        timer: 2000,
        showConfirmButton: false
      })
      setShowJoinModal(false)
      setClassCode('')
      
      fetchStudentData()
    } catch (error: any) {
      console.error('Error joining class:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: 'เกิดข้อผิดพลาดในการลงทะเบียนวิชา: ' + error.message
      })
    } finally {
      setActionLoading(false)
    }
  }

  const leaveClass = async (enrollmentId: string, className?: string) => {
    Swal.fire({
      title: `คุณต้องการออกจากวิชา "${className || 'นี้'}" ใช่หรือไม่?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'ใช่, ออกจากวิชา',
      cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
      if (result.isConfirmed) {
        setActionLoading(true)
        try {
          const { error } = await supabase
            .from('student_enrollments')
            .delete()
            .eq('enrollment_id', enrollmentId)

          if (error) throw error

          Swal.fire({
            icon: 'success',
            title: 'สำเร็จ',
            text: 'ออกจากวิชาเรียนสำเร็จ',
            timer: 2000,
            showConfirmButton: false
          })
          fetchStudentData()
        } catch (error) {
          console.error('Error leaving class:', error)
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'เกิดข้อผิดพลาดในการออกจากวิชาเรียน'
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/60 backdrop-blur-xl border-b border-white/40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 ">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100">
                <img src={image} alt="Logo" className="h-12 w-12 object-contain" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-gray-900">แดชบอร์ดนักเรียน</h1>
                <p className="text-gray-500 text-xs font-medium">ยินดีต้อนรับ, {appUser?.full_name}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => fetchStudentData()}
                className="p-2.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-xl transition-all"
                title="รีเฟรชข้อมูล"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={handleSignOut}
                className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                title="ออกจากระบบ"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Top Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <div className="glass-card p-6 border-white/60">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">วิชาทั้งหมด</p>
            <p className="text-3xl font-semibold text-gray-900">{classes.length}</p>
          </div>
          <div className="glass-card p-6 border-green-100 bg-green-50/30">
            <p className="text-[10px] text-green-600 font-bold uppercase tracking-wider mb-1">มาเรียน</p>
            <p className="text-3xl font-semibold text-green-600">
              {attendanceRecords.filter(r => r.status === 'present' || r.status === 'late').length}
            </p>
          </div>
          <div className="glass-card p-6 border-yellow-100 bg-yellow-50/30">
            <p className="text-[10px] text-yellow-600 font-bold uppercase tracking-wider mb-1">มาสาย</p>
            <p className="text-3xl font-semibold text-yellow-600">
              {attendanceRecords.filter(r => r.status === 'late').length}
            </p>
          </div>
          <div className="glass-card p-6 border-red-100 bg-red-50/30">
            <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider mb-1">ขาดเรียน</p>
            <p className="text-3xl font-semibold text-red-600">
              {attendanceRecords.filter(r => r.status === 'absent').length}
            </p>
          </div>
        </div>

        {/* Action Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">วิชาเรียนของฉัน</h2>
            <p className="text-gray-500 text-sm font-medium">จัดการคลาสและตรวจสอบประวัติการเข้าเรียน</p>
          </div>
          <button
            onClick={() => setShowJoinModal(true)}
            className="apple-button-primary !bg-green-600 hover:!bg-green-700 flex items-center space-x-2 py-3 px-6"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>ลงทะเบียนวิชาเพิ่ม</span>
          </button>
        </div>

        {/* Classes Grid */}
        {classes.length === 0 ? (
          <div className="glass-card p-20 text-center border-dashed border-gray-200 bg-white/30">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">ยังไม่มีวิชาเรียน</h3>
            <p className="text-gray-500 font-medium mb-8">กรุณากรอกรหัสวิชาที่ได้รับจากอาจารย์เพื่อเริ่มใช้งาน</p>
            <button
              onClick={() => setShowJoinModal(true)}
              className="apple-button-secondary hover:text-green-600 hover:border-green-200 py-3 px-8"
            >
              กรอกรหัสวิชาเรียน
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {classes.map((item) => (
              <div key={item.enrollment_id} className="glass-card flex flex-col group hover:shadow-xl hover:border-green-600/30 transition-all">
                <div className="p-8 flex-1">
                  <div className="flex justify-between items-start mb-6">
                    <span className="bg-green-600/10 text-green-600 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">
                      {item.classes?.class_code}
                    </span>
                    <button
                      onClick={() => leaveClass(item.enrollment_id, item.classes?.subject_name)}
                      className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-xl transition-all"
                      title="ยกเลิกการลงทะเบียน"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2 line-clamp-1 group-hover:text-green-600 transition-colors">{item.classes?.subject_name}</h3>
                  <p className="text-xs text-gray-400 font-medium mb-6 flex items-center">
                    <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {item.classes?.schedule || 'ไม่มีข้อมูลตารางเรียน'}
                  </p>

                  {/* Latest Status */}
                  <div className="mb-6 p-4 bg-gray-50/50 rounded-2xl border border-gray-100/50">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mb-2">สถานะการเช็คชื่อล่าสุด</p>
                    {item.latestSession ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-1.5 h-1.5 bg-green-600 rounded-full mr-2"></div>
                          <p className="text-xs font-semibold text-gray-700">
                            คาบวันที่ {new Date(item.latestSession.start_time).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                        {item.latestRecord ? (
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                            item.latestRecord.status === 'present' ? 'bg-green-100 text-green-600' : 
                            item.latestRecord.status === 'late' ? 'bg-yellow-100 text-yellow-600' : 
                            'bg-green-100 text-green-600'
                          }`}>
                            เช็คชื่อแล้ว ({
                              item.latestRecord.status === 'present' ? 'มาเรียน' : 
                              item.latestRecord.status === 'late' ? 'มาสาย' : 'ลา'
                            })
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-red-100 text-red-600 animate-pulse">
                            ยังไม่ได้เช็คชื่อ
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">ยังไม่มีการเปิดคาบเรียนในวิชานี้</p>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-2">
                      <span className="uppercase tracking-wider">อัตราการเข้าเรียน ({item.stats?.attendedCount}/{item.stats?.totalSessions})</span>
                      <span className={`px-2 py-0.5 rounded-full ${item.stats && item.stats.percentage >= 80 ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                        {item.stats?.percentage}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100/50 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-1000 ${
                          item.stats && item.stats.percentage >= 80 ? 'bg-green-500' : 'bg-orange-500'
                        }`}
                        style={{ width: `${item.stats?.percentage}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                <div className="p-6 bg-white/30 border-t border-white/40">
                  <button
                    onClick={() => setSelectedClass(item)}
                    className="w-full apple-button-secondary hover:text-green-600 hover:border-green-200 py-3 text-xs flex items-center justify-center space-x-2"
                  >
                    <span>ดูประวัติการเข้าเรียน</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Join Class Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowJoinModal(false)}></div>
          <div className="max-w-md w-full glass-card p-10 relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300 text-center">
            <div className="w-20 h-20 bg-green-600/10 text-green-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h3 className="text-2xl font-semibold tracking-tight text-gray-900 mb-2">ลงทะเบียนวิชาเรียน</h3>
            <p className="text-gray-500 text-sm font-medium mb-8">กรอกรหัส 6 หลักที่ได้รับจากอาจารย์ผู้สอน</p>
            
            <input
              type="text"
              value={classCode}
              onChange={(e) => setClassCode(e.target.value.toUpperCase())}
              placeholder="รหัสวิชา"
              className="w-full px-4 py-5 bg-white/50 border border-gray-100 rounded-3xl text-center text-3xl font-bold tracking-[0.5em] focus:bg-white focus:border-green-600 transition-all outline-none mb-8 shadow-inner"
              maxLength={6}
            />
            
            <div className="flex space-x-3">
              <button
                onClick={() => setShowJoinModal(false)}
                className="flex-1 apple-button-secondary py-4"
              >
                ยกเลิก
              </button>
              <button
                onClick={joinClass}
                disabled={actionLoading || classCode.length < 6}
                className="flex-1 apple-button-primary !bg-green-600 hover:!bg-green-700 py-4"
              >
                {actionLoading ? 'กำลังลงทะเบียน...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance History Modal */}
      {selectedClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setSelectedClass(null)}></div>
          <div className="max-w-2xl w-full glass-card max-h-[85vh] flex flex-col overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-8 border-b border-white/40 flex justify-between items-center bg-white/30">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-gray-900">{selectedClass.classes?.subject_name}</h3>
                <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-1">ประวัติการเข้าเรียนทั้งหมด</p>
              </div>
              <button
                onClick={() => setSelectedClass(null)}
                className="w-10 h-10 bg-white/50 text-gray-400 rounded-2xl flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all border border-white/60"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 bg-white/20">
              {attendanceRecords.filter(r => r.session?.class_id === selectedClass.class_id).length === 0 ? (
                <div className="text-center py-20">
                  <div className="bg-white/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/60">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-400 font-medium">ยังไม่มีประวัติการเช็คชื่อในวิชานี้</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {attendanceRecords
                    .filter(r => r.session?.class_id === selectedClass.class_id)
                    .map((record) => (
                      <div key={record.id} className="flex items-center justify-between p-5 glass-morphism bg-white/50 hover:bg-white transition-all">
                        <div className="flex items-center">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mr-5 font-bold shadow-sm ${
                            record.status === 'present' ? 'bg-green-500 text-white' : 
                            record.status === 'late' ? 'bg-yellow-400 text-white' : 
                            'bg-red-500 text-white'
                          }`}>
                            {record.status === 'present' ? '✓' : record.status === 'late' ? '⏰' : '✕'}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-800">
                              {record.status === 'present' ? 'มาเรียน' : record.status === 'late' ? 'มาสาย' : 'ขาดเรียน'}
                            </p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight mt-0.5">
                              {new Date(record.check_in_time || record.created_at).toLocaleDateString('th-TH', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mb-0.5">ความแม่นยำ</p>
                          <p className="text-sm font-black text-green-600">
                            {record.face_match_score ? `${(record.face_match_score * 100).toFixed(0)}%` : '-'}
                          </p>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
            
            <div className="p-8 bg-white/40 border-t border-white/40">
              <button
                onClick={() => setSelectedClass(null)}
                className="w-full apple-button-secondary py-4"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StudentDashboard
