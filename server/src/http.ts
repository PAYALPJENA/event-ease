import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { AppConfig } from './config.ts';
import type { DB } from './db/index.ts';
import type { User } from './db/types.ts';
import type { Senders } from './lib/channels.ts';
import { externalFrom } from './services/notifications.ts';
import type { PaymentGateway } from './services/payments.ts';
import type { RegistrationCtx } from './services/registrations.ts';

export interface AppDeps {
  db: DB;
  config: AppConfig;
  /** Injectable clock so tests can move time without waiting. */
  now: () => Date;
  /** Delivers queued messages per channel; a missing sender leaves them in the outbox. */
  senders: Senders;
  /** Payment gateway for paid events (the mock gateway in development and tests). */
  gateway: PaymentGateway;
}

export interface AppEnv {
  Variables: {
    deps: AppDeps;
    user: User | null;
  };
}

export type AppContext = Context<AppEnv>;

/** An error that should reach the client as `{ error: { code, message } }`. */
export class ApiError extends Error {
  status: ContentfulStatusCode;
  code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const parseBody = async (c: AppContext, allowEmpty: boolean): Promise<unknown> => {
  const text = await c.req.text();
  if (allowEmpty && text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
};

export const readJson = <T extends z.ZodType>(c: AppContext, schema: T) => validate(c, schema, false);

/** Like readJson, but an empty body counts as `{}` (for actions whose options are all optional). */
export const readOptionalJson = <T extends z.ZodType>(c: AppContext, schema: T) => validate(c, schema, true);

const validate = async <T extends z.ZodType>(c: AppContext, schema: T, allowEmpty: boolean): Promise<z.infer<T>> => {
  const body = await parseBody(c, allowEmpty);
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    throw new ApiError(400, 'validation_failed', field ? `${field}: ${issue.message}` : issue.message);
  }
  return result.data;
};

export const nowIso = (c: AppContext) => c.get('deps').now().toISOString();

/** What registration changes need beyond the database: channels, the gateway, the payment window. */
export const regCtx = (c: AppContext): RegistrationCtx => {
  const { config, gateway } = c.get('deps');
  return { ext: externalFrom(config), gateway, paymentWindowMinutes: config.paymentWindowMinutes };
};

export const extOf = (c: AppContext) => externalFrom(c.get('deps').config);
