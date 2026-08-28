// Hand-written stand-in for Convex codegen output. This project has not run
// `npx convex dev` yet (it requires an interactive browser login this
// environment cannot perform - see the project audit). Running it once will
// regenerate this file from convex/schema.ts automatically; that's safe,
// this is written to match what codegen produces.
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  SystemTableNames,
  TableNamesInDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";

import schema from "../schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;
