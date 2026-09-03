export type Values = Record<string, any>;
/** Returns an error message, or undefined when the value is acceptable. */
export type Rule = (value: any, all: Values) => string | undefined;

export const required = (label: string): Rule => (v) =>
  v === null || v === undefined || String(v).trim() === '' ? `${label} is required` : undefined;

export const maxLength = (n: number, label: string): Rule => (v) =>
  v && String(v).length > n ? `${label} must be ${n} characters or fewer` : undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const email: Rule = (v) =>
  v && !EMAIL.test(String(v).trim()) ? 'Enter a valid email address, like name@company.com' : undefined;

const PHONE = /^[+\d][\d\s()./-]{4,}$/;
export const phone: Rule = (v) =>
  v && !PHONE.test(String(v).trim()) ? 'Enter a valid phone number' : undefined;

/** `field` must not fall before the date held in `earlierKey`. */
export const notBefore = (earlierKey: string, earlierLabel: string, label: string): Rule =>
  (v, all) => {
    const other = all[earlierKey];
    if (!v || !other) return undefined;
    return new Date(v) < new Date(other)
      ? `${label} cannot be before ${earlierLabel.toLowerCase()}`
      : undefined;
  };

/** Warn when a date is implausibly far out - usually a typo in the year. */
export const saneDate: Rule = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'That is not a valid date';
  const year = d.getFullYear();
  if (year < 2000 || year > 2100) return 'Check the year on that date';
  return undefined;
};

/** Required only when `whenKey` equals `whenValue`. */
export const requiredWhen = (
  whenKey: string,
  whenValue: string,
  label: string
): Rule => (v, all) =>
  all[whenKey] === whenValue && String(v ?? '').trim() === ''
    ? `${label} is required when status is ${whenValue.replace(/_/g, ' ').toLowerCase()}`
    : undefined;

export function runRules(rules: Rule[] | Rule | undefined, value: any, all: Values) {
  if (!rules) return undefined;
  for (const rule of Array.isArray(rules) ? rules : [rules]) {
    const err = rule(value, all);
    if (err) return err;
  }
  return undefined;
}
