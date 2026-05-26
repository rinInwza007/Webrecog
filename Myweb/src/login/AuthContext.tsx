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
  const [isInitialized, setIsInitialized] = useState(false)

  const userRef = useRef<SupabaseUser | null>(null)
  const appUserRef = useRef<AppUser | null>(null)
  const syncInProgress = useRef<boolean>(false)

  const fetchAppUser = async (userId: string) => {
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (!userError && userData) {
        return userData as AppUser
      }
      return null
    } catch (error) {
      console.error('[Auth] Fetch error:', error)
      return null
    }
  }

  const handleAuthChange = async (authUser: SupabaseUser | null, source: string) => {
    if (syncInProgress.current) {
      console.log(`[Auth] Sync in progress, ignoring source: ${source}`)
      return
    }

    try {
      syncInProgress.current = true
      console.log(`[Auth] Change triggered by: ${source}`, authUser?.id)

      if (!authUser) {
        userRef.current = null
        appUserRef.current = null
        setUser(null)
        setAppUser(null)
      } else {
        // If it's the same user and we already have a profile, just update user and stop
        if (userRef.current?.id === authUser.id && appUserRef.current) {
          setUser(authUser)
        } else {
          // New user or first load
          const profile = await fetchAppUser(authUser.id)
          userRef.current = authUser
          appUserRef.current = profile
          setUser(authUser)
          setAppUser(profile)
        }
      }
    } catch (err) {
      console.error('[Auth] Handle change error:', err)
    } finally {
      syncInProgress.current = false
      setLoading(false)
      setIsInitialized(true)
    }
  }

  useEffect(() => {
    let mounted = true

    // Initial check
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (mounted) {
          await handleAuthChange(session?.user ?? null, 'initial_getSession')
        }
      } catch (err) {
        console.error('[Auth] Init error:', err)
        if (mounted) {
          setLoading(false)
          setIsInitialized(true)
        }
      }
    }

    initAuth()

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return
        console.log('[Auth] Event:', event)
        
        // Skip handleAuthChange on initial SIGNED_IN if we're already initializing/initialized
        // Supabase often fires SIGNED_IN right after getSession()
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
          // If we are already initialized and the user hasn't changed, we can skip full sync
          if (isInitialized && session?.user?.id === userRef.current?.id && appUserRef.current) {
            if (event === 'TOKEN_REFRESHED') return // Ignore token refresh flickers
          }
          
          await handleAuthChange(session?.user ?? null, `onAuthStateChange_${event}`)
        }
      }
    )

    // Safety timeout: If auth takes more than 5 seconds, stop loading
    const timeout = setTimeout(() => {
      if (mounted && loading) {
        console.warn('[Auth] Initialization timed out')
        setLoading(false)
        setIsInitialized(true)
      }
    }, 5000)

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, []) // Keep dependencies empty to ensure single subscription

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
    // Pre-emptively set loading to show feedback
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    // If error, stop loading. If success, handleAuthChange will be triggered by onAuthStateChange
    if (error) setLoading(false)
    return { data, error }
  }

  const signOut = async () => {
    setLoading(true)
    try {
      // Clear state immediately to trigger UI update
      userRef.current = null
      appUserRef.current = null
      setUser(null)
      setAppUser(null)
      
      const { error } = await supabase.auth.signOut()
      
      // Clear storage as requested by user to fix sticky states
      window.localStorage.clear()
      window.sessionStorage.clear()
      
      return { error }
    } catch (err) {
      console.error('[Auth] SignOut error:', err)
      return { error: err }
    } finally {
      setLoading(false)
      // Hard reload to ensure a clean state
      window.location.replace('/')
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
