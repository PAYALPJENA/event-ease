import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

// Migrations run in key order. Never edit a migration that has shipped;
// add a new one instead.
export const migrations: Record<string, Migration> = {
  '0001_initial': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('university_id', 'text', c => c.notNull().unique())
        .addColumn('name', 'text', c => c.notNull())
        .addColumn('email', 'text', c => c.notNull().unique())
        .addColumn('phone', 'text')
        .addColumn('campus', 'text', c => c.notNull())
        .addColumn('school', 'text')
        .addColumn('department', 'text')
        .addColumn('programme', 'text')
        .addColumn('year', 'integer')
        .addColumn('semester', 'integer')
        .addColumn('roles', 'text', c => c.notNull())
        .addColumn('status', 'text', c => c.notNull().defaultTo('active'))
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('organizations')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('type', 'text', c => c.notNull())
        .addColumn('name', 'text', c => c.notNull())
        .addColumn('slug', 'text', c => c.notNull().unique())
        .addColumn('description', 'text')
        .addColumn('contact_email', 'text')
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('organization_members')
        .addColumn('organization_id', 'text', c => c.notNull().references('organizations.id').onDelete('cascade'))
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('role', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('organization_members_pk', ['organization_id', 'user_id'])
        .execute();

      await db.schema
        .createTable('venues')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('name', 'text', c => c.notNull())
        .addColumn('campus', 'text', c => c.notNull())
        .addColumn('capacity', 'integer')
        .addColumn('maps_url', 'text')
        .execute();

      await db.schema
        .createTable('categories')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('name', 'text', c => c.notNull())
        .addColumn('slug', 'text', c => c.notNull().unique())
        .execute();

      await db.schema
        .createTable('events')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('slug', 'text', c => c.notNull().unique())
        .addColumn('organization_id', 'text', c => c.notNull().references('organizations.id'))
        .addColumn('category_id', 'text', c => c.notNull().references('categories.id'))
        .addColumn('title', 'text', c => c.notNull())
        .addColumn('summary', 'text')
        .addColumn('description', 'text', c => c.notNull())
        .addColumn('image', 'text')
        .addColumn('venue_id', 'text', c => c.references('venues.id'))
        .addColumn('mode', 'text', c => c.notNull().defaultTo('in_person'))
        .addColumn('online_url', 'text')
        .addColumn('starts_at', 'text', c => c.notNull())
        .addColumn('ends_at', 'text', c => c.notNull())
        .addColumn('registration_opens_at', 'text', c => c.notNull())
        .addColumn('registration_closes_at', 'text', c => c.notNull())
        .addColumn('capacity', 'integer', c => c.notNull())
        .addColumn('eligibility_text', 'text', c => c.notNull())
        .addColumn('eligible_departments', 'text')
        .addColumn('eligible_years', 'text')
        .addColumn('requirements', 'text', c => c.notNull().defaultTo('[]'))
        .addColumn('contact_person', 'text')
        .addColumn('contact_email', 'text')
        .addColumn('is_featured', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('status', 'text', c => c.notNull().defaultTo('draft'))
        .addColumn('created_by', 'text', c => c.notNull().references('users.id'))
        .addColumn('created_at', 'text', c => c.notNull())
        .addColumn('updated_at', 'text', c => c.notNull())
        .addColumn('published_at', 'text')
        .addCheckConstraint('events_capacity_positive', sql`capacity > 0`)
        .addCheckConstraint('events_time_order', sql`ends_at > starts_at`)
        .execute();
      await db.schema.createIndex('events_status_starts_idx').on('events').columns(['status', 'starts_at']).execute();

      await db.schema
        .createTable('registrations')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('event_id', 'text', c => c.notNull().references('events.id'))
        .addColumn('user_id', 'text', c => c.notNull().references('users.id'))
        .addColumn('status', 'text', c => c.notNull())
        .addColumn('registration_code', 'text', c => c.notNull().unique())
        .addColumn('phone', 'text')
        .addColumn('created_at', 'text', c => c.notNull())
        .addColumn('cancelled_at', 'text')
        .addColumn('cancel_reason', 'text')
        .execute();
      // Blueprint §8.3 invariant 1: one active registration per (event, student).
      // Partial unique indexes work the same way in SQLite and PostgreSQL.
      await db.schema
        .createIndex('registrations_one_active_per_user')
        .on('registrations')
        .columns(['event_id', 'user_id'])
        .unique()
        .where(sql<boolean>`status <> 'cancelled'`)
        .execute();
      await db.schema.createIndex('registrations_user_idx').on('registrations').column('user_id').execute();

      await db.schema
        .createTable('saved_events')
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('created_at', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('saved_events_pk', ['user_id', 'event_id'])
        .execute();

      await db.schema
        .createTable('notifications')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('category', 'text', c => c.notNull())
        .addColumn('title', 'text', c => c.notNull())
        .addColumn('body', 'text', c => c.notNull())
        .addColumn('link', 'text')
        .addColumn('created_at', 'text', c => c.notNull())
        .addColumn('read_at', 'text')
        .execute();
      await db.schema.createIndex('notifications_user_idx').on('notifications').columns(['user_id', 'created_at']).execute();

      await db.schema
        .createTable('feedback')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('registration_id', 'text', c => c.notNull().unique().references('registrations.id'))
        .addColumn('rating', 'integer', c => c.notNull())
        .addColumn('comment', 'text', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .addCheckConstraint('feedback_rating_range', sql`rating between 1 and 5`)
        .execute();

      await db.schema
        .createTable('sessions')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('created_at', 'text', c => c.notNull())
        .addColumn('expires_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('audit_log')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('actor_id', 'text')
        .addColumn('action', 'text', c => c.notNull())
        .addColumn('entity_type', 'text', c => c.notNull())
        .addColumn('entity_id', 'text', c => c.notNull())
        .addColumn('data', 'text')
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();
    },
  },

  // V2 — event operations: approval workflow, check-in and attendance,
  // announcements, change history, email outbox and scheduled reminders.
  '0002_event_operations': {
    async up(db: Kysely<unknown>) {
      await db.schema.alterTable('events').addColumn('cancel_requested_at', 'text').execute();
      await db.schema.alterTable('events').addColumn('cancel_requested_by', 'text').execute();
      await db.schema.alterTable('events').addColumn('cancel_request_reason', 'text').execute();

      await db.schema.alterTable('registrations').addColumn('source', 'text', c => c.notNull().defaultTo('self')).execute();
      await db.schema.createIndex('registrations_event_status_idx').on('registrations').columns(['event_id', 'status']).execute();

      await db.schema
        .createTable('approval_reviews')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('actor_id', 'text', c => c.notNull().references('users.id'))
        .addColumn('action', 'text', c => c.notNull())
        .addColumn('comments', 'text')
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();
      await db.schema.createIndex('approval_reviews_event_idx').on('approval_reviews').columns(['event_id', 'created_at']).execute();

      await db.schema
        .createTable('event_changes')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('field', 'text', c => c.notNull())
        .addColumn('old_value', 'text', c => c.notNull())
        .addColumn('new_value', 'text', c => c.notNull())
        .addColumn('reason', 'text', c => c.notNull())
        .addColumn('changed_by', 'text', c => c.notNull().references('users.id'))
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();
      await db.schema.createIndex('event_changes_event_idx').on('event_changes').columns(['event_id', 'created_at']).execute();

      await db.schema
        .createTable('check_ins')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('registration_id', 'text', c => c.notNull().unique().references('registrations.id'))
        .addColumn('event_id', 'text', c => c.notNull().references('events.id'))
        .addColumn('scanned_at', 'text', c => c.notNull())
        .addColumn('recorded_at', 'text', c => c.notNull())
        .addColumn('scanned_by', 'text', c => c.notNull().references('users.id'))
        .addColumn('method', 'text', c => c.notNull())
        .addColumn('device', 'text')
        .execute();
      await db.schema.createIndex('check_ins_event_idx').on('check_ins').column('event_id').execute();

      await db.schema
        .createTable('announcements')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('audience', 'text', c => c.notNull())
        .addColumn('title', 'text', c => c.notNull())
        .addColumn('body', 'text', c => c.notNull())
        .addColumn('author_id', 'text', c => c.notNull().references('users.id'))
        .addColumn('recipient_count', 'integer', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('email_outbox')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('user_id', 'text', c => c.references('users.id').onDelete('set null'))
        .addColumn('to_email', 'text', c => c.notNull())
        .addColumn('subject', 'text', c => c.notNull())
        .addColumn('body', 'text', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .addColumn('status', 'text', c => c.notNull().defaultTo('pending'))
        .addColumn('attempts', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('sent_at', 'text')
        .addColumn('last_error', 'text')
        .execute();
      await db.schema.createIndex('email_outbox_status_idx').on('email_outbox').columns(['status', 'created_at']).execute();

      await db.schema
        .createTable('scheduler_log')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('kind', 'text', c => c.notNull())
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('run_key', 'text', c => c.notNull())
        .addColumn('ran_at', 'text', c => c.notNull())
        .addColumn('recipients', 'integer', c => c.notNull())
        .addUniqueConstraint('scheduler_log_once', ['kind', 'event_id', 'run_key'])
        .execute();
    },
  },

  // V3 — student ecosystem: clubs and following, teams, waitlist with offers,
  // documents, custom questions, feedback dimensions, results, certificates,
  // opportunities, recaps and check-in volunteers.
  '0003_student_ecosystem': {
    async up(db: Kysely<unknown>) {
      const addColumns = async (table: string, columns: [string, 'text' | 'integer', string | number | null][]) => {
        for (const [name, type, def] of columns) {
          await db.schema
            .alterTable(table)
            .addColumn(name, type, c => (def === null ? c : c.notNull().defaultTo(def)))
            .execute();
        }
      };

      await addColumns('organizations', [
        ['status', 'text', 'active'],
        ['logo_url', 'text', null],
        ['social_links', 'text', '{}'],
        ['recruitment', 'text', null],
      ]);
      await addColumns('events', [
        ['participation', 'text', 'individual'],
        ['team_min', 'integer', null],
        ['team_max', 'integer', null],
        ['waitlist_enabled', 'integer', 1],
        ['offer_window_hours', 'integer', 12],
        ['questions', 'text', '[]'],
        ['required_documents', 'text', '[]'],
        ['cancellation_cutoff_hours', 'integer', null],
        ['certificate_rule', 'text', 'none'],
        ['recap', 'text', null],
        ['gallery', 'text', '[]'],
        ['results_published_at', 'text', null],
      ]);
      await addColumns('registrations', [
        ['team_id', 'text', null],
        ['answers', 'text', null],
        ['offer_expires_at', 'text', null],
        ['payment_due_at', 'text', null],
      ]);
      await addColumns('feedback', [
        ['content_rating', 'integer', null],
        ['speaker_rating', 'integer', null],
        ['organization_rating', 'integer', null],
        ['venue_rating', 'integer', null],
        ['registration_rating', 'integer', null],
        ['would_attend_again', 'integer', null],
      ]);

      // Invariant §8.3 #1, restated for the waitlist: an expired waitlist
      // place doesn't count as an active registration either.
      await db.schema.dropIndex('registrations_one_active_per_user').execute();
      await db.schema
        .createIndex('registrations_one_active_per_user')
        .on('registrations')
        .columns(['event_id', 'user_id'])
        .unique()
        .where(sql<boolean>`status not in ('cancelled', 'waitlist_expired')`)
        .execute();
      await db.schema.createIndex('registrations_team_idx').on('registrations').column('team_id').execute();

      await db.schema
        .createTable('follows')
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('organization_id', 'text', c => c.notNull().references('organizations.id').onDelete('cascade'))
        .addColumn('created_at', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('follows_pk', ['user_id', 'organization_id'])
        .execute();

      await db.schema
        .createTable('teams')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('event_id', 'text', c => c.notNull().references('events.id'))
        .addColumn('name', 'text', c => c.notNull())
        .addColumn('leader_id', 'text', c => c.notNull().references('users.id'))
        .addColumn('invite_code', 'text', c => c.notNull().unique())
        .addColumn('status', 'text', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();
      await db.schema.createIndex('teams_event_idx').on('teams').column('event_id').execute();

      await db.schema
        .createTable('registration_documents')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('registration_id', 'text', c => c.notNull().references('registrations.id'))
        .addColumn('requirement_id', 'text', c => c.notNull())
        .addColumn('stored_name', 'text', c => c.notNull())
        .addColumn('original_name', 'text', c => c.notNull())
        .addColumn('mime_type', 'text', c => c.notNull())
        .addColumn('size_bytes', 'integer', c => c.notNull())
        .addColumn('status', 'text', c => c.notNull())
        .addColumn('rejection_reason', 'text')
        .addColumn('submitted_at', 'text', c => c.notNull())
        .addColumn('reviewed_by', 'text')
        .addColumn('reviewed_at', 'text')
        .execute();
      await db.schema.createIndex('registration_documents_reg_idx').on('registration_documents').columns(['registration_id', 'requirement_id']).execute();

      await db.schema
        .createTable('results')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('position', 'integer', c => c.notNull())
        .addColumn('title', 'text', c => c.notNull())
        .addColumn('registration_id', 'text', c => c.references('registrations.id'))
        .addColumn('team_id', 'text', c => c.references('teams.id'))
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('certificates')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('code', 'text', c => c.notNull().unique())
        .addColumn('registration_id', 'text', c => c.notNull().references('registrations.id'))
        .addColumn('kind', 'text', c => c.notNull())
        .addColumn('title', 'text', c => c.notNull())
        .addColumn('issued_at', 'text', c => c.notNull())
        .addColumn('issued_by', 'text', c => c.notNull().references('users.id'))
        .addColumn('revoked_at', 'text')
        .addColumn('revoke_reason', 'text')
        .addUniqueConstraint('certificates_one_per_kind', ['registration_id', 'kind'])
        .execute();

      await db.schema
        .createTable('opportunities')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('type', 'text', c => c.notNull())
        .addColumn('title', 'text', c => c.notNull())
        .addColumn('provider', 'text', c => c.notNull())
        .addColumn('description', 'text', c => c.notNull())
        .addColumn('deadline', 'text', c => c.notNull())
        .addColumn('eligibility_text', 'text', c => c.notNull())
        .addColumn('eligible_departments', 'text')
        .addColumn('eligible_years', 'text')
        .addColumn('external_url', 'text')
        .addColumn('tags', 'text', c => c.notNull().defaultTo('[]'))
        .addColumn('organization_id', 'text', c => c.references('organizations.id'))
        .addColumn('created_by', 'text', c => c.notNull().references('users.id'))
        .addColumn('status', 'text', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('saved_opportunities')
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('opportunity_id', 'text', c => c.notNull().references('opportunities.id').onDelete('cascade'))
        .addColumn('created_at', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('saved_opportunities_pk', ['user_id', 'opportunity_id'])
        .execute();

      // Once-only log for "deadline tomorrow" reminders on saved opportunities.
      await db.schema
        .createTable('opportunity_reminders')
        .addColumn('opportunity_id', 'text', c => c.notNull().references('opportunities.id').onDelete('cascade'))
        .addColumn('deadline', 'text', c => c.notNull())
        .addColumn('sent_at', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('opportunity_reminders_pk', ['opportunity_id', 'deadline'])
        .execute();

      await db.schema
        .createTable('event_volunteers')
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('added_by', 'text', c => c.notNull().references('users.id'))
        .addColumn('created_at', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('event_volunteers_pk', ['event_id', 'user_id'])
        .execute();
    },
  },

  // V4 — platform intelligence: interests for recommendations, and event views for the analytics funnel.
  '0004_platform_intelligence': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('user_preferences')
        .addColumn('user_id', 'text', c => c.primaryKey().references('users.id').onDelete('cascade'))
        .addColumn('interests', 'text', c => c.notNull().defaultTo('[]'))
        .addColumn('personalization_enabled', 'integer', c => c.notNull().defaultTo(1))
        .addColumn('updated_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('event_views')
        .addColumn('event_id', 'text', c => c.notNull().references('events.id').onDelete('cascade'))
        .addColumn('viewer_key', 'text', c => c.notNull())
        .addColumn('day', 'text', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('event_views_pk', ['event_id', 'viewer_key', 'day'])
        .execute();
    },
  },

  // V5 — integrations: payments, push, SMS/WhatsApp, calendar feeds, notification preferences.
  '0005_integrations': {
    async up(db: Kysely<unknown>) {
      await db.schema.alterTable('events').addColumn('fee_amount', 'integer', c => c.notNull().defaultTo(0)).execute();

      // The email outbox becomes the outbox for every external channel.
      await db.schema.alterTable('email_outbox').renameTo('message_outbox').execute();
      await db.schema.alterTable('message_outbox').renameColumn('to_email', 'to_address').execute();
      await db.schema.alterTable('message_outbox').addColumn('channel', 'text', c => c.notNull().defaultTo('email')).execute();

      await db.schema
        .createTable('notification_prefs')
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('category', 'text', c => c.notNull())
        .addColumn('channel', 'text', c => c.notNull())
        .addColumn('enabled', 'integer', c => c.notNull())
        .addPrimaryKeyConstraint('notification_prefs_pk', ['user_id', 'category', 'channel'])
        .execute();

      await db.schema
        .createTable('push_subscriptions')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('user_id', 'text', c => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('endpoint', 'text', c => c.notNull().unique())
        .addColumn('p256dh', 'text', c => c.notNull())
        .addColumn('auth', 'text', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();

      await db.schema
        .createTable('payments')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('registration_id', 'text', c => c.notNull().references('registrations.id'))
        .addColumn('amount', 'integer', c => c.notNull())
        .addColumn('currency', 'text', c => c.notNull())
        .addColumn('gateway', 'text', c => c.notNull())
        .addColumn('gateway_order_id', 'text', c => c.notNull().unique())
        .addColumn('gateway_payment_id', 'text')
        .addColumn('status', 'text', c => c.notNull())
        .addColumn('created_at', 'text', c => c.notNull())
        .addColumn('paid_at', 'text')
        .addColumn('refunded_at', 'text')
        .addColumn('refund_ref', 'text')
        .execute();
      await db.schema.createIndex('payments_registration_idx').on('payments').column('registration_id').execute();

      await db.schema
        .createTable('calendar_feeds')
        .addColumn('user_id', 'text', c => c.primaryKey().references('users.id').onDelete('cascade'))
        .addColumn('token_hash', 'text', c => c.notNull().unique())
        .addColumn('created_at', 'text', c => c.notNull())
        .execute();
    },
  },

  // Source-based content: real CUTM events often don't state an organizer,
  // capacity, fee, registration window, eligibility or exact time. Those
  // columns become nullable ("not specified") instead of holding invented
  // values, and events gain a type, tags, time-TBD, registration mode, source
  // note and a sample flag. Also installs the full category taxonomy.
  //
  // SQLite can't relax NOT NULL in place, so the table is rebuilt the
  // documented way (sqlite.org/lang_altertable.html#otheralter): with foreign
  // keys paused, copy into a new table, drop, rename, then check every
  // reference. Kysely runs SQLite migrations outside a transaction, so this
  // migration opens its own.
  '0006_source_based_events': {
    async up(db: Kysely<unknown>) {
      const run = (q: ReturnType<typeof sql>) => q.execute(db);

      await db.schema.alterTable('categories').addColumn('position', 'integer', c => c.notNull().defaultTo(0)).execute();
      const taxonomy: [string, string, string][] = [
        ['cat-technical', 'Technical', 'technical'],
        ['cat-competitions', 'Competitions', 'competitions'],
        ['cat-workshop', 'Workshops', 'workshops'],
        ['cat-seminars', 'Seminars & Talks', 'seminars-talks'],
        ['cat-research', 'Research', 'research'],
        ['cat-sports', 'Sports', 'sports'],
        ['cat-cultural', 'Cultural', 'cultural'],
        ['cat-clubs', 'Clubs & Societies', 'clubs-societies'],
        ['cat-student-development', 'Student Development', 'student-development'],
        ['cat-social-impact', 'Social Impact', 'social-impact'],
        ['cat-wellness', 'Wellness', 'wellness'],
        ['cat-career', 'Career', 'career'],
        ['cat-other', 'Other', 'other'],
      ];
      for (const [i, [id, name, slug]] of taxonomy.entries()) {
        await run(sql`insert into categories (id, name, slug, position) values (${id}, ${name}, ${slug}, ${i + 1})
                      on conflict(id) do update set name = excluded.name, slug = excluded.slug, position = excluded.position`);
      }

      const kept = [
        'id', 'slug', 'organization_id', 'category_id', 'title', 'summary', 'description', 'image', 'venue_id', 'mode', 'online_url',
        'starts_at', 'ends_at', 'registration_opens_at', 'registration_closes_at', 'capacity', 'eligibility_text', 'eligible_departments',
        'eligible_years', 'requirements', 'contact_person', 'contact_email', 'is_featured', 'status', 'created_by', 'created_at', 'updated_at',
        'published_at', 'cancel_requested_at', 'cancel_requested_by', 'cancel_request_reason', 'participation', 'team_min', 'team_max',
        'waitlist_enabled', 'offer_window_hours', 'questions', 'required_documents', 'cancellation_cutoff_hours', 'certificate_rule', 'recap',
        'gallery', 'results_published_at', 'fee_amount',
      ].join(', ');

      await run(sql`pragma foreign_keys = off`);
      try {
        await run(sql`begin`);
        await run(sql.raw(`
          create table events_new (
            id text primary key,
            slug text not null unique,
            organization_id text references organizations(id),
            category_id text not null references categories(id),
            title text not null,
            summary text,
            description text not null,
            image text,
            venue_id text references venues(id),
            mode text not null default 'in_person',
            online_url text,
            starts_at text not null,
            ends_at text not null,
            registration_opens_at text,
            registration_closes_at text,
            capacity integer,
            eligibility_text text,
            eligible_departments text,
            eligible_years text,
            requirements text not null default '[]',
            contact_person text,
            contact_email text,
            is_featured integer not null default 0,
            status text not null default 'draft',
            created_by text not null references users(id),
            created_at text not null,
            updated_at text not null,
            published_at text,
            cancel_requested_at text,
            cancel_requested_by text,
            cancel_request_reason text,
            participation text not null default 'individual',
            team_min integer,
            team_max integer,
            waitlist_enabled integer not null default 1,
            offer_window_hours integer not null default 12,
            questions text not null default '[]',
            required_documents text not null default '[]',
            cancellation_cutoff_hours integer,
            certificate_rule text not null default 'none',
            recap text,
            gallery text not null default '[]',
            results_published_at text,
            fee_amount integer,
            event_type text not null default 'other',
            tags text not null default '[]',
            time_tbd integer not null default 0,
            registration_mode text not null default 'eventease',
            source_note text,
            is_sample integer not null default 0,
            constraint events_capacity_positive check (capacity is null or capacity > 0),
            constraint events_time_order check (ends_at > starts_at),
            constraint events_registration_window check (
              registration_mode <> 'eventease' or (registration_opens_at is not null and registration_closes_at is not null)
            )
          )`));
        await run(sql.raw(`insert into events_new (${kept}) select ${kept} from events`));
        // Events with the built-in sample ids are the fictional sample set.
        await run(sql.raw(`update events_new set is_sample = 1 where id in ('e1','e2','e3','e4','e5','e6','e7','e8','e9','e10')`));
        await run(sql`drop table events`);
        await run(sql`alter table events_new rename to events`);
        await run(sql`create index events_status_starts_idx on events (status, starts_at)`);
        const broken = await sql`pragma foreign_key_check`.execute(db);
        if (broken.rows.length) throw new Error(`Foreign key check failed after rebuilding events: ${JSON.stringify(broken.rows.slice(0, 3))}`);
        await run(sql`commit`);
      } catch (err) {
        await run(sql`rollback`).catch(() => undefined);
        throw err;
      } finally {
        await run(sql`pragma foreign_keys = on`);
      }
    },
  },
};
