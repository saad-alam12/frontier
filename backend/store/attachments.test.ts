import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, ImageUploadSchema, ResponseExtrasSchema } from '../core/attachments';
import { attachmentDataUrl, attachmentExists, readAttachment, saveAttachment } from './attachments';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const b64 = (bytes: number[], pad = 0) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(pad)]).toString('base64');
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01], 20);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]).toString('base64');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]).toString('base64');

describe('attachment validation', () => {
  it('accepts the four image types when the bytes match the declared type', () => {
    for (const [mediaType, data] of [['image/png', PNG], ['image/jpeg', JPEG], ['image/gif', GIF], ['image/webp', WEBP]] as const) {
      expect(ImageUploadSchema.safeParse({ mediaType, data }).success).toBe(true);
    }
  });

  it('refuses other types, mislabelled files, broken base64 and images over 5 MB', () => {
    const issue = (upload: unknown) => {
      const parsed = ImageUploadSchema.safeParse(upload);
      return parsed.success ? null : parsed.error.issues[0]?.message;
    };
    expect(issue({ mediaType: 'image/svg+xml', data: PNG })).toMatch('Only PNG, JPEG, GIF and WebP');
    expect(issue({ mediaType: 'image/png', data: JPEG })).toMatch('not the kind of image it says');
    expect(issue({ mediaType: 'image/png', data: Buffer.from('%PDF-1.7 not an image at all').toString('base64') })).toMatch('not the kind of image');
    expect(issue({ mediaType: 'image/png', data: `${PNG.slice(0, 20)}!!!!` })).toMatch('not valid base64');
    const big = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], MAX_IMAGE_BYTES - 7);
    expect(issue({ mediaType: 'image/png', data: big })).toMatch('at most 5 MB');
    const limit = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], MAX_IMAGE_BYTES - 8);
    expect(issue({ mediaType: 'image/png', data: limit })).toBeNull();
  });

  it('limits a response to four stored names and a quote that fits', () => {
    const name = `${'b'.repeat(64)}.png`;
    expect(ResponseExtrasSchema.safeParse({ attachments: [name, name, name, name], quote: 'that part' }).success).toBe(true);
    expect(ResponseExtrasSchema.safeParse({ attachments: [name, name, name, name, name] }).success).toBe(false);
    expect(ResponseExtrasSchema.safeParse({ attachments: ['../../etc/passwd'] }).success).toBe(false);
    expect(ResponseExtrasSchema.safeParse({ quote: 'x'.repeat(4001) }).success).toBe(false);
  });
});

describe('attachment storage', () => {
  it('stores an image by content hash and reads it back, once per distinct image', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'frontier-att-')), 'attachments');
    const name = saveAttachment(dir, { mediaType: 'image/png', data: PNG });
    expect(name).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(saveAttachment(dir, { mediaType: 'image/png', data: PNG })).toBe(name);
    expect(readdirSync(dir)).toEqual([name]);
    expect(readAttachment(dir, name)).toEqual({ mediaType: 'image/png', data: PNG });
    expect(attachmentDataUrl(dir, name)).toBe(`data:image/png;base64,${PNG}`);
    expect(attachmentExists(dir, name)).toBe(true);
    expect(saveAttachment(dir, { mediaType: 'image/jpeg', data: JPEG })).toMatch(/\.jpg$/);
  });

  it('refuses bad uploads with a plain message and never reads outside the folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-att-'));
    expect(() => saveAttachment(dir, { mediaType: 'image/png', data: JPEG })).toThrow('not the kind of image it says it is');
    expect(() => readAttachment(dir, '../secret.png')).toThrow();
    expect(attachmentExists(dir, '../secret.png')).toBe(false);
    expect(() => readAttachment(dir, `${'c'.repeat(64)}.png`)).toThrow('no longer in the attachments folder');
  });
});
