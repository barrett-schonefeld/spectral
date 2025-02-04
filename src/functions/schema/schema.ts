import { ValidateFunction, ErrorObject } from 'ajv';
import * as betterAjvErrors from '@stoplight/better-ajv-errors';
import { IFunction, IFunctionResult } from '../../types/function';
import { detectDialect } from '../../formats';
import MissingRefError from 'ajv/dist/compile/ref_error';
import { assignAjvInstance } from './ajv';
import ajvErrors from 'ajv-errors';
import Ajv, { Options } from 'ajv';
import addFormats from 'ajv-formats';
import { Dictionary, Optional } from '@stoplight/types';
import { draft7 } from 'json-schema-migrate';

export interface ISchemaFunction extends IFunction<ISchemaOptions> {
  createAJVInstance(opts: Options): Ajv;
}

export interface ISchemaOptions {
  schema: object;
  allErrors?: boolean;
  ajv?: ValidateFunction;
  dialect?: 'auto' | 'draft4' | 'draft6' | 'draft7' | 'draft2019-09' | 'draft2020-12';
  prepareResults?(errors: ErrorObject[]): void;
}

export const schema: ISchemaFunction = (targetVal, opts, paths, { rule }) => {
  const path = paths.target ?? paths.given;

  if (targetVal === void 0) {
    return [
      {
        path,
        message: `#{{print("property")}}does not exist`,
      },
    ];
  }

  const results: IFunctionResult[] = [];

  // we already access a resolved object in src/functions/schema-path.ts
  const { allErrors = false } = opts;
  let { schema: schemaObj } = opts;

  let validator = opts.ajv;

  try {
    if (validator === void 0) {
      const dialect = opts?.dialect ?? detectDialect(schemaObj) ?? 'draft7';
      if (dialect === 'draft4' || dialect === 'draft6') {
        schemaObj = JSON.parse(JSON.stringify(schemaObj));
        (schemaObj as Dictionary<unknown>).$schema = 'http://json-schema.org/draft-07/schema#';
        draft7(schemaObj);
      }

      const ajv = assignAjvInstance(dialect, allErrors);

      const $id = (schemaObj as Dictionary<unknown>).$id;

      if (typeof $id !== 'string') {
        validator = ajv.compile(schemaObj);
      } else {
        validator = ajv.getSchema($id) as Optional<ValidateFunction>;
        if (validator === void 0) {
          validator = ajv.compile(schemaObj);
        }
      }
    }

    if (validator?.(targetVal) === false && Array.isArray(validator.errors)) {
      opts.prepareResults?.(validator.errors);

      results.push(
        ...betterAjvErrors(schemaObj, validator.errors, {
          propertyPath: path,
          targetValue: targetVal,
        }).map(({ suggestion, error, path: errorPath }) => ({
          message: suggestion !== void 0 ? `${error}. ${suggestion}` : error,
          path: [...path, ...(errorPath !== '' ? errorPath.replace(/^\//, '').split('/') : [])],
        })),
      );
    }
  } catch (ex) {
    if (!(ex instanceof MissingRefError)) {
      throw ex;
    } else if (!rule.resolved) {
      // let's ignore any $ref errors if schema fn is provided with already resolved content,
      // if our resolver fails to resolve them,
      // ajv is unlikely to do it either, since it won't have access to the whole document, but a small portion of it
      results.push({
        message: ex.message,
        path,
      });
    }
  }

  return results;
};

// eslint-disable-next-line @typescript-eslint/unbound-method
schema.createAJVInstance = (opts: Options): Ajv => {
  const ajv = new Ajv(opts);
  addFormats(ajv);
  if (opts.allErrors) {
    ajvErrors(ajv);
  }
  return ajv;
};
