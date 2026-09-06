import { describe, expect, it } from 'vitest';
import { validateNotePath } from './path';

describe('validateNotePath', () => {
  it('accepts plain names and folder paths', () => {
    expect(validateNotePath('Welcome')).toBeNull();
    expect(validateNotePath('Projects/Weekly notes')).toBeNull();
    expect(validateNotePath('a/b/c')).toBeNull();
  });

  it('rejects paths that are empty once normalised', () => {
    expect(validateNotePath('')).toBe('Name cannot be empty.');
    expect(validateNotePath('/')).toBe('Name cannot be empty.');
    expect(validateNotePath('.')).toBe('Invalid name.');
    expect(validateNotePath('..')).toBe('Invalid name.');
  });

  it('rejects `.` and `..` segments instead of normalising them away', () => {
    expect(validateNotePath('Projects/../New')).toBe('Invalid name.');
    expect(validateNotePath('../Secret')).toBe('Invalid name.');
    expect(validateNotePath('./Note')).toBe('Invalid name.');
    expect(validateNotePath('Projects/./New')).toBe('Invalid name.');
  });

  it('rejects empty segments from doubled, leading or trailing slashes', () => {
    expect(validateNotePath('a//b')).toBe('Name cannot be empty.');
    expect(validateNotePath('/Welcome')).toBe('Name cannot be empty.');
    expect(validateNotePath('welcome/')).toBe('Name cannot be empty.');
    expect(validateNotePath('Projects/')).toBe('Name cannot be empty.');
  });

  it('rejects segments with characters a name cannot contain', () => {
    expect(validateNotePath('a:b')).toMatch(/invalid characters/);
    expect(validateNotePath('Projects/Bad#name')).toMatch(/invalid characters/);
  });
});
