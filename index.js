'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    NoSuchKey,
    NotFound,
    PutObjectCommand,
    S3Client
} = require('@aws-sdk/client-s3');
const BaseAdapter = require('ghost-storage-base');
const mime = require('mime-types');

const {
    buildKey,
    buildKeyFromParts,
    buildPublicUrl,
    normalizeConfig,
    normalizeRelativePath
} = require('./lib/config');

class GhostCloudflareR2Storage extends BaseAdapter {
    constructor(options = {}) {
        super();

        this.config = normalizeConfig(options);
        this.client = options.s3Client || new S3Client({
            region: this.config.region,
            endpoint: this.config.endpoint,
            forcePathStyle: this.config.forcePathStyle,
            credentials: {
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey
            }
        });

        if (this.config.syncOnBoot) {
            this.syncLocalToR2().catch(error => {
                console.error('[ghost-cloudflare-r2] Sync failed:', error);
            });
        }
    }

    async save(file, targetDir) {

        const dir = targetDir || this.getTargetDir();
        const relativePath = await this.getUniqueFileName(file, dir);
        const key = buildKey(this.config, relativePath);

        await this.putObject({
            key,
            body: fs.createReadStream(file.path),
            contentType: file.type || mime.lookup(file.name || file.path) || undefined
        });

        return buildPublicUrl(this.config, key);
    }

    async saveRaw(buffer, targetPath) {
        const key = buildKey(this.config, targetPath);
        await this.putObject({
            key,
            body: buffer,
            contentType: mime.lookup(targetPath) || undefined
        });

        return buildPublicUrl(this.config, key);
    }

    async exists(fileName, targetDir) {
        const key = buildKeyFromParts(this.config, fileName, targetDir);
        try {
            await this.client.send(new HeadObjectCommand({
                Bucket: this.config.bucket,
                Key: key
            }));
            return true;
        } catch (error) {
            if (this.isNotFound(error)) {
                return false;
            }

            throw error;
        }
    }

    serve() {
        return (req, res, next) => {
            const requestPath = String(req.path || req.url || '').split('?')[0];
            if (!requestPath || requestPath === '/') {
                return next();
            }

            let key;
            try {
                key = buildKey(this.config, requestPath);
            } catch (error) {
                return next(error);
            }

            return res.redirect(301, buildPublicUrl(this.config, key));
        };
    }

    async delete(fileName, targetDir) {
        const key = buildKeyFromParts(this.config, fileName, targetDir);
        try {
            await this.client.send(new DeleteObjectCommand({
                Bucket: this.config.bucket,
                Key: key
            }));
        } catch (error) {
            if (!this.isNotFound(error)) {
                throw error;
            }
        }
    }

    async read(file) {
        const key = buildKey(this.config, file.path || file.url || file.name);
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.config.bucket,
            Key: key
        }));

        return bodyToBuffer(response.Body);
    }

    urlToPath(url) {
        return buildKey(this.config, url).slice(this.config.prefix ? this.config.prefix.length + 1 : 0);
    }

    async putObject({key, body, contentType}) {
        const input = {
            Bucket: this.config.bucket,
            Key: key,
            Body: body
        };

        if (contentType) {
            input.ContentType = contentType;
        }

        if (this.config.cacheControl) {
            input.CacheControl = this.config.cacheControl;
        }

        await this.client.send(new PutObjectCommand(input));
    }

    async syncLocalToR2() {
        const contentRoot = this.config.contentPath || path.join(process.cwd(), 'content');
        const lockFile = path.join(contentRoot, '.r2-synced');

        // Check lock file — skip if already synced
        try {
            await fs.promises.access(lockFile);
            return { synced: false, reason: 'lock file exists' };
        } catch {
            // Lock file doesn't exist — proceed
        }

        const syncDirs = [
            { local: 'images', prefix: 'content/images' },
            { local: 'media', prefix: 'content/media' },
            { local: 'files', prefix: 'content/files' }
        ];

        let uploaded = 0;
        let skipped = 0;
        let errors = 0;

        for (const { local, prefix } of syncDirs) {
            const dirPath = path.join(contentRoot, local);

            // Skip missing directories (fresh install, no uploads yet)
            try {
                await fs.promises.access(dirPath);
            } catch {
                continue;
            }

            const result = await this._syncDirectory(dirPath, prefix);
            uploaded += result.uploaded;
            skipped += result.skipped;
            errors += result.errors;
        }

        // Write lock file so subsequent boots skip the sync
        await fs.promises.writeFile(lockFile, JSON.stringify({
            syncedAt: new Date().toISOString(),
            bucket: this.config.bucket,
            uploaded,
            skipped,
            errors
        }, null, 2) + '\n');

        return { synced: true, uploaded, skipped, errors };
    }

    async _syncDirectory(dirPath, prefix) {
        let uploaded = 0;
        let skipped = 0;
        let errors = 0;

        const walk = async (currentDir, relativeDir) => {
            let entries;
            try {
                entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
            } catch (err) {
                if (err.code === 'ENOENT') return;
                throw err;
            }

            for (const entry of entries) {
                // Skip hidden files/directories
                if (entry.name.startsWith('.')) continue;

                const fullPath = path.join(currentDir, entry.name);
                const relPath = relativeDir
                    ? path.posix.join(relativeDir, entry.name)
                    : entry.name;

                if (entry.isDirectory()) {
                    await walk(fullPath, relPath);
                } else if (entry.isFile()) {
                    const key = normalizeRelativePath(
                        path.posix.join(prefix, relPath),
                        'key'
                    );

                    try {
                        await this.client.send(new HeadObjectCommand({
                            Bucket: this.config.bucket,
                            Key: key
                        }));
                        skipped++;
                    } catch (err) {
                        if (this.isNotFound(err)) {
                            try {
                                const putInput = {
                                    Bucket: this.config.bucket,
                                    Key: key,
                                    Body: fs.createReadStream(fullPath)
                                };
                                const contentType = mime.lookup(entry.name);
                                if (contentType) {
                                    putInput.ContentType = contentType;
                                }
                                if (this.config.cacheControl) {
                                    putInput.CacheControl = this.config.cacheControl;
                                }
                                await this.client.send(new PutObjectCommand(putInput));
                                uploaded++;
                            } catch (uploadErr) {
                                errors++;
                                console.error(
                                    `[ghost-cloudflare-r2] Failed to upload ${key}:`,
                                    uploadErr.message
                                );
                            }
                        } else {
                            errors++;
                            console.error(
                                `[ghost-cloudflare-r2] Error checking ${key}:`,
                                err.message
                            );
                        }
                    }
                }
            }
        };

        await walk(dirPath, '');
        return { uploaded, skipped, errors };
    }

    isNotFound(error) {
        return error instanceof NotFound ||
            error instanceof NoSuchKey ||
            error?.name === 'NotFound' ||
            error?.name === 'NoSuchKey' ||
            error?.$metadata?.httpStatusCode === 404;
    }
}

async function bodyToBuffer(body) {
    if (!body) {
        return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(body)) {
        return body;
    }

    if (body instanceof Uint8Array) {
        return Buffer.from(body);
    }

    if (typeof body.transformToByteArray === 'function') {
        return Buffer.from(await body.transformToByteArray());
    }

    if (typeof body.arrayBuffer === 'function') {
        return Buffer.from(await body.arrayBuffer());
    }

    const chunks = [];
    for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

module.exports = GhostCloudflareR2Storage;
