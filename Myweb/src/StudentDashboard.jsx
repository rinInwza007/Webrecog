import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabaseClient'

const StudentDashboard = () => {
  const { user, signOut } = useAuth()
  const [classes, setClasses] = useState([])
  const [attendanceStats, setAttendanceStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [classCode, setClassCode] = useState('')

  useEffect(() => {
    fetchStudentClasses()
    fetchAttendanceStats()
  }, [user])

  const fetchStudentClasses = async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select(`
          *,
          classes (
            class_id,
            subject_name,
            schedule,
            class_code,
            users!classes_teacher_id_fkey (
              full_name
            )
          )
        `)
        .eq('student_id', user.id)

      if (error) throw error
      setClasses(data || [])
    } catch (error) {
      console.error('Error fetching classes:', error)
    }
  }

  const fetchAttendanceStats = async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('attendance_logs')
        .select('status')
        .eq('student_id', user.id)

      if (error) throw error

      const stats = data.reduce((acc, log) => {
        acc[log.status] = (acc[log.status] || 0) + 1
        return acc
      }, {})

      setAttendanceStats(stats)
    } catch (error) {
      console.error('Error fetching attendance stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const joinClass = async () => {
    if (!classCode.trim()) return

    try {
      // Find class by code
      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select('class_id')
        .eq('class_code', classCode.trim())
        .single()

      if (classError || !classData) {
        alert('ไม่พบรหัสวิชาที่ระบุ')
        return
      }

      // Check if already enrolled
      const { data: existingEnrollment } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('student_id', user.id)
        .eq('class_id', classData.class_id)
        .single()

      if (existingEnrollment) {
        alert('คุณได้ลงทะเบียนวิชานี้แล้ว')
        return
      }

      // Enroll student
      const { error: enrollError } = await supabase
        .from('student_enrollments')
        .insert([
          {
            student_id: user.id,
            class_id: classData.class_id
          }
        ])

      if (enrollError) throw enrollError

      alert('ลงทะเบียนวิชาสำเร็จ!')
      setShowJoinModal(false)
      setClassCode('')
      fetchStudentClasses()
    } catch (error) {
      console.error('Error joining class:', error)
      alert('เกิดข้อผิดพลาดในการลงทะเบียนวิชา')
    }
  }

  const handleSignOut = async () => {
    await signOut()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">แดชบอร์ดนักเรียน</h1>
              <p className="text-gray-600">ยินดีต้อนรับ, {user?.user_metadata?.full_name || user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">วิชาที่ลงทะเบียน</p>
                <p className="text-2xl font-bold text-gray-900">{classes.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">เข้าเรียน</p>
                <p className="text-2xl font-bold text-gray-900">{attendanceStats?.present || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">มาสาย</p>
                <p className="text-2xl font-bold text-gray-900">{attendanceStats?.late || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-red-100 rounded-lg">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">ขาดเรียน</p>
                <p className="text-2xl font-bold text-gray-900">{attendanceStats?.absent || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Classes Section */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">วิชาที่ลงทะเบียน</h2>
              <button
                onClick={() => setShowJoinModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                เข้าร่วมวิชา
              </button>
            </div>
          </div>

          <div className="p-6">
            {classes.length === 0 ? (
              <div className="text-center py-8">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">ยังไม่มีวิชาที่ลงทะเบียน</h3>
                <p className="mt-1 text-sm text-gray-500">เริ่มต้นโดยการเข้าร่วมวิชาเรียน</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {classes.map((enrollment) => (
                  <div key={enrollment.enrollment_id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <h3 className="font-medium text-gray-900 mb-2">{enrollment.classes.subject_name}</h3>
                    <p className="text-sm text-gray-600 mb-2">
                      อาจารย์: {enrollment.classes.users?.full_name || 'ไม่ระบุ'}
                    </p>
                    <p className="text-sm text-gray-600 mb-3">
                      เวลาเรียน: {enrollment.classes.schedule || 'ไม่ระบุ'}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        รหัสวิชา: {enrollment.classes.class_code}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Join Class Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">เข้าร่วมวิชาเรียน</h3>
              <div className="mb-4">
                <label htmlFor="classCode" className="block text-sm font-medium text-gray-700 mb-2">
                  รหัสวิชา
                </label>
                <input
                  id="classCode"
                  type="text"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value)}
                  placeholder="กรอกรหัสวิชา"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={joinClass}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  เข้าร่วม
                </button>
                <button
                  onClick={() => {
                    setShowJoinModal(false)
                    setClassCode('')
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StudentDashboard