import { z } from 'zod'
import { passwordProblem } from '@/components/auth/password'
import { email, name, timestamp, uuid } from './common'

export const password = z.string().superRefine((value, context) => {
  const problem = passwordProblem(value)
  if (problem) context.addIssue({ code: 'custom', message: problem })
})

export const accountUpdateInput = z.object({
  name: name(80),
})
export type AccountUpdateInput = z.infer<typeof accountUpdateInput>

export const emailChangeInput = z.object({
  email,
})
export type EmailChangeInput = z.infer<typeof emailChangeInput>

export const passwordChangeInput = z.object({
  current_password: z.string().min(1, 'Enter your current password.').max(200),
  password,
})
export type PasswordChangeInput = z.infer<typeof passwordChangeInput>

export const accountResource = z.object({
  id: uuid,
  email: z.string().nullable(),
  /** Address waiting for confirmation after an email change. */
  new_email: z.string().nullable(),
  name: z.string().nullable(),
  username: z.string().nullable(),
  created_at: timestamp,
})
export type AccountResource = z.infer<typeof accountResource>
