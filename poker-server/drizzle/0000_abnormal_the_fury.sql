CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"last_used_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_emoji" text NOT NULL,
	"password_hash" text,
	"passkeys" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_events" (
	"room_id" text NOT NULL,
	"seq" integer NOT NULL,
	"record_id" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"type" text NOT NULL,
	"message_seq" integer,
	"record" jsonb NOT NULL,
	CONSTRAINT "chat_events_room_id_seq_pk" PRIMARY KEY("room_id","seq")
);
--> statement-breakpoint
CREATE TABLE "chat_indexes" (
	"room_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"next_seq" integer NOT NULL,
	"log_seq" integer NOT NULL,
	"latest_messages" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hand_events" (
	"room_id" text NOT NULL,
	"hand_number" integer NOT NULL,
	"seq" integer NOT NULL,
	"timestamp" bigint NOT NULL,
	"type" text NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "hand_events_room_id_hand_number_seq_pk" PRIMARY KEY("room_id","hand_number","seq")
);
--> statement-breakpoint
CREATE TABLE "room_events" (
	"room_id" text NOT NULL,
	"seq" integer NOT NULL,
	"record_id" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"type" text NOT NULL,
	"hand_number" integer,
	"street" text,
	"actor" jsonb,
	"payload" jsonb NOT NULL,
	CONSTRAINT "room_events_room_id_seq_pk" PRIMARY KEY("room_id","seq")
);
--> statement-breakpoint
CREATE TABLE "room_snapshots" (
	"room_id" text PRIMARY KEY NOT NULL,
	"last_room_event_seq" integer NOT NULL,
	"updated_at" bigint NOT NULL,
	"room" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_game_archives" (
	"archive_id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"started_at" bigint NOT NULL,
	"concluded_at" bigint NOT NULL,
	"hand_count" integer NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_game_user_indexes" (
	"requester_user_id" text NOT NULL,
	"archive_id" text NOT NULL,
	"concluded_at" bigint NOT NULL,
	"summary" jsonb NOT NULL,
	CONSTRAINT "saved_game_user_indexes_requester_user_id_archive_id_pk" PRIMARY KEY("requester_user_id","archive_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_account_id_idx" ON "auth_users" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_events_record_id_idx" ON "chat_events" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_events_record_id_idx" ON "room_events" USING btree ("record_id");