'use strict';

const path = require('node:path');

const DEFAULT_PREFIX = 'content/images';
const DEFAULT_REGION = 'auto';

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

function optionalString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed || undefined;
}

function normalizeBoolean(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
            return true;
        }

        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }

    return fallback;
}

function normalizeUrl(value, fieldName) {
    const raw = optionalString(value);
    if (!raw) {
        return undefined;
    }

    let url;
    try {
        url = new URL(raw);
    } catch (error) {
        throw new TypeError(`${fieldName} must be a valid URL`);
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new TypeError(`${fieldName} must use http or https`);
    }

    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';

    return url.toString().replace(/\/+$/, '');
}

function normalizePath(value) {
    return String(value || '').replaceAll('\\', '/');
}

function stripSlashes(value) {
    return value.replace(/^\/+|\/+$/g, '');
}

function normalizeRelativePath(value, fieldName) {
    const normalized = path.posix.normalize(stripSlashes(normalizePath(value)));

    if (!normalized || normalized === '.') {
        return '';
    }

    if (normalized === '..' || normalized.startsWith('../')) {
        throw new TypeError(`${fieldName} cannot traverse outside the storage root`);
    }

    return normalized;
}

function normalizePrefix(value) {
    if (typeof value === 'string' && value.trim() === '') {
        return '';
    }

    return normalizeRelativePath(optionalString(value) || DEFAULT_PREFIX, 'prefix');
}

function normalizeConfig(options = {}, env = process.env) {
    const accountId = firstString(
        options.accountId,
        options.account_id,
        env.CLOUDFLARE_ACCOUNT_ID,
        env.CF_ACCOUNT_ID
    );
    const bucket = firstString(
        options.bucket,
        options.bucketName,
        env.R2_BUCKET,
        env.CLOUDFLARE_R2_BUCKET
    );
    const accessKeyId = firstString(
        options.accessKeyId,
        options.access_key_id,
        env.R2_ACCESS_KEY_ID,
        env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        env.AWS_ACCESS_KEY_ID
    );
    const secretAccessKey = firstString(
        options.secretAccessKey,
        options.secret_access_key,
        env.R2_SECRET_ACCESS_KEY,
        env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        env.AWS_SECRET_ACCESS_KEY
    );

    if (!accountId) {
        throw new TypeError('accountId is required');
    }

    if (!bucket) {
        throw new TypeError('bucket is required');
    }

    if (!accessKeyId) {
        throw new TypeError('accessKeyId is required');
    }

    if (!secretAccessKey) {
        throw new TypeError('secretAccessKey is required');
    }

    const endpoint = normalizeUrl(
        options.endpoint || env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
        'endpoint'
    );
    const publicUrl = normalizeUrl(
        options.publicUrl || options.cdnUrl || env.R2_PUBLIC_URL || env.CLOUDFLARE_R2_PUBLIC_URL,
        'publicUrl'
    );

    if (!publicUrl) {
        throw new TypeError('publicUrl is required');
    }

    return Object.freeze({
        accountId,
        bucket,
        accessKeyId,
        secretAccessKey,
        endpoint,
        publicUrl,
        prefix: normalizePrefix(options.prefix ?? options.storagePath ?? options.staticFileURLPrefix ?? env.R2_PREFIX),
        region: firstString(options.region, env.R2_REGION) || DEFAULT_REGION,
        cacheControl: firstString(options.cacheControl, env.R2_CACHE_CONTROL),
        contentPath: optionalString(options.contentPath || env.GHOST_CONTENT_PATH),
        forcePathStyle: normalizeBoolean(options.forcePathStyle ?? env.R2_FORCE_PATH_STYLE, false)
    });
}

function fromPublicUrl(config, value) {
    let source;
    try {
        source = new URL(value);
    } catch (error) {
        return undefined;
    }

    const base = new URL(config.publicUrl);
    if (source.origin !== base.origin) {
        return undefined;
    }

    const basePath = base.pathname.replace(/\/+$/, '');
    if (basePath && source.pathname !== basePath && !source.pathname.startsWith(`${basePath}/`)) {
        return undefined;
    }

    const rawPath = source.pathname.slice(basePath.length).replace(/^\/+/, '');
    const decoded = rawPath
        .split('/')
        .filter(Boolean)
        .map(segment => decodeURIComponent(segment))
        .join('/');

    return normalizeRelativePath(decoded, 'url');
}

function fromAbsoluteFilesystemPath(config, value) {
    const input = normalizePath(value);
    const prefix = config.prefix;

    if (prefix) {
        const marker = `/${prefix}/`;
        const markerIndex = input.lastIndexOf(marker);
        if (markerIndex !== -1) {
            return input.slice(markerIndex + marker.length);
        }

        if (input.endsWith(`/${prefix}`)) {
            return '';
        }
    }

    if (config.contentPath && path.posix.isAbsolute(input)) {
        const relative = path.posix.relative(normalizePath(config.contentPath), input);
        if (relative && relative !== '..' && !relative.startsWith('../')) {
            return relative;
        }
    }

    return undefined;
}

function toCanonicalRelativePath(config, value) {
    const input = normalizePath(value);
    const fromUrl = fromPublicUrl(config, input);
    if (fromUrl !== undefined) {
        return removeConfiguredPrefix(config, fromUrl);
    }

    const fromAbsolute = fromAbsoluteFilesystemPath(config, input);
    if (fromAbsolute !== undefined) {
        return normalizeRelativePath(fromAbsolute, 'path');
    }

    return removeConfiguredPrefix(config, input);
}

function removeConfiguredPrefix(config, value) {
    const relative = normalizeRelativePath(value, 'path');
    const {prefix} = config;

    if (!prefix) {
        return relative;
    }

    if (relative === prefix) {
        return '';
    }

    if (relative.startsWith(`${prefix}/`)) {
        return relative.slice(prefix.length + 1);
    }

    return relative;
}

function buildKey(config, value) {
    const relative = toCanonicalRelativePath(config, value);
    const key = normalizeRelativePath(path.posix.join(config.prefix, relative), 'key');

    if (!key) {
        throw new TypeError('key cannot be empty');
    }

    return key;
}

function buildKeyFromParts(config, fileName, targetDir) {
    if (!targetDir) {
        return buildKey(config, fileName);
    }

    return buildKey(config, path.posix.join(normalizePath(targetDir), normalizePath(fileName)));
}

function buildPublicUrl(config, key) {
    const encodedKey = normalizeRelativePath(key, 'key')
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');

    return `${config.publicUrl}/${encodedKey}`;
}

module.exports = {
    buildKey,
    buildKeyFromParts,
    buildPublicUrl,
    normalizeConfig,
    normalizeRelativePath,
    toCanonicalRelativePath
};
