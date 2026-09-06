import { describe, expect, it } from 'vitest';
import { errorMessage, escapeRegExp } from './util';

describe('escapeRegExp', () => {
  it('escapes every RegExp syntax character so the input matches literally', () => {
    const raw = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    const rx = new RegExp(`^${escapeRegExp(raw)}$`);
    expect(rx.test(raw)).toBe(true);
    expect(rx.test('axb*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(false);
  });

  it('produces a pattern that compiles under the u flag', () => {
    const rx = new RegExp(escapeRegExp('C++ (notes) [x] a-b/c: d'), 'u');
    expect(rx.test('see C++ (notes) [x] a-b/c: d here')).toBe(true);
  });
});

describe('errorMessage', () => {
  it('returns the message of an Error and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(new TypeError('typed'))).toBe('typed');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
