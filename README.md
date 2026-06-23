# ghost-cloudflare-r2

Ghost 6 storage adapter for Cloudflare R2.

The adapter extends `ghost-storage-base`. It uses the official `cloudflare`
Node SDK for R2 bucket validation and the Cloudflare-documented S3-compatible
R2 data API through AWS SDK v3 for object upload, read, existence checks, and
deletion.

## Install

### 1. Enter your Ghost site directory

```bash
cd /path/to/your/ghost/site
```

If you installed Ghost via the CLI, the default location is typically:

```bash
# Ghost-CLI install (recommended)
cd /var/www/ghost

# Local development
cd ~/my-ghost-blog
```

### 2. Install the package

```bash
npm install ghost-cloudflare-r2
```

This downloads the adapter to `node_modules/ghost-cloudflare-r2`.

### 3. Link the adapter to Ghost's storage directory

Ghost loads custom storage adapters from `content/adapters/storage/`. Create the
directory and symlink the installed package:

```bash
# Create the adapters directory if it doesn't exist
mkdir -p content/adapters/storage

# Symlink the package into it
ln -s ../../../node_modules/ghost-cloudflare-r2 content/adapters/storage/ghost-cloudflare-r2
```

The resulting structure should look like:

```text
content/
└── adapters/
    └── storage/
        └── ghost-cloudflare-r2 -> ../../../node_modules/ghost-cloudflare-r2
```

> **Why a symlink?** Ghost resolves adapters by looking for a folder named after
> the adapter under `content/adapters/storage/`. Symlinking avoids duplicating
> the package — updates via `npm update ghost-cloudflare-r2` take effect
> automatically. If you prefer not to symlink, you can copy the package there
> instead:
>
> ```bash
> cp -r node_modules/ghost-cloudflare-r2 content/adapters/storage/ghost-cloudflare-r2
> ```
>
> (You will need to re-copy on each update.)

### 4. Configure Ghost

Add the adapter configuration to your `config.production.json` (or
`config.development.json` for local dev) as shown below.

## Configuration

Use a public R2 custom domain or an enabled `r2.dev` public URL for `publicUrl`.
Do not use the S3 API endpoint as `publicUrl`; it is for authenticated object
API calls.

To store all Ghost uploads in Cloudflare R2, configure the `images`, `media`,
and `files` storage features to use this adapter. Ghost keeps themes in a
separate theme storage service, so this does not move theme zip uploads.

```json
{
  "adapters": {
    "storage": {
      "active": "ghost-cloudflare-r2",
      "ghost-cloudflare-r2": {
        "accountId": "CLOUDFLARE_ACCOUNT_ID",
        "bucket": "ghost",
        "accessKeyId": "R2_ACCESS_KEY_ID",
        "secretAccessKey": "R2_SECRET_ACCESS_KEY",
        "apiToken": "CLOUDFLARE_API_TOKEN",
        "publicUrl": "https://cdn.example.com",
        "validateBucket": true,
        "cacheControl": "public, max-age=31536000, immutable"
      },
      "images": {
        "adapter": "ghost-cloudflare-r2",
        "prefix": "content/images"
      },
      "media": {
        "adapter": "ghost-cloudflare-r2",
        "prefix": "content/media"
      },
      "files": {
        "adapter": "ghost-cloudflare-r2",
        "prefix": "content/files"
      }
    }
  }
}
```

Environment variable fallbacks:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
R2_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_PUBLIC_URL
R2_PREFIX
R2_ENDPOINT
R2_REGION
R2_FORCE_PATH_STYLE
R2_VALIDATE_BUCKET
R2_CACHE_CONTROL
```

## Options

`accountId`, `bucket`, `accessKeyId`, `secretAccessKey`, and `publicUrl` are
required.

`apiToken` is required when `validateBucket` is enabled. Bucket validation uses:

```js
client.r2.buckets.get(bucket, {account_id: accountId});
```

`endpoint` defaults to:

```text
https://<accountId>.r2.cloudflarestorage.com
```

`region` defaults to `auto`, matching Cloudflare R2 examples. `prefix` defaults
to `content/images`; for full upload coverage, set feature-specific prefixes as
shown above.

## Scripts

```bash
npm test
npm run lint
```
