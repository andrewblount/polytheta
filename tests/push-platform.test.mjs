import test from 'node:test';
import assert from 'node:assert/strict';
import push from '../src/server/services/push.ts';

test('Mac device registration preserves its platform', () => {
  assert.equal(push.normalizePushPlatform?.('macos'), 'macos');
});

test('legacy iOS device registration retains its default', () => {
  assert.equal(push.normalizePushPlatform?.(undefined), 'ios');
});

test('unsupported push platforms are rejected', () => {
  assert.throws(() => push.normalizePushPlatform?.('android'), /Unsupported push platform/);
});

test('Mac push tokens use the Mac bundle topic', () => {
  assert.equal(push.apnsTopicForDevice?.({ platform: 'macos' }, 'com.andrewblount.polytheta'), 'com.andrewblount.polytheta.mac');
});

test('iOS push routing preserves the configured topic', () => {
  assert.equal(push.apnsTopicForDevice?.({ platform: 'ios' }, 'com.example.polytheta'), 'com.example.polytheta');
});
