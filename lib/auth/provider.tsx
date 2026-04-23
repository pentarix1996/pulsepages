'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeInput, validateEmail } from '@/lib/utils/security'
import type { UserData, Plan } from '@/lib/types'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: UserData | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  updateProfile: (updates: { name?: string; email?: string }) => Promise<{ success: boolean; error?: string }>
  changePlan: (plan: Plan) => Promise<{ success: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [supabase] = useState(() => createClient())

  const fetchProfile = useCallback(async (currentAuthUser: User): Promise<UserData> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentAuthUser.id)
      .single()

    if (!error && data) {
      return {
        id: currentAuthUser.id,
        email: currentAuthUser.email || '',
        name: data.name || '',
        plan: data.plan || 'free',
      }
    }

    return {
      id: currentAuthUser.id,
      email: currentAuthUser.email || '',
      name: currentAuthUser.user_metadata?.name || 'User',
      plan: 'free',
    }
  }, [supabase])

  // Inicialización de sesión
  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error

        if (!mounted) return

        setAuthUser(data.session?.user ?? null)

        if (!data.session?.user) {
          setUser(null)
          setIsLoading(false)
        }
      } catch (err) {
        console.error('Session init error:', err)
        if (mounted) {
          setAuthUser(null)
          setUser(null)
          setIsLoading(false)
        }
      }
    }

    void init()

    return () => {
      mounted = false
    }
  }, [supabase])

  // Listener de auth: SIN async y SIN llamadas a Supabase dentro
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        setAuthUser(null)
        setUser(null)
        setIsLoading(false)
        return
      }

      // INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED
      setAuthUser(session.user)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  // Carga de perfil separada del evento de auth
  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      if (!authUser) return

      setIsLoading(true)

      try {
        const userData = await fetchProfile(authUser)
        if (!cancelled) {
          setUser(userData)
        }
      } catch (err) {
        console.error('Profile load error:', err)
        if (!cancelled) {
          setUser({
            id: authUser.id,
            email: authUser.email || '',
            name: authUser.user_metadata?.name || 'User',
            plan: 'free',
          })
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    if (!authUser) {
      setUser(null)
      setIsLoading(false)
      return
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [authUser?.id, fetchProfile])

  const login = useCallback(async (email: string, password: string) => {
    email = sanitizeInput(email)

    if (!email || !password) {
      return { success: false, error: 'Email and password are required.' }
    }

    if (!validateEmail(email)) {
      return { success: false, error: 'Invalid email format.' }
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          return { success: false, error: 'Incorrect email or password.' }
        }
        return { success: false, error: error.message }
      }

      // No hagas fetchProfile aquí.
      // onAuthStateChange + efecto de perfil se encargan.
      return { success: true }
    } catch (err) {
      console.error('Login error:', err)
      return { success: false, error: 'Connection error. Please check your internet connection.' }
    }
  }, [supabase])

  const register = useCallback(async (name: string, email: string, password: string) => {
    name = sanitizeInput(name)
    email = sanitizeInput(email)

    if (!name || !email || !password) {
      return { success: false, error: 'All fields are required.' }
    }
    if (name.length < 2 || name.length > 50) {
      return { success: false, error: 'Name must be 2-50 characters.' }
    }
    if (!validateEmail(email)) {
      return { success: false, error: 'Invalid email format.' }
    }
    if (password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long.' }
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      })

      if (error) return { success: false, error: error.message }

      if (data.user && !data.user.confirmed_at) {
        return { success: true, error: 'Please check your email to confirm your account.' }
      }

      // No hagas fetchProfile aquí.
      return { success: true }
    } catch (err) {
      console.error('Register error:', err)
      return { success: false, error: 'Connection error. Please check your internet connection.' }
    }
  }, [supabase])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setAuthUser(null)
    setUser(null)
  }, [supabase])

  const updateProfile = useCallback(async (updates: { name?: string; email?: string }) => {
    if (!user) return { success: false, error: 'Not authenticated.' }

    if (updates.name) {
      const name = sanitizeInput(updates.name)
      if (name.length < 2 || name.length > 50) {
        return { success: false, error: 'Name must be 2-50 characters.' }
      }

      const { error } = await supabase
        .from('profiles')
        .update({ name })
        .eq('id', user.id)

      if (error) return { success: false, error: error.message }
      setUser((prev) => (prev ? { ...prev, name } : prev))
    }

    if (updates.email) {
      const newEmail = sanitizeInput(updates.email)
      if (!validateEmail(newEmail)) {
        return { success: false, error: 'Invalid email format.' }
      }

      const { error } = await supabase.auth.updateUser({ email: newEmail })
      if (error) return { success: false, error: error.message }

      setUser((prev) => (prev ? { ...prev, email: newEmail } : prev))
    }

    return { success: true }
  }, [user, supabase])

  const changePlan = useCallback(async (plan: Plan) => {
    if (!user) return { success: false, error: 'Not authenticated.' }

    const validPlans: Plan[] = ['free', 'pro', 'business']
    if (!validPlans.includes(plan)) {
      return { success: false, error: 'Invalid plan.' }
    }

    const { error } = await supabase
      .from('profiles')
      .update({ plan })
      .eq('id', user.id)

    if (error) return { success: false, error: error.message }

    setUser((prev) => (prev ? { ...prev, plan } : prev))
    return { success: true }
  }, [user, supabase])

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, register, logout, updateProfile, changePlan }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}