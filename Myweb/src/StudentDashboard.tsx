import { useState, useEffect, FC } from 'react'
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
  }
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
    if (!user || !appUser) return

    try {
      setLoading(true)
      
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

      // 3. Process data to add stats to classes
      const processedClasses: EnrollmentWithClass[] = (enrollments || []).map(enrollment => {
        const classRecords = (records || []).filter(r => r.session?.class_id === enrollment.class_id)
        
        const present = classRecords.filter(r => r.status === 'present').length
        const late = classRecords.filter(r => r.status === 'late').length
        const absent = classRecords.filter(r => r.status === 'absent').length
        const total = classRecords.length

        return {
          ...enrollment,
          stats: {
            total,
            present,
            late,
            absent,
            percentage: total > 0 ? Math.round(((present + late) / total) * 100) : 0
          }
        }
      })

      setClasses(processedClasses)

    } catch (error: any) {
      console.error('Error fetching student data:', error)
      alert('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const joinClass = async () => {
    if (!classCode.trim()) {
      alert('กรุณากรอกรหัสวิชา')
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
        alert('ไม่พบรหัสวิชาที่ระบุ กรุณาตรวจสอบรหัสให้ถูกต้อง')
        return
      }

      const { data: existingEnrollment } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('student_id', user?.id)
        .eq('class_id', classData.class_id)
        .single()

      if (existingEnrollment) {
        alert('คุณได้ลงทะเบียนวิชานี้แล้ว')
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

      alert(`เข้าร่วมวิชา "${classData.subject_name}" สำเร็จ!`)
      setShowJoinModal(false)
      setClassCode('')
      
      fetchStudentData()
    } catch (error: any) {
      console.error('Error joining class:', error)
      alert('เกิดข้อผิดพลาดในการลงทะเบียนวิชา: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const leaveClass = async (enrollmentId: string, className?: string) => {
    if (!confirm(`คุณต้องการออกจากวิชา "${className || 'นี้'}" ใช่หรือไม่?`)) {
      return
    }

    setActionLoading(true)

    try {
      const { error } = await supabase
        .from('student_enrollments')
        .delete()
        .eq('enrollment_id', enrollmentId)

      if (error) throw error

      alert('ออกจากวิชาเรียนสำเร็จ')
      fetchStudentData()
    } catch (error) {
      console.error('Error leaving class:', error)
      alert('เกิดข้อผิดพลาดในการออกจากวิชาเรียน')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSignOut = async () => {
    if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
      await signOut()
    }
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-100 pb-12">
      {/* Header */}
      <header className="bg-white shadow-md border-b border-indigo-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <img src={image} alt="Logo" className="h-12 w-12 mr-3" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">แดชบอร์ดนักเรียน</h1>
                <p className="text-xs text-gray-500">ยินดีต้อนรับ: {appUser?.full_name}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => fetchStudentData()}
                className="p-2 text-gray-500 hover:text-indigo-600 transition-colors"
                title="รีเฟรชข้อมูล"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={handleSignOut}
                className="text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
                title="ออกจากระบบ"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Top Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-50">
            <p className="text-sm text-gray-500 font-medium">วิชาทั้งหมด</p>
            <p className="text-3xl font-bold text-indigo-600">{classes.length}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-green-50">
            <p className="text-sm text-gray-500 font-medium">มาเรียน (ครั้ง)</p>
            <p className="text-3xl font-bold text-green-600">
              {attendanceRecords.filter(r => r.status === 'present' || r.status === 'late').length}
            </p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-yellow-50">
            <p className="text-sm text-gray-500 font-medium">มาสาย (ครั้ง)</p>
            <p className="text-3xl font-bold text-yellow-600">
              {attendanceRecords.filter(r => r.status === 'late').length}
            </p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-50">
            <p className="text-sm text-gray-500 font-medium">ขาดเรียน (ครั้ง)</p>
            <p className="text-3xl font-bold text-red-600">
              {attendanceRecords.filter(r => r.status === 'absent').length}
            </p>
          </div>
        </div>

        {/* Action Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">วิชาเรียนของฉัน</h2>
          <button
            onClick={() => setShowJoinModal(true)}
            className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg flex items-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>ลงทะเบียนวิชาเพิ่ม</span>
          </button>
        </div>

        {/* Classes Grid */}
        {classes.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center shadow-sm border border-gray-100">
            <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-500 text-4xl">📚</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">ยังไม่มีวิชาเรียน</h3>
            <p className="text-gray-500 mb-6">ขอรหัสวิชาจากอาจารย์เพื่อเริ่มเช็คชื่อ</p>
            <button
              onClick={() => setShowJoinModal(true)}
              className="text-indigo-600 font-bold hover:underline"
            >
              คลิกเพื่อใส่รหัสวิชา
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classes.map((item) => (
              <div key={item.enrollment_id} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all flex flex-col">
                <div className="p-6 flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <span className="bg-indigo-50 text-indigo-600 text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider">
                      {item.classes?.class_code}
                    </span>
                    <button
                      onClick={() => leaveClass(item.enrollment_id, item.classes?.subject_name)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title="ยกเลิกการลงทะเบียน"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1 line-clamp-1">{item.classes?.subject_name}</h3>
                  <p className="text-xs text-gray-500 mb-4 flex items-center">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {item.classes?.schedule || 'ไม่มีข้อมูลตารางเรียน'}
                  </p>

                  {/* Mini Stats Grid */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-green-50 p-2 rounded-xl text-center">
                      <p className="text-[10px] text-green-600 font-bold uppercase">มาเรียน</p>
                      <p className="text-lg font-black text-green-700">{item.stats?.present}</p>
                    </div>
                    <div className="bg-yellow-50 p-2 rounded-xl text-center">
                      <p className="text-[10px] text-yellow-600 font-bold uppercase">สาย</p>
                      <p className="text-lg font-black text-yellow-700">{item.stats?.late}</p>
                    </div>
                    <div className="bg-red-50 p-2 rounded-xl text-center">
                      <p className="text-[10px] text-red-600 font-bold uppercase">ขาด</p>
                      <p className="text-lg font-black text-red-700">{item.stats?.absent}</p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-1">
                      <span>อัตราการเข้าเรียน</span>
                      <span className={item.stats && item.stats.percentage >= 80 ? 'text-green-500' : 'text-orange-500'}>
                        {item.stats?.percentage}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full transition-all duration-1000 ${
                          item.stats && item.stats.percentage >= 80 ? 'bg-green-500' : 'bg-orange-500'
                        }`}
                        style={{ width: `${item.stats?.percentage}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-gray-50 border-t border-gray-100">
                  <button
                    onClick={() => setSelectedClass(item)}
                    className="w-full bg-white border border-gray-200 py-2 rounded-xl text-xs font-bold text-gray-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all"
                  >
                    ดูประวัติการเข้าเรียน
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Join Class Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🔑</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">ลงทะเบียนวิชาเรียน</h3>
              <p className="text-sm text-gray-500 mb-6">กรอกรหัส 6 หลักที่อาจารย์ให้เพื่อเข้าคลาส</p>
              
              <input
                type="text"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                placeholder="รหัสวิชา"
                className="w-full px-4 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-center text-2xl font-black tracking-widest focus:bg-white focus:border-indigo-500 transition-all outline-none mb-6"
                maxLength={6}
              />
              
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowJoinModal(false)}
                  className="flex-1 py-3 font-bold text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={joinClass}
                  disabled={actionLoading || classCode.length < 6}
                  className="flex-1 bg-indigo-600 text-white py-3 rounded-2xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 disabled:opacity-50 transition-all"
                >
                  {actionLoading ? 'กำลังเข้า...' : 'ยืนยัน'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attendance History Modal */}
      {selectedClass && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{selectedClass.classes?.subject_name}</h3>
                <p className="text-xs text-gray-500">ประวัติการเข้าเรียนทั้งหมด</p>
              </div>
              <button
                onClick={() => setSelectedClass(null)}
                className="w-10 h-10 bg-gray-50 text-gray-400 rounded-full flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {attendanceRecords.filter(r => r.session?.class_id === selectedClass.class_id).length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400">ยังไม่มีประวัติการเช็คชื่อในวิชานี้</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {attendanceRecords
                    .filter(r => r.session?.class_id === selectedClass.class_id)
                    .map((record) => (
                      <div key={record.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <div className="flex items-center">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mr-4 font-bold ${
                            record.status === 'present' ? 'bg-green-100 text-green-600' : 
                            record.status === 'late' ? 'bg-yellow-100 text-yellow-600' : 
                            'bg-red-100 text-red-600'
                          }`}>
                            {record.status === 'present' ? '✓' : record.status === 'late' ? '⏰' : '✕'}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-800">
                              {record.status === 'present' ? 'มาเรียน' : record.status === 'late' ? 'มาสาย' : 'ขาดเรียน'}
                            </p>
                            <p className="text-[10px] text-gray-500">
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
                          <p className="text-[10px] text-gray-400 font-medium">ความแม่นยำ</p>
                          <p className="text-xs font-bold text-gray-600">
                            {record.face_match_score ? `${(record.face_match_score * 100).toFixed(0)}%` : '-'}
                          </p>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
            
            <div className="p-6 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setSelectedClass(null)}
                className="w-full bg-white py-3 rounded-2xl font-bold text-gray-600 border border-gray-200 hover:bg-gray-100 transition-all"
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

export default StudentDashboard
