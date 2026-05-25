export interface VerifyResponseParseResult {
  satisfied: boolean | null;
  parseMethod: 'direct' | 'regex' | null;
  error: string | null;
  rawResponse: string;
}

function extractJsonObject(text: string): string | null {
  const regex = /\{[\s\S]*?"satisfied"[\s\S]*?\}/g;
  const matches = [...text.matchAll(regex)];

  for (const match of matches) {
    const candidate = match[0];
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // continue to next match
    }
  }

  return null;
}

export function parseVerifyResponse(rawResponse: string): VerifyResponseParseResult {
  const trimmed = rawResponse.trim();

  if (trimmed.length === 0) {
    return { satisfied: null, parseMethod: null, error: 'unparseable response', rawResponse };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { satisfied: null, parseMethod: null, error: 'unparseable response', rawResponse };
    }

    if (!('satisfied' in parsed)) {
      return { satisfied: null, parseMethod: 'direct', error: 'invalid field type', rawResponse };
    }

    if (typeof parsed.satisfied !== 'boolean') {
      return { satisfied: null, parseMethod: 'direct', error: 'invalid field type', rawResponse };
    }

    return { satisfied: parsed.satisfied, parseMethod: 'direct', error: null, rawResponse };
  } catch {
    const jsonStr = extractJsonObject(trimmed);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { satisfied: null, parseMethod: null, error: 'unparseable response', rawResponse };
        }

        if (!('satisfied' in parsed)) {
          return { satisfied: null, parseMethod: 'regex', error: 'invalid field type', rawResponse };
        }

        if (typeof parsed.satisfied !== 'boolean') {
          return { satisfied: null, parseMethod: 'regex', error: 'invalid field type', rawResponse };
        }

        return { satisfied: parsed.satisfied, parseMethod: 'regex', error: null, rawResponse };
      } catch {
        return { satisfied: null, parseMethod: null, error: 'unparseable response', rawResponse };
      }
    }

    return { satisfied: null, parseMethod: null, error: 'unparseable response', rawResponse };
  }
}