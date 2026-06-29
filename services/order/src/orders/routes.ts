import { type Request, type Response, Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  deleteOrder,
  getOrderById,
  insertOrder,
  insertOrderIdempotent,
  listOrders,
  ORDER_STATUSES,
  updateOrder,
} from './repository.js';

// Request-body schemas. zod is the single source of truth for what a valid
// payload looks like; the inferred types flow straight into the repository.
const createOrderSchema = z.object({
  customerId: z.string().min(1),
  itemSku: z.string().min(1),
  quantity: z.number().int().positive(),
});

const updateOrderSchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    quantity: z.number().int().positive().optional(),
  })
  .refine((body) => body.status !== undefined || body.quantity !== undefined, {
    message: 'provide at least one of status or quantity',
  });

// The :id path param arrives as a string; coerce + validate it's a positive int.
const idParam = z.coerce.number().int().positive();

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: 'invalid request body', details: error.flatten() });
}

/** Parses :id, sending a 400 and returning null when it isn't a positive int. */
function parseId(req: Request, res: Response): number | null {
  const parsed = idParam.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: 'order id must be a positive integer' });
    return null;
  }
  return parsed.data;
}

/**
 * CRUD over the orders table. The pool is injected (not imported) so the router
 * is decoupled from a specific connection and stays unit-testable. Handlers are
 * plain async functions — Express 5 forwards their rejections to the error seam
 * in app.ts, so no per-route try/catch is needed.
 */
export function createOrdersRouter(pool: Pool): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error);
      return;
    }

    // An optional Idempotency-Key makes create safe to retry: the same key
    // returns the original order (200) instead of creating a duplicate (201).
    const idempotencyKey = req.get('Idempotency-Key');
    if (idempotencyKey !== undefined) {
      if (idempotencyKey.length < 1 || idempotencyKey.length > 255) {
        res.status(400).json({ error: 'Idempotency-Key header must be 1–255 characters' });
        return;
      }
      const { order, created } = await insertOrderIdempotent(pool, parsed.data, idempotencyKey);
      res.status(created ? 201 : 200).json(order);
      return;
    }

    const order = await insertOrder(pool, parsed.data);
    res.status(201).json(order);
  });

  router.get('/', async (_req, res) => {
    res.json(await listOrders(pool));
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req, res);
    if (id === null) {
      return;
    }
    const order = await getOrderById(pool, id);
    if (!order) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    res.json(order);
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req, res);
    if (id === null) {
      return;
    }
    const parsed = updateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error);
      return;
    }
    const order = await updateOrder(pool, id, parsed.data);
    if (!order) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    res.json(order);
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req, res);
    if (id === null) {
      return;
    }
    const deleted = await deleteOrder(pool, id);
    if (!deleted) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
