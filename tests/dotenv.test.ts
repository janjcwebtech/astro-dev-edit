import { describe, expect, it } from 'vitest';
import { upsertEnvVar } from '../src/patcher/dotenv.ts';

/**
 * The Unsplash access key is written into `.env.local` rather than the settings
 * file, so this patcher edits a file the user owns and may keep other secrets
 * in. Two properties matter more than anything else here: nothing the user
 * wrote is disturbed, and a value that could not read back as written is
 * refused rather than quoted.
 */

const NAME = 'UNSPLASH_ACCESS_KEY';
const ok = (r: ReturnType<typeof upsertEnvVar>) => {
  if (!r.ok) throw new Error(`expected success, got refusal: ${r.reason}`);
  return r;
};

describe('upsertEnvVar — writing a value', () => {
  it('creates a self-explanatory document from nothing', () => {
    const r = ok(upsertEnvVar('', NAME, 'abc123'));
    expect(r.action).toBe('created');
    expect(r.text).toBe(
      '# Written by astro-dev-edit. Keep this file out of version control.\n' +
        'UNSPLASH_ACCESS_KEY=abc123\n',
    );
  });

  it('appends to an existing file without a header', () => {
    const r = ok(upsertEnvVar('DATABASE_URL=postgres://x\n', NAME, 'abc123'));
    expect(r.action).toBe('appended');
    expect(r.text).toBe('DATABASE_URL=postgres://x\nUNSPLASH_ACCESS_KEY=abc123\n');
  });

  it('adds the missing trailing newline rather than joining two lines', () => {
    const r = ok(upsertEnvVar('DATABASE_URL=postgres://x', NAME, 'abc123'));
    expect(r.text).toBe('DATABASE_URL=postgres://x\nUNSPLASH_ACCESS_KEY=abc123\n');
  });

  it('replaces in place, keeping every other line exactly', () => {
    const before = '# my project\nA=1\n\nUNSPLASH_ACCESS_KEY=old\nZ=last\n';
    const r = ok(upsertEnvVar(before, NAME, 'new'));
    expect(r.action).toBe('updated');
    expect(r.text).toBe('# my project\nA=1\n\nUNSPLASH_ACCESS_KEY=new\nZ=last\n');
  });

  it('keeps indentation and an export prefix', () => {
    const r = ok(upsertEnvVar('  export UNSPLASH_ACCESS_KEY=old\n', NAME, 'new'));
    expect(r.text).toBe('  export UNSPLASH_ACCESS_KEY=new\n');
  });

  it('drops a trailing comment, which described the old value', () => {
    const r = ok(upsertEnvVar('UNSPLASH_ACCESS_KEY=old # from the demo account\n', NAME, 'new'));
    expect(r.text).toBe('UNSPLASH_ACCESS_KEY=new\n');
  });

  it('rewrites the last duplicate and deletes the earlier ones', () => {
    // dotenv is last-wins, so an earlier copy reads as inert — but it is still
    // a secret sitting on disk, which is the thing being fixed.
    const before = 'UNSPLASH_ACCESS_KEY=first\nA=1\nUNSPLASH_ACCESS_KEY=second\n';
    const r = ok(upsertEnvVar(before, NAME, 'new'));
    expect(r.text).toBe('A=1\nUNSPLASH_ACCESS_KEY=new\n');
  });

  it('lands under a commented-out line, where the user expected it', () => {
    const before = 'A=1\n# UNSPLASH_ACCESS_KEY=paste-yours-here\nB=2\n';
    const r = ok(upsertEnvVar(before, NAME, 'abc'));
    expect(r.action).toBe('appended');
    expect(r.text).toBe('A=1\n# UNSPLASH_ACCESS_KEY=paste-yours-here\nUNSPLASH_ACCESS_KEY=abc\nB=2\n');
  });

  it('does not treat a commented-out line as a value to replace', () => {
    const r = ok(upsertEnvVar('# UNSPLASH_ACCESS_KEY=old\n', NAME, 'new'));
    expect(r.text).toContain('# UNSPLASH_ACCESS_KEY=old');
  });

  it('does not match a variable that merely shares a prefix', () => {
    const r = ok(upsertEnvVar('UNSPLASH_ACCESS_KEY_OLD=keepme\n', NAME, 'new'));
    expect(r.text).toBe('UNSPLASH_ACCESS_KEY_OLD=keepme\nUNSPLASH_ACCESS_KEY=new\n');
  });

  it('keeps a CRLF document on CRLF', () => {
    const r = ok(upsertEnvVar('A=1\r\nUNSPLASH_ACCESS_KEY=old\r\n', NAME, 'new'));
    expect(r.text).toBe('A=1\r\nUNSPLASH_ACCESS_KEY=new\r\n');
    expect(r.text).not.toContain('\r\r');
  });

  it('trims surrounding whitespace rather than refusing it', () => {
    // A pasted key routinely arrives with a trailing newline attached.
    expect(ok(upsertEnvVar('', NAME, '  abc123\n')).text).toContain('=abc123\n');
  });
});

describe('upsertEnvVar — clearing', () => {
  it('removes the line entirely, not just its value', () => {
    const r = ok(upsertEnvVar('A=1\nUNSPLASH_ACCESS_KEY=old\nB=2\n', NAME, ''));
    expect(r.action).toBe('removed');
    expect(r.text).toBe('A=1\nB=2\n');
  });

  it('removes every duplicate', () => {
    const r = ok(upsertEnvVar('UNSPLASH_ACCESS_KEY=a\nUNSPLASH_ACCESS_KEY=b\n', NAME, ''));
    expect(r.text).toBe('');
  });

  it('reports unchanged when there was nothing to clear', () => {
    const r = ok(upsertEnvVar('A=1\n', NAME, ''));
    expect(r.action).toBe('unchanged');
    expect(r.text).toBe('A=1\n');
  });
});

describe('upsertEnvVar — refuses rather than escapes', () => {
  // Every one of these would either fail to read back as written (dotenv
  // quoting, `#` comments, `$` expansion) or silently truncate.
  const bad: Array<[string, string]> = [
    ['a space', 'abc 123'],
    ['a double quote', 'abc"123'],
    ['a single quote', "abc'123"],
    ['a backtick', 'abc`123'],
    ['a hash', 'abc#123'],
    ['a dollar', 'abc$HOME'],
    ['an equals', 'abc=123'],
    ['a newline', 'abc\n123'],
    ['a carriage return', 'abc\r123'],
    ['a backslash', 'abc\\123'],
    ['a tab', 'abc\t123'],
    ['non-ascii', 'abc£123'],
  ];

  for (const [label, value] of bad) {
    it(`refuses ${label}`, () => {
      const r = upsertEnvVar('A=1\n', NAME, value);
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/letters, digits/);
    });
  }

  it('refuses a name that is not a shell variable', () => {
    const r = upsertEnvVar('', 'not a name', 'abc');
    expect(r.ok).toBe(false);
  });

  it('never returns text alongside a refusal', () => {
    const r = upsertEnvVar('A=1\n', NAME, 'abc 123');
    expect(r).not.toHaveProperty('text');
  });
});
