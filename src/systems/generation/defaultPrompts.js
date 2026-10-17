/**
 * Default Prompt Constants
 * Pure template-string constants shared by generation modules (injector) and the Prompts Editor UI. Kept import-free so pulling a constant
 * never drags UI modules into the load graph.
 */
// ─── Default Prompt: New Fields Boost ────────────────────────────────────────
// Injected when new tracker fields are enabled, reminding the AI to include them.
// {fieldList} is replaced with the list of newly-enabled field descriptions.
export const DEFAULT_NEW_FIELDS_BOOST_PROMPT = `[TRACKER NOTE: The following fields have just been enabled and MUST be included in the infoBox JSON this turn: {fieldList}. Do not omit them.]`;

