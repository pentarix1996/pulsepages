// Password rule shared by the sign-up, reset and account forms and by server validation (lib/domain/schemas/account.ts).
// Stricter than the Supabase minimum (6 locally); matches Supabase's "letters_digits" requirement if it is turned on.

export const PASSWORD_MIN_LENGTH = 8
/** bcrypt (Supabase Auth) only uses the first 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72
export const PASSWORD_RULE = 'At least 8 characters, with a letter and a number.'

/** First problem with the password, in words, or null when it is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`
  if (!/[A-Za-z]/.test(password)) return 'Add at least one letter.'
  if (!/[0-9]/.test(password)) return 'Add at least one number.'
  return null
}
