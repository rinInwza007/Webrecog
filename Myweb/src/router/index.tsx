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
}

const ProtectedRoute: FC<ProtectedRouteProps> = ({
  children,
  requiredRole
}) => {
  const { appUser, loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (!appUser) {
    return <Navigate to="/" replace />
  }

  if (requiredRole && appUser.role !== requiredRole) {
    // Redirect to appropriate dashboard based on role
    return <Navigate to={appUser.role === 'teacher' ? '/teacher-dashboard' : '/dashboard'} replace />
  }

  return <>{children}</>
}

// Auth Flow Component
interface AuthFlowState {
  mode: 'login' | 'register' | 'face-registration'
  registeredUser: any
  userRole: UserRole | null
}

const AuthFlow: FC = () => {
  const [state, setState] = useState<AuthFlowState>({
    mode: 'login',
    registeredUser: null,
    userRole: null
  })

  const handleSwitchToRegister = (): void => {
    setState((prev) => ({ ...prev, mode: 'register' }))
  }

  const handleSwitchToLogin = (): void => {
    setState((prev) => ({ ...prev, mode: 'login' }))
  }

  const handleRegistrationSuccess = (user: any, role: UserRole): void => {
    if (role === 'teacher') {
      // Teachers don't need face registration, refresh to trigger AppRouter redirect
      window.location.reload()
      return
    }
    
    setState((prev) => ({
      ...prev,
      registeredUser: user,
      userRole: role,
      mode: 'face-registration'
    }))
  }

  const handleFaceRegistrationComplete = (): void => {
    // Face registration complete, refresh to trigger AppRouter redirect
    window.location.reload()
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
  const { appUser, loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  return (
    <Routes>
      {/* Auth Routes */}
      <Route
        path="/"
        element={
          appUser ? (
            <Navigate to={appUser.role === 'teacher' ? '/teacher-dashboard' : '/dashboard'} replace />
          ) : (
            <AuthFlow />
          )
        }
      />

      {/* Student Dashboard */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute requiredRole="student">
            <StudentDashboard />
          </ProtectedRoute>
        }
      />

      {/* Teacher Dashboard */}
      <Route
        path="/teacher-dashboard"
        element={
          <ProtectedRoute requiredRole="teacher">
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