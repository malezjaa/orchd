-- The model a session's agent is actually running (reported via
-- `SessionInit.model`), and a running total of context tokens the model has
-- read so far (input + cache-read + cache-creation from the latest
-- `UsageUpdate`), so both are queryable without replaying the event log.
-- Both NULL until the adapter has reported anything.
ALTER TABLE sessions ADD COLUMN model TEXT;
ALTER TABLE sessions ADD COLUMN context_tokens_used INTEGER;
