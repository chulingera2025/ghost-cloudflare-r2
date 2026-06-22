'use strict';

const fs = require('node:fs');

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
const CloudflareModule = require('cloudflare');
const mime = require('mime-types');

const {
    buildKey,
    buildKeyFromParts,
    buildPublicUrl,
    normalizeConfig
} = require('./lib/config');

const Cloudflare = CloudflareModule.default || CloudflareModule;

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
        this.cloudflare = options.cloudflareClient || (this.config.apiToken ? new Cloudflare({
            apiToken: this.config.apiToken
        }) : undefined);
        this.bucketValidation = undefined;
    }

    async save(file, targetDir) {
        await this.ensureBucket();

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
        await this.ensureBucket();

        const key = buildKey(this.config, targetPath);
        await this.putObject({
            key,
            body: buffer,
            contentType: mime.lookup(targetPath) || undefined
        });

        return buildPublicUrl(this.config, key);
    }

    async exists(fileName, targetDir) {
        await this.ensureBucket();

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
        await this.ensureBucket();

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
        await this.ensureBucket();

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

    async ensureBucket() {
        if (!this.config.validateBucket) {
            return;
        }

        if (!this.cloudflare) {
            throw new TypeError('apiToken is required when validateBucket is enabled');
        }

        if (!this.bucketValidation) {
            this.bucketValidation = this.cloudflare.r2.buckets
                .get(this.config.bucket, {
                    account_id: this.config.accountId
                })
                .catch(error => {
                    this.bucketValidation = undefined;
                    throw error;
                });
        }

        await this.bucketValidation;
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
