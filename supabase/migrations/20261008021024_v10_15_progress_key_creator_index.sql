-- Cover administrator FK checks when accounts are removed; no existing data changes.
create index progress_api_keys_creator_v1015_idx on spark_private.progress_api_keys_v1015(created_by);
