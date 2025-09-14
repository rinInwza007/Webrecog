import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './Login'
import Register from './Register'
import FaceRegistration from './FaceRegistration'
import StudentDashboard from './StudentDashboard'
import EnhancedTeacherDashboard from './EnhancedTeacherDashboard'
import { supabase } from './supabaseClient'

// Loading Component
const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
      <p className="text-gray-600">กำลังโหลด...</p>
    </div>
  </div>
)

// Main App Content
const AppContent = () => {
  const { user, loading } = useAuth()
  const [authMode, setAuthMode] = useState('login')
  const [showFaceRegistration, setShowFaceRegistration] = useState(false)
  const [registeredUser, setRegisteredUser] = useState(null)
  const [userRole, setUserRole] = useState(null)

  useEffect(() => {
    if (user?.email) {
      fetchUserRole()
    }
  }, [user])

  const fetchUserRole = async () => {
    if (!user?.email) return

    try {
      const userEmail = user.email.trim().toLowerCase()
      console.log('Fetching role for user:', user.id, userEmail)

      // หา role ด้วย email (ignore case + trim)
      let { data, error } = await supabase
        .from('users')
        .select('role')
        .ilike('email', userEmail)
        .limit(1)

      if (error) {
        console.warn('Error fetching role by email:', error)
      }

      // ถ้าไม่เจอด้วย email → fallback ไปใช้ user_id
      if (!data || data.length === 0) {
        console.log('Fallback: try matching with user_id instead of email')
        const res = await supabase
          .from('users')
          .select('role')
          .eq('user_id', user.id)
          .limit(1)

        if (res.data && res.data.length > 0) {
          data = res.data
        }
      }

      if (data && data.length > 0) {
        setUserRole(data[0].role)
      } else {
        console.warn('⚠️ ไม่พบ role ในตาราง users, fallback เป็น student')
        setUserRole('student')
      }
    } catch (error) {
      console.error('Error fetching user role:', error)
      setUserRole('student') // fallback
    }
  }

  const handleRegistrationSuccess = (user, role) => {
    setRegisteredUser(user)
    if (role === 'student') {
      setShowFaceRegistration(true)
    } else {
      setUserRole(role)
    }
  }

  const handleFaceRegistrationComplete = () => {
    setShowFaceRegistration(false)
    setRegisteredUser(null)
    setUserRole('student')
  }

  // Show loading screen while checking auth
  if (loading) {
    return <LoadingScreen />
  }

  // User is not authenticated - show login/register
  if (!user) {
    if (authMode === 'register') {
      return (
        <Register
          onSwitchToLogin={() => setAuthMode('login')}
          onRegistrationSuccess={handleRegistrationSuccess}
        />
      )
    }
    return <Login onSwitchToRegister={() => setAuthMode('register')} />
  }

  // Student needs face registration
  if (showFaceRegistration && registeredUser) {
    return <FaceRegistration onComplete={handleFaceRegistrationComplete} />
  }

  // Authenticated - show dashboard by role
  if (userRole === 'student') {
    return <StudentDashboard />
  } else if (userRole === 'teacher') {
    return <EnhancedTeacherDashboard />
  }

  // Fallback - still determining role
  return <LoadingScreen />
}

// Main App Component with Auth Provider
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
