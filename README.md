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

### Prerequisites

Before configuring, create the following credentials in your
[Cloudflare Dashboard](https://dash.cloudflare.com/):

| Field | Where to create it | What it is |
|-------|-------------------|------------|
| `accountId` | **R2 Dashboard** → top right or URL (`/` after `r2/`) | Your Cloudflare account ID (31-32 hex chars) — always visible on any R2 page |
| `accessKeyId` / `secretAccessKey` | **R2** → your bucket → **管理 / Manage** → **兼容S3的凭据 / S3-compatible credentials** → **创建 / Create** | S3 兼容密钥，用于通过 AWS SDK 读写 R2 存储桶。**注意：** 这是 R2 存储桶级别的 S3 凭据，不是 Cloudflare API 令牌 |
| `apiToken` | **My Profile / 个人资料** → **API Tokens / API 令牌** → **Create Token / 创建令牌** | Cloudflare API 令牌，用于 `validateBucket` 时通过 Cloudflare SDK 验证 bucket 存在性。**注意：** 这是「API 令牌」部分生成的，**不是** R2 的「S3 兼容」凭据 |
| `publicUrl` | **R2** → your bucket → **设置 / Settings** → **公共URL / Public URL** | R2 存储桶的公网访问域名。可以是绑定的自定义域名，或开启的 `r2.dev` 子域名 |

### Adapter config

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
        "accountId": "YOUR_CLOUDFLARE_ACCOUNT_ID",
        "bucket": "ghost",
        "accessKeyId": "YOUR_R2_S3_ACCESS_KEY",
        "secretAccessKey": "YOUR_R2_S3_SECRET_KEY",
        "apiToken": "YOUR_CLOUDFLARE_API_TOKEN",
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

The `apiToken` corresponds to the **API 令牌 / API Token** section in
Cloudflare Dashboard (My Profile → API Tokens). It is **NOT** the S3-compatible
credential — do not confuse it with `accessKeyId` / `secretAccessKey`.

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
