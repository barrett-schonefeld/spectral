import { ISchemaOptions } from '../../../functions/schema';
import { IFunction, IFunctionContext } from '../../../types';
import * as traverse from 'json-schema-traverse';
import { SchemaObject } from 'json-schema-traverse';

const oasSchema: IFunction<ISchemaOptions> = function (this: IFunctionContext, targetVal, opts, paths, otherValues) {
  const formats = otherValues.documentInventory.document.formats;

  let { schema } = opts;

  if (Array.isArray(formats)) {
    try {
      if (formats.includes('oas2')) {
        schema = convertXNullable({ ...schema });
        traverse(schema, visitOAS2);
      } else if (formats.includes('oas3')) {
        schema = convertNullable({ ...schema });
        traverse(schema, visitOAS3);
      }
    } catch {
      // just in case
    }
  }

  return this.functions.schema.call(this, targetVal, { ...opts, schema, dialect: 'draft4' }, paths, otherValues);
};

export default oasSchema;

const visitOAS2: traverse.Callback = (
  schema,
  jsonPtr,
  rootSchema,
  parentJsonPtr,
  parentKeyword,
  parentSchema,
  keyIndex,
) => {
  if (parentSchema !== void 0 && keyIndex !== void 0 && jsonPtr !== void 0) {
    const actualSchema = get(parentSchema, jsonPtr);
    if (actualSchema !== null) {
      actualSchema[keyIndex] = convertXNullable({ ...schema });
    }
  }
};

const visitOAS3: traverse.Callback = (
  schema,
  jsonPtr,
  rootSchema,
  parentJsonPtr,
  parentKeyword,
  parentSchema,
  keyIndex,
) => {
  if (parentSchema !== void 0 && keyIndex !== void 0 && jsonPtr !== void 0) {
    const actualSchema = get(parentSchema, jsonPtr);
    if (actualSchema !== null) {
      actualSchema[keyIndex] = convertNullable({ ...schema });
    }
  }
};

function get(obj: SchemaObject, jsonPtr: string): SchemaObject | null {
  const path = jsonPtr.slice(1).split('/');
  if (path.length === 1) {
    return obj;
  }

  path.pop();

  let curObj: SchemaObject = obj;
  for (const segment of path) {
    const value = curObj[segment];
    curObj[segment] = Array.isArray(value) ? value.slice() : { ...value };
    curObj = curObj[segment];
  }

  return curObj;
}

const createNullableConverter = (keyword: 'x-nullable' | 'nullable') => {
  return (schema: SchemaObject): SchemaObject => {
    if (!(keyword in schema)) return schema;
    if (schema[keyword] === true) {
      schema.type = [schema.type, 'null'];

      if (Array.isArray(schema.enum)) {
        schema.enum = [...schema.enum, null];
      }
    }

    delete schema[keyword];
    return schema;
  };
};

const convertXNullable = createNullableConverter('x-nullable');
const convertNullable = createNullableConverter('nullable');
