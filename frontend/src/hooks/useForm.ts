import { useCallback, useMemo, useRef, useState } from 'react';
import { Rule, Values, runRules } from '../lib/validators';

interface Options {
  initial: Values;
  rules?: Record<string, Rule[] | Rule>;
}

/**
 * Form state with progressive validation.
 *
 * A field is only marked wrong once the user has left it (or tried to submit),
 * so nothing turns red while they are still typing the first character. After
 * that it revalidates on every keystroke, so the error clears the moment it is
 * fixed rather than lingering until the next blur.
 */
export function useForm({ initial, rules = {} }: Options) {
  const [values, setValues] = useState<Values>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const pristine = useRef(initial);

  const reset = useCallback((next: Values) => {
    pristine.current = next;
    setValues(next);
    setTouched({});
    setSubmitAttempted(false);
    setServerError(null);
  }, []);

  const allErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(rules)) {
      const err = runRules(rules[key], values[key], values);
      if (err) out[key] = err;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, JSON.stringify(Object.keys(rules))]);

  /** Errors the user should actually see right now. */
  const visibleErrors = useMemo(() => {
    if (submitAttempted) return allErrors;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(allErrors)) if (touched[k]) out[k] = v;
    return out;
  }, [allErrors, touched, submitAttempted]);

  const setField = useCallback((key: string, value: any) => {
    setServerError(null);
    setValues((v) => ({ ...v, [key]: value }));
  }, []);

  const blur = useCallback((key: string) => {
    setTouched((t) => ({ ...t, [key]: true }));
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(pristine.current),
    [values]
  );

  const isValid = Object.keys(allErrors).length === 0;

  /**
   * Validate everything; on failure reveal all errors and hand back the first
   * offending field so the caller can focus it.
   */
  const validate = useCallback((): { ok: boolean; firstInvalid?: string } => {
    setSubmitAttempted(true);
    const keys = Object.keys(rules).filter((k) => allErrors[k]);
    return keys.length === 0 ? { ok: true } : { ok: false, firstInvalid: keys[0] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allErrors, JSON.stringify(Object.keys(rules))]);

  return {
    values, setValues, setField, blur, reset, validate,
    errors: visibleErrors,
    errorList: Object.values(submitAttempted ? allErrors : visibleErrors),
    isValid, isDirty, serverError, setServerError,
  };
}
