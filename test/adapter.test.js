'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const Storage = require('../index');

class MockS3Client {
    constructor({existingKeys = []} = {}) {
        this.commands = [];
        this.existingKeys = new Set(existingKeys);
        this.objects = new Map();
    }

    async send(command) {
        this.commands.push(command);
        const name = command.constructor.name;
        const {Key} = command.input;

        if (name === 'HeadObjectCommand') {
            if (this.existingKeys.has(Key) || this.objects.has(Key)) {
                return {};
            }

            const error = new Error('not found');
            error.name = 'NotFound';
            error.$metadata = {httpStatusCode: 404};
            throw error;
        }

        if (name === 'PutObjectCommand') {
            this.objects.set(Key, command.input);
            return {};
        }

        if (name === 'GetObjectCommand') {
            return {
                Body: Buffer.from('stored file')
            };
        }

        if (name === 'DeleteObjectCommand') {
            this.objects.delete(Key);
            return {};
        }

        return {};
    }
}

function createStorage(s3Client, overrides = {}) {
    return new Storage({
        accountId: 'account-id',
        bucket: 'ghost',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        publicUrl: 'https://cdn.example.com',
        s3Client,
        ...overrides
    });
}

test('save uploads a file stream and returns the public URL', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghost-r2-'));
    const filePath = path.join(tmpDir, 'my image.jpg');
    await fs.writeFile(filePath, 'image');

    const s3Client = new MockS3Client();
    const storage = createStorage(s3Client);

    const url = await storage.save({
        name: 'my image.jpg',
        path: filePath,
        type: 'image/jpeg'
    }, '/var/lib/ghost/content/images/2026/06');

    assert.equal(url, 'https://cdn.example.com/content/images/2026/06/my-image.jpg');

    const putCommand = s3Client.commands.find(command => command.constructor.name === 'PutObjectCommand');
    assert.equal(putCommand.input.Bucket, 'ghost');
    assert.equal(putCommand.input.Key, 'content/images/2026/06/my-image.jpg');
    assert.equal(putCommand.input.ContentType, 'image/jpeg');
});

test('save asks ghost-storage-base for a unique file name', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghost-r2-'));
    const filePath = path.join(tmpDir, 'image.jpg');
    await fs.writeFile(filePath, 'image');

    const s3Client = new MockS3Client({
        existingKeys: ['content/images/2026/06/image.jpg']
    });
    const storage = createStorage(s3Client);

    const url = await storage.save({
        name: 'image.jpg',
        path: filePath
    }, 'content/images/2026/06');

    assert.equal(url, 'https://cdn.example.com/content/images/2026/06/image-1.jpg');
});

test('read returns a buffer', async () => {
    const storage = createStorage(new MockS3Client());

    const result = await storage.read({
        path: 'content/images/2026/06/file.txt'
    });

    assert.equal(result.toString(), 'stored file');
});

test('serve redirects local Ghost paths to the public R2 URL', async () => {
    const storage = createStorage(new MockS3Client());
    const middleware = storage.serve();

    let redirected;
    await middleware(
        {path: '/2026/06/image.jpg'},
        {
            redirect(status, url) {
                redirected = {status, url};
            }
        },
        error => {
            throw error;
        }
    );

    assert.deepEqual(redirected, {
        status: 301,
        url: 'https://cdn.example.com/content/images/2026/06/image.jpg'
    });
});

test('adapter does not require apiToken or validateBucket', async () => {
    const storage = createStorage(new MockS3Client());
    assert.ok(storage instanceof Storage);
    assert.equal(storage.config.bucket, 'ghost');
});
