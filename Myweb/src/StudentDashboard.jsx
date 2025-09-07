import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabaseClient'

const StudentDashboard = () => {
  const { user, signOut } = useAuth()
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [classCode, setClassCode] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    fetchStudentClasses()
  }, [user])

  const fetchStudentClasses = async () => {
    if (!user) return

    try {
      console.log('=== Starting fetchStudentClasses ===')
      console.log('User ID:', user.id)
      
      // Simple approach: Get enrollments first
      const { data: enrollments, error: enrollmentError } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('student_id', user.id)

      console.log('Enrollments query result:', { enrollments, enrollmentError })

      if (enrollmentError) {
        console.error('Enrollment error:', enrollmentError)
        throw enrollmentError
      }

      if (!enrollments || enrollments.length === 0) {
        console.log('No enrollments found')
        setClasses([])
        return
      }

      // Get classes separately
      const classIds = enrollments.map(e => e.class_id)
      console.log('Class IDs to fetch:', classIds)

      const { data: classesData, error: classesError } = await supabase
        .from('classes')
        .select('*')
        .in('class_id', classIds)

      console.log('Classes query result:', { classesData, classesError })

      if (classesError) {
        console.error('Classes error:', classesError)
        throw classesError
      }

      // Combine data
      const combinedData = enrollments.map(enrollment => {
        const classData = classesData.find(c => c.class_id === enrollment.class_id)
        return {
          ...enrollment,
          classes: classData || null
        }
      }).filter(item => item.classes !== null)

      console.log('Combined data:', combinedData)
      setClasses(combinedData)

    } catch (error) {
      console.error('Error in fetchStudentClasses:', error)
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
      console.log('=== Starting joinClass ===')
      console.log('Class code:', classCode.trim().toUpperCase())
      
      // Find class by code
      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select('*')
        .eq('class_code', classCode.trim().toUpperCase())
        .single()

      console.log('Class search result:', { classData, classError })

      if (classError || !classData) {
        alert('ไม่พบรหัสวิชาที่ระบุ กรุณาตรวจสอบรหัสให้ถูกต้อง')
        return
      }

      // Check if already enrolled
      const { data: existingEnrollment, error: checkError } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('student_id', user.id)
        .eq('class_id', classData.class_id)
        .single()

      console.log('Existing enrollment check:', { existingEnrollment, checkError })

      if (existingEnrollment) {
        alert('คุณได้ลงทะเบียนวิชานี้แล้ว')
        return
      }

      // Enroll student
      const { data: enrollData, error: enrollError } = await supabase
        .from('student_enrollments')
        .insert([
          {
            student_id: user.id,
            class_id: classData.class_id
          }
        ])
        .select()

      console.log('Enrollment result:', { enrollData, enrollError })

      if (enrollError) throw enrollError

      alert(`เข้าร่วมวิชา "${classData.subject_name}" สำเร็จ!`)
      setShowJoinModal(false)
      setClassCode('')
      
      // Refresh the classes list
      fetchStudentClasses()
    } catch (error) {
      console.error('Error joining class:', error)
      alert('เกิดข้อผิดพลาดในการลงทะเบียนวิชา: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const leaveClass = async (enrollmentId, className) => {
    if (!confirm(`คุณต้องการออกจากวิชา "${className}" ใช่หรือไม่?`)) {
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
      fetchStudentClasses()
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100">
      {/* Header */}
      <header className="bg-white shadow-lg border-b border-green-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">แดชบอร์ดนักเรียน</h1>
              <p className="text-gray-600 mt-1">ยินดีต้อนรับ, {user?.user_metadata?.full_name || user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors flex items-center space-x-2 shadow-md"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-r from-green-500 to-green-600 rounded-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="ml-6">
                <p className="text-sm font-medium text-gray-600">วิชาที่ลงทะเบียน</p>
                <p className="text-3xl font-bold text-gray-900">{classes.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-blue-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-6">
                <p className="text-sm font-medium text-gray-600">สถานะ</p>
                <p className="text-lg font-bold text-gray-900">พร้อมเรียน</p>
              </div>
            </div>
          </div>
        </div>

        {/* Classes Section */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200">
          <div className="p-8 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">วิชาที่ลงทะเบียน</h2>
                <p className="text-gray-600 mt-1">คลาสเรียนทั้งหมดที่คุณเข้าร่วม</p>
              </div>
              <button
                onClick={() => setShowJoinModal(true)}
                disabled={actionLoading}
                className="bg-gradient-to-r from-green-600 to-green-700 text-white px-6 py-3 rounded-lg hover:from-green-700 hover:to-green-800 transition-all disabled:opacity-50 flex items-center space-x-2 shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>เข้าร่วมวิชา</span>
              </button>
            </div>
          </div>

          <div className="p-8">
            {classes.length === 0 ? (
              <div className="text-center py-16">
                <div className="bg-green-50 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                  <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">ยังไม่มีวิชาที่ลงทะเบียน</h3>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">เริ่มต้นการเรียนของคุณโดยการเข้าร่วมวิชาเรียนด้วยรหัสที่อาจารย์ให้</p>
                <button
                  onClick={() => setShowJoinModal(true)}
                  className="bg-gradient-to-r from-green-600 to-green-700 text-white px-8 py-4 rounded-lg hover:from-green-700 hover:to-green-800 transition-all shadow-lg"
                >
                  🎓 เข้าร่วมวิชาแรก
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {classes.map((enrollment) => (
                  <div key={enrollment.enrollment_id} className="bg-gradient-to-br from-white to-gray-50 border-2 border-gray-200 rounded-xl p-6 hover:shadow-xl hover:border-green-300 transition-all group">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-green-600 transition-colors">
                          {enrollment.classes?.subject_name || 'ไม่ระบุชื่อวิชา'}
                        </h3>
                        {enrollment.classes?.description && (
                          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{enrollment.classes.description}</p>
                        )}
                        <div className="flex items-center text-sm text-gray-600 mb-4">
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {enrollment.classes?.schedule || 'ไม่ระบุเวลาเรียน'}
                        </div>
                        
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-green-600 font-medium">รหัสวิชา</p>
                              <p className="text-lg font-bold text-green-800 font-mono">{enrollment.classes?.class_code}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="ml-4">
                        <button
                          onClick={() => leaveClass(enrollment.enrollment_id, enrollment.classes?.subject_name)}
                          disabled={actionLoading}
                          className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="ออกจากวิชา"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <p className="text-xs text-gray-500">
                        เข้าร่วมเมื่อ: {new Date(enrollment.enrolled_at).toLocaleDateString('th-TH', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </p>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900">เข้าร่วมวิชาเรียน</h3>
                <button
                  onClick={() => setShowJoinModal(false)}
                  disabled={actionLoading}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50 p-2"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="mb-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <div className="flex">
                    <svg className="w-5 h-5 text-green-400 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm text-green-800 font-medium">วิธีการเข้าร่วมวิชา</p>
                      <p className="text-sm text-green-700 mt-1">
                        ขอรหัสวิชาจากอาจารย์ผู้สอน และกรอกในช่องด้านล่าง รหัสวิชาจะเป็นตัวอักษรและตัวเลข 6 ตัว
                      </p>
                    </div>
                  </div>
                </div>
                
                <label htmlFor="classCode" className="block text-sm font-semibold text-gray-700 mb-2">
                  รหัสวิชา
                </label>
                <input
                  id="classCode"
                  type="text"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                  placeholder="กรอกรหัสวิชา เช่น ABC123"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-center text-lg font-mono tracking-wider transition-colors"
                  maxLength={6}
                  disabled={actionLoading}
                />
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={joinClass}
                  disabled={actionLoading || !classCode.trim()}
                  className="flex-1 bg-gradient-to-r from-green-600 to-green-700 text-white py-3 px-6 rounded-lg hover:from-green-700 hover:to-green-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {actionLoading ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      กำลังเข้าร่วม...
                    </div>
                  ) : (
                    '🎓 เข้าร่วมวิชา'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowJoinModal(false)
                    setClassCode('')
                  }}
                  disabled={actionLoading}
                  className="flex-1 bg-gray-300 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-400 transition-colors disabled:opacity-50 font-semibold"
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