/**
 * X (Twitter) APIクライアント
 * OAuth2ユーザートークンで認証
 */

import { createHmac, randomBytes } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename } from 'path';

const X_API_BASE = 'https://api.x.com/2';
const UPLOAD_API_BASE = 'https://upload.twitter.com/1.1';

const DRY_RUN = process.env.X_DRY_RUN === 'true';

/**
 * OAuth2認証ヘッダーを取得
 */
function getAuthHeader(): string {
  const token = process.env.X_USER_ACCESS_TOKEN;
  if (!token) {
    throw new Error('X_USER_ACCESS_TOKEN is not set');
  }
  return `Bearer ${token}`;
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

  const response = await fetch(`${X_API_BASE}/tweets`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
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

  const response = await fetch(`${X_API_BASE}/tweets`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      media: {
        media_ids: mediaIds,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Tweet with media failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<TweetResponse>;
}

/**
 * メディアをチャンク分割でアップロード
 * INIT -> APPEND -> FINALIZE -> STATUS(polling)
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
  const initResponse = await fetch(`${UPLOAD_API_BASE}/media/upload.json`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      command: 'INIT',
      total_bytes: fileSize.toString(),
      media_type: mediaType,
    }),
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

    const formData = new FormData();
    formData.append('command', 'APPEND');
    formData.append('media_id', mediaId);
    formData.append('segment_index', segmentIndex.toString());
    formData.append('media', new Blob([chunk]));

    const appendResponse = await fetch(`${UPLOAD_API_BASE}/media/upload.json`, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(),
      },
      body: formData,
    });

    if (!appendResponse.ok) {
      const errorBody = await appendResponse.text();
      throw new Error(`Media APPEND failed: ${appendResponse.status} ${errorBody}`);
    }

    segmentIndex++;
  }

  // FINALIZE
  const finalizeResponse = await fetch(`${UPLOAD_API_BASE}/media/upload.json`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    }),
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
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `${UPLOAD_API_BASE}/media/upload.json?command=STATUS&media_id=${mediaId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': getAuthHeader(),
        },
      }
    );

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
  return !!process.env.X_USER_ACCESS_TOKEN;
}
