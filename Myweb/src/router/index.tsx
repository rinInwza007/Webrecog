import { Routes, Route, Navigate } from 'react-router-dom'
import { FC, useState, useEffect, ReactNode } from 'react'
import { useAuth } from '../login/AuthContext'
import Login from '../login/Login'
import Register from '../login/Register'
import FaceRegistration from '../login/FaceRegistration'
import StudentDashboard from '../StudentDashboard'
import EnhancedTeacherDashboard from '../EnhancedTeacherDashboard'
import { supabase } from '../supabaseClient'
import type { UserRole } from '@/types'

// Loading Component
const LoadingScreen: FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
      <p className="text-gray-600">กำลังโหลด...</p>
    </div>
  </div>
)

// Protected Route Component
interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: UserRole
  isLoading: boolean
  userRole: UserRole | null
}

const ProtectedRoute: FC<ProtectedRouteProps> = ({
  children,
  requiredRole,
  isLoading,
  userRole
}) => {
  if (isLoading) {
    return <LoadingScreen />
  }

  if (!userRole) {
    return <Navigate to="/" replace />
  }

  if (requiredRole && userRole !== requiredRole) {
    // Redirect to appropriate dashboard based on role
    if (userRole === 'teacher') {
      return <Navigate to="/teacher-dashboard" replace />
    } else {
      return <Navigate to="/dashboard" replace />
    }
  }

  return <>{children}</>
}

// Auth Flow Component
interface AuthFlowState {
  mode: 'login' | 'register' | 'face-registration'
  registeredUser: any
  userRole: UserRole | null
}

const AuthFlow: FC<{ onAuthSuccess: () => void }> = ({ onAuthSuccess }) => {
  const [state, setState] = useState<AuthFlowState>({
    mode: 'login',
    registeredUser: null,
    userRole: null
  })

  const handleSwitchToRegister = (): void => {
    setState((prev) => ({
      ...prev,
      mode: 'register'
    }))
  }

  const handleSwitchToLogin = (): void => {
    setState((prev) => ({
      ...prev,
      mode: 'login'
    }))
  }

  const handleRegistrationSuccess = (user: any, role: UserRole): void => {
    setState((prev) => ({
      ...prev,
      registeredUser: user,
      userRole: role,
      mode: 'face-registration'
    }))
  }

  const handleFaceRegistrationComplete = (): void => {
    onAuthSuccess()
  }

  return (
    <>
      {state.mode === 'login' && (
        <Login onSwitchToRegister={handleSwitchToRegister} />
      )}
      {state.mode === 'register' && (
        <Register
          onSwitchToLogin={handleSwitchToLogin}
          onRegistrationSuccess={handleRegistrationSuccess}
        />
      )}
      {state.mode === 'face-registration' && (
        <FaceRegistration onComplete={handleFaceRegistrationComplete} />
      )}
    </>
  )
}

// Main Router Component
const AppRouter: FC = () => {
  const { user, loading } = useAuth()
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [loadingRole, setLoadingRole] = useState(true)

  useEffect(() => {
    const fetchUserRole = async (): Promise<void> => {
      if (!user?.email) {
        setUserRole(null)
        setLoadingRole(false)
        return
      }

      try {
        const userEmail = user.email.trim().toLowerCase()

        const { data, error } = await supabase
          .from('users')
          .select('role')
          .ilike('email', userEmail)
          .limit(1)
          .single()

        if (error) {
          console.warn('Error fetching role:', error)
          setUserRole(null)
        } else if (data) {
          setUserRole(data.role as UserRole)
        }
      } catch (err) {
        console.error('Error fetching user role:', err)
        setUserRole(null)
      } finally {
        setLoadingRole(false)
      }
    }

    fetchUserRole()
  }, [user])

  if (loading || loadingRole) {
    return <LoadingScreen />
  }

  return (
    <Routes>
      {/* Auth Routes */}
      <Route
        path="/"
        element={
          user ? (
            <Navigate to={userRole === 'teacher' ? '/teacher-dashboard' : '/dashboard'} replace />
          ) : (
            <AuthFlow onAuthSuccess={() => window.location.reload()} />
          )
        }
      />

      {/* Student Dashboard */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute
            isLoading={loading || loadingRole}
            userRole={userRole}
            requiredRole="student"
          >
            <StudentDashboard />
          </ProtectedRoute>
        }
      />

      {/* Teacher Dashboard */}
      <Route
        path="/teacher-dashboard"
        element={
          <ProtectedRoute
            isLoading={loading || loadingRole}
            userRole={userRole}
            requiredRole="teacher"
          >
            <EnhancedTeacherDashboard />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default AppRouter