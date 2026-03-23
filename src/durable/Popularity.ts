import { DurableObject } from "cloudflare:workers";

import { json } from "../lib/http";

function utcDay(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isRecentDay(key: string): boolean {
  const recent = new Set(Array.from({ length: 8 }, (_, index) => `day:${utcDay(-index)}`));
  return recent.has(key);
}

export class Popularity extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/increment") {
      return this.increment(request);
    }

    if (request.method === "GET" && url.pathname === "/scores") {
      return this.scores();
    }

    return json({ ok: false, error: "Not found." }, { status: 404 });
  }

  private async increment(request: Request): Promise<Response> {
    const body = (await request.json()) as { appId?: string };
    const appId = body.appId?.trim();

    if (!appId) {
      return json({ ok: false, error: "Missing appId." }, { status: 400 });
    }

    const dayKey = `day:${utcDay()}`;
    const bucket = ((await this.ctx.storage.get<Record<string, number>>(dayKey)) ?? {});
    bucket[appId] = (bucket[appId] ?? 0) + 1;

    await this.ctx.storage.put(dayKey, bucket);
    await this.prune();

    return json({ ok: true });
  }

  private async scores(): Promise<Response> {
    const keys = Array.from({ length: 7 }, (_, index) => `day:${utcDay(-index)}`);
    const buckets = await Promise.all(keys.map((key) => this.ctx.storage.get<Record<string, number>>(key)));
    const totals: Record<string, number> = {};

    for (const bucket of buckets) {
      if (!bucket) {
        continue;
      }

      for (const [appId, count] of Object.entries(bucket)) {
        totals[appId] = (totals[appId] ?? 0) + count;
      }
    }

    return json({
      ok: true,
      scores: totals,
      windowDays: 7,
    });
  }

  private async prune(): Promise<void> {
    const keys = await this.ctx.storage.list({ prefix: "day:" });

    for (const [key] of keys) {
      if (!isRecentDay(key)) {
        await this.ctx.storage.delete(key);
      }
    }
  }
}
