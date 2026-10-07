// 保存した Plonkit の画像（scripts/mirror-plonkit-images.mjs の保存先）を、Cloudflare R2 のバケットに入れる（再開できる）
// 使い方（PowerShell / bash で、値を環境変数に入れてから）:
//   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=plonkit-images node scripts/upload-plonkit-images.mjs [画像の保存先]
// 事前に: cd scripts && npm i --no-save @aws-sdk/client-s3
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) { console.error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET を環境変数に入れてください'); process.exit(1); }
const root = path.resolve(process.argv[2] || new URL('../../plonkit-images', import.meta.url).pathname);
const s3 = new S3Client({ region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!e.name.startsWith('_')) files.push(p); } })(root);
const have = new Set();
for (let token; ;) { const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token })); (r.Contents || []).forEach((o) => have.add(o.Key)); if (!r.IsTruncated) break; token = r.NextContinuationToken; }
const sniff = (b) => (b.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : b[0] === 0x89 ? 'image/png' : b[0] === 0xff ? 'image/jpeg' : b.slice(0, 3).toString() === 'GIF' ? 'image/gif' : 'application/octet-stream');
const todo = files.filter((f) => !have.has(path.relative(root, f).split(path.sep).join('/')));
console.log(`全 ${files.length} 枚 / 済 ${have.size} / これから ${todo.length}`);
let n = 0;
const worker = async () => {
  for (let f; (f = todo.pop());) {
    const body = fs.readFileSync(f);
    await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: path.relative(root, f).split(path.sep).join('/'), Body: body, ContentType: sniff(body) }));
    if (++n % 100 === 0) console.log(`${n} 枚`);
  }
};
await Promise.all(Array.from({ length: 8 }, worker));
console.log('完了', n, '枚');
