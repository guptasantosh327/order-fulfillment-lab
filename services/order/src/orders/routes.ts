import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  deleteOrder,
  getOrderById,
  insertOrder,
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

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: 'invalid request body', details: error.flatten() });
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
    const order = await insertOrder(pool, parsed.data);
    res.status(201).json(order);
  });

  router.get('/', async (_req, res) => {
    res.json(await listOrders(pool));
  });

  router.get('/:id', async (req, res) => {
    const order = await getOrderById(pool, req.params.id);
    if (!order) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    res.json(order);
  });

  router.patch('/:id', async (req, res) => {
    const parsed = updateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error);
      return;
    }
    const order = await updateOrder(pool, req.params.id, parsed.data);
    if (!order) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    res.json(order);
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await deleteOrder(pool, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
