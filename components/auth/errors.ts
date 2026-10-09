// Supabase Auth errors in words. Pure: used by the auth forms (browser) and lib/domain/account.ts (server).

export interface AuthErrorLike {
  code?: string | null
  message?: string | null
  status?: number | null
  name?: string | null
}

const BY_CODE: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  email_not_confirmed: 'Confirm your email address first. Use the link we sent you when you signed up.',
  user_already_exists: 'An account with this email already exists. Sign in instead.',
  email_exists: 'Another account already uses this email address.',
  weak_password: 'Choose a stronger password: at least 8 characters, with a letter and a number.',
  same_password: 'Choose a password that is different from your current one.',
  over_email_send_rate_limit: 'Too many emails were sent to this address. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  otp_expired: 'That link has expired or was already used. Request a new one.',
  flow_state_not_found: 'Open the link in the same browser where you requested it, or request a new one.',
  flow_state_expired: 'That link has expired. Request a new one.',
  bad_code_verifier: 'Open the link in the same browser where you requested it, or request a new one.',
  mfa_verification_failed: "That code didn't work. Enter the current 6-digit code from your authenticator app.",
  mfa_challenge_expired: 'That code expired. Enter the current one from your authenticator app.',
  mfa_factor_not_found: 'That authenticator is no longer on your account. Reload the page.',
  mfa_factor_name_conflict: 'You already have an authenticator app with that name. Choose another name.',
  mfa_totp_enroll_not_enabled: 'Two-factor authentication is turned off on this server.',
  insufficient_aal: 'Enter your two-factor code first.',
  sso_provider_not_found: "Single sign-on isn't set up for that domain. Sign in with your password, or ask your admin.",
  saml_provider_disabled: "Single sign-on isn't available on this server. Sign in with your password.",
  saml_idp_not_found: "Single sign-on isn't set up for that domain. Sign in with your password, or ask your admin.",
  sso_domain_not_found: "Single sign-on isn't set up for that domain. Sign in with your password, or ask your admin.",
  signup_disabled: 'New sign-ups are turned off on this server.',
  email_provider_disabled: 'Signing in with email is turned off on this server.',
  email_address_invalid: 'Enter a valid email address.',
  email_address_not_authorized: 'This server cannot send email to that address.',
  session_not_found: 'Your session ended. Sign in again.',
  refresh_token_not_found: 'Your session ended. Sign in again.',
  user_banned: 'This account is suspended. Contact support.',
  user_not_found: 'There is no account with that email address.',
  reauthentication_needed: 'Sign in again before changing your password.',
  validation_failed: 'Check the fields and try again.',
}

const BY_MESSAGE: Array<[RegExp, string]> = [
  [/invalid login credentials/i, BY_CODE.invalid_credentials!],
  [/email not confirmed/i, BY_CODE.email_not_confirmed!],
  [/user already registered/i, BY_CODE.user_already_exists!],
  [/rate limit|too many requests/i, BY_CODE.over_request_rate_limit!],
  [/password should be at least|password is known to be weak|weak password/i, BY_CODE.weak_password!],
  [/should be different from the old password/i, BY_CODE.same_password!],
  [/no sso provider|sso provider not found|identity provider/i, BY_CODE.sso_provider_not_found!],
  [/saml 2\.0 is disabled|sso is disabled|saml.*not enabled/i, BY_CODE.saml_provider_disabled!],
  [/invalid totp code|invalid mfa|code is invalid/i, BY_CODE.mfa_verification_failed!],
  [/code verifier|auth code and code verifier|flow state/i, BY_CODE.flow_state_not_found!],
  [/expired|is invalid or has expired/i, BY_CODE.otp_expired!],
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Could not reach Upvane. Check your connection and try again.'],
]

/** Readable sentence for an error returned by supabase.auth.*. */
export function authErrorMessage(error: AuthErrorLike | null | undefined, fallback = 'Something went wrong. Try again in a moment.'): string {
  if (!error) return fallback
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code]!
  const message = (error.message ?? '').trim()
  for (const [pattern, text] of BY_MESSAGE) if (pattern.test(message)) return text
  if (error.status === 429) return BY_CODE.over_request_rate_limit!
  // Supabase messages are usually readable sentences; show short ones rather than a vague fallback.
  if (message && message.length <= 160 && !/[{}<>]|^\w+Error\b/.test(message)) return /[.!?]$/.test(message) ? message : `${message}.`
  return fallback
}

/** Codes of errors that mean "this email address has no account" when sign-ups are not allowed. */
export function isUnknownAccountError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false
  return error.code === 'otp_disabled' || error.code === 'user_not_found' || /signups not allowed/i.test(error.message ?? '')
}

/** Error codes the auth pages put in `?error=` (from /auth/callback and /auth/confirm). */
export const LINK_ERROR_MESSAGES: Record<string, string> = {
  link_expired: 'That link has expired or was already used. Request a new one.',
  link_invalid: "That link isn't valid. Request a new one.",
  other_browser: 'Open the link in the same browser where you requested it, or request a new one.',
  access_denied: 'Sign-in was cancelled.',
  sso_failed: "Single sign-on didn't complete. Try again, or sign in with your password.",
}

/** Maps errors from the code exchange / OTP verification to a LINK_ERROR_MESSAGES key. */
export function linkErrorCode(error: AuthErrorLike | null | undefined): keyof typeof LINK_ERROR_MESSAGES {
  if (!error) return 'link_invalid'
  if (error.code === 'flow_state_not_found' || error.code === 'bad_code_verifier' || /code verifier/i.test(error.message ?? '')) return 'other_browser'
  if (error.code === 'otp_expired' || error.code === 'flow_state_expired' || /expired|already been used|already used/i.test(error.message ?? '')) return 'link_expired'
  if (error.code === 'access_denied') return 'access_denied'
  return 'link_invalid'
}
