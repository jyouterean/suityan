/**
 * X (Twitter) APIクライアント
 * OAuth 1.0a User Context認証
 */

import { createHmac, randomBytes } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename } from 'path';

const X_API_BASE = 'https://api.x.com/2';
const UPLOAD_API_BASE = 'https://upload.twitter.com/1.1';

const DRY_RUN = process.env.X_DRY_RUN === 'true';

interface OAuthCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function getCredentials(): OAuthCredentials {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      'Missing X API credentials. Required: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET'
    );
  }

  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

/**
 * パーセントエンコード（RFC 3986準拠）
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * OAuth 1.0a署名を生成
 */
function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  credentials: OAuthCredentials
): string {
  // パラメータをソートして連結
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');

  // 署名ベース文字列
  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&');

  // 署名キー
  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessTokenSecret)}`;

  // HMAC-SHA1で署名
  const signature = createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  return signature;
}

/**
 * OAuth 1.0aヘッダーを生成
 */
function generateOAuthHeader(
  method: string,
  url: string,
  bodyParams: Record<string, string> = {}
): string {
  const credentials = getCredentials();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  // 署名生成用に全パラメータを結合
  const allParams = { ...oauthParams, ...bodyParams };
  const signature = generateOAuthSignature(method, url, allParams, credentials);
  oauthParams.oauth_signature = signature;

  // Authorizationヘッダー形式
  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(key => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

export interface TweetResponse {
  data: {
    id: string;
    text: string;
  };
}

export interface MediaUploadResponse {
  media_id_string: string;
  processing_info?: {
    state: string;
    check_after_secs?: number;
  };
}

/**
 * ツイートを投稿（テキストのみ）
 */
export async function createTweet(text: string): Promise<TweetResponse | null> {
  if (DRY_RUN) {
    console.log('[DRY_RUN] Would post tweet:', text);
    return {
      data: {
        id: 'dry_run_' + Date.now(),
        text,
      },
    };
  }

  const url = `${X_API_BASE}/tweets`;
  const body = JSON.stringify({ text });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': generateOAuthHeader('POST', url),
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Tweet failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<TweetResponse>;
}

/**
 * メディア付きツイートを投稿
 */
export async function createTweetWithMedia(
  text: string,
  mediaIds: string[]
): Promise<TweetResponse | null> {
  if (DRY_RUN) {
    console.log('[DRY_RUN] Would post tweet with media:', text, mediaIds);
    return {
      data: {
        id: 'dry_run_' + Date.now(),
        text,
      },
    };
  }

  const url = `${X_API_BASE}/tweets`;
  const body = JSON.stringify({
    text,
    media: {
      media_ids: mediaIds,
    },
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': generateOAuthHeader('POST', url),
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Tweet with media failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<TweetResponse>;
}

/**
 * メディアをアップロード（v1.1 API、OAuth 1.0a）
 */
export async function uploadMediaChunked(filePath: string): Promise<string> {
  if (DRY_RUN) {
    console.log('[DRY_RUN] Would upload media:', filePath);
    return 'dry_run_media_' + Date.now();
  }

  const fileBuffer = readFileSync(filePath);
  const fileSize = statSync(filePath).size;
  const fileName = basename(filePath);

  // MIMEタイプを推定
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  const mediaType = mimeTypes[ext || ''] || 'image/jpeg';

  // INIT
  const initUrl = `${UPLOAD_API_BASE}/media/upload.json`;
  const initParams = {
    command: 'INIT',
    total_bytes: fileSize.toString(),
    media_type: mediaType,
  };

  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: {
      'Authorization': generateOAuthHeader('POST', initUrl, initParams),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(initParams),
  });

  if (!initResponse.ok) {
    const errorBody = await initResponse.text();
    throw new Error(`Media INIT failed: ${initResponse.status} ${errorBody}`);
  }

  const initData = (await initResponse.json()) as MediaUploadResponse;
  const mediaId = initData.media_id_string;

  // APPEND (チャンク分割)
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  let segmentIndex = 0;

  for (let offset = 0; offset < fileSize; offset += CHUNK_SIZE) {
    const chunk = fileBuffer.subarray(offset, Math.min(offset + CHUNK_SIZE, fileSize));
    const chunkBase64 = chunk.toString('base64');

    const appendParams = {
      command: 'APPEND',
      media_id: mediaId,
      segment_index: segmentIndex.toString(),
      media_data: chunkBase64,
    };

    const appendResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        'Authorization': generateOAuthHeader('POST', initUrl, appendParams),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(appendParams),
    });

    if (!appendResponse.ok) {
      const errorBody = await appendResponse.text();
      throw new Error(`Media APPEND failed: ${appendResponse.status} ${errorBody}`);
    }

    segmentIndex++;
  }

  // FINALIZE
  const finalizeParams = {
    command: 'FINALIZE',
    media_id: mediaId,
  };

  const finalizeResponse = await fetch(initUrl, {
    method: 'POST',
    headers: {
      'Authorization': generateOAuthHeader('POST', initUrl, finalizeParams),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(finalizeParams),
  });

  if (!finalizeResponse.ok) {
    const errorBody = await finalizeResponse.text();
    throw new Error(`Media FINALIZE failed: ${finalizeResponse.status} ${errorBody}`);
  }

  const finalizeData = (await finalizeResponse.json()) as MediaUploadResponse;

  // STATUS (processing_infoがある場合はポーリング)
  if (finalizeData.processing_info) {
    await pollMediaStatus(mediaId);
  }

  return mediaId;
}

/**
 * メディア処理状況をポーリング
 */
async function pollMediaStatus(mediaId: string, maxAttempts: number = 10): Promise<void> {
  const baseUrl = `${UPLOAD_API_BASE}/media/upload.json`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const params = {
      command: 'STATUS',
      media_id: mediaId,
    };

    const url = `${baseUrl}?command=STATUS&media_id=${mediaId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': generateOAuthHeader('GET', baseUrl, params),
      },
    });

    if (!response.ok) {
      throw new Error(`Media STATUS failed: ${response.status}`);
    }

    const data = (await response.json()) as MediaUploadResponse;

    if (!data.processing_info) {
      return; // 処理完了
    }

    if (data.processing_info.state === 'succeeded') {
      return;
    }

    if (data.processing_info.state === 'failed') {
      throw new Error('Media processing failed');
    }

    // in_progress の場合は待機
    const waitSeconds = data.processing_info.check_after_secs || 5;
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
  }

  throw new Error('Media processing timeout');
}

/**
 * X APIが利用可能かチェック
 */
export function isXApiAvailable(): boolean {
  return !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
}
