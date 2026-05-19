export const sql = `
ALTER TABLE source_change_events
  DROP CONSTRAINT IF EXISTS source_change_events_check_target_id_fkey;
`;
