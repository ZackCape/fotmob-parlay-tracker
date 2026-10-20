import { DataProviderFactory } from '../providers/provider-factory.js';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedNews {
  articles: any[];
  cachedAt: number;
}

let cache: CachedNews | null = null;

export async function getLatestNews(factory: DataProviderFactory, forceRefresh = false): Promise<any[]> {
  const now = Date.now();

  // Check cache validity
  if (!forceRefresh && cache && (now - cache.cachedAt) < CACHE_TTL_MS) {
    // Purge articles older than 24 hours
    const filtered = cache.articles.filter((a: any) => {
      const pubDate = a.publishedAt ? new Date(a.publishedAt).getTime() : now;
      return (now - pubDate) < MAX_AGE_MS;
    });
    if (filtered.length !== cache.articles.length) {
      cache.articles = filtered;
    }
    return cache.articles;
  }

  // Fetch fresh
  try {
    const articles = await factory.getLatestNews();
    const now2 = Date.now();
    const filtered = articles.filter((a: any) => {
      const pubDate = a.publishedAt ? new Date(a.publishedAt).getTime() : now2;
      return (now2 - pubDate) < MAX_AGE_MS;
    });
    cache = { articles: filtered, cachedAt: now2 };
    return filtered;
  } catch {
    // Return stale cache if available
    if (cache) return cache.articles;
    return [];
  }
}

export function invalidateNewsCache(): void {
  cache = null;
}

export default { getLatestNews, invalidateNewsCache };
