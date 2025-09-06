import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './Login'
import Register from './Register'
import FaceRegistration from './FaceRegistration'
import StudentDashboard from './StudentDashboard'
import TeacherDashboard from './TeacherDashboard'
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
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [showFaceRegistration, setShowFaceRegistration] = useState(false)
  const [registeredUser, setRegisteredUser] = useState(null)
  const [userRole, setUserRole] = useState(null)

  useEffect(() => {
    if (user) {
      fetchUserRole()
    }
  }, [user])

  const fetchUserRole = async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (error) {
        console.error('Error fetching user role:', error)
        return
      }

      setUserRole(data.role)
    } catch (error) {
      console.error('Error fetching user role:', error)
    }
  }

  const handleRegistrationSuccess = (user, role) => {
    setRegisteredUser(user)
    
    if (role === 'student') {
      setShowFaceRegistration(true)
    } else {
      // For teachers, go directly to dashboard
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
    
    return (
      <Login
        onSwitchToRegister={() => setAuthMode('register')}
      />
    )
  }

  // User just registered as student and needs face registration
  if (showFaceRegistration && registeredUser) {
    return (
      <FaceRegistration
        onComplete={handleFaceRegistrationComplete}
      />
    )
  }

  // User is authenticated - show appropriate dashboard
  if (userRole === 'student') {
    return <StudentDashboard />
  } else if (userRole === 'teacher') {
    return <TeacherDashboard />
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