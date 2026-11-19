import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const eventState = sqliteTable("event_state", { id: text("id").primaryKey(), version: integer("version").notNull(), body: text("body").notNull() });
