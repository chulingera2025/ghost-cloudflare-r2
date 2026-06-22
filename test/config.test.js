'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildKey,
    buildKeyFromParts,
    buildPublicUrl,
    normalizeConfig,
    toCanonicalRelativePath
} = require('../lib/config');

function config(overrides = {}) {
    return normalizeConfig({
        accountId: 'account-id',
        bucket: 'ghost',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        publicUrl: 'https://cdn.example.com',
        validateBucket: false,
        ...overrides
    }, {});
}

test('normalizes the Cloudflare R2 endpoint and default prefix', () => {
    const result = config();

    assert.equal(result.endpoint, 'https://account-id.r2.cloudflarestorage.com');
    assert.equal(result.prefix, 'content/images');
    assert.equal(result.region, 'auto');
});

test('builds keys from relative and storage-prefixed paths', () => {
    const result = config();

    assert.equal(buildKey(result, '2026/06/image.jpg'), 'content/images/2026/06/image.jpg');
    assert.equal(buildKey(result, 'content/images/2026/06/image.jpg'), 'content/images/2026/06/image.jpg');
});

test('builds keys from absolute Ghost content paths', () => {
    const result = config();

    assert.equal(
        buildKeyFromParts(result, 'image.jpg', '/var/lib/ghost/content/images/2026/06'),
        'content/images/2026/06/image.jpg'
    );
});

test('round trips public URLs with an optional public URL path', () => {
    const result = config({
        publicUrl: 'https://cdn.example.com/assets/'
    });

    const key = buildKey(result, '2026/06/my image.jpg');

    assert.equal(buildPublicUrl(result, key), 'https://cdn.example.com/assets/content/images/2026/06/my%20image.jpg');
    assert.equal(toCanonicalRelativePath(result, 'https://cdn.example.com/assets/content/images/2026/06/my%20image.jpg'), '2026/06/my image.jpg');
});

test('rejects traversal paths', () => {
    const result = config();

    assert.throws(() => buildKey(result, '../secret.txt'), /storage root/);
});
