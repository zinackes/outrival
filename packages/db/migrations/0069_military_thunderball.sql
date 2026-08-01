CREATE TABLE "ai_visibility_engine_budget" (
	"engine" text NOT NULL,
	"model" text NOT NULL,
	"day" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"next_call_allowed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_visibility_engine_budget_engine_model_pk" PRIMARY KEY("engine","model")
);
