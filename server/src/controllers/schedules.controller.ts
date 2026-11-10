// server/src/controllers/schedules.controller.ts — schedule CRUD handlers (T-062, contract §3.1
// #17–#20). Why: thin HTTP layer; the shared schedule schemas validate bodies, the service enforces
// ownership (cross-user id = 404) and never runs a schedule (execution is W4/T-063).
// Invariants: 201 create, 200 update/delete/list; delete returns the frozen `{id}` payload.

import type { RequestHandler } from 'express';
import {
  ERROR_CODES,
  type ApiSuccess,
  type Paginated,
  type ScheduleCreateInput,
  type ScheduleUpdateInput,
} from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import { getValidatedQuery } from '../middlewares/validate.js';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
  type PublicSchedule,
} from '../services/schedule.service.js';
import { AppError } from '../utils/AppError.js';
import type { PageLimitQuery } from '../utils/pagination.js';

type RouteParams = Record<string, string>;

/** GET /api/v1/schedules — 200 paginated schedules ordered by startTime (§3.1 #17). */
export const list: RequestHandler<RouteParams, ApiSuccess<Paginated<PublicSchedule>>> = async (
  req,
  res,
) => {
  const user = getAuthenticatedUser(req);
  const query = getValidatedQuery<PageLimitQuery>(res);
  const data = await listSchedules(user.id, query);
  res.status(200).json({ success: true, data });
};

/** POST /api/v1/schedules — 201 created schedule. */
export const create: RequestHandler<
  RouteParams,
  ApiSuccess<PublicSchedule>,
  ScheduleCreateInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const schedule = await createSchedule(user.id, req.body);
  res.status(201).json({ success: true, data: schedule });
};

/** PATCH /api/v1/schedules/:id — 200 updated schedule; foreign/missing id → 404. */
export const update: RequestHandler<
  RouteParams,
  ApiSuccess<PublicSchedule>,
  ScheduleUpdateInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const scheduleId = req.params.id;
  if (scheduleId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Schedule not found.');
  }
  const schedule = await updateSchedule(user.id, scheduleId, req.body);
  res.status(200).json({ success: true, data: schedule });
};

/** DELETE /api/v1/schedules/:id — 200 `{id}`; foreign/missing id → 404. */
export const remove: RequestHandler<RouteParams, ApiSuccess<{ id: string }>> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const scheduleId = req.params.id;
  if (scheduleId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Schedule not found.');
  }
  const data = await deleteSchedule(user.id, scheduleId);
  res.status(200).json({ success: true, data });
};
