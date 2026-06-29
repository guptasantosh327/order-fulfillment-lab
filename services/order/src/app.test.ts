import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

// The health route never touches the DB, so a stub pool is enough here. Real
// DB behaviour is covered by the Testcontainers integration test.
const stubPool = {} as Pool;

describe('GET /health', () => {
  it('responds 200 with status ok', async () => {
    const res = await request(createApp(stubPool)).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
