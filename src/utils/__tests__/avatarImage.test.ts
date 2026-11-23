import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeSquareCrop,
  getMemberInitials,
  isValidAvatarDataUrl,
  mapCameraError,
  validateSelectedImageFile,
} from '../avatarImage.ts';

test('computeSquareCrop centers square crop for landscape and portrait dimensions', () => {
  assert.deepEqual(computeSquareCrop(1280, 720), { sx: 280, sy: 0, size: 720 });
  assert.deepEqual(computeSquareCrop(480, 640), { sx: 0, sy: 80, size: 480 });
  assert.deepEqual(computeSquareCrop(512, 512), { sx: 0, sy: 0, size: 512 });
  assert.throws(() => computeSquareCrop(0, 500));
});

test('isValidAvatarDataUrl enforces image MIME types and max byte size', () => {
  assert.equal(isValidAvatarDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isValidAvatarDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isValidAvatarDataUrl('data:image/webp;base64,UklGRg=='), true);
  assert.equal(isValidAvatarDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isValidAvatarDataUrl('https://example.com/avatar.png'), false);
  assert.equal(isValidAvatarDataUrl(`data:image/jpeg;base64,${'A'.repeat(100000)}`), false);
});

test('getMemberInitials derives clean initials', () => {
  assert.equal(getMemberInitials('Aarav Sharma'), 'AS');
  assert.equal(getMemberInitials('Lalit'), 'LA');
  assert.equal(getMemberInitials(''), 'NX');
});

test('validateSelectedImageFile and mapCameraError return clear messages', () => {
  const valid = { type: 'image/jpeg', size: 1024 * 500 } as File;
  const badType = { type: 'application/pdf', size: 1024 } as File;
  const tooBig = { type: 'image/png', size: 15 * 1024 * 1024 } as File;

  assert.equal(validateSelectedImageFile(valid), null);
  assert.match(validateSelectedImageFile(badType) || '', /Unsupported file format/);
  assert.match(validateSelectedImageFile(tooBig) || '', /10 MB/);

  assert.match(mapCameraError({ name: 'NotAllowedError' }), /permission was denied/i);
  assert.match(mapCameraError({ name: 'NotFoundError' }), /No camera was detected/i);
});
