import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from '../supabaseClient'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { User as AppUser, UserRole } from '@/types'

interface AuthContextType {
  user: SupabaseUser | null
  appUser: AppUser | null
  loading: boolean
  signUp: (
    email: string,
    password: string,
    userData: {
      full_name: string
      role: UserRole
      school_id: string
    }
  ) => Promise<{ data?: any; error?: any }>
  signIn: (email: string, password: string) => Promise<{ data?: any; error?: any }>
  signOut: () => Promise<{ error?: any }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAppUser = async (userId: string) => {
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (!userError && userData) {
        setAppUser(userData as AppUser)
        return userData as AppUser
      } else {
        console.warn('App user not found in database for auth user:', userId)
        setAppUser(null)
        return null
      }
    } catch (error) {
      console.error('Error fetching app user:', error)
      setAppUser(null)
      return null
    }
  }

  const userRef = useRef<SupabaseUser | null>(null)
  const appUserRef = useRef<AppUser | null>(null)

  useEffect(() => {
    userRef.current = user
    appUserRef.current = appUser
  }, [user, appUser])

  useEffect(() => {
    let mounted = true
    let authInitialized = false

    const handleAuthChange = async (authUser: SupabaseUser | null) => {
      if (!mounted) return

      // If no auth user, clear everything and stop loading
      if (!authUser) {
        setUser(null)
        setAppUser(null)
        setLoading(false)
        return
      }

      // If user is already set and same, and we already have appUser, just stop loading
      if (userRef.current?.id === authUser.id && appUserRef.current) {
        setLoading(false)
        return
      }

      setUser(authUser)
      const profile = await fetchAppUser(authUser.id)
      
      if (mounted) {
        // If auth user exists but no profile, it might be a loop or missing data
        // We sign out to prevent infinite loops in ProtectedRoutes
        if (!profile && authInitialized) {
          console.error('Auth user exists but profile missing. Signing out to prevent loop.')
          await supabase.auth.signOut()
          // No need to setLoading(false) here as signOut will trigger a reload/state change
        } else {
          setLoading(false)
        }
      }
    }

    // Get initial session
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (mounted) {
          await handleAuthChange(session?.user ?? null)
          authInitialized = true
        }
      } catch (error) {
        console.error('Error initializing auth:', error)
        if (mounted) setLoading(false)
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return
        console.log('Auth event:', event)
        
        // Only handle significant events to avoid redundant re-renders
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
            setLoading(true)
          }
          await handleAuthChange(session?.user ?? null)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, []) // Empty dependency array is correct now that we use refs for state checks

  const signUp = async (
    email: string,
    password: string,
    userData: {
      full_name: string
      role: UserRole
      school_id: string
    }
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData
      }
    })
    return { data, error }
  }

  const signIn = async (email: string, password: string) => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    if (error) setLoading(false)
    return { data, error }
  }

  const signOut = async () => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.signOut()
      // Clear all storage to prevent stale state issues reported by user
      window.localStorage.clear()
      window.sessionStorage.clear()
      
      // Clear state manually for immediate feedback
      setUser(null)
      setAppUser(null)
      
      return { error }
    } catch (err) {
      console.error('Error during signOut:', err)
      return { error: err }
    } finally {
      setLoading(false)
      // Force reload to ensure a clean state across all tabs
      window.location.href = '/'
    }
  }

  const value: AuthContextType = {
    user,
    appUser,
    loading,
    signUp,
    signIn,
    signOut
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
