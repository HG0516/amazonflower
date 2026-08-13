// Read-only production readiness check for supabase-first-bundle.sql.
// Vercel Sensitive env values may be masked in local `vercel env run`; run this with
// explicitly injected local process env or inside a protected server/CI context.
// The credential values themselves are never printed.

const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) || !key) {
  console.error('supabase production credentials unavailable');
  process.exit(2);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function get(path, extraHeaders = {}) {
  return fetch(`${base}/rest/v1/${path}`, { headers: { ...headers, ...extraHeaders } });
}

const expectedColumns = [
  'payment_key', 'payment_status', 'payment_method', 'approved_at', 'receipt_url',
  'photo_access_token_hash', 'photo_access_expires_at', 'photo_notice_status',
  'photo_notice_photo', 'photo_notified_at', 'photo_notify_error', 'photo_notice_lease_until',
  'canceled_at', 'cancel_requested_at', 'user_id', 'status', 'completed_photo',
];
const columnStates = {};
for (const name of expectedColumns) {
  const response = await get(`orders?select=${encodeURIComponent(name)}&limit=0`);
  columnStates[name] = response.ok;
}

const readinessResponse = await fetch(`${base}/rest/v1/rpc/first_bundle_readiness`, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
});
if (!readinessResponse.ok) {
  console.error(`first-bundle readiness RPC unavailable (${readinessResponse.status})`);
  process.exit(3);
}
const readiness = await readinessResponse.json();
const photoNoticeMode = String(process.env.PHOTO_NOTICE_MODE || '').trim().toLowerCase();
const solapiCredentialsPresent = !!(
  process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_SENDER
);
const manualPhotoNotice = photoNoticeMode === 'manual';
const solapiPhotoNotice = photoNoticeMode === 'solapi' && solapiCredentialsPresent;
const ownerIds = String(process.env.ADMIN_OWNER_IDS || '').split(/[\s,;]+/).filter(Boolean);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownerIdsFormatValid = ownerIds.length > 0 && ownerIds.every((id) => uuidPattern.test(id));
const secretStrong = (name) => String(process.env[name] || '').length >= 32;
const koreanPhone = (value) => /^01[016789]\d{7,8}$/.test(String(value || '').replace(/[^0-9]/g, ''));
const ownerPhones = [process.env.OWNER_PHONE_1, process.env.OWNER_PHONE_2].filter(Boolean);
const ownerPhonesValid = ownerPhones.length > 0 && ownerPhones.every(koreanPhone);
const telegramConfigured = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
const publicBaseUrlValid = /^https:\/\/floweranbu\.co\.kr\/?$/i.test(String(process.env.PUBLIC_BASE_URL || ''));
const supabaseProjectRef = (() => {
  try { return new URL(base).hostname.split('.')[0] || ''; } catch { return ''; }
})();

let ownerIdsExist = false;
if (ownerIdsFormatValid) {
  const checks = await Promise.all(ownerIds.map(async (id) => {
    try {
      const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        headers: { ...headers, 'X-Supabase-Project-Ref': supabaseProjectRef },
      });
      return response.ok;
    } catch {
      return false;
    }
  }));
  ownerIdsExist = checks.every(Boolean);
}
const env = {
  paymentIntentsRequired: process.env.PAYMENT_INTENTS_REQUIRED === '1',
  adminAuthModeJwt: String(process.env.ADMIN_AUTH_MODE || '').toLowerCase() === 'jwt',
  ownerUidAllowlist: ownerIdsFormatValid && ownerIdsExist,
  ownerUidFormatValid: ownerIdsFormatValid,
  ownerUidsExist: ownerIdsExist,
  photoUploadSecretStrong: secretStrong('PHOTO_UPLOAD_SECRET'),
  paymentRateLimitSecretStrong: secretStrong('PAYMENT_RATE_LIMIT_SECRET'),
  photoNoticeModeValid: manualPhotoNotice || solapiPhotoNotice,
  photoNoticeMode: manualPhotoNotice ? 'manual' : (solapiPhotoNotice ? 'solapi' : 'invalid'),
  solapiConfigured: solapiCredentialsPresent,
  ownerPhonesValidIfProvided: ownerPhones.length === 0 || ownerPhonesValid,
  operationalAlertChannel: ownerPhonesValid || telegramConfigured,
  publicBaseUrlValid,
};

console.log(JSON.stringify({
  database: readiness,
  orderColumns: columnStates,
  environment: env,
}, null, 2));

const columnsReady = Object.values(columnStates).every(Boolean);
if (!readiness || readiness.schema_ready !== true || readiness.active_ready !== true || !columnsReady
    || !env.paymentIntentsRequired || !env.adminAuthModeJwt || !env.ownerUidAllowlist
    || !env.photoUploadSecretStrong || !env.paymentRateLimitSecretStrong
    || !env.photoNoticeModeValid || !env.ownerPhonesValidIfProvided
    || !env.operationalAlertChannel || !env.publicBaseUrlValid) {
  process.exitCode = 4;
}
