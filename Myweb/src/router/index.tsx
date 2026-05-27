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
const LoadingScreen: FC<{ role?: UserRole }> = ({ role }) => {
  const isStudent = role === 'student'
  const isTeacher = role === 'teacher'
  
  const fromColor = isStudent ? 'from-green-50' : isTeacher ? 'from-blue-50' : 'from-gray-50'
  const toColor = isStudent ? 'to-emerald-100' : isTeacher ? 'to-indigo-100' : 'to-slate-100'
  const borderColor = isStudent ? 'border-green-600' : isTeacher ? 'border-blue-600' : 'border-gray-400'

  return (
    <div className={`min-h-screen flex items-center justify-center bg-gradient-to-br ${fromColor} ${toColor}`}>
      <div className="text-center">
        <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${borderColor} mx-auto mb-4`}></div>
        <p className="text-gray-600">กำลังโหลด...</p>
      </div>
    </div>
  )
}

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
    return <LoadingScreen role={requiredRole} />
  }

  if (!appUser) {
    console.log('[Router] No user found, redirecting to login')
    return <Navigate to="/" replace />
  }

  if (requiredRole && appUser.role !== requiredRole) {
    console.warn(`[Router] Role mismatch for ${appUser.email}: expected ${requiredRole}, got ${appUser.role}`)
    
    // Explicitly redirect to the correct dashboard based on role to avoid loops
    if (appUser.role === 'teacher') {
      return <Navigate to="/teacher-dashboard" replace />
    } else if (appUser.role === 'student') {
      return <Navigate to="/dashboard" replace />
    } else {
      console.error('[Router] Unknown user role:', appUser.role)
      return <Navigate to="/" replace />
    }
  }

  return <>{children}</>
}

// Auth Flow Component
interface AuthFlowProps {
  initialMode?: 'login' | 'register' | 'face-registration'
}

const AuthFlow: FC<AuthFlowProps> = ({ initialMode = 'login' }) => {
  const [state, setState] = useState<AuthFlowState>({
    mode: initialMode,
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
      setState((prev) => ({ ...prev, mode: 'login' }))
      //window.location.reload()
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
    // Face registration complete, redirect to dashboard or reload to re-run checks
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
  const [hasFace, setHasFace] = useState<boolean | null>(null)
  const [checkingFace, setCheckingFace] = useState(false)

  useEffect(() => {
    const checkFaceRegistration = async () => {
      if (appUser && appUser.role === 'student') {
        setCheckingFace(true)
        try {
          const { data, error } = await supabase
            .from('student_face_embeddings')
            .select('id')
            .eq('student_id', appUser.school_id)
            .maybeSingle()
          
          if (!error && data) {
            setHasFace(true)
          } else {
            setHasFace(false)
          }
        } catch (err) {
          console.error('Error checking face registration:', err)
          setHasFace(false) // Assume not registered if error
        } finally {
          setCheckingFace(false)
        }
      } else {
        setHasFace(null)
      }
    }

    checkFaceRegistration()
  }, [appUser])

  if (loading || checkingFace) {
    return <LoadingScreen />
  }

  return (
    <Routes>
      {/* Auth Routes */}
      <Route
        path="/"
        element={
          appUser ? (
            appUser.role === 'teacher' ? (
              <Navigate to="/teacher-dashboard" replace />
            ) : hasFace ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <AuthFlow initialMode="face-registration" />
            )
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