import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
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
      } else {
        setAppUser(null)
      }
    } catch (error) {
      console.error('Error fetching app user:', error)
      setAppUser(null)
    }
  }

  useEffect(() => {
    let mounted = true

    // Get initial session
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return

        const authUser = session?.user ?? null
        setUser(authUser)

        if (authUser) {
          await fetchAppUser(authUser.id)
        } else {
          setAppUser(null)
        }
      } catch (error) {
        console.error('Error initializing auth:', error)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return
        console.log('Auth event:', event)
        
        const authUser = session?.user ?? null
        
        // Only trigger updates if the user ID actually changed
        // This avoids redundant re-renders on token refreshes
        setUser(prevUser => {
          if (prevUser?.id === authUser?.id) return prevUser
          return authUser
        })

        if (authUser) {
          await fetchAppUser(authUser.id)
        } else {
          setAppUser(null)
        }
        
        if (mounted) setLoading(false)
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
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
