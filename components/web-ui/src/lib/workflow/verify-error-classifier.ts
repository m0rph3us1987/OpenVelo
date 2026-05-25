export type VerifyErrorCause =
  | 'missing_repository'
  | 'session_start_failure'
  | 'llm_timeout'
  | 'llm_error'
  | 'parse_failure'
  | 'missing_requirement_file'
  | 'missing_original_requirement'
  | 'unknown';

export type VerifyErrorType = VerifyErrorCause;

export interface VerifyErrorClassification {
  errorType: VerifyErrorType;
  message: string;
}

const ERROR_MESSAGES: Record<VerifyErrorCause, string> = {
  missing_repository: 'No repository found — run implementation first',
  session_start_failure: 'An error occurred during verification. Please try again.',
  llm_timeout: 'An error occurred during verification. Please try again.',
  llm_error: 'An error occurred during verification. Please try again.',
  parse_failure: 'An error occurred during verification. Please try again.',
  missing_requirement_file: 'An error occurred during verification. Please try again.',
  missing_original_requirement: 'An error occurred during verification. Please try again.',
  unknown: 'An error occurred during verification. Please try again.',
};

export function classifyVerifyError(cause: VerifyErrorCause): VerifyErrorClassification {
  return {
    errorType: cause,
    message: ERROR_MESSAGES[cause] ?? ERROR_MESSAGES.unknown,
  };
}